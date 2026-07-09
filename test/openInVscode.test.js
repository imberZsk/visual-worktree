import { beforeEach, describe, it, expect, vi } from 'vitest';

// openInVscode 命令构建与兜底分支测试：mock child_process.exec 与 fs.existsSync，
// 重点验证「buildVscodeCommand 注入 -n 新窗口打开（不替换用户当前窗口）」与自定义模板替换逻辑，
// 以及 openInVscode 的「code → 绝对路径 → 系统 open/start」兜底，全程不真实拉起 VSCode。

// execMock 替身：模拟 exec 命令成败
const execMock = vi.fn();
// existsMock 替身：控制 VSCODE_CLI_PATHS 检测时绝对路径是否存在
const existsMock = vi.fn();

// mock child_process：exec(cmd, cb) 走 execMock
vi.mock('child_process', async () => {
  // actual 存储 child_process 真实导出，避免 ipcHandlers 里未参与本测试的 spawn 等导入缺失。
  const actual = await vi.importActual('child_process');
  return {
    ...actual,
    exec: (cmd, cb) => execMock(cmd, cb),
  };
});
// mock fs：existsSync 走 existsMock
vi.mock('fs', async () => {
  // actual 存储 fs 真实导出，避免 ipcHandlers 里其它文件操作导入缺失。
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: (p) => existsMock(p),
  };
});

// 被测函数在 mock 生效后再导入
const { buildVscodeCommand, openInVscode } = await import('../electron/ipcHandlers.js');

beforeEach(() => {
  execMock.mockReset();
  existsMock.mockReset();
});

describe('buildVscodeCommand 命令构建（注入 -n 新窗口打开）', () => {
  it('默认模板 code {path} 会注入 -n 在新窗口打开（不替换当前窗口）', () => {
    // 显式传 'darwin'：Windows 下路径用双引号包裹，断言的单引号会失败
    const cmd = buildVscodeCommand('code {path}', '/wt/TASK-A', 'darwin');
    // 应包含新窗口参数 -n
    expect(cmd).toContain('-n');
    // 路径被 POSIX 单引号包裹防止 shell 展开
    expect(cmd).toContain("'/wt/TASK-A'");
    // -n 应在路径之前
    expect(cmd.indexOf('-n')).toBeLessThan(cmd.indexOf('/wt/TASK-A'));
  });

  it('模板未给 {path} 占位符时把路径拼到末尾', () => {
    // 显式传 'darwin'：Windows 下双引号包裹路径，断言的单引号会失败
    const cmd = buildVscodeCommand('code', '/wt/TASK-B', 'darwin');
    expect(cmd).toContain('-n');
    expect(cmd).toContain("'/wt/TASK-B'");
  });

  it('模板已含 -n 时不重复注入', () => {
    // 显式传 'darwin' 保证走 macOS 单引号分支
    const cmd = buildVscodeCommand('code -n {path}', '/wt/TASK-C', 'darwin');
    // -n 只出现一次
    expect(cmd.match(/-n/g)).toHaveLength(1);
  });

  it('模板已含 --new-window 时不再注入 -n', () => {
    // 显式传 'darwin' 保证走 macOS 分支
    const cmd = buildVscodeCommand('code --new-window {path}', '/wt/TASK-D', 'darwin');
    expect(cmd).not.toContain('-n ');
    expect(cmd).toContain('--new-window');
  });

  it('模板已含 -r/--reuse-window 时尊重用户选择，不注入 -n', () => {
    // 显式传 'darwin' 保证走 macOS 分支
    const cmd = buildVscodeCommand('code -r {path}', '/wt/TASK-R', 'darwin');
    expect(cmd).not.toContain('-n');
    expect(cmd).toContain('-r');
  });

  it('非 code 命令的自定义模板（如 cursor）不注入 -n，保持用户原样', () => {
    // 显式传 'darwin' 保证走 macOS 单引号分支；断言精确匹配含单引号的字符串
    const cmd = buildVscodeCommand('cursor {path}', '/wt/TASK-E', 'darwin');
    // cursor 不是 code 命令，不应被注入 -n
    expect(cmd).toBe("cursor '/wt/TASK-E'");
  });

  it('空模板回退到默认 code 命令', () => {
    // 显式传 'darwin' 保证走 macOS 单引号分支
    const cmd = buildVscodeCommand('', '/wt/TASK-F', 'darwin');
    expect(cmd).toContain('code');
    expect(cmd).toContain('-n');
    expect(cmd).toContain("'/wt/TASK-F'");
  });

  it('路径包含 shell 变量字符时不会被外层 shell 展开', () => {
    // cmd 存储 VSCode 启动命令；显式传 'darwin' 保证走 macOS 单引号分支（Windows 用双引号）
    const cmd = buildVscodeCommand('code {path}', '/wt/$TASK/proj', 'darwin');
    expect(cmd).toContain("'/wt/$TASK/proj'");
    expect(cmd).not.toContain('"/wt/$TASK/proj"');
  });
});

describe('buildVscodeCommand Windows 分支（双引号包裹路径）', () => {
  it('Windows 下用双引号包裹路径而非 POSIX 单引号', () => {
    // 传入 platform='win32'，路径应被双引号包裹（cmd 分词以双引号为界）
    const cmd = buildVscodeCommand('code {path}', 'C:\\wt\\TASK A', 'win32');
    expect(cmd).toContain('"C:\\wt\\TASK A"');
    // 不应出现 POSIX 单引号包裹的路径
    expect(cmd).not.toContain("'C:\\wt\\TASK A'");
  });

  it('Windows 下仍注入 -n 新窗口参数', () => {
    // code 命令跨平台通用 -n 参数，Windows 也应注入
    const cmd = buildVscodeCommand('code {path}', 'C:\\wt\\proj', 'win32');
    expect(cmd).toContain('-n');
    expect(cmd.indexOf('-n')).toBeLessThan(cmd.indexOf('C:\\wt\\proj'));
  });

  it('Windows 下含空格路径被双引号包裹不被拆词', () => {
    // 任务目录含空格是常见场景，双引号包裹保证 cmd 不拆词
    const cmd = buildVscodeCommand('code', 'C:\\Users\\a b\\wt', 'win32');
    expect(cmd).toContain('"C:\\Users\\a b\\wt"');
  });
});

describe('openInVscode macOS 兜底打开', () => {
  it('code 与绝对 CLI 不可用时用 open -na 透传 -n 和目标路径', async () => {
    // 模拟常见 GUI 启动场景：PATH 里的 code 不可用，已知绝对 CLI 路径也不存在。
    existsMock.mockReturnValue(false);
    execMock.mockImplementation((cmd, cb) => {
      // shouldSucceed 标记当前命令是否为新版 macOS open 兜底命令。
      const shouldSucceed = cmd.startsWith('open -na "Visual Studio Code" --args -n ');
      cb(shouldSucceed ? null : new Error('mock failed'));
    });

    // res 存储打开结果，期望 open -na 兜底成功。
    const res = await openInVscode('/wt/TASK-A', 'code {path}', 'darwin');

    expect(res.success).toBe(true);
    expect(execMock).toHaveBeenCalledTimes(2);
    expect(execMock.mock.calls[1][0]).toBe('open -na "Visual Studio Code" --args -n \'/wt/TASK-A\'');
  });
});
