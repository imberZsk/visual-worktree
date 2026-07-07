import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { registerIpcHandlers } from '../electron/ipcHandlers.js';
import { IPC } from '../electron/ipcChannels.js';
import { makeTempRoot, initRepo, git } from './helpers.js';
import { DEFAULT_CONFIG, loadConfig, saveConfig } from '../src/core/config.js';

// IPC 层接口测试：用 mock ipcMain 捕获 handler，直接调用验证转发到 gitService 正确。
// 不启动 Electron，纯逻辑验证。

/**
 * 创建 mock ipcMain，记录注册的 handler 以便直接调用
 * @returns {{ipcMain:object, invoke:(channel:string,...args:any[])=>Promise<any>}} mock 与调用器
 */
function makeMockIpc() {
  // handlers 存储 channel → handler 映射
  const handlers = {};
  const ipcMain = {
    handle: (channel, fn) => {
      handlers[channel] = fn;
    },
  };
  // invoke 模拟渲染进程调用：第一个参数 event 传 null
  const invoke = (channel, ...args) => {
    if (!handlers[channel]) throw new Error(`no handler for ${channel}`);
    return handlers[channel](null, ...args);
  };
  return { ipcMain, invoke, handlers };
}

describe('registerIpcHandlers', () => {
  let ctx;
  let mock;
  let dataDir;
  let envFileSnapshot;
  let histFileSnapshot;
  beforeEach(() => {
    ctx = makeTempRoot();
    mock = makeMockIpc();
    // dataDir 存储本用例的 Visual Worktree 持久化临时目录，避免测试写入用户真实 ~/.visualWorktree
    dataDir = join(ctx.root, 'visualWorktree-data');
    // envFileSnapshot 记录真实环境检查缓存的原始内容；RED 阶段旧实现仍可能误写真实目录，afterEach 会原样恢复
    const envFile = join(homedir(), '.visualWorktree', 'task-env-health.json');
    envFileSnapshot = existsSync(envFile) ? readFileSync(envFile, 'utf8') : null;
    // histFileSnapshot 记录真实历史文件的原始内容；避免 IPC 历史测试污染用户真实数据
    const histFile = join(homedir(), '.visualWorktree', 'task-history.json');
    histFileSnapshot = existsSync(histFile) ? readFileSync(histFile, 'utf8') : null;
    // 注入一个假窗口收集进度事件
    mock.sentEvents = [];
    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { send: (ch, payload) => mock.sentEvents.push({ ch, payload }) },
    };
    // dialog 模拟 Electron 系统对话框，供目录选择 IPC 测试断言。
    mock.dialog = { showOpenDialog: vi.fn() };
    registerIpcHandlers(mock.ipcMain, {
      getWindow: () => fakeWindow,
      shell: { openPath: () => {} },
      // mock clipboard：记录最后写入的文本，供 COPY_TEXT 用例断言
      clipboard: { writeText: (t) => { mock.clipboardText = t; } },
      // mock dialog：记录目录选择器调用，供 SELECT_DIRECTORY 用例断言
      dialog: mock.dialog,
      // 测试持久化目录：所有 ~/.visualWorktree 类文件都应写到临时目录，不能污染真实用户数据
      dataDir,
    });
  });
  afterEach(() => {
    ctx.cleanup();
    // histFile 真实历史文件路径；若 RED 阶段旧实现误写真实目录，则按快照恢复
    const histFile = join(homedir(), '.visualWorktree', 'task-history.json');
    if (histFileSnapshot === null) {
      if (existsSync(histFile)) unlinkSync(histFile);
    } else {
      writeFileSync(histFile, histFileSnapshot, 'utf8');
    }
    // envFile 真实环境检查缓存文件路径；若 RED 阶段旧实现误写真实目录，则按快照恢复
    const envFile = join(homedir(), '.visualWorktree', 'task-env-health.json');
    if (envFileSnapshot === null) {
      if (existsSync(envFile)) unlinkSync(envFile);
    } else {
      writeFileSync(envFile, envFileSnapshot, 'utf8');
    }
  });

  it('registers all expected channels', () => {
    for (const ch of Object.values(IPC)) {
      // BATCH_PROGRESS / STEP_OUTPUT 是主进程→渲染进程的推送通道，不是 handle 通道
      if (ch === IPC.BATCH_PROGRESS || ch === IPC.STEP_OUTPUT) continue;
      expect(typeof mock.handlers[ch]).toBe('function');
    }
  });

  it('SCAN_PROJECTS forwards to gitService and returns project list', async () => {
    initRepo(join(ctx.root, 'r1'), 'master');
    initRepo(join(ctx.root, 'r2'), 'master');
    const result = await mock.invoke(IPC.SCAN_PROJECTS, { path: ctx.root });
    expect(result.length).toBe(2);
    expect(result.map((p) => p.name).sort()).toEqual(['r1', 'r2']);
  });

  it('CHECKOUT_BRANCH switches branch via IPC', async () => {
    const repo = initRepo(join(ctx.root, 'co'), 'master');
    git(repo, 'branch dev');
    const res = await mock.invoke(IPC.CHECKOUT_BRANCH, repo, 'dev');
    expect(res.success).toBe(true);
    const status = await mock.invoke(IPC.GET_PROJECT_STATUS, repo);
    expect(status.currentBranch).toBe('dev');
  });

  it('BATCH_OPERATE pushes progress events to the window', async () => {
    const r1 = initRepo(join(ctx.root, 'b1'), 'master');
    git(r1, 'branch dev');
    const results = await mock.invoke(IPC.BATCH_OPERATE, [r1], 'checkout', { branch: 'dev' });
    expect(results[0].success).toBe(true);
    // progress events should have been sent
    expect(mock.sentEvents.some((e) => e.ch === IPC.BATCH_PROGRESS)).toBe(true);
    const last = mock.sentEvents[mock.sentEvents.length - 1];
    expect(last.payload.done).toBe(1);
  });

  it('GET_WORKTREES returns worktree list', async () => {
    const repo = initRepo(join(ctx.root, 'wt'), 'master');
    const wts = await mock.invoke(IPC.GET_WORKTREES, repo);
    expect(wts.length).toBe(1);
    expect(wts[0].isMain).toBe(true);
  });

  it('GET_COMMITS returns recent commits', async () => {
    const repo = initRepo(join(ctx.root, 'log'), 'master');
    const commits = await mock.invoke(IPC.GET_COMMITS, repo, 5);
    expect(commits.length).toBe(1);
    expect(commits[0].message).toBe('init');
  });

  it('SCAN_WORKTREES_BY_TASK groups worktrees under a task dir', async () => {
    // 构造 projectsRoot 与 worktreesRoot，显式传入覆盖配置默认值
    const { mkdirSync } = await import('fs');
    const projectsRoot = join(ctx.root, 'projects');
    const worktreesRoot = join(ctx.root, 'worktrees');
    mkdirSync(projectsRoot, { recursive: true });
    const repo = initRepo(join(projectsRoot, 'projA'), 'master');
    git(repo, `worktree add -q -b feat/t1 ${join(worktreesRoot, 'TASK-1', 'projA')}`);
    const tasks = await mock.invoke(IPC.SCAN_WORKTREES_BY_TASK, { projectsRoot, worktreesRoot, status: false });
    expect(tasks.length).toBe(1);
    expect(tasks[0].task).toBe('TASK-1');
    expect(tasks[0].worktrees[0].branch).toBe('feat/t1');
  });

  it('ADD_WORKTREE then REMOVE_WORKTREE works via IPC', async () => {
    const { existsSync } = await import('fs');
    const repo = initRepo(join(ctx.root, 'projB'), 'master');
    const target = join(ctx.root, 'wt-b', 'projB');
    const addRes = await mock.invoke(IPC.ADD_WORKTREE, repo, target, 'feat/b', { newBranch: true });
    expect(addRes.success).toBe(true);
    expect(existsSync(target)).toBe(true);
    const rmRes = await mock.invoke(IPC.REMOVE_WORKTREE, repo, target, {});
    expect(rmRes.success).toBe(true);
    expect(existsSync(target)).toBe(false);
  });

  it('BATCH_ADD_WORKTREE creates worktrees for multiple projects', async () => {
    const { existsSync, mkdirSync } = await import('fs');
    const projectsRoot = join(ctx.root, 'projects2');
    const worktreesRoot = join(ctx.root, 'worktrees2');
    mkdirSync(projectsRoot, { recursive: true });
    const projA = initRepo(join(projectsRoot, 'projA'), 'master');
    const projB = initRepo(join(projectsRoot, 'projB'), 'master');
    const results = await mock.invoke(IPC.BATCH_ADD_WORKTREE, {
      projectPaths: [projA, projB],
      worktreesRoot,
      task: 'PROJ-1',
      branch: 'feat/batch',
      newBranch: true,
    });
    expect(results.every((r) => r.success)).toBe(true);
    expect(existsSync(join(worktreesRoot, 'PROJ-1', 'projA'))).toBe(true);
  });

  it('ARCHIVE_TASK_DOCS 归档任务 docs 并返回归档路径', async () => {
    // taskDir 存储待删除任务目录，内部按项目保存 docs 工作记录。
    const taskDir = join(ctx.root, 'worktrees', 'TASK-IPC');
    mkdirSync(join(taskDir, 'projA', 'docs'), { recursive: true });
    writeFileSync(join(taskDir, 'projA', 'docs', 'note.md'), 'note');

    // result 存储归档 IPC 返回值。
    const result = await mock.invoke(IPC.ARCHIVE_TASK_DOCS, taskDir, 'TASK-IPC');

    expect(result.success).toBe(true);
    expect(result.docsPath).toBe(join(dataDir, 'task-docs', 'TASK-IPC'));
    expect(result.archivedProjects).toBe(1);
    expect(readFileSync(join(dataDir, 'task-docs', 'TASK-IPC', 'projA', 'note.md'), 'utf8')).toBe('note');
  });

  it('ARCHIVE_TASK_DOCS 按配置的工作文档模板归档文件和目录', async () => {
    // taskDir 存储待删除任务目录，内部包含用户自定义工作文档。
    const taskDir = join(ctx.root, 'worktrees', 'TASK-IPC-CUSTOM');
    mkdirSync(join(taskDir, 'projA', 'records'), { recursive: true });
    mkdirSync(join(taskDir, 'projA', '.ai'), { recursive: true });
    writeFileSync(join(taskDir, 'projA', 'records', 'note.md'), 'note');
    writeFileSync(join(taskDir, 'projA', '.ai', 'summary.md'), 'summary');
    saveConfig({
      workDocumentTemplates: [
        { type: 'directory', path: 'records', content: '' },
        { type: 'file', path: '.ai/summary.md', content: '' },
      ],
    }, dataDir);

    // result 存储归档 IPC 返回值。
    const result = await mock.invoke(IPC.ARCHIVE_TASK_DOCS, taskDir, 'TASK-IPC-CUSTOM');

    expect(result.success).toBe(true);
    expect(result.archivedProjects).toBe(1);
    expect(readFileSync(join(dataDir, 'task-docs', 'TASK-IPC-CUSTOM', 'projA', 'records', 'note.md'), 'utf8')).toBe('note');
    expect(readFileSync(join(dataDir, 'task-docs', 'TASK-IPC-CUSTOM', 'projA', '.ai', 'summary.md'), 'utf8')).toBe('summary');
  });

  it('RUN_WORKFLOW_STEP 流式执行真实命令并通过 STEP_OUTPUT 推送输出', async () => {
    // 用 echo 真实命令验证：在任务目录下执行、过程中推送 STEP_OUTPUT、结束回传 success
    const res = await mock.invoke(IPC.RUN_WORKFLOW_STEP, {
      command: 'echo hi',
      cwd: ctx.root,
      taskName: 'TASK-RUN',
      stepKey: 'check',
    });
    expect(res.success).toBe(true);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('hi');
    // 执行过程中应至少推送过一次 STEP_OUTPUT 事件，且带正确路由标识
    const stepEvents = mock.sentEvents.filter((e) => e.ch === IPC.STEP_OUTPUT);
    expect(stepEvents.length).toBeGreaterThan(0);
    expect(stepEvents[0].payload).toMatchObject({ taskName: 'TASK-RUN', stepKey: 'check' });
    expect(stepEvents.map((e) => e.payload.chunk).join('')).toContain('hi');
  });

  it('OPEN_IN_VSCODE handler is registered and callable', () => {    // 仅验证 handler 已注册为函数，不实际 invoke（避免在测试机真的拉起编辑器）
    expect(typeof mock.handlers[IPC.OPEN_IN_VSCODE]).toBe('function');
  });

  it('OPEN_IN_TERMINAL handler is registered and callable', () => {
    // 仅验证 handler 已注册为函数，不实际 invoke（避免在测试机真的拉起终端）
    expect(typeof mock.handlers[IPC.OPEN_IN_TERMINAL]).toBe('function');
  });

  it('SELECT_DIRECTORY 打开系统目录选择器并返回选中路径', async () => {
    // pickedPath 存储模拟用户在系统选择器里选中的目录路径。
    const pickedPath = join(ctx.root, 'picked-dir');
    mock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [pickedPath] });

    // result 存储 IPC handler 返回给渲染进程的目录选择结果。
    const result = await mock.invoke(IPC.SELECT_DIRECTORY, { defaultPath: ctx.root });

    expect(mock.dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: ctx.root,
      properties: ['openDirectory'],
    }));
    expect(result).toEqual({ canceled: false, path: pickedPath });
  });

  it('COPY_TEXT 写入注入的 clipboard 并返回 true', async () => {
    const ok = await mock.invoke(IPC.COPY_TEXT, '/some/abs/path');
    expect(ok).toBe(true);
    // 应写入到 mock clipboard
    expect(mock.clipboardText).toBe('/some/abs/path');
  });

  it('RESET_CONFIG 通过 IPC 恢复默认配置并返回默认值', async () => {
    expect(IPC.RESET_CONFIG).toBe('reset-config');
    saveConfig({
      sourceProjectsPath: '/custom/source',
      worktreesPath: '/custom/worktrees',
      mainBranches: ['develop'],
      ignoredProjects: ['legacy'],
      cicdLinks: { app: 'https://ci.example.com/app' },
    }, dataDir);

    // result 存储 IPC 恢复默认设置后的返回配置。
    const result = await mock.invoke(IPC.RESET_CONFIG);

    expect(result).toEqual(DEFAULT_CONFIG);
    expect(loadConfig(dataDir)).toEqual(DEFAULT_CONFIG);
  });

  it('SAVE_TASK_ENV_HEALTH 写入后 LOAD_TASK_ENV_HEALTH 能读回环境检查状态', async () => {
    // map 为环境检查结果缓存：任务名 → 上次检查状态和结果摘要
    const map = {
      'TASK-ENV': {
        status: 'ok',
        issueCount: 0,
        taskDir: '/wt/TASK-ENV',
        checkedAt: '2026-06-30T10:00:00.000Z',
        result: { summary: { status: 'ok', issueCount: 0 } },
      },
    };

    const ok = await mock.invoke(IPC.SAVE_TASK_ENV_HEALTH, map);
    const loaded = await mock.invoke(IPC.LOAD_TASK_ENV_HEALTH);

    expect(ok).toBe(true);
    expect(loaded).toEqual(map);
    expect(JSON.parse(readFileSync(join(dataDir, 'task-env-health.json'), 'utf8'))).toEqual(map);
  });

  it('CHECKOUT_BRANCH 切主分支时对只有 main 的仓库兜底成功（不报 pathspec 错误）', async () => {
    // 仓库用 main 作默认分支，不存在 master
    const repo = initRepo(join(ctx.root, 'mainonly'), 'main');
    git(repo, 'checkout -q -b feature');
    // 请求切到 master（配置默认首个主分支），handler 应识别为主分支并兜底切到 main
    const res = await mock.invoke(IPC.CHECKOUT_BRANCH, repo, 'master');
    expect(res.success).toBe(true);
    expect(res.branch).toBe('main');
    const status = await mock.invoke(IPC.GET_PROJECT_STATUS, repo);
    expect(status.currentBranch).toBe('main');
  });

  it('LOAD_TASK_HISTORY 文件不存在时返回空数组', async () => {
    // 首次加载，history 文件尚未创建，应回退空数组
    const result = await mock.invoke(IPC.LOAD_TASK_HISTORY);
    expect(result).toEqual([]);
  });

  it('APPEND_TASK_HISTORY 写入后 LOAD_TASK_HISTORY 能读回同一条记录', async () => {
    // entry 为待写入的历史条目
    const entry = { task: 'TASK-42', link: 'https://jira.example.com/TASK-42', docsPath: '/tmp/task-docs/TASK-42' };
    const ok = await mock.invoke(IPC.APPEND_TASK_HISTORY, entry);
    expect(ok).toBe(true);
    // 读回后应有 1 条记录，字段与写入时一致
    const list = await mock.invoke(IPC.LOAD_TASK_HISTORY);
    expect(list.length).toBe(1);
    expect(list[0].task).toBe('TASK-42');
    expect(list[0].link).toBe('https://jira.example.com/TASK-42');
    expect(list[0].docsPath).toBe('/tmp/task-docs/TASK-42');
    // deletedAt 应由 handler 自动附加，格式为 ISO 字符串
    expect(typeof list[0].deletedAt).toBe('string');
    expect(new Date(list[0].deletedAt).getTime()).toBeGreaterThan(0);
  });

  it('APPEND_TASK_HISTORY 多次追加时最新记录排在最前', async () => {
    // 先写入旧记录
    await mock.invoke(IPC.APPEND_TASK_HISTORY, { task: 'TASK-1', link: '' });
    // 再写入新记录
    await mock.invoke(IPC.APPEND_TASK_HISTORY, { task: 'TASK-2', link: '' });
    const list = await mock.invoke(IPC.LOAD_TASK_HISTORY);
    // 最新写入的 TASK-2 应排在下标 0
    expect(list[0].task).toBe('TASK-2');
    expect(list[1].task).toBe('TASK-1');
  });

  it('APPEND_TASK_HISTORY link 字段可为空字符串', async () => {
    const ok = await mock.invoke(IPC.APPEND_TASK_HISTORY, { task: 'TASK-NO-LINK', link: '' });
    expect(ok).toBe(true);
    const list = await mock.invoke(IPC.LOAD_TASK_HISTORY);
    expect(list[0].link).toBe('');
  });
});
