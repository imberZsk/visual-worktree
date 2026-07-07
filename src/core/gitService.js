import { simpleGit } from 'simple-git';
import { existsSync, readdirSync, statSync, realpathSync, symlinkSync, lstatSync, rmSync } from 'fs';
import { readdir as readdirAsync, lstat as lstatAsync, stat as statAsync } from 'fs/promises';
import { join, basename, resolve } from 'path';
import { ensureTaskDocsAssets, ensureTaskDocsGitExclude } from './taskDocsService.js';

// 核心 Git 服务：纯 Node 模块，不依赖 Electron。负责扫描项目、检测状态、执行 git 操作。
// 设计为可独立测试（vitest 直接 import），Electron 主进程只做薄封装转发。

// 依赖目录名：前端项目的依赖安装在此目录，worktree 通过软链接复用源项目的同名目录
const NODE_MODULES_DIR = 'node_modules';

/**
 * 把路径归一化为正斜杠（POSIX 风格）分隔符，用于跨平台路径比较与切分。
 * WHY：Windows 上 `git worktree list --porcelain` 返回的路径统一用正斜杠（如 `C:/Users/.../wt`），
 * 而 Node 的 realpathSync/join/basename 在 Windows 上返回反斜杠（`C:\Users\...`）。二者直接做
 * startsWith 前缀匹配、split('/') 切分或 === 相等比较都会失配，导致 worktree 扫不到、任务名被截断。
 * 统一归一化为正斜杠后再比较即可对齐。类 Unix 平台路径本无反斜杠，此函数为无副作用的恒等变换。
 * @param {string} p - 待归一化的路径
 * @returns {string} 反斜杠全部替换为正斜杠后的路径
 */
export function toPosixPath(p) {
  // 空值兜底：非字符串直接原样返回，避免 replace 抛错
  if (!p) return p;
  return p.replace(/\\/g, '/');
}

/**
 * 为 worktree 软链接源项目根目录的 node_modules，避免每个 worktree 重复 npm install。
 * 仅当源项目存在 node_modules（即已安装依赖的前端/Node 项目）且 worktree 内尚无同名目录时才创建。
 * 失败不抛出，仅返回结果，避免影响 worktree 创建主流程。
 * @param {string} sourceProjectPath - 源项目根目录
 * @param {string} worktreePath - worktree 目标路径
 * @param {NodeJS.Platform} [platform] - 平台标识，默认当前进程平台；决定用 junction 还是 dir 类型软链接
 * @returns {{linked:boolean, reason?:string, error?:string}} 是否创建了软链接，未创建时附原因
 */
export function linkNodeModules(sourceProjectPath, worktreePath, platform = process.platform) {
  // source 源项目的 node_modules 绝对路径，作为软链接指向的目标
  const source = join(sourceProjectPath, NODE_MODULES_DIR);
  // target worktree 内待创建的 node_modules 软链接路径
  const target = join(worktreePath, NODE_MODULES_DIR);
  // 源项目没有依赖目录：非前端/Node 项目或未安装依赖，无需软链接
  if (!existsSync(source)) return { linked: false, reason: 'source-missing' };
  // worktree 已存在同名目录（真实目录或既有软链接）：不覆盖，避免破坏已有依赖
  if (existsSync(target) || isSymlink(target)) return { linked: false, reason: 'target-exists' };
  // linkType 为软链接类型：Windows 用 junction（NTFS 目录联结），类 Unix 用 dir（符号链接）。
  // WHY 用 junction：Windows 上创建目录符号链接(symlink)默认需要管理员权限或开启开发者模式（SeCreateSymbolicLinkPrivilege），
  // 普通用户会 EPERM 失败；junction 是文件系统层的目录联结，无需特殊权限即可创建，正好适配「复用 node_modules」这一目录级链接场景。
  const linkType = platform === 'win32' ? 'junction' : 'dir';
  try {
    // 按平台类型创建目录链接：Windows junction / 类 Unix dir 符号链接
    symlinkSync(source, target, linkType);
    return { linked: true };
  } catch (e) {
    return { linked: false, error: e.message };
  }
}

/**
 * 删除 worktree 内指向源项目 node_modules 的软链接。
 * 仅删除软链接本身（不跟随、不删除源目录内容），真实目录则保持不动交由 git 处理。
 * 失败不抛出，仅返回结果。
 * @param {string} worktreePath - worktree 路径
 * @returns {{unlinked:boolean, reason?:string, error?:string}} 是否删除了软链接，未删除时附原因
 */
export function unlinkNodeModules(worktreePath) {
  // target worktree 内的 node_modules 路径
  const target = join(worktreePath, NODE_MODULES_DIR);
  // 不是软链接（不存在或为真实目录）：无需处理，避免误删真实依赖
  if (!isSymlink(target)) return { unlinked: false, reason: 'not-symlink' };
  try {
    // rmSync 作用于软链接路径本身，只移除链接不触及指向的源目录
    rmSync(target);
    return { unlinked: true };
  } catch (e) {
    return { unlinked: false, error: e.message };
  }
}

/**
 * 判断路径是否为软链接（用 lstat 不跟随链接）
 * @param {string} p - 待判断路径
 * @returns {boolean} 是否为软链接
 */
function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch (e) {
    // 路径不存在时 lstat 抛错，视为非软链接
    return false;
  }
}

// 默认视为"主分支"的分支名集合
const DEFAULT_MAIN_BRANCHES = ['master', 'main'];

// git fetch 默认超时（毫秒）：远程连不上（VPN 断开/SSH 无响应/网络不通）时 simple-git 不会自动超时，
// 会一直挂起导致上层 Promise.all 永不 resolve、UI 一直 loading。用超时强制结束，回退到本地状态。
// 取 10s：同时发起多个 SSH 连接时服务端排队会拉长建连时间，4s 过短导致正常可达的仓库误报失败。
const DEFAULT_FETCH_TIMEOUT_MS = 10000;

/**
 * 给一个 Promise 包裹超时：超时后以特定错误 reject，避免操作（如 git fetch 连不上远程）无限挂起。
 * 注意：仅让上层不再等待，底层 git 子进程仍会按其自身机制结束，不影响本地状态读取。
 * @param {Promise<T>} promise - 被包裹的 Promise
 * @param {number} ms - 超时毫秒数
 * @param {string} label - 超时错误信息中的操作名，便于排查
 * @returns {Promise<T>} 原 Promise 与超时竞速的结果
 * @template T
 */
function withTimeout(promise, ms, label = 'operation') {
  // timer 保存定时器句柄，用于在原 Promise 先完成时清除，避免泄漏
  let timer;
  // timeout 为超时竞速 Promise，到点即 reject
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 扫描项目/worktree 状态时的并发上限。
// WHY 统一用 8：
//   - getWorktrees / git status 是 CPU/IO 型 git 子进程，并发过高会进程风暴反而更慢；
//   - git fetch 看似网络等待型可以高并发，但多项目同时向同一 SSH 服务器建连会导致服务端排队，
//     建连时间超过 timeout 被误报失败；降低并发让每批连接更快建立，整体成功率更高。
const SCAN_CONCURRENCY = 8;
const FETCH_CONCURRENCY = 8;

/**
 * 以受控并发对数组逐项执行异步任务，保持结果顺序与输入一致。
 * 用滑动窗口（worker 池）实现：始终最多 limit 个任务在飞行，完成一个补一个。
 * @param {Array<T>} items - 输入项数组
 * @param {(item:T, index:number)=>Promise<R>} fn - 对每项执行的异步函数
 * @param {number} limit - 最大并发数
 * @returns {Promise<R[]>} 与 items 顺序对应的结果数组
 * @template T, R
 */
async function mapWithConcurrency(items, fn, limit = SCAN_CONCURRENCY) {
  // results 按原始下标存放结果，保证顺序与 items 一致
  const results = new Array(items.length);
  // nextIndex 为下一个待处理项的下标，多个 worker 共享、原子递增（单线程 JS 无需加锁）
  let nextIndex = 0;
  // worker 持续从队列取下一项处理，直到取完
  async function worker() {
    while (nextIndex < items.length) {
      // i 为本 worker 本轮认领的下标
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }
  // 启动 min(limit, 项数) 个 worker 并发跑，全部结束后返回
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * 构造 git worktree add 命令参数。
 * @param {string} branch - 要检出或创建的分支名
 * @param {string} targetPath - worktree 目标路径
 * @param {boolean} useNewBranch - 是否通过 -b 创建新分支
 * @param {boolean} [forceExistingBranch] - 复用已被其他 worktree 占用的已有分支时是否加 --force
 * @param {string} [startPoint] - 新建分支的起点引用（如 master/origin/main）；仅在 useNewBranch 时生效，不传则用源仓库当前 HEAD
 * @param {NodeJS.Platform} [platform] - 平台标识，默认当前进程平台；决定 hooksPath 指向的空设备路径
 * @returns {string[]} simple-git raw 所需的 git 参数数组
 */
export function buildWorktreeAddArgs(branch, targetPath, useNewBranch, forceExistingBranch = false, startPoint = '', platform = process.platform) {
  // nullDevice 为当前平台的「空设备」路径：Windows 用 NUL，类 Unix 用 /dev/null。
  // WHY：把 core.hooksPath 指向空设备可跳过 worktree 创建时的 git hooks（husky 等常因依赖缺失非零退出导致 add 失败）；
  // /dev/null 在 Windows 原生 git 下不是合法路径，需换成 Windows 的空设备名 NUL。
  const nullDevice = platform === 'win32' ? 'NUL' : '/dev/null';
  // args 存储 simple-git raw 需要的完整 git 参数，包含跳过 hooks 的临时配置
  const args = ['-c', `core.hooksPath=${nullDevice}`, 'worktree', 'add'];
  if (forceExistingBranch && !useNewBranch) {
    // 分支已被另一个 worktree 使用时，Git 默认拒绝；这里按用户选择显式复用该已有分支
    args.push('--force');
  }
  if (useNewBranch) {
    // 新建分支：显式指定起点引用，避免默认基于源仓库当前 HEAD（可能停在 test 等非主分支）
    args.push('-b', branch, targetPath);
    if (startPoint) args.push(startPoint);
  } else {
    args.push(targetPath, branch);
  }
  return args;
}

/**
 * 解析新建分支应基于的「主分支起点引用」。
 * 新建 worktree 分支时若不指定起点，Git 会基于源仓库当前 HEAD —— 当源仓库恰好停在 test 等分支时，
 * 新分支会错误地继承这些分支的提交。此函数按候选主分支名优先取实际存在的引用作为起点。
 * 优先用远程跟踪分支 origin/<main>（更接近最新主分支），其次回退到本地分支 <main>。
 * @param {import('simple-git').SimpleGit} git - 指向源仓库的 simple-git 实例
 * @param {string[]} [mainBranches] - 候选主分支名（按优先级排序），默认 master/main
 * @returns {Promise<string>} 可用作起点的引用名；都不存在时返回空串（退化为基于当前 HEAD）
 */
async function resolveMainStartPoint(git, mainBranches = DEFAULT_MAIN_BRANCHES) {
  // candidates 为每个主分支名展开出的候选引用：远程跟踪分支优先于本地分支
  const candidates = mainBranches.flatMap((b) => [`origin/${b}`, b]);
  for (const ref of candidates) {
    try {
      // rev-parse --verify --quiet：引用存在时输出 commit 哈希，不存在时输出空且不报错（--quiet 抑制错误）
      // 故以输出是否非空判断该引用是否可用，而非依赖抛错
      const out = await git.raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      if (out && out.trim()) return ref;
    } catch (e) {
      // 探测异常时跳过该候选，继续尝试下一个
    }
  }
  return '';
}

/**
 * 创建 worktree 前，定向 fetch 各候选主分支的远程引用，确保新分支基于最新主分支。
 * 逐个 fetch（git fetch origin <branch>）而非整仓 fetch：更快，且单个分支远程不存在不会牵连其余。
 * 带超时（远程不可达时不无限挂起）；任何失败都吞掉——退化为基于本地已有的远程引用，不阻断创建主流程。
 * @param {import('simple-git').SimpleGit} git - 指向源仓库的 simple-git 实例
 * @param {string[]} [mainBranches] - 候选主分支名，默认 master/main
 * @param {number} [fetchTimeout] - 单次 fetch 超时毫秒数
 * @returns {Promise<void>}
 */
async function fetchMainBranches(git, mainBranches = DEFAULT_MAIN_BRANCHES, fetchTimeout = DEFAULT_FETCH_TIMEOUT_MS) {
  // 仓库无 origin 远程时直接跳过，避免无谓的报错与等待
  try {
    // remotes 当前仓库已配置的远程名集合
    const remotes = await git.getRemotes();
    if (!remotes.some((r) => r.name === 'origin')) return;
  } catch (e) {
    // 获取远程列表失败时保守跳过 fetch
    return;
  }
  for (const branch of mainBranches) {
    try {
      // 定向拉取该主分支的远程引用；超时或分支远程不存在均忽略，回退本地引用
      await withTimeout(git.fetch(['origin', branch]), fetchTimeout, `git fetch origin ${branch}`);
    } catch (e) {
      // 单个主分支 fetch 失败不影响其余分支与后续创建
    }
  }
}

/**
 * 判断 git worktree add 是否因引用不存在而失败。
 * @param {string} message - git 返回的错误信息
 * @returns {boolean} 是否为分支或引用不存在的错误
 */
function isMissingBranchError(message) {
  return /invalid reference|not a valid|pathspec/i.test(message);
}

/**
 * 判断 git worktree add 是否因目标分支已被其他 worktree 使用而失败。
 * @param {string} message - git 返回的错误信息
 * @returns {boolean} 是否为分支已被其他 worktree 使用的错误
 */
function isBranchAlreadyUsedError(message) {
  return /already (?:used by worktree|checked out at)/i.test(message);
}

/**
 * 判断分支是否属于主分支
 * @param {string} branch - 分支名
 * @param {string[]} [mainBranches] - 自定义主分支名列表，默认 master/main
 * @returns {boolean} 是否为主分支
 */
export function isMainBranch(branch, mainBranches = DEFAULT_MAIN_BRANCHES) {
  return mainBranches.includes(branch);
}

/**
 * 判断目录是否为 git 仓库（含 .git 目录或文件——worktree 场景下 .git 是文件）
 * @param {string} dir - 目录路径
 * @returns {boolean} 是否为 git 仓库
 */
function isGitRepo(dir) {
  return existsSync(join(dir, '.git'));
}

/**
 * 清理 remote 路径部分，去掉首尾斜杠与 Git 裸仓库后缀。
 * @param {string} pathname - remote URL 或 scp-like remote 中的仓库路径部分
 * @returns {string} 可拼到网页 URL 后面的仓库路径
 */
function normalizeRemoteProjectPath(pathname) {
  // rawPath 存储原始路径字符串，统一转成字符串后再清理空白。
  const rawPath = String(pathname || '').trim();
  // cleanPath 存储去掉首尾斜杠后的项目路径，避免拼接出双斜杠。
  const cleanPath = rawPath.replace(/^\/+/, '').replace(/\/+$/, '');
  // projectPath 存储去掉 .git 后缀后的网页路径，GitLab 仓库首页不需要该后缀。
  const projectPath = cleanPath.endsWith('.git') ? cleanPath.slice(0, -4) : cleanPath;
  return projectPath;
}

/**
 * 将 Git remote 地址转换为可在浏览器打开的 GitLab 项目地址。
 * 支持 HTTPS、SSH URL、scp-like SSH（git@gitlab.example.com:group/project.git）等常见 remote 格式。
 * @param {string} remoteUrl - git remote 原始地址
 * @returns {string} GitLab 项目网页 URL；本地路径或无法解析时返回空串
 */
export function deriveGitlabUrlFromRemote(remoteUrl) {
  // value 存储去空白后的 remote 地址，空地址直接视为不可打开。
  const value = String(remoteUrl || '').trim();
  if (!value) return '';
  // hasScheme 标记 remote 是否是带协议的 URL，避免把 https://... 误当成 scp-like 地址解析。
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  if (hasScheme) {
    try {
      // url 存储标准 URL 解析结果，用于安全去掉账号密码并保留 host/port。
      const url = new URL(value);
      // projectPath 存储 URL pathname 中的 GitLab 项目路径。
      const projectPath = normalizeRemoteProjectPath(url.pathname);
      if (!url.host || !projectPath) return '';
      // protocol 存储最终网页协议：HTTP(S) remote 保留原协议，SSH/Git 协议转成 HTTPS 网页地址。
      const protocol = url.protocol === 'http:' ? 'http:' : 'https:';
      return `${protocol}//${url.host}/${projectPath}`;
    } catch (e) {
      return '';
    }
  }
  // scpMatch 存储 scp-like SSH remote 的匹配结果，例如 git@host:group/project.git。
  const scpMatch = value.match(/^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/);
  if (!scpMatch) return '';
  // host 存储 remote 主机名，可能是公司内部 GitLab 域名。
  const host = scpMatch[1];
  // projectPath 存储 scp-like remote 中冒号后的项目路径。
  const projectPath = normalizeRemoteProjectPath(scpMatch[2]);
  if (!host || !projectPath) return '';
  return `https://${host}/${projectPath}`;
}

/**
 * 读取仓库 origin remote，并推导浏览器可打开的 GitLab 地址。
 * @param {import('simple-git').SimpleGit} git - 指向目标仓库的 simple-git 实例
 * @returns {Promise<{remoteUrl:string, gitlabUrl:string}>} origin remote 原始地址与 GitLab 网页地址
 */
async function getOriginRemoteInfo(git) {
  try {
    // remotes 存储当前仓库的 remote 列表，verbose=true 时包含 fetch/push URL。
    const remotes = await git.getRemotes(true);
    // origin 存储名为 origin 的 remote；没有 origin 时不展示 GitLab 按钮。
    const origin = remotes.find((remote) => remote.name === 'origin');
    // remoteUrl 存储 origin 的 fetch URL，缺失时回退 push URL。
    const remoteUrl = origin?.refs?.fetch || origin?.refs?.push || '';
    // gitlabUrl 存储从 remote 推导出的网页地址，供 UI 直接打开。
    const gitlabUrl = deriveGitlabUrlFromRemote(remoteUrl);
    return { remoteUrl, gitlabUrl };
  } catch (e) {
    return { remoteUrl: '', gitlabUrl: '' };
  }
}

/**
 * 解析 `git worktree list --porcelain` 输出为结构化数组
 * @param {string} raw - porcelain 原始输出
 * @param {string[]} mainBranches - 主分支名列表
 * @returns {Array<{path:string,branch:string,head:string,isMain:boolean,detached:boolean}>} worktree 列表
 */
function parseWorktreePorcelain(raw, mainBranches = DEFAULT_MAIN_BRANCHES) {
  // 结果数组，每个 worktree 一项
  const list = [];
  // current 累积当前正在解析的 worktree 块字段
  let current = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) list.push(current);
      current = { path: line.slice('worktree '.length).trim(), branch: '', head: '', detached: false, isMain: false, prunable: false };
    } else if (line.startsWith('HEAD ')) {
      if (current) current.head = line.slice('HEAD '.length).trim();
    } else if (line.startsWith('branch ')) {
      // branch refs/heads/xxx → 取最后一段作为分支名
      if (current) current.branch = line.slice('branch '.length).trim().replace('refs/heads/', '');
    } else if (line.trim() === 'detached') {
      if (current) current.detached = true;
    } else if (line.startsWith('prunable')) {
      // prunable 标记：worktree 的 gitdir 已失效，可被 prune 清理
      if (current) current.prunable = true;
    }
  }
  if (current) list.push(current);
  // 第一个 worktree 即主工作区
  return list.map((w, idx) => ({ ...w, isMain: idx === 0, branchIsMain: isMainBranch(w.branch, mainBranches) }));
}

/**
 * 获取某个项目的 worktree 列表
 * @param {string} projectPath - 项目路径
 * @param {string[]} [mainBranches] - 主分支名列表
 * @returns {Promise<Array>} worktree 列表
 */
export async function getWorktrees(projectPath, mainBranches = DEFAULT_MAIN_BRANCHES) {
  const git = simpleGit(projectPath);
  const raw = await git.raw(['worktree', 'list', '--porcelain']);
  return parseWorktreePorcelain(raw, mainBranches);
}

/**
 * 获取单个项目的完整状态
 * @param {string} projectPath - 项目路径
 * @param {{fetch?:boolean, fetchTimeout?:number, mainBranches?:string[]}} [opts] - 选项：fetch 是否先拉取远程引用；fetchTimeout fetch 超时毫秒数
 * @returns {Promise<object>} 项目状态对象（含 fetchFailed 标记：本次刷新是否因连不上远程而未能更新远程引用）
 */
export async function getProjectStatus(projectPath, opts = {}) {
  // mainBranches 自定义主分支；fetch 控制是否执行 git fetch 以获得准确 behind；fetchTimeout fetch 超时阈值
  const { fetch = false, fetchTimeout = DEFAULT_FETCH_TIMEOUT_MS, mainBranches = DEFAULT_MAIN_BRANCHES } = opts;
  const name = basename(projectPath);
  // 非 git 目录直接返回占位状态，避免 simple-git 抛错
  if (!isGitRepo(projectPath)) {
    return { name, path: projectPath, isGitRepo: false, currentBranch: '', isMainBranch: false, hasUncommittedChanges: false, hasUnpushedCommits: false, canPull: false, ahead: 0, behind: 0, changedFiles: [], worktrees: [], fetchFailed: false, remoteUrl: '', gitlabUrl: '' };
  }
  const git = simpleGit(projectPath);
  // remoteInfo 存储 origin remote 原始地址与可打开的 GitLab 网页地址；读取失败不影响状态扫描。
  const remoteInfo = await getOriginRemoteInfo(git);
  // fetchFailed 记录本次是否尝试 fetch 但失败（连不上远程/超时），供 UI 给出友好提示
  let fetchFailed = false;
  // 可选 fetch：获取远程最新引用以便计算 behind。加超时避免远程不可达时无限挂起；
  // 失败（含超时）不阻断主流程，仅标记 fetchFailed 并回退到本地已有的远程引用计算 behind
  if (fetch) {
    try {
      await withTimeout(git.fetch(), fetchTimeout, `${name} git fetch`);
    } catch (e) {
      // 离线、无远程、鉴权失败或超时：标记失败，继续用本地状态返回
      fetchFailed = true;
    }
  }
  const status = await git.status();
  // worktree 列表失败不阻断主流程
  let worktrees = [];
  try {
    worktrees = await getWorktrees(projectPath, mainBranches);
  } catch (e) {
    worktrees = [];
  }
  // current 为空时（detached HEAD）回退为 HEAD 短哈希
  const currentBranch = status.current || '';
  return {
    name,
    path: projectPath,
    isGitRepo: true,
    currentBranch,
    isMainBranch: isMainBranch(currentBranch, mainBranches),
    hasUncommittedChanges: status.files.length > 0,
    hasUnpushedCommits: status.ahead > 0,
    canPull: status.behind > 0,
    ahead: status.ahead,
    behind: status.behind,
    tracking: status.tracking || '',
    changedFiles: status.files.map((f) => ({ path: f.path, index: f.index, working_dir: f.working_dir })),
    worktrees,
    fetchFailed,
    remoteUrl: remoteInfo.remoteUrl,
    gitlabUrl: remoteInfo.gitlabUrl,
  };
}

/**
 * 扫描目录下所有 git 项目并返回各自状态
 * @param {string} rootPath - 待扫描的根目录
 * @param {{ignore?:string[], fetch?:boolean, mainBranches?:string[]}} [opts] - 选项
 * @returns {Promise<object[]>} 项目状态数组
 */
export async function scanProjects(rootPath, opts = {}) {
  // ignore 排除的目录名；其余透传给 getProjectStatus
  const { ignore = [], ...statusOpts } = opts;
  if (!existsSync(rootPath)) return [];
  // 读取一级子目录，筛选出 git 仓库
  const entries = readdirSync(rootPath);
  // dirs 为符合条件的项目目录绝对路径
  const dirs = [];
  for (const entry of entries) {
    if (ignore.includes(entry)) continue;
    if (entry.startsWith('.')) continue;
    const full = join(rootPath, entry);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch (e) {
      continue;
    }
    if (isGitRepo(full)) dirs.push(full);
  }
  // 受控并发获取状态：fetch 场景（网络等待型）用高并发让超时等待相互重叠，
  // 非 fetch（CPU 型 git 调用）用低并发避免进程风暴
  const limit = statusOpts.fetch ? FETCH_CONCURRENCY : SCAN_CONCURRENCY;
  return mapWithConcurrency(dirs, (d) => getProjectStatus(d, statusOpts), limit);
}

/**
 * 按"任务"分组扫描 worktree。
 * 你的工作流是：一个需求(任务)要跨多个仓库改，就在 worktreesRoot/{任务名}/{项目名} 下
 * 为每个仓库各建一个 worktree。本函数遍历所有源项目的 worktree，过滤出位于 worktreesRoot
 * 下的，按去掉末尾项目目录后的完整任务路径聚合，兼容任务名包含 / 的场景。
 * @param {string} projectsRoot - 源项目根目录
 * @param {string} worktreesRoot - worktree 任务根目录
 * @param {{status?:boolean, mainBranches?:string[]}} [opts] - status 是否附带每个 worktree 的工作区状态
 * @returns {Promise<Array<{task:string, path:string, worktrees:Array}>>} 按任务分组的 worktree
 */
export async function scanWorktreesByTask(projectsRoot, worktreesRoot, opts = {}) {
  // status 控制是否查询每个 worktree 的未提交/领先落后状态(较慢)；mainBranches 主分支名
  const { status = false, mainBranches = DEFAULT_MAIN_BRANCHES } = opts;
  if (!existsSync(projectsRoot)) return [];
  // 规范化 worktreesRoot 的真实路径，消除 symlink 差异(如 macOS /var → /private/var)，
  // 否则与 git 返回的绝对路径前缀匹配会失败
  const realWtRoot = existsSync(worktreesRoot) ? realpathSync(worktreesRoot) : worktreesRoot;
  // 归一化为正斜杠后末尾补分隔符便于前缀匹配；Windows 下 realWtRoot 是反斜杠，
  // 而 git 返回路径是正斜杠，须统一到正斜杠才能与 wt.path 前缀对齐
  const wtRootPrefix = toPosixPath(realWtRoot).replace(/\/?$/, '/');
  // 收集所有源项目目录
  const entries = readdirSync(projectsRoot);
  // projectDirs 为源项目绝对路径列表
  const projectDirs = [];
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const full = join(projectsRoot, entry);
    try {
      if (statSync(full).isDirectory() && isGitRepo(full)) projectDirs.push(full);
    } catch (e) {
      continue;
    }
  }
  // taskMap 以任务名为键聚合 worktree 项
  const taskMap = new Map();
  // 受控并发取每个源项目的 worktree 列表和 remote 信息：原来对几十个项目串行 git 调用是扫描慢的主因，
  // 改为限流并发后整体快数倍；projectResults 与 projectDirs 顺序一致，便于稳定聚合
  const projectResults = await mapWithConcurrency(projectDirs, async (projDir) => {
    // git 存储当前源项目的 simple-git 实例，用于读取 origin remote。
    const git = simpleGit(projDir);
    // remoteInfo 存储当前源项目的 origin remote 与 GitLab 网页地址，查询失败时内部兜底为空串。
    const remoteInfo = await getOriginRemoteInfo(git);
    try {
      // worktrees 存储当前源项目登记的全部 worktree 列表。
      const worktrees = await getWorktrees(projDir, mainBranches);
      return { worktrees, ...remoteInfo };
    } catch (e) {
      // 单个项目查询失败不阻断整体，返回空列表跳过
      return { worktrees: [], ...remoteInfo };
    }
  });
  // 顺序聚合各项目的 worktree 到 taskMap（聚合是纯内存操作，无需并发）
  for (let i = 0; i < projectDirs.length; i++) {
    // projDir 为当前源项目路径；projectName 为其目录名
    const projDir = projectDirs[i];
    const projectName = basename(projDir);
    // projectResult 存储当前项目的 worktree 列表与 remote 信息（已并发取回）。
    const projectResult = projectResults[i];
    // wts 为该项目的 worktree 列表。
    const wts = projectResult.worktrees;
    // remoteUrl 存储源项目 origin remote 原始地址，透传给 UI tooltip 或后续扩展使用。
    const remoteUrl = projectResult.remoteUrl;
    // gitlabUrl 存储从 origin remote 推导出的 GitLab 项目网页地址。
    const gitlabUrl = projectResult.gitlabUrl;
    for (const wt of wts) {
      // wtPathPosix 存储归一化为正斜杠的 worktree 路径；Windows 下 git 返回正斜杠但为稳妥统一处理，
      // 用它与同为正斜杠的 wtRootPrefix 做前缀匹配与切片，避免分隔符不一致导致失配
      const wtPathPosix = toPosixPath(wt.path);
      // 只关心位于 worktreesRoot 下的 worktree（跳过主工作区与其他位置）
      if (!wtPathPosix.startsWith(wtRootPrefix)) continue;
      // rel 存储 worktree 相对 worktreesRoot 的路径，如 TASK-1/projA 或 user/bugfix/TASK-1/projA
      const rel = wtPathPosix.slice(wtRootPrefix.length);
      // taskName 存储完整任务名；任务名可包含 /，因此取最后一个目录（项目名）之前的全部路径
      const taskName = getTaskNameFromWorktreeRelativePath(rel);
      if (!taskName) continue;
      if (!taskMap.has(taskName)) {
        taskMap.set(taskName, { task: taskName, path: join(worktreesRoot, taskName), worktrees: [] });
      }
      // item 为单个 worktree 在任务分组中的展示项
      const item = {
        project: projectName,
        projectPath: projDir,
        path: wt.path,
        branch: wt.branch,
        head: wt.head,
        prunable: wt.prunable,
        branchIsMain: wt.branchIsMain,
        remoteUrl,
        gitlabUrl,
      };
      taskMap.get(taskName).worktrees.push(item);
    }
  }
  // 可选：为每个 worktree 附加工作区状态（未提交/领先落后）
  if (status) {
    // 收集所有需要查状态的 worktree 项，受控并发查询（限流避免 git 进程风暴）
    const all = [];
    for (const group of taskMap.values()) all.push(...group.worktrees);
    await mapWithConcurrency(all, async (item) => {
      // prunable 的 worktree 目录可能已不存在，跳过状态查询
      if (item.prunable || !existsSync(item.path)) {
        item.hasUncommittedChanges = false;
        item.missing = item.prunable || !existsSync(item.path);
        return;
      }
      try {
        const st = await getProjectStatus(item.path, { mainBranches });
        item.hasUncommittedChanges = st.hasUncommittedChanges;
        item.ahead = st.ahead;
        item.behind = st.behind;
        item.changedFilesCount = st.changedFiles.length;
      } catch (e) {
        item.hasUncommittedChanges = false;
      }
    });
  }
  // 补充：把 worktreesRoot 下没有 worktree 的空目录也纳入结果（显示给用户便于管理）
  if (existsSync(worktreesRoot)) {
    // knownTaskPaths 存储已有 worktree 任务目录的真实路径，用于避免把含 / 任务名的父级目录误显示成任务
    const knownTaskPaths = Array.from(taskMap.values()).map((task) => (existsSync(task.path) ? realpathSync(task.path) : task.path));
    for (const entry of readdirSync(worktreesRoot)) {
      if (entry.startsWith('.')) continue;
      // full 存储 worktreesRoot 下一级目录的完整路径
      const full = join(worktreesRoot, entry);
      try {
        // realFull 存储 full 的真实路径，用于和已识别任务目录做前缀关系判断
        const realFull = realpathSync(full);
        // realFullPosix 存储归一化为正斜杠的 realFull，用于跨平台前缀匹配（Windows 下 realpathSync 返回反斜杠）
        const realFullPosix = toPosixPath(realFull);
        // isParentOfKnownTask 表示该一级目录只是某个带 / 任务名的父级容器，不能作为独立任务展示
        const isParentOfKnownTask = knownTaskPaths.some((taskPath) => {
          // taskPathPosix 归一化任务真实路径为正斜杠，与 realFullPosix 统一分隔符后再做前缀判断
          const taskPathPosix = toPosixPath(taskPath);
          return taskPathPosix !== realFullPosix && taskPathPosix.startsWith(realFullPosix + '/');
        });
        if (statSync(full).isDirectory() && !isParentOfKnownTask && !taskMap.has(entry)) {
          taskMap.set(entry, { task: entry, path: full, worktrees: [] });
        }
      } catch (e) {
        // 目录不可访问时忽略
      }
    }
  }

  // 按任务名排序返回
  return Array.from(taskMap.values()).sort((a, b) => a.task.localeCompare(b.task));
}

/**
 * 从 worktree 相对路径提取任务名。
 * @param {string} relPath - worktree 相对 worktreesRoot 的路径，格式通常为 {任务名}/{项目名}
 * @returns {string} 任务名；当任务名自身包含 / 时保留完整路径
 */
export function getTaskNameFromWorktreeRelativePath(relPath) {
  // parts 存储相对路径按目录层级拆分后的非空片段；先归一化为正斜杠再 split，
  // 使 Windows 反斜杠路径也能正确切分（否则 alice\bugfix\... 切不开会被整体当成任务名）
  const parts = toPosixPath(relPath).split('/').filter(Boolean);
  // 路径为空时无法识别任务名
  if (parts.length === 0) return '';
  // 兼容旧数据：如果 worktree 直接在根目录下，沿用该目录名作为任务名
  if (parts.length === 1) return parts[0];
  // taskParts 存储去掉末尾项目目录后的任务名片段，任务名中的 / 会被保留
  const taskParts = parts.slice(0, -1);
  return taskParts.join('/');
}

/**
 * 为某个源项目创建 worktree。
 * 幂等：若目标已是该项目的合法 worktree（如之前已创建过），不报错，仅补齐缺失的 node_modules 软链接。
 * newBranch 未指定时自动检测：先尝试 checkout 已有分支，失败再创建新分支。
 * @param {string} projectPath - 源项目路径
 * @param {string} targetPath - worktree 目标路径
 * @param {string} branch - 分支名（新建或已有）
 * @param {{newBranch?:boolean, linkNodeModules?:boolean, mainBranches?:string[], fetchMain?:boolean, fetchTimeout?:number, workDocumentTemplates?:Array}} [opts] - newBranch 为 true 强制创建新分支，false 强制 checkout，undefined 时自动检测；linkNodeModules 为真（默认）时自动软链接源项目 node_modules；mainBranches 新建分支时作为起点的候选主分支名；fetchMain 为真（默认）时新建分支前先 fetch 主分支远程引用；fetchTimeout 单次 fetch 超时毫秒数；workDocumentTemplates 为工作文档模板
 * @returns {Promise<{success:boolean, error?:string, nodeModulesLinked?:boolean, reused?:boolean}>} 操作结果；reused 表示复用了已存在的 worktree
 */
export async function addWorktree(projectPath, targetPath, branch, opts = {}) {
  // newBranch 决定创建/checkout 策略；undefined 时自动检测
  // mainBranches 新建分支时解析起点用的候选主分支名，默认 master/main
  // fetchMain 控制新建分支前是否先 fetch 主分支远程引用（默认开启，保证基于最新主分支）
  const {
    newBranch,
    linkNodeModules: doLink = true,
    mainBranches = DEFAULT_MAIN_BRANCHES,
    fetchMain = true,
    fetchTimeout = DEFAULT_FETCH_TIMEOUT_MS,
    workDocumentTemplates,
  } = opts;
  // autoDetect 为 true 时：先尝试 checkout 已有分支，失败再建新分支（适合 UI 不传 newBranch 的场景）
  const autoDetect = newBranch === undefined;
  // willCreateBranch 是否可能新建分支：显式 newBranch 或自动检测模式都可能走新建分支路径，
  // 仅这些场景才需要 fetch 主分支并解析起点（checkout 已有分支无需起点）
  const willCreateBranch = newBranch === true || autoDetect;
  try {
    // unsafe.allowUnsafeHooksPath：放开 simple-git 对 -c core.hooksPath 的默认拦截，
    // 以便下方跳过项目 git hooks（仅用于本次 worktree add，不影响仓库配置）
    const git = simpleGit(projectPath, { unsafe: { allowUnsafeHooksPath: true } });
    // 新建分支前 fetch 主分支远程引用，使起点（origin/<main>）为最新主分支；失败不阻断
    if (willCreateBranch && fetchMain) {
      await fetchMainBranches(git, mainBranches, fetchTimeout);
    }
    // startPoint 新建分支的起点引用：取配置主分支（master/main）而非源仓库当前 HEAD，
    // 避免源仓库停在 test 等分支时新分支错误地从这些分支拉出
    const startPoint = willCreateBranch ? await resolveMainStartPoint(git, mainBranches) : '';
    if (autoDetect) {
      // 自动检测：先尝试 checkout 已有分支
      try {
        await git.raw(buildWorktreeAddArgs(branch, targetPath, false));
      } catch (checkoutErr) {
        // checkoutErrMessage 存储 git 返回的失败原因，用于区分分支不存在与分支已被其他 worktree 使用
        const checkoutErrMessage = checkoutErr.message || '';
        // 分支不存在时报 invalid reference / pathspec：改为基于主分支起点创建新分支
        if (isMissingBranchError(checkoutErrMessage)) {
          await git.raw(buildWorktreeAddArgs(branch, targetPath, true, false, startPoint));
        } else if (isBranchAlreadyUsedError(checkoutErrMessage)) {
          await git.raw(buildWorktreeAddArgs(branch, targetPath, false, true));
        } else {
          throw checkoutErr;
        }
      }
    } else {
      try {
        await git.raw(buildWorktreeAddArgs(branch, targetPath, newBranch, false, startPoint));
      } catch (addErr) {
        // addErrMessage 存储指定创建策略下的失败原因，用于在 checkout 已有分支时兼容分支已被占用
        const addErrMessage = addErr.message || '';
        if (!newBranch && isBranchAlreadyUsedError(addErrMessage)) {
          await git.raw(buildWorktreeAddArgs(branch, targetPath, false, true));
        } else {
          throw addErr;
        }
      }
    }
    // worktree 创建成功后，软链接源项目 node_modules，避免重复安装依赖
    let nodeModulesLinked = false;
    if (doLink) {
      nodeModulesLinked = linkNodeModules(projectPath, targetPath).linked;
    }
    await ensureTaskDocsIgnored(git, projectPath, workDocumentTemplates);
    ensureTaskDocsAssets(targetPath, workDocumentTemplates);
    return { success: true, nodeModulesLinked };
  } catch (e) {
    // 目标已存在：可能是之前已建好的合法 worktree（如旧版本创建、未带软链接）。
    // 此时不算失败，幂等地补齐 node_modules 软链接，让用户重新创建即可补链接。
    if (/already exists/i.test(e.message) && (await isExistingWorktree(projectPath, targetPath))) {
      let nodeModulesLinked = false;
      if (doLink) {
        nodeModulesLinked = linkNodeModules(projectPath, targetPath).linked;
      }
      // git 用于读取仓库 common git dir，并写入本地 exclude 规则。
      const git = simpleGit(projectPath);
      await ensureTaskDocsIgnored(git, projectPath, workDocumentTemplates);
      ensureTaskDocsAssets(targetPath, workDocumentTemplates);
      return { success: true, nodeModulesLinked, reused: true };
    }
    return { success: false, error: e.message };
  }
}

/**
 * 将自动生成的工作文档写入仓库本地忽略规则，避免 worktree 安全删除被这些文件阻塞。
 * @param {import('simple-git').SimpleGit} git - simple-git 实例
 * @param {string} projectPath - 源项目路径，用于解析 git 返回的相对 common dir
 * @param {Array} [workDocumentTemplates] - 工作文档模板列表
 * @returns {Promise<void>} 无返回值
 */
async function ensureTaskDocsIgnored(git, projectPath, workDocumentTemplates) {
  // commonDir 存储仓库共享 git 目录，worktree 场景下各工作区都会使用这个目录下的 info/exclude。
  const commonDir = (await git.raw(['rev-parse', '--git-common-dir'])).trim();
  // absoluteCommonDir 存储规范化后的 common git 目录；git 可能返回 .git 这种相对路径。
  const absoluteCommonDir = resolve(projectPath, commonDir);
  ensureTaskDocsGitExclude(absoluteCommonDir, workDocumentTemplates);
}

/**
 * 判断目标路径是否已是该项目登记在册的合法 worktree。
 * git worktree list 返回真实路径（macOS 下 /tmp→/private/tmp），故对 target 做 realpath 后比较。
 * @param {string} projectPath - 源项目路径
 * @param {string} targetPath - 待判断的目标路径
 * @returns {Promise<boolean>} 是否为已存在的合法 worktree
 */
async function isExistingWorktree(projectPath, targetPath) {
  try {
    // realTarget 规范化目标路径，消除 symlink 差异以便与 git 输出精确匹配
    const realTarget = existsSync(targetPath) ? realpathSync(targetPath) : targetPath;
    // realTargetPosix 归一化为正斜杠：Windows 下 realTarget 是反斜杠而 git 返回正斜杠，
    // 须统一到正斜杠才能与 w.path 做相等比较，否则幂等复用判断失效
    const realTargetPosix = toPosixPath(realTarget);
    const wts = await getWorktrees(projectPath);
    return wts.some((w) => toPosixPath(w.path) === realTargetPosix);
  } catch (e) {
    // 查询失败时保守视为非 worktree，让上层按原错误处理
    return false;
  }
}

/**
 * 删除某个 worktree。默认安全模式：有未提交变更时拒绝删除。
 * @param {string} projectPath - 源项目路径
 * @param {string} worktreePath - 要删除的 worktree 路径
 * @param {{force?:boolean, unlinkNodeModules?:boolean}} [opts] - force 为真时强制删除（丢弃未提交变更）；unlinkNodeModules 为真（默认）时先移除 node_modules 软链接
 * @returns {Promise<{success:boolean, error?:string}>} 操作结果
 */
export async function removeWorktree(projectPath, worktreePath, opts = {}) {
  // force 控制是否强制删除；unlinkNodeModules 控制删除前是否先移除依赖软链接
  const { force = false, unlinkNodeModules: doUnlink = true } = opts;
  try {
    // 先移除 node_modules 软链接：防止 git worktree remove 误删或跟随链接影响源项目依赖
    if (doUnlink) {
      unlinkNodeModules(worktreePath);
    }
    const git = simpleGit(projectPath);
    // 组装参数：force 时加 --force（git 对有变更的 worktree 需 --force 才删）
    const args = force
      ? ['worktree', 'remove', '--force', worktreePath]
      : ['worktree', 'remove', worktreePath];
    await git.raw(args);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 清理失效（prunable）的 worktree 记录——目录已被手动删除但 git 仍有引用。
 * @param {string} projectPath - 源项目路径
 * @returns {Promise<{success:boolean, error?:string}>} 操作结果
 */
export async function pruneWorktrees(projectPath) {
  try {
    const git = simpleGit(projectPath);
    await git.raw(['worktree', 'prune']);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 按任务批量创建 worktree：在 worktreesRoot/{task}/{项目名} 下为每个项目各建一个 worktree。
 * 单项失败不阻断其余项目，逐项返回结果。
 * @param {object} params - 参数对象
 * @param {string[]} params.projectPaths - 源项目路径列表
 * @param {string} params.worktreesRoot - worktree 任务根目录
 * @param {string} params.task - 任务名（作为子目录名）
 * @param {string} params.branch - 分支名
 * @param {boolean} [params.newBranch] - 是否创建新分支
 * @param {string[]} [params.mainBranches] - 新建分支时作为起点的候选主分支名（master/main）
 * @param {boolean} [params.fetchMain] - 新建分支前是否先 fetch 主分支远程引用（默认开启）
 * @param {number} [params.fetchTimeout] - 单次 fetch 超时毫秒数
 * @param {Array} [params.workDocumentTemplates] - 工作文档模板列表
 * @param {(progress:{done:number,total:number,current:string})=>void} [onProgress] - 进度回调
 * @returns {Promise<Array<{project:string,projectPath:string,targetPath:string,success:boolean,error?:string}>>} 每个项目的结果
 */
export async function batchAddWorktree(params, onProgress) {
  // 解构批量创建参数
  // newBranch 不设默认值，undefined 时透传给 addWorktree 触发自动检测（先 checkout 再建分支）
  // mainBranches / fetchMain / fetchTimeout 透传给 addWorktree，控制新建分支起点与 fetch 行为
  const { projectPaths, worktreesRoot, task, branch, newBranch, mainBranches, fetchMain, fetchTimeout, workDocumentTemplates } = params;
  // selectedProjectPaths 存储本次要创建 worktree 的项目路径；空或缺失表示只创建任务根目录。
  const selectedProjectPaths = Array.isArray(projectPaths) ? projectPaths : [];
  // taskRootPath 存储任务聚合目录；工作文档放在这里，用户打开任务根时也能直接记录任务级内容。
  const taskRootPath = join(worktreesRoot, task);
  ensureTaskDocsAssets(taskRootPath, workDocumentTemplates);
  // results 累积每个项目的创建结果
  const results = [];
  // total 总数用于进度
  const total = selectedProjectPaths.length;
  for (let i = 0; i < total; i++) {
    const projPath = selectedProjectPaths[i];
    // projectName 项目名，作为 worktree 子目录名
    const projectName = basename(projPath);
    // targetPath 该项目 worktree 的目标路径
    const targetPath = join(worktreesRoot, task, projectName);
    if (onProgress) onProgress({ done: i, total, current: projectName });
    // 单项失败捕获为结果，不抛出
    const res = await addWorktree(projPath, targetPath, branch, { newBranch, mainBranches, fetchMain, fetchTimeout, workDocumentTemplates });
    results.push({ project: projectName, projectPath: projPath, targetPath, ...res });
    if (onProgress) onProgress({ done: i + 1, total, current: projectName });
  }
  return results;
}

/**
 * 获取最近的提交历史
 * @param {string} projectPath - 项目路径
 * @param {number} [n] - 返回条数，默认 10
 * @returns {Promise<Array<{hash:string,date:string,message:string,author:string}>>} 提交列表
 */
export async function getCommits(projectPath, n = 10) {
  try {
    const git = simpleGit(projectPath);
    const log = await git.log({ maxCount: n });
    return log.all.map((c) => ({
      hash: c.hash.slice(0, 9),
      date: c.date,
      message: c.message,
      author: c.author_name,
    }));
  } catch (e) {
    // 无提交或非仓库时返回空列表
    return [];
  }
}

/**
 * 切换分支
 * @param {string} projectPath - 项目路径
 * @param {string} branch - 目标分支
 * @returns {Promise<{success:boolean, error?:string}>} 操作结果
 */
export async function checkoutBranch(projectPath, branch) {
  try {
    const git = simpleGit(projectPath);
    await git.checkout(branch);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 切换到主分支，带兜底：不同仓库主分支名可能是 master 或 main，
 * 优先切换到本地实际存在的候选主分支；本地都没有时再逐个尝试 checkout（兼容只存在于远程的情况）。
 * 解决「仓库用 main 而非 master 时直接切 master 报 pathspec did not match」的问题。
 * @param {string} projectPath - 项目路径
 * @param {string[]} [mainBranches] - 候选主分支名（按优先级排序），默认 master/main
 * @returns {Promise<{success:boolean, branch?:string, error?:string}>} 操作结果，成功时 branch 为实际切到的分支
 */
export async function checkoutMainBranch(projectPath, mainBranches = DEFAULT_MAIN_BRANCHES) {
  try {
    const git = simpleGit(projectPath);
    // localBranches 本地已有分支名集合，用于优先匹配真实存在的主分支
    let localBranches = [];
    try {
      localBranches = (await git.branchLocal()).all;
    } catch (e) {
      // 获取本地分支列表失败时退化为直接逐个尝试 checkout
      localBranches = [];
    }
    // existing 候选主分支中第一个确实存在于本地的分支名
    const existing = mainBranches.find((b) => localBranches.includes(b));
    if (existing) {
      await git.checkout(existing);
      return { success: true, branch: existing };
    }
    // 本地无任何候选主分支：可能只存在于远程，逐个尝试 checkout（git 会自动建立跟踪分支）
    // tried 记录已尝试但失败的分支名，全部失败时回报便于排查
    const tried = [];
    for (const b of mainBranches) {
      try {
        await git.checkout(b);
        return { success: true, branch: b };
      } catch (e) {
        tried.push(b);
      }
    }
    return { success: false, error: `未找到主分支（已尝试：${tried.join(', ')}）` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 拉取远程更新
 * @param {string} projectPath - 项目路径
 * @returns {Promise<{success:boolean, error?:string, summary?:object}>} 操作结果
 */
export async function pullUpdates(projectPath) {
  try {
    const git = simpleGit(projectPath);
    const res = await git.pull();
    return { success: true, summary: res.summary };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 暂存当前变更（git stash），用于强制切换前保护数据
 * @param {string} projectPath - 项目路径
 * @returns {Promise<{success:boolean, error?:string}>} 操作结果
 */
export async function stashChanges(projectPath) {
  try {
    const git = simpleGit(projectPath);
    await git.stash(['push', '-u', '-m', 'visual-worktree-auto-stash']);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 单项操作类型到执行函数的映射
const OP_HANDLERS = {
  // 切换到指定分支：需要 args.branch
  checkout: (path, args) => checkoutBranch(path, args.branch),
  // 切换到主分支（带 master/main 兜底）：可选 args.mainBranches 指定候选主分支名
  checkoutMain: (path, args) => checkoutMainBranch(path, args.mainBranches),
  // 拉取更新
  pull: (path) => pullUpdates(path),
  // 暂存变更
  stash: (path) => stashChanges(path),
};

/**
 * 批量执行 git 操作，逐个处理、互不阻断，返回每项结果
 * @param {string[]} projectPaths - 项目路径列表
 * @param {'checkout'|'pull'|'stash'} operation - 操作类型
 * @param {object} [args] - 操作参数（如 checkout 的 branch）
 * @param {(progress:{done:number,total:number,current:string})=>void} [onProgress] - 进度回调
 * @returns {Promise<Array<{path:string,success:boolean,error?:string}>>} 每个项目的结果
 */
export async function batchOperate(projectPaths, operation, args = {}, onProgress) {
  // handler 为该操作类型对应的执行函数
  const handler = OP_HANDLERS[operation];
  if (!handler) throw new Error(`未知操作类型: ${operation}`);
  // results 累积每个项目的执行结果
  const results = [];
  // total 总数，用于进度计算
  const total = projectPaths.length;
  for (let i = 0; i < total; i++) {
    const path = projectPaths[i];
    // 通知进度：即将处理第 i 个
    if (onProgress) onProgress({ done: i, total, current: path });
    // 单项失败不抛出，捕获为失败结果继续下一个
    let res;
    try {
      res = await handler(path, args);
    } catch (e) {
      res = { success: false, error: e.message };
    }
    results.push({ path, ...res });
    if (onProgress) onProgress({ done: i + 1, total, current: path });
  }
  return results;
}

/**
 * 异步获取目录占用的磁盘空间（递归统计所有文件大小）
 * @param {string} dirPath - 目录路径
 * @returns {Promise<number>} 字节数
 * WHY 改为 async：同步递归遍历大型 worktree（含 node_modules 软链接）会阻塞主进程事件循环数秒，
 * 改用 fs.promises 不卡主线程，对文件系统的压力与同步版相同但不占 JS 事件循环。
 */
async function getDirSize(dirPath) {
  // totalSize 累计该目录及子目录所有文件的字节数
  let totalSize = 0;
  let items;
  try {
    items = await readdirAsync(dirPath);
  } catch {
    return totalSize;
  }
  // 并行 lstat 所有条目，减少串行等待
  const stats = await Promise.all(
    items.map(async (item) => {
      const itemPath = join(dirPath, item);
      try {
        return { itemPath, stat: await lstatAsync(itemPath) };
      } catch {
        return null;
      }
    }),
  );
  for (const entry of stats) {
    if (!entry) continue;
    const { itemPath, stat } = entry;
    if (stat.isSymbolicLink()) {
      totalSize += stat.size;
    } else if (stat.isDirectory()) {
      totalSize += await getDirSize(itemPath);
    } else {
      totalSize += stat.size;
    }
  }
  return totalSize;
}

/**
 * 检测某个 worktree 是否可安全删除（分支已合并到主分支 且 本地无未提交改动）
 * @param {string} projectPath - 源项目路径
 * @param {string} worktreePath - worktree 路径
 * @param {string} branch - worktree 所在分支名
 * @param {string[]} [mainBranches] - 视为主分支的候选名列表，取仓库中实际存在的第一个
 * @returns {Promise<{safe:boolean, reason?:string}>}
 */
async function checkWorktreeSafeToRemove(projectPath, worktreePath, branch, mainBranches = DEFAULT_MAIN_BRANCHES) {
  try {
    const git = simpleGit(projectPath);
    // branches 仓库所有本地分支，用于确定实际主分支名
    const branches = await git.branch();
    // mainBranch 主分支名：取候选列表中仓库实际存在的第一个，兜底用候选首项
    const mainBranch = mainBranches.find((b) => branches.all.includes(b)) || mainBranches[0];

    // worktree 自身就在主分支上：删它会丢掉主工作区语义，视为不可删
    if (branch === mainBranch) return { safe: false, reason: 'is-main-branch' };

    // mergedToMain 检查分支是否已合并到主分支
    let mergedToMain = false;
    try {
      // mergedOutput git branch --merged 输出已合并到 mainBranch 的分支列表
      const mergedOutput = await git.raw(['branch', '--merged', mainBranch]);
      // 逐行去掉行首标记前缀再比较：当前分支为 `* `，被其他 worktree 检出的分支为 `+ `，普通分支无前缀。
      // WHY：可删的 worktree 其分支正被该 worktree 检出，输出恒为 `+ ` 前缀，
      // 若只匹配裸名/`* ` 会漏掉它们，导致所有 worktree 都被误判为「未合并」不可删。
      mergedToMain = mergedOutput
        .split('\n')
        .map((line) => line.replace(/^[*+]?\s*/, '').trim())
        .some((name) => name === branch);
    } catch (e) {
      // 主分支不存在或其他错误：保守视为未合并
      mergedToMain = false;
    }

    // hasChanges 检查 worktree 内是否有未提交改动
    let hasChanges = false;
    try {
      const wtGit = simpleGit(worktreePath);
      const status = await wtGit.status();
      hasChanges = !status.isClean();
    } catch (e) {
      // worktree 目录不存在或损坏：视为有问题不可删
      return { safe: false, reason: 'worktree-inaccessible' };
    }

    // safe 仅当已合并且无改动时为 true
    const safe = mergedToMain && !hasChanges;
    // reason 说明不可删原因
    let reason;
    if (!safe) {
      if (!mergedToMain && hasChanges) reason = 'not-merged-and-has-changes';
      else if (!mergedToMain) reason = 'not-merged';
      else reason = 'has-changes';
    }

    return { safe, reason };
  } catch (e) {
    return { safe: false, reason: 'check-failed' };
  }
}

/**
 * 扫描所有 worktree，返回可安全删除的列表（已合并到主分支 且 无未提交改动）
 * @param {string} projectsRoot - 源项目根目录（其下每个子目录是一个 git 仓库）
 * @param {string} worktreesRoot - worktree 根目录
 * @param {string[]} [mainBranches] - 视为主分支的分支名列表
 * @returns {Promise<Array<{taskName:string, projectName:string, projectPath:string, path:string, branch:string, sizeBytes:number, lastModified:number}>>} 可删除的 worktree 列表
 */
export async function getSafeToRemoveWorktrees(projectsRoot, worktreesRoot, mainBranches = DEFAULT_MAIN_BRANCHES) {
  // safeList 累积可安全删除的 worktree 信息
  const safeList = [];
  // 源项目根目录不存在：无项目可扫，直接返回空
  if (!projectsRoot || !existsSync(projectsRoot)) return safeList;

  // realWtRoot 规范化 worktree 根目录真实路径，消除 symlink 差异以便前缀匹配
  const realWtRoot = existsSync(worktreesRoot) ? realpathSync(worktreesRoot) : worktreesRoot;
  // wtRootPrefix 归一化为正斜杠后末尾补分隔符便于前缀匹配；Windows 下 realWtRoot 是反斜杠，
  // 而 git 返回路径是正斜杠，须统一到正斜杠才能与 wt.path 前缀对齐
  const wtRootPrefix = toPosixPath(realWtRoot).replace(/\/?$/, '/');

  // projectDirs 为源项目绝对路径列表：扫描 projectsRoot 下的 git 仓库目录
  const projectDirs = [];
  for (const entry of readdirSync(projectsRoot)) {
    // 跳过隐藏目录（.git/.DS_Store 等）
    if (entry.startsWith('.')) continue;
    const full = join(projectsRoot, entry);
    try {
      if (statSync(full).isDirectory() && isGitRepo(full)) projectDirs.push(full);
    } catch (e) {
      continue;
    }
  }

  for (const projDir of projectDirs) {
    try {
      // worktrees 该源项目的所有 worktree（含主工作区）
      const worktrees = await getWorktrees(projDir, mainBranches);
      // projectName 项目名（源项目目录 basename）
      const projectName = basename(projDir);
      for (const wt of worktrees) {
        // wtPathPosix 存储归一化为正斜杠的 worktree 路径，与同为正斜杠的 wtRootPrefix 前缀匹配/切片，避免分隔符不一致失配
        const wtPathPosix = toPosixPath(wt.path);
        // 只处理位于 worktreesRoot 下的 worktree（跳过主工作区与其他位置）
        if (!wtPathPosix.startsWith(wtRootPrefix)) continue;

        // 检查是否可安全删除（已合并+无改动）
        const check = await checkWorktreeSafeToRemove(projDir, wt.path, wt.branch, mainBranches);
        if (!check.safe) continue;

        // sizeBytes 该 worktree 占用磁盘空间（软链接不跟随，避免重复计 node_modules）
        const sizeBytes = await getDirSize(wt.path);
        // lastModified worktree 目录最后修改时间（毫秒）
        let lastModified = 0;
        try {
          const wtStat = await statAsync(wt.path);
          lastModified = wtStat.mtimeMs;
        } catch {
          // 获取失败：使用 0
        }

        // relPath 相对 worktreesRoot 的路径（正斜杠），用于提取任务名
        const relPath = wtPathPosix.slice(wtRootPrefix.length);
        // taskName 任务名（worktree 路径格式：{任务名}/{项目名}）
        const taskName = getTaskNameFromWorktreeRelativePath(relPath);

        safeList.push({ taskName, projectName, projectPath: projDir, path: wt.path, branch: wt.branch, sizeBytes, lastModified });
      }
    } catch (e) {
      // 单个项目失败不影响其他项目
      continue;
    }
  }

  return safeList;
}
