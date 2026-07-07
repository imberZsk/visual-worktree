import { describe, it, expect, vi, beforeEach } from 'vitest';

// openInTerminal 兜底分支测试：mock child_process.exec 与 fs.existsSync，
// 验证「优先 Ghostty → 失败兜底 Terminal → 全失败报错」这段副作用逻辑，全程不真实拉起终端。
// 单独成文件：因需要 mock child_process/fs，与 ipcHandlers.test.js 里用真实 git 的用例隔离开。

// execMock 替身：根据注入的「应失败的命令关键字」决定回调返回错误还是成功
const execMock = vi.fn();
// existsMock 替身：控制 detectTerminal 判定 Ghostty 是否安装
const existsMock = vi.fn();

// mock child_process：exec(cmd, cb) 调用 execMock 决定成败
vi.mock('child_process', () => ({
  exec: (cmd, cb) => execMock(cmd, cb),
}));
// mock fs：existsSync 走 existsMock（detectTerminal 用它判 Ghostty.app 是否存在）
vi.mock('fs', () => ({
  existsSync: (p) => existsMock(p),
}));

// 被测函数在 mock 生效后再导入
const { openInTerminal } = await import('../electron/ipcHandlers.js');

// configureExec 配置 exec 行为：failOn 命中时回调 error，否则成功
function configureExec(failOn) {
  execMock.mockImplementation((cmd, cb) => {
    // shouldFail 标记该命令是否应模拟失败
    const shouldFail = failOn.some((kw) => cmd.includes(kw));
    cb(shouldFail ? new Error('mock exec failed') : null);
  });
}

describe('openInTerminal 终端兜底逻辑', () => {
  beforeEach(() => {
    execMock.mockReset();
    existsMock.mockReset();
  });

  it('检测到 Ghostty 且打开成功：只调用一次 exec，命令为 Ghostty', async () => {
    // 模拟 Ghostty 已安装
    existsMock.mockReturnValue(true);
    // 任何命令都成功
    configureExec([]);
    const res = await openInTerminal('/wt/TASK-A');
    expect(res.success).toBe(true);
    expect(execMock).toHaveBeenCalledTimes(1);
    // 首条命令应是 Ghostty 打开命令
    expect(execMock.mock.calls[0][0]).toContain('Ghostty.app');
  });

  it('Ghostty 打开失败时兜底用 Terminal 重试并成功', async () => {
    // Ghostty 已安装，但 Ghostty 命令失败、Terminal 命令成功
    existsMock.mockReturnValue(true);
    configureExec(['Ghostty.app']);
    const res = await openInTerminal('/wt/TASK-A');
    expect(res.success).toBe(true);
    // 应调用两次：先 Ghostty（失败）再 Terminal（成功）
    expect(execMock).toHaveBeenCalledTimes(2);
    expect(execMock.mock.calls[0][0]).toContain('Ghostty.app');
    // Terminal 兜底命令改用 AppleScript（osascript 驱动 Terminal），不再是 open -a Terminal
    expect(execMock.mock.calls[1][0]).toContain('osascript');
    expect(execMock.mock.calls[1][0]).toContain('Terminal');
  });

  it('Ghostty 与 Terminal 都失败时返回错误', async () => {
    existsMock.mockReturnValue(true);
    // 所有命令都失败
    configureExec(['Ghostty.app', 'Terminal']);
    const res = await openInTerminal('/wt/TASK-A');
    expect(res.success).toBe(false);
    expect(res.error).toBe('未找到可用终端');
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it('未检测到 Ghostty 时直接用 Terminal，不做 Ghostty 尝试', async () => {
    // 模拟 Ghostty 未安装 → detectTerminal 返回 'terminal'
    existsMock.mockReturnValue(false);
    configureExec([]);
    const res = await openInTerminal('/wt/TASK-A');
    expect(res.success).toBe(true);
    // 只调用一次，且直接是 Terminal 命令（无 Ghostty 兜底分支）
    expect(execMock).toHaveBeenCalledTimes(1);
    // Terminal 用 AppleScript（osascript 驱动 Terminal）打开，规避首次冷启动目录竞态
    expect(execMock.mock.calls[0][0]).toContain('osascript');
    expect(execMock.mock.calls[0][0]).toContain('Terminal');
  });

  it('未装 Ghostty 且 Terminal 失败时直接报错，不重试', async () => {
    existsMock.mockReturnValue(false);
    configureExec(['Terminal']);
    const res = await openInTerminal('/wt/TASK-A');
    expect(res.success).toBe(false);
    expect(res.error).toBe('未找到可用终端');
    // kind 为 terminal，失败后无兜底分支，仅一次调用
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it('用户配置 preferred=Ghostty 时强制用 Ghostty，忽略自动检测', async () => {
    // 即便 existsSync 返回 false（检测不到 Ghostty），显式配置应优先生效
    existsMock.mockReturnValue(false);
    configureExec([]);
    const res = await openInTerminal('/wt/TASK-A', 'Ghostty');
    expect(res.success).toBe(true);
    expect(execMock.mock.calls[0][0]).toContain('Ghostty.app');
  });

  it('用户配置 preferred=Terminal 时强制用 Terminal，即便装了 Ghostty', async () => {
    // Ghostty 已安装，但用户明确选了 Terminal，应直接用 Terminal 不走 Ghostty
    existsMock.mockReturnValue(true);
    configureExec([]);
    const res = await openInTerminal('/wt/TASK-A', 'Terminal');
    expect(res.success).toBe(true);
    expect(execMock).toHaveBeenCalledTimes(1);
    // 强制 Terminal 时走 AppleScript 命令
    expect(execMock.mock.calls[0][0]).toContain('osascript');
    expect(execMock.mock.calls[0][0]).toContain('Terminal');
  });

  it('用户配置 preferred=iTerm2 时用 iTerm2 命令', async () => {
    existsMock.mockReturnValue(false);
    configureExec([]);
    const res = await openInTerminal('/wt/TASK-A', 'iTerm2');
    expect(res.success).toBe(true);
    expect(execMock).toHaveBeenCalledTimes(1);
    // iTerm2 命令应驱动 iTerm 应用
    expect(execMock.mock.calls[0][0]).toContain('iTerm');
  });

  it('iTerm2 打开失败时兜底用系统 Terminal 重试并成功', async () => {
    existsMock.mockReturnValue(false);
    // iTerm 命令失败、Terminal 命令成功（failOn 用 iTerm 关键字命中首条 iTerm2 命令）
    configureExec(['iTerm']);
    const res = await openInTerminal('/wt/TASK-A', 'iTerm2');
    expect(res.success).toBe(true);
    // 先 iTerm2（失败）再 Terminal（成功），共两次
    expect(execMock).toHaveBeenCalledTimes(2);
    expect(execMock.mock.calls[0][0]).toContain('iTerm');
    expect(execMock.mock.calls[1][0]).toContain('do script');
  });
});
