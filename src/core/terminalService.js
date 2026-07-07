// 终端启动纯逻辑模块：负责「检测可用终端类型」与「构建在指定目录打开终端的 shell 命令」。
// 抽成不依赖 Electron 的纯 Node 模块，便于 vitest 直接 import 测试，副作用（exec）留给 ipcHandlers。

import { homedir } from 'os';
import { join } from 'path';

// Ghostty 应用候选安装路径：分别覆盖系统级 /Applications 与用户级 ~/Applications
const GHOSTTY_APP_PATHS = ['/Applications/Ghostty.app', join(homedir(), 'Applications/Ghostty.app')];

/**
 * 检测当前优先可用的终端类型
 * @param {(p:string)=>boolean} existsSyncFn - 注入的 fs.existsSync，便于单测 mock（不真实读盘）
 * @returns {'ghostty'|'terminal'} 检测到 Ghostty 返回 'ghostty'，否则回退系统 'terminal'
 */
export function detectTerminal(existsSyncFn) {
  // installed 标记是否检测到任一 Ghostty 安装路径存在
  const installed = GHOSTTY_APP_PATHS.some((p) => existsSyncFn(p));
  return installed ? 'ghostty' : 'terminal';
}

/**
 * 把字符串包裹为 POSIX shell 的单引号字面量，内部单引号用 '\'' 序列转义。
 * 用于把路径安全嵌入 shell 命令，避免空格/引号/$ 等特殊字符被 shell 解释或截断命令。
 * @param {string} s - 待包裹的原始字符串（如目录路径）
 * @returns {string} 单引号包裹后的 shell 安全字面量
 */
export function shellSingleQuote(s) {
  // 把每个单引号替换为 '\''（闭合单引号→转义单引号→重开单引号），再整体用单引号包裹
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * 构建在指定目录打开终端的 shell 命令字符串
 * @param {string} targetPath - 要作为初始工作目录打开的目录路径
 * @param {'ghostty'|'terminal'|'iterm2'} kind - 终端类型，决定使用哪条 open 命令
 * @returns {string} 可交给 child_process.exec 执行的命令字符串
 */
export function buildTerminalCommand(targetPath, kind) {
  // Ghostty 在 macOS 不支持用 CLI 直接开窗，必须经 open -na 启动并通过 --working-directory 设初始目录。
  // WHY：Ghostty 的目录继承配置可能让新窗口沿用上一个窗口目录，并覆盖 --working-directory，
  // 因此每次从应用打开任务目录时既显式关闭继承，又在 Ghostty 内部执行一次 cd 兜底。
  if (kind === 'ghostty') {
    // quotedWorkingDirectory 存储传给 Ghostty working-directory 参数的 shell 安全路径。
    const quotedWorkingDirectory = shellSingleQuote(targetPath);
    // interactiveShellScript 存储 Ghostty 启动后执行的脚本：先 cd 到目标目录，再替换成用户默认交互 shell。
    const interactiveShellScript = `cd ${shellSingleQuote(targetPath)} && exec "\${SHELL:-/bin/zsh}"`;
    return `open -na Ghostty.app --args --window-inherit-working-directory=false --working-directory=${quotedWorkingDirectory} -e /bin/zsh -lc ${shellSingleQuote(interactiveShellScript)}`;
  }

  // cdScript 为在终端里执行的命令：cd 到单引号包裹的目标路径（路径先做 POSIX 单引号转义，shell 与 cd 安全）。
  // iTerm2 与 Terminal 都通过 AppleScript 在窗口里执行此命令，规避「open -a 首次冷启动打不到目标目录」的竞态。
  const cdScript = `cd ${shellSingleQuote(targetPath)}`;

  // iTerm2：AppleScript API 与 Terminal 不同——需先 create window with default profile 建窗，再 write text 执行 cd。
  // 同样无论 iTerm2 是否已运行都能可靠落到目标目录。脚本里的双引号转义为 \"，整段用 osascript -e 双引号包裹。
  if (kind === 'iterm2') {
    return `osascript -e "tell application \\"iTerm\\" to create window with default profile" -e "tell application \\"iTerm\\" to tell current session of current window to write text \\"${cdScript}\\"" -e "tell application \\"iTerm\\" to activate"`;
  }

  // 系统 Terminal.app：改用 AppleScript 的 `do script "cd <path>"` 而非 `open -a Terminal <path>`。
  // WHY：`open -a Terminal <path>` 在 Terminal 未运行（首次点击）时存在冷启动竞态——macOS 先拉起
  // Terminal 开一个 home 目录窗口，传入的 path 参数常被这次冷启动吞掉，导致打开的不是目标目录。
  // AppleScript 显式在窗口里执行 cd，无论 Terminal 是否已运行都能可靠落到目标目录；activate 把窗口提到前台。
  // 两层转义：路径先用 POSIX 单引号包裹（shell 与 cd 安全），再放进 AppleScript 双引号字符串里
  // （单引号在 AppleScript 双引号串内无需转义），最外层 osascript 的 -e 参数用双引号包裹整段脚本。
  // 外层用双引号包裹 AppleScript 源；脚本里的双引号（包裹 do script 的参数）转义为 \"
  return `osascript -e "tell application \\"Terminal\\" to do script \\"${cdScript}\\"" -e "tell application \\"Terminal\\" to activate"`;
}
