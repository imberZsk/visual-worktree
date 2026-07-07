import { IPC } from './ipcChannels.js';
import * as gitService from '../src/core/gitService.js';
import { loadConfig, resetConfig, saveConfig } from '../src/core/config.js';
import { detectTerminal, buildTerminalCommand, resolveTerminalKind, shellSingleQuote, winQuote } from '../src/core/terminalService.js';
import { buildStepCommand, resolveShell } from '../src/core/commandRunner.js';
import { getSessionsByTask, getTasksSummary } from '../src/core/claudeService.js';
import { checkEnvHealth } from '../src/core/envHealthService.js';
import { loadTaskEnvHealth, saveTaskEnvHealth } from '../src/core/envHealthStore.js';
import { loadIdeaWorkflows, saveIdeaWorkflows, loadIdeaRuns, appendIdeaRun } from '../src/core/ideaWorkflowService.js';
import { archiveTaskDocs } from '../src/core/taskDocsService.js';
import { exec, spawn } from 'child_process';
import { dirname, join, resolve } from 'path';
import { existsSync, rmSync, readdirSync } from 'fs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { homedir } from 'os';

// IPC handler 注册：把核心 gitService/config 能力暴露给渲染进程。
// 抽成独立函数并注入 ipcMain，便于用 mock 做接口测试（无需启动 Electron）。

// VSCode CLI 在 GUI 启动的 Electron 中可能不在 PATH，预置各平台常见安装位置作兜底。
// macOS：Homebrew(intel/arm) 与应用包内 CLI；Windows：系统级与用户级安装的 code.cmd（%LOCALAPPDATA% 用户装、Program Files 全局装）。
const VSCODE_CLI_PATHS_DARWIN = [
  '/usr/local/bin/code',
  '/opt/homebrew/bin/code',
  '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
];
// Windows 常见 VSCode CLI(code.cmd) 位置：优先用户级安装（占多数），再全局安装
const VSCODE_CLI_PATHS_WIN32 = [
  join(homedir(), 'AppData/Local/Programs/Microsoft VS Code/bin/code.cmd'),
  'C:/Program Files/Microsoft VS Code/bin/code.cmd',
  'C:/Program Files (x86)/Microsoft VS Code/bin/code.cmd',
];

/**
 * 按平台返回 VSCode CLI 的候选绝对路径列表（用于 PATH 中无 code 时的兜底）。
 * @param {NodeJS.Platform} [platform] - 平台标识，默认当前进程平台
 * @returns {string[]} 该平台下 VSCode CLI 的候选安装路径
 */
function getVscodeCliPaths(platform = process.platform) {
  // Windows 返回 code.cmd 候选路径，其余平台（macOS/Linux）返回 Unix 风格候选
  return platform === 'win32' ? VSCODE_CLI_PATHS_WIN32 : VSCODE_CLI_PATHS_DARWIN;
}

// 需要透传给流程脚本子进程的环境变量前缀/名称白名单。
// WHY：流程脚本（jira 评论、飞书上传、claude 分析）依赖 ANTHROPIC/JIRA/SSO/FEISHU 等凭证，
// 这些通常配在 ~/.claude/settings.json 的 env 里；GUI 启动的 Electron 不会继承登录 shell 的环境，
// 故从 settings.json 读出并注入子进程，让脚本无需用户再手动 export。
const STEP_ENV_PREFIXES = ['ANTHROPIC_', 'JIRA_', 'SSO_', 'FEISHU_'];

/**
 * 从 ~/.claude/settings.json 的 env 段读取流程脚本所需的凭证类环境变量。
 * 只挑白名单前缀的键，避免把无关配置（甚至敏感无关项）一股脑注入子进程。
 * 读取失败（文件不存在/损坏）时返回空对象，不影响主流程。
 * @returns {Promise<Record<string,string>>} 过滤后的环境变量键值对
 */
async function loadClaudeSettingsEnv() {
  // result 累积命中白名单前缀的环境变量
  const result = {};
  try {
    // settingsPath 为 Claude Code 全局配置文件路径
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    if (!existsSync(settingsPath)) return result;
    // env 为 settings.json 里的环境变量段（可能不存在）
    const env = JSON.parse(await readFile(settingsPath, 'utf8')).env || {};
    for (const [k, v] of Object.entries(env)) {
      // 仅注入白名单前缀且值为字符串的项
      if (typeof v === 'string' && STEP_ENV_PREFIXES.some((p) => k.startsWith(p))) {
        result[k] = v;
      }
    }
  } catch {
    // 配置缺失/损坏时静默降级为空，脚本会自行提示缺少凭证
  }
  return result;
}

/**
 * 根据配置的命令模板与目标路径构建 VSCode 启动命令。
 * 模板里的 {path} 占位符会被替换为带引号的路径；模板默认追加 -n 在「新窗口」打开。
 * WHY 用 -n 而非 -r：-r（--reuse-window）会把目标目录开在「当前聚焦的窗口」里，
 * 等于替换掉用户正在看的窗口内容（表现为「关掉旧窗口又开新窗口」）——这不是用户想要的。
 * -n（--new-window）始终新开一个窗口、不动现有窗口；两者都不会在程序坞新建额外的 VSCode 进程图标。
 * @param {string} template - 命令模板，如 'code {path}'，{path} 为占位符
 * @param {string} targetPath - 要打开的目录路径
 * @param {NodeJS.Platform} [platform] - 平台标识，默认当前进程平台；决定路径用 POSIX 单引号还是 Windows 双引号
 * @returns {string} 可直接交给 exec 执行的完整命令字符串
 */
export function buildVscodeCommand(template, targetPath, platform = process.platform) {
  // quoted 为按平台包裹的目标路径：Windows 用双引号（cmd 分词以双引号为界），其余平台用 POSIX 单引号
  const quoted = platform === 'win32' ? winQuote(targetPath) : shellSingleQuote(targetPath);
  // tpl 为去掉首尾空白的有效模板，缺省回退到默认 code 命令
  const tpl = (template || 'code {path}').trim();
  // 注入 -n（new-window）：始终新开窗口而不替换用户当前窗口。
  // 仅当模板是 code 系命令且未显式带 -n/-r（用户已自定窗口行为）时才注入，避免破坏用户自定义命令。
  const needNewWindow = /(^|\/|\\)code(\s|$)/.test(tpl) && !/(^|\s)(-n|--new-window|-r|--reuse-window)(\s|$)/.test(tpl);
  // injected 为补齐新窗口参数后的模板
  const injected = needNewWindow ? tpl.replace(/(^|\/|\\)code(\s|$)/, (m) => `${m.trimEnd()} -n `) : tpl;
  // 模板含 {path} 占位符则替换，否则在末尾拼接路径，兼容两种写法
  return injected.includes('{path}') ? injected.replace('{path}', quoted) : `${injected} ${quoted}`;
}

/**
 * 在 VSCode 中打开目录：优先用配置的命令模板（默认 code -n 新窗口打开，不动用户当前窗口），
 * 失败则回退到已知 CLI 路径，再失败用系统方式启动 VSCode 应用（macOS: open -a；Windows: start code）。
 * @param {string} targetPath - 要打开的目录路径
 * @param {string} [template] - 可选的命令模板（来自用户配置 vscodeCommand）
 * @param {NodeJS.Platform} [platform] - 平台标识，默认当前进程平台；决定引号风格与最终兜底命令
 * @returns {Promise<{success:boolean, error?:string}>} 操作结果
 */
function openInVscode(targetPath, template, platform = process.platform) {
  // isWin 标记是否 Windows 平台，决定路径引号风格与 CLI 候选路径/兜底命令
  const isWin = platform === 'win32';
  // quoted 为按平台包裹的目标路径：Windows 双引号、其余 POSIX 单引号
  const quoted = isWin ? winQuote(targetPath) : shellSingleQuote(targetPath);
  return new Promise((resolve) => {
    // 先尝试配置模板（默认 code -n），在新窗口打开而不替换用户当前正在看的窗口
    exec(buildVscodeCommand(template, targetPath, platform), (err) => {
      if (!err) return resolve({ success: true });
      // PATH 中没有 code，尝试该平台已知的绝对路径（同样用 -n 新窗口打开）
      const cliPath = getVscodeCliPaths(platform).find((p) => existsSync(p));
      if (cliPath) {
        // quotedCliPath 存储 VSCode CLI 的安全路径，兼容安装目录里的空格
        const quotedCliPath = isWin ? winQuote(cliPath) : shellSingleQuote(cliPath);
        exec(`${quotedCliPath} -n ${quoted}`, (err2) => {
          if (!err2) return resolve({ success: true });
          // 绝对路径也失败，最终回退到系统级启动
          fallbackOpen();
        });
      } else {
        fallbackOpen();
      }
    });
    // 兜底：用系统方式启动 VSCode 应用打开目录。
    // Windows 无 open -a：改用 start 调 code（首个 "" 为窗口标题占位）；macOS 用 open -a 按应用名启动。
    function fallbackOpen() {
      // fallbackCmd 为平台相关的最终兜底命令
      const fallbackCmd = isWin ? `start "" code -n ${quoted}` : `open -a "Visual Studio Code" ${quoted}`;
      exec(fallbackCmd, (err3) => {
        if (!err3) resolve({ success: true });
        else resolve({ success: false, error: '未找到 VSCode，请确认已安装' });
      });
    }
  });
}

/**
 * 在终端中打开目录：优先使用用户配置指定的终端，未指定时按平台自动判定
 * （macOS：检测到 Ghostty 用 Ghostty 否则系统 Terminal；Windows：Windows Terminal→powershell→cmd）。
 * 选用的终端打开失败（未安装/损坏）时按兜底链逐个重试，直到某个成功或链尽。
 * 终端类型解析与命令构建的纯逻辑在 src/core/terminalService.js，这里只做 exec 副作用与降级兜底。
 * 导出以便单测验证「主选失败 → 兜底重试」这段分支逻辑（mock child_process）。
 * @param {string} targetPath - 要作为初始工作目录打开的目录路径
 * @param {string} [preferred] - 用户配置的首选终端（macOS：'Terminal'|'iTerm2'|'Ghostty'；Windows：'wt'|'powershell'|'cmd'），来自配置 terminalApp
 * @returns {Promise<{success:boolean, error?:string}>} 操作结果
 */
export function openInTerminal(targetPath, preferred) {
  // chain 为终端类型尝试链（主选 + 兜底），按平台解析；副作用层按序 exec 直到成功
  const chain = resolveTerminalKind(preferred, existsSync);
  return new Promise((resolve) => {
    // tryAt 从链的第 index 项开始尝试打开，失败则递归尝试下一项，链尽仍失败则回传错误
    const tryAt = (index) => {
      // 链尽仍无成功：所有候选终端都打不开，回传失败供 UI 提示
      if (index >= chain.length) {
        resolve({ success: false, error: '未找到可用终端' });
        return;
      }
      exec(buildTerminalCommand(targetPath, chain[index]), (err) => {
        if (!err) return resolve({ success: true });
        // 当前终端打开失败（未安装/损坏），继续尝试链中下一个兜底终端
        tryAt(index + 1);
      });
    };
    tryAt(0);
  });
}

/**
 * 判断输出里是否包含高置信错误标记。
 * WHY 部分团队脚本会打印「[错误] 用法...」但忘记 exit 1；如果仍按退出码 0 判成功，
 * UI 会同时出现脚本错误与成功勾选，状态割裂。这里仅匹配行首错误标记，降低误伤普通文本的概率。
 * @param {string} output - stdout/stderr 合并后的输出文本
 * @returns {boolean} 是否命中高置信错误标记
 */
function hasHighConfidenceErrorOutput(output) {
  // text 存储输出文本的字符串形式，容错 Buffer/null/undefined。
  const text = String(output || '');
  return /^\s*(?:\[错误\]|\[失败\]|\[未通过\]|\[ERROR\]|\[Error\]|ERROR:|Error:|错误[:：]|失败[:：]|未通过[:：])/m.test(text);
}

/**
 * 执行某工作流步骤配置的 shell 命令：在任务目录（cwd）下流式运行渲染后的命令，实时回推输出并最终回传汇总结果。
 * 命令模板的占位符渲染（{path}/{task}/{branch}）在纯逻辑 buildStepCommand 完成，这里负责 spawn 副作用与流式推送。
 * WHY 用 spawn('bash',['-c',cmd]) 而非 exec：exec 要等进程结束才一次性回传全部输出（黑盒等待）；
 * spawn 可监听 stdout/stderr 的 data 事件，每来一段即通过 onChunk 推给渲染进程，让执行过程可见。
 * 用 bash -c 执行整条命令字符串，保持与原 exec 等价的 shell 解释能力（管道/重定向/占位符引号等）。
 * 导出以便单测验证「cwd 传入 / 成功 / 失败 / stdout+stderr 流式回传 / 空命令短路」分支（mock child_process.spawn）。
 * @param {{command?:string, cwd?:string, task?:string, branch?:string, taskName?:string, stepKey?:string, taskArgMode?:string}} payload - 执行入参；taskName/stepKey 用于把流式输出事件路由到正确的任务/步骤
 * @param {(evt:{taskName?:string, stepKey?:string, chunk:string})=>void} [onChunk] - 流式输出回调：每来一段 stdout/stderr 即调用，由调用方推给渲染进程
 * @returns {Promise<{success:boolean, code?:number, stdout?:string, stderr?:string, error?:string}>} 执行结果
 */
export function runWorkflowStep(payload = {}, onChunk) {
  // command/cwd/task/branch 从入参解构：command 为用户配置的命令模板，cwd 为任务目录，task/branch 供占位符替换
  const { command, cwd, task, branch, taskArgMode } = payload;
  const taskName = payload.taskName ?? task;
  const stepKey = payload.stepKey;
  // extraEnv 为调用方注入的额外环境变量（如 ANTHROPIC_API_KEY），合并到子进程 env 中
  const extraEnv = payload.extraEnv || {};
  // finalCmd 为占位符渲染后的最终命令；空命令（未配置）直接返回失败提示，避免空跑
  const finalCmd = buildStepCommand(command, { path: cwd, task, branch }, { taskArgMode });
  return new Promise((resolve) => {
    // 未配置命令时不执行，回传明确错误供 UI 提示用户去设置里补命令
    if (!finalCmd) {
      resolve({ success: false, error: '该步骤未配置执行命令' });
      return;
    }
    // outBuf/errBuf 分别累积 stdout/stderr 全文，进程结束时回传供 UI 汇总展示
    let outBuf = '';
    let errBuf = '';
    // emit 把一段输出推给渲染进程（带任务/步骤标识用于路由）；onChunk 未传时静默忽略
    const emit = (chunk) => {
      if (typeof onChunk === 'function') onChunk({ taskName, stepKey, chunk });
    };
    // taskEnv 存储工作流脚本可直接读取的任务上下文环境变量；即使命令不用占位符/参数，也能通过环境感知当前任务。
    const taskEnv = {
      VW_TASK_DIR: cwd || '',
      VW_TASK_NAME: taskName || '',
      VW_TASK_BRANCH: branch || '',
    };
    // childEnv 存储最终子进程环境变量：系统环境 + 额外凭证 + 工作流任务上下文。
    const childEnv = { ...process.env, ...extraEnv, ...taskEnv };
    // shell 为按平台解析的执行器：macOS/Linux 用 bash；Windows 优先 Git Bash（保持 POSIX 语义），无则兜底 cmd。
    // 传入 existsSync 探测 Windows 上 Git Bash 的绝对路径；纯逻辑在 commandRunner.resolveShell。
    const shell = resolveShell(process.platform, existsSync);
    // 用解析出的 shell 执行整条命令字符串（bash -c / cmd /c <finalCmd>），合并 childEnv 注入凭证和任务上下文
    const child = spawn(shell.cmd, [...shell.args, finalCmd], { cwd, env: childEnv });
    // stdout data：累积到 outBuf 并实时推送
    child.stdout?.on('data', (data) => {
      // text 为本次到达的输出片段（Buffer 转字符串）
      const text = String(data);
      outBuf += text;
      emit(text);
    });
    // stderr data：累积到 errBuf 并实时推送（很多脚本进度打到 stderr，也需可见）
    child.stderr?.on('data', (data) => {
      const text = String(data);
      errBuf += text;
      emit(text);
    });
    // error 事件：进程无法启动（如 bash 缺失）时回传失败，避免 Promise 悬挂
    child.on('error', (err) => {
      resolve({ success: false, stdout: outBuf, stderr: errBuf, error: err.message });
    });
    // close 事件：进程结束，按退出码和高置信错误输出共同判定成败并回传汇总输出
    child.on('close', (code) => {
      // combinedOutput 存储 stdout/stderr 合并文本，用于检查脚本是否输出了明确错误标记。
      const combinedOutput = `${outBuf}${errBuf}`;
      // hasErrorOutput 标记脚本是否打出明确错误；WHY：弥补脚本忘记非零退出的状态割裂问题。
      const hasErrorOutput = hasHighConfidenceErrorOutput(combinedOutput);
      // success 仅在退出码为 0 且没有高置信错误输出时成立。
      const success = code === 0 && !hasErrorOutput;
      // error 存储失败原因，供 UI toast 和输出弹窗展示。
      const error = success ? undefined : (hasErrorOutput ? '检测到错误输出' : `命令退出码 ${code}`);
      resolve({
        success,
        code: typeof code === 'number' ? code : undefined,
        stdout: outBuf,
        stderr: errBuf,
        error,
      });
    });
  });
}

/**
 * 判断目标路径是否在指定根目录内。
 * @param {string} targetPath - 待判断的目标路径
 * @param {string} rootPath - 允许清理的根目录
 * @returns {boolean} 目标路径是否位于根目录内或等于根目录
 */
function isPathInsideRoot(targetPath, rootPath) {
  // resolvedTarget 存储目标路径的规范化绝对路径
  const resolvedTarget = resolve(targetPath);
  // resolvedRoot 存储根目录的规范化绝对路径
  const resolvedRoot = resolve(rootPath);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + '/');
}

/**
 * 删除任务目录后向上清理空父目录，避免带 / 的任务名留下中间壳目录。
 * @param {string} folderPath - 已删除或即将删除的任务目录路径
 * @param {string} rootPath - worktree 根目录，清理不会越过该目录
 * @returns {void}
 */
function removeEmptyParentsWithinRoot(folderPath, rootPath) {
  // resolvedRoot 存储 worktree 根目录的规范化绝对路径，用作清理边界
  const resolvedRoot = resolve(rootPath);
  // current 存储当前尝试清理的父级目录，从任务目录的父目录开始
  let current = dirname(resolve(folderPath));
  while (current !== resolvedRoot && isPathInsideRoot(current, resolvedRoot)) {
    try {
      if (!existsSync(current)) {
        current = dirname(current);
        continue;
      }
      // entries 存储当前目录下的剩余文件/目录，用于判断是否为空
      const entries = readdirSync(current);
      if (entries.length > 0) return;
      rmSync(current, { recursive: false, force: true });
      current = dirname(current);
    } catch (e) {
      // 权限或并发文件变化导致清理失败时停止向上清理，不影响任务目录删除结果
      return;
    }
  }
}

/**
 * 注册所有 IPC handler
 * @param {object} ipcMain - Electron 的 ipcMain（测试时传入 mock）
 * @param {object} deps - 依赖注入：{ getWindow, shell }，用于发进度/打开 Finder
 * @returns {void}
 */
export function registerIpcHandlers(ipcMain, deps = {}) {
  // getWindow 返回当前主窗口，用于向渲染进程推送批量进度；shell 打开 Finder；clipboard 写系统剪贴板
  const { getWindow, shell, clipboard, dialog, dataDir } = deps;
  // configBaseDir 存储配置文件目录；生产环境为空时使用默认 ~/.visualWorktree，测试时复用 dataDir 隔离真实用户配置。
  const configBaseDir = dataDir;

  // 扫描项目：读取配置中的源路径与忽略列表
  ipcMain.handle(IPC.SCAN_PROJECTS, async (_e, opts = {}) => {
    const cfg = loadConfig(configBaseDir);
    return gitService.scanProjects(opts.path || cfg.sourceProjectsPath, {
      ignore: cfg.ignoredProjects,
      mainBranches: cfg.mainBranches,
      fetch: opts.fetch ?? cfg.autoFetch,
    });
  });

  // 获取单个项目状态（带 fetch 以拿到准确 behind）
  ipcMain.handle(IPC.GET_PROJECT_STATUS, async (_e, projectPath, opts = {}) => {
    const cfg = loadConfig(configBaseDir);
    return gitService.getProjectStatus(projectPath, { mainBranches: cfg.mainBranches, ...opts });
  });

  // 切换分支：若目标分支是配置中的主分支，走带兜底的 checkoutMainBranch
  // （不同仓库主分支名 master/main 不一，避免切到不存在的分支报 pathspec 错误）
  ipcMain.handle(IPC.CHECKOUT_BRANCH, async (_e, projectPath, branch) => {
    const cfg = loadConfig(configBaseDir);
    // mainBranches 配置的候选主分支名列表，默认 master/main
    const mainBranches = cfg.mainBranches || ['master', 'main'];
    // 请求切换的目标分支属于主分支时，用兜底逻辑切到实际存在的那个
    if (mainBranches.includes(branch)) {
      return gitService.checkoutMainBranch(projectPath, mainBranches);
    }
    // 普通分支按原样切换
    return gitService.checkoutBranch(projectPath, branch);
  });

  // 拉取更新
  ipcMain.handle(IPC.PULL_UPDATES, async (_e, projectPath) => {
    return gitService.pullUpdates(projectPath);
  });

  // 打开系统目录选择器：设置页路径输入使用，取消选择不视为错误。
  ipcMain.handle(IPC.SELECT_DIRECTORY, async (_e, opts = {}) => {
    try {
      // result 存储 Electron 原生目录选择器结果，filePaths 第一项为用户选中的目录。
      const result = await dialog?.showOpenDialog?.({
        defaultPath: opts?.defaultPath || undefined,
        properties: ['openDirectory'],
      });
      if (!result || result.canceled || !result.filePaths?.[0]) {
        return { canceled: true };
      }
      return { canceled: false, path: result.filePaths[0] };
    } catch (e) {
      // 对话框不可用或系统异常时返回结构化错误，渲染进程据此给用户提示。
      return { canceled: false, error: e.message || '选择目录失败' };
    }
  });

  // 打开系统文件选择器：流程步骤"执行命令"输入框旁的"选择文件"按钮使用，取消选择不视为错误。
  ipcMain.handle(IPC.SELECT_FILE, async (_e, opts = {}) => {
    try {
      // result 存储 Electron 原生文件选择器结果，filePaths 第一项为用户选中的文件。
      const result = await dialog?.showOpenDialog?.({
        defaultPath: opts?.defaultPath || undefined,
        properties: ['openFile'],
      });
      if (!result || result.canceled || !result.filePaths?.[0]) {
        return { canceled: true };
      }
      return { canceled: false, path: result.filePaths[0] };
    } catch (e) {
      // 对话框不可用或系统异常时返回结构化错误，渲染进程据此给用户提示。
      return { canceled: false, error: e.message || '选择文件失败' };
    }
  });

  // 批量操作：通过 window.webContents 推送进度事件
  ipcMain.handle(IPC.BATCH_OPERATE, async (_e, projectPaths, operation, args = {}) => {
    const cfg = loadConfig(configBaseDir);
    // 批量切主分支（checkoutMain）注入配置的候选主分支名，使每个仓库都按 master/main 兜底切换
    const finalArgs = operation === 'checkoutMain'
      ? { mainBranches: cfg.mainBranches, ...args }
      : args;
    return gitService.batchOperate(projectPaths, operation, finalArgs, (progress) => {
      const win = getWindow?.();
      if (win && !win.isDestroyed?.()) {
        win.webContents.send(IPC.BATCH_PROGRESS, progress);
      }
    });
  });

  // 获取 worktree 列表
  ipcMain.handle(IPC.GET_WORKTREES, async (_e, projectPath) => {
    const cfg = loadConfig(configBaseDir);
    return gitService.getWorktrees(projectPath, cfg.mainBranches);
  });

  // 按任务分组扫描 worktree
  ipcMain.handle(IPC.SCAN_WORKTREES_BY_TASK, async (_e, opts = {}) => {
    const cfg = loadConfig(configBaseDir);
    return gitService.scanWorktreesByTask(
      opts.projectsRoot || cfg.sourceProjectsPath,
      opts.worktreesRoot || cfg.worktreesPath,
      { status: opts.status ?? true, mainBranches: cfg.mainBranches },
    );
  });

  // 创建 worktree
  ipcMain.handle(IPC.ADD_WORKTREE, async (_e, projectPath, targetPath, branch, opts) => {
    // cfg 当前应用配置，用于取主分支候选名作为新建分支的起点
    const cfg = loadConfig(configBaseDir);
    // 注入 mainBranches：新建分支时以 master/main 为起点，避免基于源仓库当前 HEAD（可能停在 test）
    return gitService.addWorktree(projectPath, targetPath, branch, {
      mainBranches: cfg.mainBranches,
      workDocumentTemplates: cfg.workDocumentTemplates,
      ...opts,
    });
  });

  // 删除 worktree
  ipcMain.handle(IPC.REMOVE_WORKTREE, async (_e, projectPath, worktreePath, opts) => {
    return gitService.removeWorktree(projectPath, worktreePath, opts);
  });

  // 清理失效 worktree
  ipcMain.handle(IPC.PRUNE_WORKTREES, async (_e, projectPath) => {
    return gitService.pruneWorktrees(projectPath);
  });

  // 按任务批量创建 worktree：用配置里的 worktreesRoot，向渲染进程推送进度
  ipcMain.handle(IPC.BATCH_ADD_WORKTREE, async (_e, params) => {
    const cfg = loadConfig(configBaseDir);
    return gitService.batchAddWorktree(
      // 注入 worktreesRoot、mainBranches 与工作文档模板，params 中同名字段可覆盖
      { worktreesRoot: cfg.worktreesPath, mainBranches: cfg.mainBranches, workDocumentTemplates: cfg.workDocumentTemplates, ...params },
      (progress) => {
        const win = getWindow?.();
        if (win && !win.isDestroyed?.()) {
          win.webContents.send(IPC.BATCH_PROGRESS, progress);
        }
      },
    );
  });

  // 读取配置
  ipcMain.handle(IPC.LOAD_CONFIG, async () => loadConfig(configBaseDir));

  // 保存配置
  ipcMain.handle(IPC.SAVE_CONFIG, async (_e, config) => saveConfig(config, configBaseDir));

  // 恢复默认配置
  ipcMain.handle(IPC.RESET_CONFIG, async () => resetConfig(configBaseDir));

  // 获取提交历史（最近 n 条）
  ipcMain.handle(IPC.GET_COMMITS, async (_e, projectPath, n = 10) => {
    return gitService.getCommits(projectPath, n);
  });

  // 在 Finder 中打开目录
  ipcMain.handle(IPC.OPEN_IN_FINDER, async (_e, targetPath) => {
    shell?.openPath?.(targetPath);
    return { success: true };
  });

  // 在 VSCode 中打开目录（命令模板来自用户配置，默认 code -r 复用窗口避免新建程序坞图标）
  ipcMain.handle(IPC.OPEN_IN_VSCODE, async (_e, targetPath) => {
    // cfg 当前应用配置，读取用户自定义的 VSCode 命令模板
    const cfg = loadConfig(configBaseDir);
    return openInVscode(targetPath, cfg.vscodeCommand);
  });

  // 在终端中打开目录（终端类型来自用户配置，未配置时自动检测 Ghostty/Terminal）
  ipcMain.handle(IPC.OPEN_IN_TERMINAL, async (_e, targetPath) => {
    // cfg 当前应用配置，读取用户选择的终端应用
    const cfg = loadConfig(configBaseDir);
    return openInTerminal(targetPath, cfg.terminalApp);
  });

  // 执行工作流步骤的 shell 命令（在任务目录下流式运行）：
  // 执行过程中逐段把 stdout/stderr 通过 STEP_OUTPUT 推给渲染进程使过程可见，结束时回传汇总 {success,code,stdout,stderr}
  ipcMain.handle(IPC.RUN_WORKFLOW_STEP, async (_e, payload) => {
    // extraEnv 从 ~/.claude/settings.json 读取 ANTHROPIC/JIRA/SSO/FEISHU 凭证注入子进程，
    // 使流程脚本（claude 流式分析 / jira 评论 / 飞书上传）无需用户再手动 export 即可认证。
    const extraEnv = await loadClaudeSettingsEnv();
    return runWorkflowStep({ ...payload, extraEnv }, (evt) => {
      // win 为当前主窗口；存在且未销毁时把这一段输出推给渲染进程
      const win = getWindow?.();
      if (win && !win.isDestroyed?.()) {
        win.webContents.send(IPC.STEP_OUTPUT, evt);
      }
    });
  });

  // 删除任务文件夹（递归删除整个目录树，用于清理删除 worktree 后残留的任务目录）
  ipcMain.handle(IPC.REMOVE_TASK_FOLDER, async (_e, folderPath) => {
    try {
      // cfg 存储当前应用配置，用于拿到 worktree 根目录作为空父目录清理边界
      const cfg = loadConfig(configBaseDir);
      // 仅在目录存在时删除，避免路径不存在时抛错
      if (existsSync(folderPath)) rmSync(folderPath, { recursive: true, force: true });
      removeEmptyParentsWithinRoot(folderPath, cfg.worktreesPath);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 任务状态文件路径：默认 ~/.visualWorktree/task-status.json；测试可通过 dataDir 注入临时目录，避免污染真实用户数据
  const VW_DIR = dataDir || join(homedir(), '.visualWorktree');
  // STATUS_FILE 任务状态的持久化文件路径
  const STATUS_FILE = join(VW_DIR, 'task-status.json');
  // TASK_DOCS_ARCHIVE_ROOT 历史任务工作记录归档根目录：~/.visualWorktree/task-docs
  const TASK_DOCS_ARCHIVE_ROOT = join(VW_DIR, 'task-docs');

  // 归档任务工作文档：删除任务目录前调用，避免工作记录随 worktree 一起被删
  ipcMain.handle(IPC.ARCHIVE_TASK_DOCS, (_e, taskDir, taskName) => {
    // cfg 存储当前应用配置，用于按用户配置的工作文档模板收集文件和目录。
    const cfg = loadConfig(configBaseDir);
    return archiveTaskDocs(taskDir, taskName, TASK_DOCS_ARCHIVE_ROOT, cfg.workDocumentTemplates);
  });

  // 读取任务状态映射（损坏或不存在时回退空对象）
  // WHY 改为 async：readFileSync 在主进程同步阻塞；readFile Promise 不卡事件循环。
  ipcMain.handle(IPC.LOAD_TASK_STATUS, async () => {
    try {
      if (!existsSync(STATUS_FILE)) return {};
      const raw = await readFile(STATUS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  });

  // 保存任务状态映射（目录不存在时自动创建）
  ipcMain.handle(IPC.SAVE_TASK_STATUS, async (_e, map) => {
    try {
      await mkdir(VW_DIR, { recursive: true });
      await writeFile(STATUS_FILE, JSON.stringify(map || {}, null, 2));
      return true;
    } catch {
      return false;
    }
  });

  // 任务链接文件路径：~/.visualWorktree/task-links.json
  const LINKS_FILE = join(VW_DIR, 'task-links.json');

  // TASK_VISIBILITY_FILE 任务隐藏/置顶偏好文件路径：~/.visualWorktree/task-visibility.json
  const TASK_VISIBILITY_FILE = join(VW_DIR, 'task-visibility.json');

  // PROJECT_VISIBILITY_FILE 项目隐藏/置顶偏好文件路径：~/.visualWorktree/project-visibility.json
  const PROJECT_VISIBILITY_FILE = join(VW_DIR, 'project-visibility.json');

  // 通用的异步读取 JSON 文件辅助函数（不存在/损坏时回退空对象）
  // WHY 改为 async：避免 readFileSync 在主进程同步阻塞，与所有调用方 handler 统一用 await。
  const readJsonFile = async (filePath) => {
    try {
      if (!existsSync(filePath)) return {};
      const parsed = JSON.parse(await readFile(filePath, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  };

  // 通用的异步读取 JSON 数组文件辅助函数（不存在/损坏/非数组时回退空数组）
  const readJsonArray = async (filePath) => {
    try {
      if (!existsSync(filePath)) return [];
      const parsed = JSON.parse(await readFile(filePath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  };

  // 通用的异步写入 JSON 文件辅助函数（目录不存在时自动创建）
  const writeJsonFile = async (filePath, data) => {
    try {
      await mkdir(VW_DIR, { recursive: true });
      await writeFile(filePath, JSON.stringify(data, null, 2));
      return true;
    } catch { return false; }
  };

  // 读取任务链接映射
  ipcMain.handle(IPC.LOAD_TASK_LINKS, () => readJsonFile(LINKS_FILE));

  // 保存任务链接映射
  ipcMain.handle(IPC.SAVE_TASK_LINKS, (_e, map) => writeJsonFile(LINKS_FILE, map || {}));

  // 读取任务隐藏/置顶偏好
  ipcMain.handle(IPC.LOAD_TASK_VISIBILITY, () => readJsonFile(TASK_VISIBILITY_FILE));

  // 保存任务隐藏/置顶偏好
  ipcMain.handle(IPC.SAVE_TASK_VISIBILITY, (_e, prefs) => writeJsonFile(TASK_VISIBILITY_FILE, prefs || {}));

  // 读取项目隐藏/置顶偏好
  ipcMain.handle(IPC.LOAD_PROJECT_VISIBILITY, () => readJsonFile(PROJECT_VISIBILITY_FILE));

  // 保存项目隐藏/置顶偏好
  ipcMain.handle(IPC.SAVE_PROJECT_VISIBILITY, (_e, prefs) => writeJsonFile(PROJECT_VISIBILITY_FILE, prefs || {}));

  // 任务工作流勾选文件路径：~/.visualWorktree/task-workflow.json
  // 存储「任务名 → 已勾选步骤 key 数组」，记录每个任务的需求流程完成进度
  const WORKFLOW_FILE = join(VW_DIR, 'task-workflow.json');

  // 任务工作流执行输出缓存文件路径：~/.visualWorktree/task-workflow-output.json
  // 存储「任务名::步骤 key → 最近一次输出快照」，用于重启后恢复查看/失败态
  const WORKFLOW_OUTPUT_FILE = join(VW_DIR, 'task-workflow-output.json');

  // 任务卡点备注文件路径：~/.visualWorktree/task-blockers.json
  // 存储「任务名 → 卡点备注文本」，记录每个任务当前的阻塞点/待办说明
  const BLOCKERS_FILE = join(VW_DIR, 'task-blockers.json');

  // 读取任务卡点备注映射（不存在/损坏时回退空对象）
  ipcMain.handle(IPC.LOAD_TASK_BLOCKERS, () => readJsonFile(BLOCKERS_FILE));

  // 保存任务卡点备注映射（目录不存在时自动创建）
  ipcMain.handle(IPC.SAVE_TASK_BLOCKERS, (_e, map) => writeJsonFile(BLOCKERS_FILE, map || {}));

  // 读取任务工作流勾选映射（不存在/损坏时回退空对象）
  ipcMain.handle(IPC.LOAD_TASK_WORKFLOW, () => readJsonFile(WORKFLOW_FILE));

  // 保存任务工作流勾选映射（目录不存在时自动创建）
  ipcMain.handle(IPC.SAVE_TASK_WORKFLOW, (_e, map) => writeJsonFile(WORKFLOW_FILE, map || {}));

  // 读取任务工作流步骤最近一次执行输出缓存（不存在/损坏时回退空对象）
  ipcMain.handle(IPC.LOAD_TASK_WORKFLOW_OUTPUT, () => readJsonFile(WORKFLOW_OUTPUT_FILE));

  // 保存任务工作流步骤最近一次执行输出缓存（目录不存在时自动创建）
  ipcMain.handle(IPC.SAVE_TASK_WORKFLOW_OUTPUT, (_e, map) => writeJsonFile(WORKFLOW_OUTPUT_FILE, map || {}));

  // 历史记录文件路径：~/.visualWorktree/task-history.json，存储已删除任务列表
  const HISTORY_FILE = join(VW_DIR, 'task-history.json');

  // 读取已删除任务的历史记录（损坏或不存在时回退空数组）
  ipcMain.handle(IPC.LOAD_TASK_HISTORY, () => readJsonArray(HISTORY_FILE));

  // 追加一条已删除任务记录到历史文件头部（最新的排最前）
  // entry: { task: string, link: string|string[]|Array<{name:string,url:string}>, status?: string, docsPath?: string }
  ipcMain.handle(IPC.APPEND_TASK_HISTORY, async (_e, entry) => {
    try {
      await mkdir(VW_DIR, { recursive: true });
      // list 现有历史列表，文件不存在或损坏时回退空数组
      let list = [];
      if (existsSync(HISTORY_FILE)) {
        try {
          const raw = await readFile(HISTORY_FILE, 'utf8');
          const p = JSON.parse(raw);
          if (Array.isArray(p)) list = p;
        } catch {}
      }
      // link 存储任务被删除时的需求链接；新版为命名链接数组，旧版字符串仍原样兼容历史展示。
      const link = Array.isArray(entry.link) ? entry.link : (entry.link || '');
      // 新记录插入头部，附加删除时间戳；status 为任务被删除时的人工标记状态（可选）
      list.unshift({ task: entry.task || '', link, status: entry.status || '', docsPath: entry.docsPath || '', deletedAt: new Date().toISOString() });
      await writeFile(HISTORY_FILE, JSON.stringify(list, null, 2));
      return true;
    } catch { return false; }
  });

  // 按下标删除一条历史记录（idx 为数组下标），写回文件
  ipcMain.handle(IPC.REMOVE_TASK_HISTORY, async (_e, idx) => {
    try {
      if (!existsSync(HISTORY_FILE)) return true;
      const raw = await readFile(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      // list 现有历史列表，非数组时回退空数组
      const list = Array.isArray(parsed) ? parsed : [];
      list.splice(idx, 1);
      await writeFile(HISTORY_FILE, JSON.stringify(list, null, 2));
      return true;
    } catch { return false; }
  });

  // 在系统默认浏览器中打开 URL（通过 shell.openExternal）
  ipcMain.handle(IPC.OPEN_EXTERNAL_URL, async (_e, url) => {
    try {
      await shell?.openExternal?.(url);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 复制文本到系统剪贴板：用主进程注入的 clipboard 写入（沙箱 preload 不暴露 clipboard 模块）。
  // 返回布尔表示是否成功，失败不抛出
  ipcMain.handle(IPC.COPY_TEXT, async (_e, text) => {
    try {
      // clipboard 由 main.js 注入；缺失（如测试未注入）时视为失败
      if (!clipboard?.writeText) return false;
      clipboard.writeText(String(text ?? ''));
      return true;
    } catch (e) {
      return false;
    }
  });

  // 获取任务关联的 Claude Code 会话列表及 token 用量
  ipcMain.handle(IPC.GET_CLAUDE_SESSIONS_BY_TASK, async (_e, taskName) => {
    const cfg = loadConfig(configBaseDir);
    return getSessionsByTask(taskName, cfg.worktreesPath);
  });

  // 获取所有任务的 Claude Code 用量汇总
  ipcMain.handle(IPC.GET_CLAUDE_TASKS_SUMMARY, async (_e, taskNames) => {
    const cfg = loadConfig(configBaseDir);
    return getTasksSummary(taskNames, cfg.worktreesPath);
  });

  // 获取可安全删除的 worktree 列表（已合并+无未提交改动）
  ipcMain.handle(IPC.GET_SAFE_TO_REMOVE_WORKTREES, async () => {
    const cfg = loadConfig(configBaseDir);
    // 源项目根目录 sourceProjectsPath、worktree 根目录 worktreesPath、主分支候选 mainBranches 均来自配置
    return gitService.getSafeToRemoveWorktrees(cfg.sourceProjectsPath, cfg.worktreesPath, cfg.mainBranches);
  });

  // 对任务目录执行环境健康检查（依赖/端口/服务/Git 并行）；传入 envCheckRoles 按角色分组结果
  ipcMain.handle(IPC.CHECK_ENV_HEALTH, async (_e, taskDir) => {
    const cfg = loadConfig(configBaseDir);
    // envCheckRoles 角色配置（如前端/后端目录映射），空数组时自动扫描全部子目录；workDocumentTemplates 用于排除 docs 等工作文档入口。
    return checkEnvHealth(taskDir, cfg.envCheckRoles || [], { workDocumentTemplates: cfg.workDocumentTemplates });
  });

  // 读取任务环境检查缓存（不存在/损坏时回退空对象）
  ipcMain.handle(IPC.LOAD_TASK_ENV_HEALTH, () => loadTaskEnvHealth(VW_DIR));

  // 保存任务环境检查缓存（目录不存在时自动创建）
  ipcMain.handle(IPC.SAVE_TASK_ENV_HEALTH, (_e, map) => saveTaskEnvHealth(map, VW_DIR));

  // 想法工作流定义文件路径：~/.visualWorktree/idea-workflows.json
  // 读取想法工作流定义列表（不存在时返回内置默认）
  ipcMain.handle(IPC.LOAD_IDEA_WORKFLOWS, () => loadIdeaWorkflows());

  // 保存想法工作流定义列表（整体覆盖写入）
  ipcMain.handle(IPC.SAVE_IDEA_WORKFLOWS, (_e, defs) => {
    try { saveIdeaWorkflows(defs); return true; } catch (e) { return false; }
  });

  // 读取想法工作流运行历史（最近 50 条）
  ipcMain.handle(IPC.LOAD_IDEA_RUNS, () => loadIdeaRuns());

  // 追加一条想法工作流运行记录（插入头部，自动截断到50条）
  ipcMain.handle(IPC.APPEND_IDEA_RUN, (_e, run) => {
    try { appendIdeaRun(run); return true; } catch (e) { return false; }
  });
}
