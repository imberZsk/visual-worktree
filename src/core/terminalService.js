// 终端启动纯逻辑模块：负责「检测可用终端类型」与「构建在指定目录打开终端的 shell 命令」。
// 抽成不依赖 Electron 的纯 Node 模块，便于 vitest 直接 import 测试，副作用（exec）留给 ipcHandlers。

import { homedir } from 'os';
import { join } from 'path';

// Ghostty 应用候选安装路径：分别覆盖系统级 /Applications 与用户级 ~/Applications
const GHOSTTY_APP_PATHS = ['/Applications/Ghostty.app', join(homedir(), 'Applications/Ghostty.app')];

/**
 * 检测当前优先可用的终端类型
 * @param {(p:string)=>boolean} existsSyncFn - 注入的 fs.existsSync，便于单测 mock（不真实读盘）
 * @param {NodeJS.Platform} [platform] - 平台标识，默认取当前进程平台；注入便于单测不同平台分支
 * @returns {'ghostty'|'terminal'|'wt'} macOS 检测到 Ghostty 返回 'ghostty' 否则 'terminal'；Windows 返回 'wt'（Windows Terminal，Win11 自带、Win10 多已装）
 */
export function detectTerminal(existsSyncFn, platform = process.platform) {
  // Windows 默认用 Windows Terminal(wt)：Win11 自带、Win10 多数已装；未装时由副作用层兜底到 powershell/cmd
  if (platform === 'win32') return 'wt';
  // installed 标记是否检测到任一 Ghostty 安装路径存在
  const installed = GHOSTTY_APP_PATHS.some((p) => existsSyncFn(p));
  return installed ? 'ghostty' : 'terminal';
}

/**
 * 把字符串包裹为 Windows 命令行的双引号字面量。
 * WHY 用双引号：Windows(cmd/powershell/wt) 的路径分词以双引号为界；且 Windows 文件名本身不允许包含 " 字符
 * （Win32 非法文件名字符），故无需像 POSIX 那样处理引号转义，直接双引号包裹即可安全承载空格/中文/& 等。
 * @param {string} s - 待包裹的原始字符串（如目录路径）
 * @returns {string} 双引号包裹后的 Windows 命令行安全字面量
 */
export function winQuote(s) {
  // Windows 路径不含 " 字符，直接双引号包裹即可防止空格/特殊字符拆词
  return `"${String(s ?? '')}"`;
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
 * @param {'ghostty'|'terminal'|'iterm2'|'wt'|'powershell'|'cmd'} kind - 终端类型，决定使用哪条命令
 * @param {NodeJS.Platform} [platform] - 平台标识，默认取当前进程平台；注入便于单测 Windows 分支
 * @returns {string} 可交给 child_process.exec 执行的命令字符串
 */
export function buildTerminalCommand(targetPath, kind, platform = process.platform) {
  // Windows 分支：wt/powershell/cmd 三种终端，命令语法与 macOS 完全不同，单独处理
  if (platform === 'win32') {
    return buildWindowsTerminalCommand(targetPath, kind);
  }

  // Ghostty 在 macOS 不支持用 CLI 直接开窗，必须经 open -na 启动并通过配置参数设初始目录。
  // WHY：Ghostty 的目录继承配置可能让新窗口沿用上一个窗口目录，并覆盖 working-directory；
  // 因此每次从应用打开任务目录时显式关闭窗口目录继承，再传入目标 working-directory。
  if (kind === 'ghostty') {
    // quotedWorkingDirectory 存储传给 Ghostty working-directory 参数的 shell 安全路径。
    const quotedWorkingDirectory = shellSingleQuote(targetPath);
    return `open -na Ghostty.app --args --window-inherit-working-directory=false --working-directory=${quotedWorkingDirectory}`;
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

/**
 * 解析首选终端类型并给出「主选 + 兜底链」，供副作用层依次尝试打开。
 * WHY 分平台返回不同兜底链：某个终端可能未安装/损坏（如 Windows 没装 Windows Terminal、macOS 没装 Ghostty），
 * 按链逐个重试能最大化「总能打开一个终端」的成功率。纯逻辑抽出便于单测各平台的选择与降级顺序。
 * @param {string} [preferred] - 用户配置的首选终端（macOS：'Terminal'|'iTerm2'|'Ghostty'；Windows：'wt'|'powershell'|'cmd'；跨平台残留的旧值会被忽略）
 * @param {(p:string)=>boolean} existsSyncFn - 注入的 fs.existsSync，用于 macOS 自动探测 Ghostty
 * @param {NodeJS.Platform} [platform] - 平台标识，默认当前进程平台
 * @returns {string[]} 终端类型尝试链：从主选到兜底，副作用层按序尝试直到某个成功
 */
export function resolveTerminalKind(preferred, existsSyncFn, platform = process.platform) {
  // Windows：三种终端 wt→powershell→cmd 依次兜底；cmd 必然存在，作为最终保底
  if (platform === 'win32') {
    // winChain 存储 Windows 终端兜底链，cmd 恒在末位保证总能打开
    const winChain = ['wt', 'powershell', 'cmd'];
    // 用户显式选了合法 Windows 终端时把它提到链首，其余作兜底；旧的 macOS 终端名（Terminal 等）落不到 winChain，走默认顺序
    if (winChain.includes(preferred)) {
      return [preferred, ...winChain.filter((k) => k !== preferred)];
    }
    return winChain;
  }

  // macOS：用户显式选择优先，Ghostty/iTerm2 失败时兜底系统 Terminal（terminal 恒作最终保底）
  // kind 存储主选终端类型：显式配置优先，否则自动探测 Ghostty
  let kind;
  if (preferred === 'Ghostty') kind = 'ghostty';
  else if (preferred === 'iTerm2') kind = 'iterm2';
  else if (preferred === 'Terminal') kind = 'terminal';
  else kind = detectTerminal(existsSyncFn, platform);
  // 非系统 Terminal（ghostty/iterm2）打开失败时兜底重试系统 terminal；主选已是 terminal 则无需追加
  return kind === 'terminal' ? ['terminal'] : [kind, 'terminal'];
}

/**
 * 构建 Windows 平台在指定目录打开终端的命令字符串。
 * 支持三种终端：wt(Windows Terminal)/powershell/cmd。路径统一用 winQuote 双引号包裹防空格拆词。
 * WHY 各终端用不同机制设定初始目录：
 *  - wt 有原生 `-d <dir>` 参数指定启动目录，最干净；
 *  - powershell 无启动目录参数，用 `-NoExit -Command Set-Location -LiteralPath` 启动后 cd（-LiteralPath 不解释通配符，路径含 [] 也安全）；
 *  - cmd 用 `/K cd /d <dir>` 执行 cd 后保持窗口（/d 允许跨盘符切换）。
 * powershell/cmd 都经 `start` 另起独立窗口（否则会阻塞父进程或复用当前控制台）；start 首个 "" 是窗口标题占位（start 语法要求）。
 * @param {string} targetPath - 要作为初始工作目录打开的目录路径
 * @param {'wt'|'powershell'|'cmd'} kind - Windows 终端类型
 * @returns {string} 可交给 child_process.exec 执行的命令字符串
 */
function buildWindowsTerminalCommand(targetPath, kind) {
  // quotedPath 存储双引号包裹的目标路径，兼容空格/中文/& 等特殊字符（Windows 文件名不含 " 故无需转义）
  const quotedPath = winQuote(targetPath);

  // PowerShell：无启动目录参数，启动后用 Set-Location 切目录；-LiteralPath 避免路径中 []* 被当通配符
  if (kind === 'powershell') {
    // psCommand 存储 PowerShell 启动后执行的 cd 命令；路径用单引号包裹（PowerShell 字符串），内部单引号转义为两个单引号
    const psCommand = `Set-Location -LiteralPath '${String(targetPath).replace(/'/g, "''")}'`;
    // -NoExit 保持窗口不退出；start 首参 "" 为窗口标题占位
    return `start "" powershell -NoExit -Command "${psCommand}"`;
  }

  // cmd：/K 执行命令后保持窗口，cd /d 支持跨盘符切换到目标目录
  if (kind === 'cmd') {
    // start 首参 "" 为窗口标题占位；cmd /K "cd /d <path>" 切目录后保留交互窗口
    return `start "" cmd /K "cd /d ${quotedPath}"`;
  }

  // 默认 wt(Windows Terminal)：-d <dir> 原生指定新标签/窗口的启动目录，最简洁可靠
  return `wt -d ${quotedPath}`;
}
