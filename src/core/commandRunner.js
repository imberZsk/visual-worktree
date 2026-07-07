// 工作流步骤「执行命令」的纯逻辑：把用户配置的命令模板渲染为可交给 shell 执行的最终命令。
// 与 Electron 解耦，便于 vitest 直接单测；真正的 exec 副作用在 electron/ipcHandlers.js。
//
// 业务场景：用户在「设置 → 流程」里给某个步骤配一段 shell 命令（如 ./deploy.sh {path}），
// 点该步骤的「执行」按钮时，在对应任务目录下运行。命令里可用占位符引用任务上下文。

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
