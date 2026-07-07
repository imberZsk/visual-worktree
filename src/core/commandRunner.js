// 工作流步骤「执行命令」的纯逻辑：把用户配置的命令模板渲染为可交给 shell 执行的最终命令。
// 与 Electron 解耦，便于 vitest 直接单测；真正的 exec 副作用在 electron/ipcHandlers.js。
//
// 业务场景：用户在「设置 → 流程」里给某个步骤配一段 shell 命令（如 ./deploy.sh {path}），
// 点该步骤的「执行」按钮时，在对应任务目录下运行。命令里可用占位符引用任务上下文。

import { homedir } from 'os';
import { join } from 'path';

/**
 * 计算 Windows 上 Git for Windows 自带 bash.exe 的常见安装位置（全局装 / 用户装）。
 * WHY 优先用 Git Bash：工作流命令模板多为 POSIX 风格（.sh 脚本、单引号转义），用 Git Bash 跑能与 macOS 保持一致语义，
 * 避免用户为 Windows 重写全部命令模板；找不到 Git Bash 时才兜底 cmd（见 resolveShell）。
 * WHY 用函数而非模块级常量：homedir() 若在模块加载时调用，会与测试对 os.homedir 的 mock 产生初始化顺序问题（TDZ）；
 * 惰性求值到调用时才读 home，既规避该问题，也保证拿到运行时真实用户目录。
 * @returns {string[]} Git Bash 候选绝对路径列表
 */
function gitBashPathsWin32() {
  // homedir() 返回反斜杠路径，统一替换为正斜杠，与前两个硬编码路径保持一致，
  // 使 resolveShell 的 existsSyncFn 接收到的路径格式始终是正斜杠，不受平台分隔符影响
  const home = homedir().replace(/\\/g, '/');
  return [
    'C:/Program Files/Git/bin/bash.exe',
    'C:/Program Files (x86)/Git/bin/bash.exe',
    `${home}/AppData/Local/Programs/Git/bin/bash.exe`,
  ];
}

// TASK_ARG_MODE_AUTO 表示自动判断是否把任务目录作为最后一个参数追加到命令后。
export const TASK_ARG_MODE_AUTO = 'auto';
// TASK_ARG_MODE_NONE 表示永不自动追加任务目录参数，完全尊重用户命令文本。
export const TASK_ARG_MODE_NONE = 'none';
// TASK_ARG_MODE_APPEND_PATH 表示只要命令没有显式 {path}，就把任务目录追加为最后一个参数。
export const TASK_ARG_MODE_APPEND_PATH = 'appendPath';
// TASK_ARG_MODES 存储合法参数模式集合，用于容错损坏配置。
const TASK_ARG_MODES = new Set([TASK_ARG_MODE_AUTO, TASK_ARG_MODE_NONE, TASK_ARG_MODE_APPEND_PATH]);
// PATH_PLACEHOLDER_RE 用于判断命令是否已经显式引用任务目录，避免重复追加。
const PATH_PLACEHOLDER_RE = /\{path\}/;
// CONTEXT_PLACEHOLDER_RE 用于判断命令是否已经显式引用任意任务上下文；auto 模式下视为用户已接管参数。
const CONTEXT_PLACEHOLDER_RE = /\{(?:path|task|branch|idea)\}/;
// SHELL_COMMAND_STRING_RE 用于识别 bash/sh/zsh -c/-lc 这类“命令字符串”模式，auto 不应追加位置参数。
const SHELL_COMMAND_STRING_RE = /^(?:bash|sh|zsh)\s+-[^\s]*c(?:\s|$)/;
// SHELL_SCRIPT_COMMAND_RE 用于保守识别脚本调用命令；只匹配命令开头的 .sh 或 bash/sh/zsh 执行 .sh 的场景。
const SHELL_SCRIPT_COMMAND_RE = /^(?:(?:bash|sh|zsh)\s+(?:-[^\s]+\s+)*[^;&|<>]+\.sh(?:\s|$)|(?:\.{0,2}\/|~\/|\/)?[^\s;&|<>]+\.sh(?:\s|$))/;

/**
 * 把字符串包裹为 POSIX shell 的单引号字面量，内部单引号用 '\'' 序列转义。
 * 用于把占位符的替换值（路径/任务名/分支名）安全嵌入命令，避免其中的空格/引号/&/$ 等
 * 被 shell 解释或截断命令（如任务名含 & 时不加引号会被当作后台执行符）。
 * @param {string} s - 待包裹的原始字符串
 * @returns {string} 单引号包裹后的 shell 安全字面量
 */
function shellSingleQuote(s) {
  // 把每个单引号替换为 '\''（闭合单引号→转义单引号→重开单引号），再整体用单引号包裹
  return `'${String(s ?? '').replace(/'/g, `'\\''`)}'`;
}

/**
 * 规范化任务目录参数模式，损坏/缺失配置统一回退 auto。
 * @param {string} mode - 原始任务目录参数模式
 * @returns {'auto'|'none'|'appendPath'} 可执行的参数模式
 */
function normalizeTaskArgMode(mode) {
  // value 存储字符串化后的模式值，避免 null/undefined 直接参与集合判断。
  const value = String(mode || '').trim();
  return TASK_ARG_MODES.has(value) ? value : TASK_ARG_MODE_AUTO;
}

/**
 * 判断命令是否看起来像“直接运行一个 shell 脚本”。
 * WHY auto 模式不能无脑给所有命令加路径，npm test / pnpm build 之类命令多一个参数可能改变语义；
 * 但用户配置 bash xxx.sh 时，脚本常把任务目录作为位置参数读取，自动补齐能减少配置心智负担。
 * @param {string} command - 去首尾空白后的命令模板
 * @returns {boolean} 是否是可安全自动补任务目录的脚本形态
 */
function looksLikeShellScriptCommand(command) {
  // text 存储命令文本，统一容错非字符串输入。
  const text = String(command || '').trim();
  // bash -c 的后续内容是命令字符串，不是脚本文件参数位；auto 模式下跳过，避免路径被当作 $0/$1 等传入。
  if (SHELL_COMMAND_STRING_RE.test(text)) return false;
  return SHELL_SCRIPT_COMMAND_RE.test(text);
}

/**
 * 判断当前命令是否需要把任务目录追加为最后一个参数。
 * @param {string} command - 去首尾空白后的命令模板（替换占位符前）
 * @param {{path?:string}} ctx - 任务上下文，path 为空时不会追加
 * @param {{taskArgMode?:string}} options - 渲染选项，taskArgMode 控制追加策略
 * @returns {boolean} 是否应追加任务目录参数
 */
function shouldAppendTaskPath(command, ctx = {}, options = {}) {
  // taskPath 存储任务目录；缺失时无法追加，直接返回 false。
  const taskPath = String(ctx.path || '').trim();
  if (!taskPath) return false;
  // commandText 存储命令模板原文，用于检测占位符和脚本形态。
  const commandText = String(command || '').trim();
  // 已显式使用 {path} 时不再自动追加，避免脚本收到重复路径参数。
  if (PATH_PLACEHOLDER_RE.test(commandText)) return false;
  // mode 存储规范化后的任务目录参数模式。
  const mode = normalizeTaskArgMode(options.taskArgMode);
  if (mode === TASK_ARG_MODE_NONE) return false;
  if (mode === TASK_ARG_MODE_APPEND_PATH) return true;
  // auto 模式下，如果用户已经显式用了任意上下文占位符，视为已自行设计参数，不再猜测追加。
  if (CONTEXT_PLACEHOLDER_RE.test(commandText)) return false;
  return looksLikeShellScriptCommand(commandText);
}

/**
 * 渲染工作流步骤的执行命令：把模板里的占位符替换为带 shell 引号的实际值。
 * 支持的占位符：{path} 任务目录绝对路径、{task} 任务名、{branch} 分支名、{idea} 想法描述文本。
 * WHY 替换值要加引号：占位符常被替换成含空格/中文/&（如任务名「物料发放&维修」）的值，
 * 裸值会被 shell 拆词或误解析；统一用单引号字面量包裹，保证命令语义稳定。
 * @param {string} command - 用户配置的命令模板（可空）
 * @param {{path?:string, task?:string, branch?:string, idea?:string}} [ctx] - 任务上下文，提供占位符替换值
 * @param {{taskArgMode?:'auto'|'none'|'appendPath'}} [options] - 渲染选项，控制是否自动追加任务目录参数
 * @returns {string} 渲染后的最终命令；command 为空/全空白时返回空串（调用方据此判定「无命令」）
 */
export function buildStepCommand(command, ctx = {}, options = {}) {
  // tpl 为去首尾空白的有效命令模板；空命令直接返回空串，调用方据此跳过执行
  const tpl = String(command ?? '').trim();
  if (tpl === '') return '';
  // rendered 存储替换四个占位符后的命令；用全局替换支持同一占位符出现多次。
  const rendered = tpl
    .replace(/\{path\}/g, shellSingleQuote(ctx.path ?? ''))
    .replace(/\{task\}/g, shellSingleQuote(ctx.task ?? ''))
    .replace(/\{branch\}/g, shellSingleQuote(ctx.branch ?? ''))
    .replace(/\{idea\}/g, shellSingleQuote(ctx.idea ?? ''));
  // 任务目录参数需要追加在渲染后命令末尾，保证 path 一样经过 shell 安全引号包裹。
  if (shouldAppendTaskPath(tpl, ctx, options)) return `${rendered} ${shellSingleQuote(ctx.path ?? '')}`;
  return rendered;
}

/**
 * 解析在当前平台执行工作流命令字符串所用的 shell（spawn 的可执行文件 + 参数）。
 * WHY 分平台：macOS/Linux 有 /bin/bash，直接 `bash -c <cmd>`；Windows 默认无 bash，
 * 但装了 Git for Windows 就有 bash.exe——优先用它保持与 macOS 一致的 POSIX 语义（.sh 脚本/单引号转义可复用），
 * 找不到才兜底 `cmd /c <cmd>`（此时用户的 POSIX 命令模板可能不适用，UI 需提示装 Git Bash）。
 * 纯逻辑抽出便于单测各平台/Git Bash 有无的分支，副作用（spawn）留给 ipcHandlers.runWorkflowStep。
 * @param {NodeJS.Platform} [platform] - 平台标识，默认当前进程平台
 * @param {(p:string)=>boolean} [existsSyncFn] - 注入的 fs.existsSync，用于探测 Git Bash 是否存在（默认恒 false，便于纯逻辑测试兜底分支）
 * @returns {{cmd:string, args:string[], shell:'bash'|'cmd', bashFound:boolean}} spawn 所需的可执行文件与前置参数；调用方把最终命令串接在 args 末尾。shell 标识实际 shell 类型，bashFound 标记 Windows 上是否找到 Git Bash（供 UI 提示）
 */
export function resolveShell(platform = process.platform, existsSyncFn = () => false) {
  // 非 Windows：直接用 bash -c 执行命令字符串，保持原有 POSIX 行为
  if (platform !== 'win32') {
    return { cmd: 'bash', args: ['-c'], shell: 'bash', bashFound: true };
  }
  // Windows：优先探测 Git for Windows 自带的 bash.exe（PATH 里没有时用绝对路径）
  // gitBash 存储探测到的 Git Bash 绝对路径，找不到为 undefined
  const gitBash = gitBashPathsWin32().find((p) => existsSyncFn(p));
  if (gitBash) {
    // 找到 Git Bash：用它 -c 执行，命令模板的 POSIX 语义（.sh/单引号）与 macOS 一致
    return { cmd: gitBash, args: ['-c'], shell: 'bash', bashFound: true };
  }
  // 兜底：无 Git Bash 时用 Windows 自带 cmd /c 执行；POSIX 风格命令模板可能失效，bashFound=false 供 UI 提示
  return { cmd: 'cmd', args: ['/c'], shell: 'cmd', bashFound: false };
}
