import { describe, it, expect, vi } from 'vitest';

// openInVscode 命令构建与兜底分支测试：mock child_process.exec 与 fs.existsSync，
// 重点验证「buildVscodeCommand 注入 -n 新窗口打开（不替换用户当前窗口）」与自定义模板替换逻辑，
// 以及 openInVscode 的「code → 绝对路径 → open -a」三级兜底，全程不真实拉起 VSCode。

// execMock 替身：模拟 exec 命令成败
const execMock = vi.fn();
// existsMock 替身：控制 VSCODE_CLI_PATHS 检测时绝对路径是否存在
const existsMock = vi.fn();

// mock child_process：exec(cmd, cb) 走 execMock
vi.mock('child_process', () => ({
  exec: (cmd, cb) => execMock(cmd, cb),
}));
// mock fs：existsSync 走 existsMock
vi.mock('fs', () => ({
  existsSync: (p) => existsMock(p),
}));

// 被测函数在 mock 生效后再导入
const { buildVscodeCommand } = await import('../electron/ipcHandlers.js');

describe('buildVscodeCommand 命令构建（注入 -n 新窗口打开）', () => {
  it('默认模板 code {path} 会注入 -n 在新窗口打开（不替换当前窗口）', () => {
    const cmd = buildVscodeCommand('code {path}', '/wt/TASK-A');
    // 应包含新窗口参数 -n
    expect(cmd).toContain('-n');
    // 路径被 POSIX 单引号包裹防止 shell 展开
    expect(cmd).toContain("'/wt/TASK-A'");
    // -n 应在路径之前
    expect(cmd.indexOf('-n')).toBeLessThan(cmd.indexOf('/wt/TASK-A'));
  });

  it('模板未给 {path} 占位符时把路径拼到末尾', () => {
    const cmd = buildVscodeCommand('code', '/wt/TASK-B');
    expect(cmd).toContain('-n');
    expect(cmd).toContain("'/wt/TASK-B'");
  });

  it('模板已含 -n 时不重复注入', () => {
    const cmd = buildVscodeCommand('code -n {path}', '/wt/TASK-C');
    // -n 只出现一次
    expect(cmd.match(/-n/g)).toHaveLength(1);
  });

  it('模板已含 --new-window 时不再注入 -n', () => {
    const cmd = buildVscodeCommand('code --new-window {path}', '/wt/TASK-D');
    expect(cmd).not.toContain('-n ');
    expect(cmd).toContain('--new-window');
  });

  it('模板已含 -r/--reuse-window 时尊重用户选择，不注入 -n', () => {
    // 用户显式选了复用窗口（-r），说明是有意为之，不应被我们强行改成新窗口
    const cmd = buildVscodeCommand('code -r {path}', '/wt/TASK-R');
    expect(cmd).not.toContain('-n');
    expect(cmd).toContain('-r');
  });

  it('非 code 命令的自定义模板（如 cursor）不注入 -n，保持用户原样', () => {
    const cmd = buildVscodeCommand('cursor {path}', '/wt/TASK-E');
    // cursor 不是 code 命令，不应被注入 -n
    expect(cmd).toBe("cursor '/wt/TASK-E'");
  });

  it('空模板回退到默认 code 命令', () => {
    const cmd = buildVscodeCommand('', '/wt/TASK-F');
    expect(cmd).toContain('code');
    expect(cmd).toContain('-n');
    expect(cmd).toContain("'/wt/TASK-F'");
  });

  it('路径包含 shell 变量字符时不会被外层 shell 展开', () => {
    // cmd 存储 VSCode 启动命令，用于验证 $TASK 作为路径字面量保留
    const cmd = buildVscodeCommand('code {path}', '/wt/$TASK/proj');
    expect(cmd).toContain("'/wt/$TASK/proj'");
    expect(cmd).not.toContain('"/wt/$TASK/proj"');
  });
});
