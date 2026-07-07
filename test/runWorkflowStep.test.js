import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// runWorkflowStep 测试：mock child_process.spawn，验证「在任务目录流式执行渲染后的命令、逐段回推输出、
// 结束回传汇总」逻辑，全程不真实跑命令。重点覆盖：bash -c 执行、cwd 传入、命令渲染（占位符）、
// 成功/失败/stdout+stderr 流式回传、onChunk 路由标识、空命令短路。

// spawnMock 替身：捕获 spawn 调用参数（cmd, args, options），返回一个可手动 emit data/close 的假子进程
const spawnMock = vi.fn();

// mock child_process：spawn 走 spawnMock；exec 给个空桩（同模块其它函数会 import）
vi.mock('child_process', () => ({
  spawn: (cmd, args, options) => spawnMock(cmd, args, options),
  exec: () => {},
}));
// mock fs：runWorkflowStep 不依赖 fs，但同模块其它函数会 import，给个最小桩避免真实 fs
vi.mock('fs', () => ({
  existsSync: () => false,
}));

// 被测函数在 mock 生效后再导入
const { runWorkflowStep } = await import('../electron/ipcHandlers.js');

/**
 * 创建一个假子进程：带 stdout/stderr 两个 EventEmitter，并可手动触发 close/error。
 * @returns {object} 假 child_process 对象
 */
function makeFakeChild() {
  // child 为模拟的子进程，自身是 EventEmitter 以支持 on('close'/'error')
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

describe('runWorkflowStep 流式执行工作流步骤命令', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('用 bash -c 在指定 cwd 下执行渲染后的命令并回传 stdout（成功）', async () => {
    // fake 为本次 spawn 返回的假子进程
    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake);
    // 发起执行（Promise 在 close 后 resolve）；显式传 'darwin' 保证走 POSIX bash 分支，
    // 否则 Windows CI 上 resolveShell 探测不到 Git Bash 会改用 cmd，导致 spawn('bash') 断言失败
    const p = runWorkflowStep({ command: 'echo hello {path}', cwd: '/wt/TASK-A', task: 'TASK-A', branch: 'main' }, undefined, 'darwin');
    // 模拟脚本输出后正常退出
    fake.stdout.emit('data', Buffer.from('hello\n'));
    fake.emit('close', 0);
    const res = await p;
    expect(res.success).toBe(true);
    expect(res.code).toBe(0);
    expect(res.stdout).toBe('hello\n');
    // spawn 应以 bash -c 执行
    expect(spawnMock.mock.calls[0][0]).toBe('bash');
    expect(spawnMock.mock.calls[0][1][0]).toBe('-c');
    // options 应带 cwd，确保命令在任务目录下执行
    expect(spawnMock.mock.calls[0][2]).toMatchObject({ cwd: '/wt/TASK-A' });
    // 命令里的 {path} 应被渲染为带单引号的 cwd
    expect(spawnMock.mock.calls[0][1][1]).toContain("'/wt/TASK-A'");
  });

  it('占位符 {task} {branch} 被渲染进命令', async () => {
    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake);
    const p = runWorkflowStep({ command: 'deploy {task} {branch}', cwd: '/wt/T', task: 'PROJ-1', branch: 'feat/x' });
    fake.emit('close', 0);
    await p;
    // cmd 为传给 bash -c 的命令字符串
    const cmd = spawnMock.mock.calls[0][1][1];
    expect(cmd).toContain("'PROJ-1'");
    expect(cmd).toContain("'feat/x'");
  });

  it('按任务参数模式渲染命令，并把任务上下文注入环境变量', async () => {
    // fake 为本次 spawn 返回的假子进程。
    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake);
    // p 存储执行 Promise；auto 模式应把脚本命令补成 bash check-unit-test.sh <任务目录>。
    const p = runWorkflowStep({
      command: 'bash check-unit-test.sh',
      cwd: '/wt/TASK-A',
      task: 'TASK-A',
      branch: 'feat-a',
      taskArgMode: 'auto',
    });
    fake.emit('close', 0);
    await p;
    // args 存储 spawn 的参数数组，其中第二项为 bash -c 的最终命令。
    const args = spawnMock.mock.calls[0][1];
    // options 存储 spawn 的 options，其中 env 应包含任务上下文变量。
    const options = spawnMock.mock.calls[0][2];
    expect(args[1]).toBe("bash check-unit-test.sh '/wt/TASK-A'");
    expect(options.env).toMatchObject({
      VW_TASK_DIR: '/wt/TASK-A',
      VW_TASK_NAME: 'TASK-A',
      VW_TASK_BRANCH: 'feat-a',
    });
  });

  it('执行过程中 stdout/stderr 逐段触发 onChunk，并带 taskName/stepKey 路由标识', async () => {
    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake);
    // chunks 收集每次 onChunk 回调的事件
    const chunks = [];
    const p = runWorkflowStep(
      { command: './run.sh', cwd: '/wt/T', taskName: 'TASK-X', stepKey: 'check' },
      (evt) => chunks.push(evt),
    );
    // 模拟分两段输出（一段 stdout、一段 stderr），再正常退出
    fake.stdout.emit('data', Buffer.from('step1\n'));
    fake.stderr.emit('data', Buffer.from('warn\n'));
    fake.emit('close', 0);
    await p;
    // 应收到两段 chunk，均带正确的路由标识
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toMatchObject({ taskName: 'TASK-X', stepKey: 'check', chunk: 'step1\n' });
    expect(chunks[1]).toMatchObject({ taskName: 'TASK-X', stepKey: 'check', chunk: 'warn\n' });
  });

  it('taskName 缺省时回退用 task 作为路由标识', async () => {
    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake);
    const chunks = [];
    const p = runWorkflowStep({ command: './run.sh', cwd: '/wt/T', task: 'TASK-FALLBACK', stepKey: 's1' }, (evt) => chunks.push(evt));
    fake.stdout.emit('data', Buffer.from('x'));
    fake.emit('close', 0);
    await p;
    expect(chunks[0].taskName).toBe('TASK-FALLBACK');
  });

  it('命令失败（退出码非 0）时回传 success:false、code 与已累积的 stderr', async () => {
    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake);
    const p = runWorkflowStep({ command: './fail.sh', cwd: '/wt/T' });
    fake.stdout.emit('data', Buffer.from('partial out'));
    fake.stderr.emit('data', Buffer.from('boom\n'));
    fake.emit('close', 2);
    const res = await p;
    expect(res.success).toBe(false);
    expect(res.code).toBe(2);
    expect(res.stdout).toBe('partial out');
    expect(res.stderr).toBe('boom\n');
  });

  it('退出码为 0 但输出高置信错误标记时仍回传失败，避免 UI 成功提示与脚本错误冲突', async () => {
    // fake 为本次 spawn 返回的假子进程。
    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake);
    // p 存储执行 Promise；模拟脚本忘记 exit 1，但已经输出 [错误]。
    const p = runWorkflowStep({ command: 'bash check-unit-test.sh', cwd: '/wt/T' });
    fake.stderr.emit('data', Buffer.from('[错误] 未传入任务目录参数。用法：bash check-unit-test.sh <任务目录>\n'));
    fake.emit('close', 0);
    const res = await p;
    expect(res.success).toBe(false);
    expect(res.code).toBe(0);
    expect(res.error).toContain('错误输出');
  });

  it('退出码为 0 但输出未通过标记时仍回传失败，避免检查脚本漏设退出码', async () => {
    // fake 为本次 spawn 返回的假子进程。
    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake);
    // p 存储执行 Promise；模拟检查脚本识别出未通过，但忘记用非零退出码结束。
    const p = runWorkflowStep({ command: 'bash check-unit-test.sh', cwd: '/wt/T' });
    fake.stdout.emit('data', Buffer.from('[未通过] 单测检查未通过：logistics 需要补充单测\n'));
    fake.emit('close', 0);
    const res = await p;
    expect(res.success).toBe(false);
    expect(res.code).toBe(0);
    expect(res.error).toContain('错误输出');
  });

  it('退出码为 0 但输出失败标记时仍回传失败，避免 Jira 脚本失败后被自动勾选', async () => {
    // fake 为本次 spawn 返回的假子进程。
    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake);
    // p 存储执行 Promise；模拟 Jira 脚本提交失败但按兼容策略 exit 0。
    const p = runWorkflowStep({ command: 'bash comment-branch-jira.sh', cwd: '/wt/T' });
    fake.stdout.emit('data', Buffer.from('[失败] 评论提交失败（HTTP 404）。\n'));
    fake.emit('close', 0);
    // res 存储工作流步骤执行结果，应用会据此决定是否自动勾选完成。
    const res = await p;
    expect(res.success).toBe(false);
    expect(res.code).toBe(0);
    expect(res.error).toContain('错误输出');
  });

  it('进程启动失败（error 事件）时回传 success:false 与错误信息', async () => {
    const fake = makeFakeChild();
    spawnMock.mockReturnValue(fake);
    const p = runWorkflowStep({ command: './x.sh', cwd: '/wt/T' });
    fake.emit('error', new Error('spawn bash ENOENT'));
    const res = await p;
    expect(res.success).toBe(false);
    expect(res.error).toContain('ENOENT');
  });

  it('未配置命令（空）时不执行，直接回传明确错误', async () => {
    const res = await runWorkflowStep({ command: '', cwd: '/wt/T' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('未配置执行命令');
    // 不应调用 spawn
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('command 仅空白时同样短路，不执行', async () => {
    const res = await runWorkflowStep({ command: '   ', cwd: '/wt/T' });
    expect(res.success).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
