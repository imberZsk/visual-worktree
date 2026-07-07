import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { scanWorktreesByTask } from '../src/core/gitService.js';
import { makeTempRoot, initRepo, git } from './helpers.js';

// 按任务分组扫描 worktree 测试。
// 模拟真实结构：projectsRoot 下有多个源项目；worktreesRoot/{任务名}/{项目名} 是各项目的 worktree。

describe('scanWorktreesByTask', () => {
  let ctx;
  // projectsRoot 源项目根目录
  let projectsRoot;
  // worktreesRoot worktree 任务根目录
  let worktreesRoot;

  beforeEach(() => {
    ctx = makeTempRoot();
    projectsRoot = join(ctx.root, 'projects');
    worktreesRoot = join(ctx.root, 'worktrees');
    mkdirSync(projectsRoot, { recursive: true });
    mkdirSync(worktreesRoot, { recursive: true });
  });
  afterEach(() => ctx.cleanup());

  it('groups worktrees by task directory across projects', async () => {
    // 两个源项目
    const projA = initRepo(join(projectsRoot, 'projA'), 'master');
    const projB = initRepo(join(projectsRoot, 'projB'), 'master');
    // 任务 TASK-1 下为 projA、projB 各建一个 worktree
    git(projA, `worktree add -q -b feat/task1-a ${join(worktreesRoot, 'TASK-1', 'projA')}`);
    git(projB, `worktree add -q -b feat/task1-b ${join(worktreesRoot, 'TASK-1', 'projB')}`);
    // 任务 TASK-2 只涉及 projA
    git(projA, `worktree add -q -b feat/task2-a ${join(worktreesRoot, 'TASK-2', 'projA')}`);

    const tasks = await scanWorktreesByTask(projectsRoot, worktreesRoot);
    // 应分出两个任务组
    const names = tasks.map((t) => t.task).sort();
    expect(names).toEqual(['TASK-1', 'TASK-2']);
    // TASK-1 含两个项目的 worktree
    const t1 = tasks.find((t) => t.task === 'TASK-1');
    expect(t1.worktrees.length).toBe(2);
    expect(t1.worktrees.map((w) => w.project).sort()).toEqual(['projA', 'projB']);
    const wtA = t1.worktrees.find((w) => w.project === 'projA');
    expect(wtA.branch).toBe('feat/task1-a');
    // TASK-2 只有一个
    const t2 = tasks.find((t) => t.task === 'TASK-2');
    expect(t2.worktrees.length).toBe(1);
  });

  it('keeps the full task name when the task contains slash-separated branch style segments', async () => {
    // projA 存储当前测试用的源项目路径
    const projA = initRepo(join(projectsRoot, 'projA'), 'master');
    // taskName 存储包含斜杠的任务名，模拟从分支名直接作为任务名创建 worktree
    const taskName = 'alice/bugfix/PROJ-5001-订单批量导入页面异常';
    git(projA, `worktree add -q -b feat/slash-task ${join(worktreesRoot, taskName, 'projA')}`);

    // tasks 存储按任务分组扫描后的 worktree 列表
    const tasks = await scanWorktreesByTask(projectsRoot, worktreesRoot);
    // names 存储扫描得到的任务名列表，用于确认不会被截断成第一层目录 alice
    const names = tasks.map((t) => t.task).sort();
    expect(names).toEqual([taskName]);
    expect(tasks[0].path).toBe(join(worktreesRoot, taskName));
  });

  it('ignores the main worktree (not under worktreesRoot)', async () => {
    const projA = initRepo(join(projectsRoot, 'projA'), 'master');
    git(projA, `worktree add -q -b feat/x ${join(worktreesRoot, 'TASK-X', 'projA')}`);
    const tasks = await scanWorktreesByTask(projectsRoot, worktreesRoot);
    // 主工作区在 projectsRoot 下，不应出现在任务分组里
    expect(tasks.length).toBe(1);
    expect(tasks[0].task).toBe('TASK-X');
  });

  it('returns empty when no worktrees exist', async () => {
    initRepo(join(projectsRoot, 'projA'), 'master');
    const tasks = await scanWorktreesByTask(projectsRoot, worktreesRoot);
    expect(tasks).toEqual([]);
  });

  it('includes branch and status info per worktree', async () => {
    const projA = initRepo(join(projectsRoot, 'projA'), 'master');
    git(projA, `worktree add -q -b feat/s ${join(worktreesRoot, 'TASK-S', 'projA')}`);
    const tasks = await scanWorktreesByTask(projectsRoot, worktreesRoot, { status: true });
    const wt = tasks[0].worktrees[0];
    expect(wt.branch).toBe('feat/s');
    expect(wt).toHaveProperty('hasUncommittedChanges');
    expect(wt.hasUncommittedChanges).toBe(false);
  });

  it('为任务中的每个项目 worktree 带上 GitLab 网页地址', async () => {
    // projA 存储源项目路径，remote 信息从源项目读取后透传到任务 worktree 项。
    const projA = initRepo(join(projectsRoot, 'projA'), 'master');
    // remoteUrl 存储 GitLab HTTPS remote 地址，覆盖带 .git 后缀的常见格式。
    const remoteUrl = 'https://gitlab.example.com/team/projA.git';
    git(projA, `remote add origin ${remoteUrl}`);
    git(projA, `worktree add -q -b feat/gitlab ${join(worktreesRoot, 'TASK-GITLAB', 'projA')}`);

    // tasks 存储按任务分组扫描结果，供 UI 直接渲染 GitLab 打开按钮。
    const tasks = await scanWorktreesByTask(projectsRoot, worktreesRoot);
    // wt 存储任务下的项目 worktree 项。
    const wt = tasks[0].worktrees[0];

    expect(wt.remoteUrl).toBe(remoteUrl);
    expect(wt.gitlabUrl).toBe('https://gitlab.example.com/team/projA');
  });
});
