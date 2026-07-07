import { describe, it, expect } from 'vitest';
import { detectTerminal, buildTerminalCommand, resolveTerminalKind, winQuote } from '../src/core/terminalService.js';

// 终端启动纯逻辑测试：检测终端类型与构建打开命令，全程不触发副作用（不真实拉起终端）。

describe('detectTerminal', () => {
  it('returns ghostty when a Ghostty app path exists', () => {
    // 注入恒为 true 的 existsSync，模拟检测到 Ghostty 安装；显式传 'darwin' 避免在 Windows CI 上走 win32 分支
    expect(detectTerminal(() => true, 'darwin')).toBe('ghostty');
  });

  it('falls back to terminal when no Ghostty app exists', () => {
    // 注入恒为 false 的 existsSync，模拟未安装 Ghostty；显式传 'darwin' 避免在 Windows CI 上返回 'wt'
    expect(detectTerminal(() => false, 'darwin')).toBe('terminal');
  });
});

describe('buildTerminalCommand', () => {
  it('builds a Ghostty command with quoted working-directory', () => {
    // 含空格路径需被 POSIX 单引号包裹，验证防注入引号生效；显式传 'darwin' 保证走 macOS 分支
    const cmd = buildTerminalCommand('/a b/proj', 'ghostty', 'darwin');
    expect(cmd).toContain("--working-directory='/a b/proj'");
  });

  it('Ghostty command disables inherited working directory before setting target dir', () => {
    // cmd 存储 Ghostty 启动命令，用于验证新建窗口不会继承上一个窗口目录覆盖目标目录；显式传 'darwin'
    const cmd = buildTerminalCommand('/wt/TASK-A', 'ghostty', 'darwin');
    // inheritFlagIndex 存储禁用目录继承参数的位置；必须早于 working-directory，避免后者被继承目录覆盖
    const inheritFlagIndex = cmd.indexOf('--window-inherit-working-directory=false');
    // workingDirIndex 存储目标目录参数的位置
    const workingDirIndex = cmd.indexOf("--working-directory='/wt/TASK-A'");
    expect(inheritFlagIndex).toBeGreaterThan(-1);
    expect(workingDirIndex).toBeGreaterThan(-1);
    expect(inheritFlagIndex).toBeLessThan(workingDirIndex);
  });

  it('Ghostty command explicitly cd into the target dir before starting the interactive shell', () => {
    // cmd 存储 Ghostty 启动命令；显式传 'darwin' 保证走 macOS 分支
    const cmd = buildTerminalCommand('/wt/TASK-A/projA', 'ghostty', 'darwin');
    expect(cmd).toContain('-e /bin/zsh -lc');
    expect(cmd).toContain("cd '\\''/wt/TASK-A/projA'\\''");
    expect(cmd).toContain('exec "${SHELL:-/bin/zsh}"');
  });

  it('builds a Terminal.app command via AppleScript that cd into the target dir', () => {
    // Terminal 改用 AppleScript do script "cd <path>"；显式传 'darwin' 保证走 macOS AppleScript 分支
    const cmd = buildTerminalCommand('/a/proj', 'terminal', 'darwin');
    expect(cmd).toBe(
      'osascript -e "tell application \\"Terminal\\" to do script \\"cd \'/a/proj\'\\"" -e "tell application \\"Terminal\\" to activate"'
    );
  });

  it('Terminal command wraps a path with spaces in single quotes (no word splitting)', () => {
    // 带空格路径应被单引号包裹，cd 不会被拆成多个参数；显式传 'darwin' 保证走 macOS 分支
    const cmd = buildTerminalCommand('/a b/proj a', 'terminal', 'darwin');
    // 关键片段：cd '/a b/proj a'（AppleScript 双引号串内）
    expect(cmd).toContain("cd '/a b/proj a'");
  });

  it("Terminal command escapes single quotes inside the path", () => {
    // 路径含单引号时用 '\'' 序列转义；显式传 'darwin' 保证走 macOS 分支
    const cmd = buildTerminalCommand("/a/it's/proj", 'terminal', 'darwin');
    // 期望 cd 'a/it'\''s/proj' 的片段（单引号被转义为 '\''）
    expect(cmd).toContain("cd '/a/it'\\''s/proj'");
  });

  it('builds an iTerm2 command via AppleScript that cd into the target dir', () => {
    // iTerm2 用 create window + write text 的 AppleScript；显式传 'darwin' 保证走 macOS 分支
    const cmd = buildTerminalCommand('/a/proj', 'iterm2', 'darwin');
    expect(cmd).toContain('osascript');
    // 应驱动 iTerm 应用、新建窗口并在会话里执行 cd
    expect(cmd).toContain('iTerm');
    expect(cmd).toContain('create window with default profile');
    expect(cmd).toContain("write text");
    expect(cmd).toContain("cd '/a/proj'");
  });

  it('iTerm2 command wraps a path with spaces in single quotes', () => {
    // 带空格路径在 iTerm2 命令里同样被单引号包裹；显式传 'darwin' 保证走 macOS 分支
    const cmd = buildTerminalCommand('/a b/proj a', 'iterm2', 'darwin');
    expect(cmd).toContain("cd '/a b/proj a'");
  });
});

describe('detectTerminal Windows 分支', () => {
  it('Windows 平台恒返回 wt（Windows Terminal），不探测 Ghostty', () => {
    // 注入 platform='win32'，existsSync 恒 false 也应返回 wt（Windows 不走 Ghostty 探测）
    expect(detectTerminal(() => false, 'win32')).toBe('wt');
    expect(detectTerminal(() => true, 'win32')).toBe('wt');
  });
});

describe('winQuote 双引号包裹', () => {
  it('用双引号包裹路径，承载空格与中文', () => {
    expect(winQuote('C:\\wt\\TASK A')).toBe('"C:\\wt\\TASK A"');
    expect(winQuote('C:\\工作\\任务')).toBe('"C:\\工作\\任务"');
  });

  it('null/undefined 兜底为空字符串的双引号', () => {
    expect(winQuote(undefined)).toBe('""');
    expect(winQuote(null)).toBe('""');
  });
});

describe('buildTerminalCommand Windows 分支（wt/powershell/cmd）', () => {
  it('wt 用 -d 参数指定启动目录，路径双引号包裹', () => {
    // 注入 platform='win32'，wt 用原生 -d 指定目录
    const cmd = buildTerminalCommand('C:\\wt\\TASK-A', 'wt', 'win32');
    expect(cmd).toBe('wt -d "C:\\wt\\TASK-A"');
  });

  it('wt 含空格路径被双引号包裹不拆词', () => {
    const cmd = buildTerminalCommand('C:\\wt\\TASK A\\proj', 'wt', 'win32');
    expect(cmd).toContain('-d "C:\\wt\\TASK A\\proj"');
  });

  it('powershell 用 -NoExit + Set-Location 启动后切目录', () => {
    // powershell 无启动目录参数，靠 Set-Location -LiteralPath 切目录，-NoExit 保持窗口
    const cmd = buildTerminalCommand('C:\\wt\\TASK-A', 'powershell', 'win32');
    expect(cmd).toContain('powershell -NoExit -Command');
    expect(cmd).toContain("Set-Location -LiteralPath 'C:\\wt\\TASK-A'");
    // 经 start 另起独立窗口，首参 "" 为标题占位
    expect(cmd).toContain('start ""');
  });

  it('powershell 路径含单引号时转义为两个单引号（PowerShell 字符串规则）', () => {
    // PowerShell 单引号字符串内的单引号用两个单引号转义
    const cmd = buildTerminalCommand("C:\\wt\\it's", 'powershell', 'win32');
    expect(cmd).toContain("Set-Location -LiteralPath 'C:\\wt\\it''s'");
  });

  it('cmd 用 /K cd /d 切目录后保持窗口', () => {
    // cmd /K 执行命令后保留窗口；cd /d 支持跨盘符切换
    const cmd = buildTerminalCommand('D:\\wt\\TASK-A', 'cmd', 'win32');
    expect(cmd).toBe('start "" cmd /K "cd /d "D:\\wt\\TASK-A""');
  });

  it('未知 kind 在 Windows 下默认走 wt', () => {
    // 传入非法/残留的 macOS 终端名，Windows 分支应回退到默认 wt
    const cmd = buildTerminalCommand('C:\\wt\\proj', 'terminal', 'win32');
    expect(cmd).toBe('wt -d "C:\\wt\\proj"');
  });
});

describe('resolveTerminalKind 终端类型解析与兜底链', () => {
  it('Windows 默认返回 wt→powershell→cmd 兜底链', () => {
    // Windows 无显式配置时按 wt→powershell→cmd 顺序兜底
    expect(resolveTerminalKind(undefined, () => false, 'win32')).toEqual(['wt', 'powershell', 'cmd']);
  });

  it('Windows 显式选 powershell 时提到链首，其余作兜底', () => {
    // 用户选 powershell，应把它排第一，wt/cmd 作后续兜底
    expect(resolveTerminalKind('powershell', () => false, 'win32')).toEqual(['powershell', 'wt', 'cmd']);
  });

  it('Windows 上残留的 macOS 终端名（Terminal）被忽略，走默认链', () => {
    // 跨平台迁移场景：配置里存的旧 macOS 值 'Terminal' 在 Windows 上不合法，回退默认链
    expect(resolveTerminalKind('Terminal', () => false, 'win32')).toEqual(['wt', 'powershell', 'cmd']);
  });

  it('macOS 检测到 Ghostty 时返回 ghostty→terminal 兜底链', () => {
    // Ghostty 已安装且未显式配置，主选 ghostty 兜底 terminal
    expect(resolveTerminalKind(undefined, () => true, 'darwin')).toEqual(['ghostty', 'terminal']);
  });

  it('macOS 未装 Ghostty 时只返回 terminal（无冗余兜底）', () => {
    // 主选已是系统 terminal，无需再追加兜底
    expect(resolveTerminalKind(undefined, () => false, 'darwin')).toEqual(['terminal']);
  });

  it('macOS 显式选 iTerm2 时返回 iterm2→terminal 兜底链', () => {
    expect(resolveTerminalKind('iTerm2', () => false, 'darwin')).toEqual(['iterm2', 'terminal']);
  });
});
