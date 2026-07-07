import { describe, it, expect } from 'vitest';
import { detectTerminal, buildTerminalCommand } from '../src/core/terminalService.js';

// 终端启动纯逻辑测试：检测终端类型与构建打开命令，全程不触发副作用（不真实拉起终端）。

describe('detectTerminal', () => {
  it('returns ghostty when a Ghostty app path exists', () => {
    // 注入恒为 true 的 existsSync，模拟检测到 Ghostty 安装
    expect(detectTerminal(() => true)).toBe('ghostty');
  });

  it('falls back to terminal when no Ghostty app exists', () => {
    // 注入恒为 false 的 existsSync，模拟未安装 Ghostty
    expect(detectTerminal(() => false)).toBe('terminal');
  });
});

describe('buildTerminalCommand', () => {
  it('builds a Ghostty command with quoted working-directory', () => {
    // 含空格路径需被 POSIX 单引号包裹，验证防注入引号生效
    const cmd = buildTerminalCommand('/a b/proj', 'ghostty');
    expect(cmd).toContain("--working-directory='/a b/proj'");
  });

  it('Ghostty command disables inherited working directory before setting target dir', () => {
    // cmd 存储 Ghostty 启动命令，用于验证新建窗口不会继承上一个窗口目录覆盖目标目录
    const cmd = buildTerminalCommand('/wt/TASK-A', 'ghostty');
    // inheritFlagIndex 存储禁用目录继承参数的位置；必须早于 working-directory，避免后者被继承目录覆盖
    const inheritFlagIndex = cmd.indexOf('--window-inherit-working-directory=false');
    // workingDirIndex 存储目标目录参数的位置
    const workingDirIndex = cmd.indexOf("--working-directory='/wt/TASK-A'");
    expect(inheritFlagIndex).toBeGreaterThan(-1);
    expect(workingDirIndex).toBeGreaterThan(-1);
    expect(inheritFlagIndex).toBeLessThan(workingDirIndex);
  });

  it('Ghostty command explicitly cd into the target dir before starting the interactive shell', () => {
    // cmd 存储 Ghostty 启动命令，用于验证即使 Ghostty 继承了上一个窗口目录也会在 shell 内落到目标路径
    const cmd = buildTerminalCommand('/wt/TASK-A/projA', 'ghostty');
    expect(cmd).toContain('-e /bin/zsh -lc');
    expect(cmd).toContain("cd '\\''/wt/TASK-A/projA'\\''");
    expect(cmd).toContain('exec "${SHELL:-/bin/zsh}"');
  });

  it('builds a Terminal.app command via AppleScript that cd into the target dir', () => {
    // Terminal 改用 AppleScript do script "cd <path>"，规避 open -a Terminal 首次冷启动打不到目标目录的竞态
    const cmd = buildTerminalCommand('/a/proj', 'terminal');
    expect(cmd).toBe(
      'osascript -e "tell application \\"Terminal\\" to do script \\"cd \'/a/proj\'\\"" -e "tell application \\"Terminal\\" to activate"'
    );
  });

  it('Terminal command wraps a path with spaces in single quotes (no word splitting)', () => {
    // 带空格路径应被单引号包裹，cd 不会被拆成多个参数
    const cmd = buildTerminalCommand('/a b/proj a', 'terminal');
    // 关键片段：cd '/a b/proj a'（AppleScript 双引号串内）
    expect(cmd).toContain("cd '/a b/proj a'");
  });

  it("Terminal command escapes single quotes inside the path", () => {
    // 路径含单引号时用 '\'' 序列转义，避免提前闭合单引号导致命令损坏
    const cmd = buildTerminalCommand("/a/it's/proj", 'terminal');
    // 期望 cd 'a/it'\''s/proj' 的片段（单引号被转义为 '\''）
    expect(cmd).toContain("cd '/a/it'\\''s/proj'");
  });

  it('builds an iTerm2 command via AppleScript that cd into the target dir', () => {
    // iTerm2 用 create window + write text 的 AppleScript，同样规避首次冷启动目录竞态
    const cmd = buildTerminalCommand('/a/proj', 'iterm2');
    expect(cmd).toContain('osascript');
    // 应驱动 iTerm 应用、新建窗口并在会话里执行 cd
    expect(cmd).toContain('iTerm');
    expect(cmd).toContain('create window with default profile');
    expect(cmd).toContain("write text");
    expect(cmd).toContain("cd '/a/proj'");
  });

  it('iTerm2 command wraps a path with spaces in single quotes', () => {
    // 带空格路径在 iTerm2 命令里同样被单引号包裹
    const cmd = buildTerminalCommand('/a b/proj a', 'iterm2');
    expect(cmd).toContain("cd '/a b/proj a'");
  });
});
