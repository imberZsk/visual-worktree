import { homedir } from 'os';
import { dirname, join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { DEFAULT_WORKFLOW_STEPS } from './workflowSteps.js';
import { DEFAULT_WORK_DOCUMENT_TEMPLATES } from './taskDocsService.js';

// 应用配置管理：持久化用户设置（源项目路径、worktree 路径、主分支名、忽略列表）。
// 配置存于用户目录下，纯 Node 模块便于测试。

// DEFAULT_SOURCE_PROJECTS_PATH 存储默认源项目根目录。
const DEFAULT_SOURCE_PROJECTS_PATH = join(homedir(), 'work/projects');
// DEFAULT_WORKTREES_PATH 存储默认 worktree 根目录。
const DEFAULT_WORKTREES_PATH = join(homedir(), 'work/worktrees');
// DEFAULT_PATH_PROFILE_ID 存储内置默认路径组合的稳定 id。
const DEFAULT_PATH_PROFILE_ID = 'default';
// DEFAULT_PATH_PROFILE_NAME 存储内置默认路径组合的展示名称。
const DEFAULT_PATH_PROFILE_NAME = '工作路径';

// 默认配置：基于用户的实际工作目录
const DEFAULT_CONFIG = {
  // 源项目根目录：扫描的主要对象
  sourceProjectsPath: DEFAULT_SOURCE_PROJECTS_PATH,
  // worktree 根目录：实际开发时建立 worktree 的位置
  worktreesPath: DEFAULT_WORKTREES_PATH,
  // 当前启用的路径组合 id；顶层 sourceProjectsPath/worktreesPath 始终同步为该组合的路径，供旧调用链继续使用。
  activePathProfileId: DEFAULT_PATH_PROFILE_ID,
  // 路径组合列表：每组同时包含源项目根目录与 worktree 根目录，便于在工作/个人等多套目录间切换。
  pathProfiles: [
    {
      id: DEFAULT_PATH_PROFILE_ID,
      name: DEFAULT_PATH_PROFILE_NAME,
      sourceProjectsPath: DEFAULT_SOURCE_PROJECTS_PATH,
      worktreesPath: DEFAULT_WORKTREES_PATH,
    },
  ],
  // 视为主分支的分支名
  mainBranches: ['master', 'main'],
  // 扫描时排除的目录名
  ignoredProjects: [],
  // 扫描时是否自动 fetch 远程（慢但能算出 behind）
  autoFetch: false,
  // 项目 CI/CD 流水线地址：{ 项目目录名: URL }，有则填写，无则不填
  cicdLinks: {},
  // 编辑器命令模板：{path} 占位符会被替换为实际路径，支持 VSCode(code)/Cursor(cursor)/Trae(trae) 等；
  // code 命令会自动注入 -n 在新窗口打开，不替换用户当前窗口
  vscodeCommand: 'code {path}',
  // 终端选择：按平台给不同默认——Windows 默认 wt(Windows Terminal)，macOS/其他默认系统 Terminal。
  // WHY 按平台：默认值直接决定新用户首次「打开终端」用哪个应用；给 Windows 存 'Terminal' 虽也能被主进程兜底到 wt，
  // 但设置页下拉会显示不匹配项。取当前平台的合理默认，让展示与行为一致。macOS：Terminal / iTerm2 / Ghostty；Windows：wt / powershell / cmd。
  terminalApp: process.platform === 'win32' ? 'wt' : 'Terminal',
  // 任务工作流步骤清单：worktree 视图里每个任务展示的「需求流程」步骤（可在设置中增删改）。
  // 每项 { key, label, command }，所有步骤都可勾选；command 非空的步骤额外可「执行」。
  // 取默认清单的深拷贝，避免多处共享同一数组引用被意外修改。
  workflowSteps: DEFAULT_WORKFLOW_STEPS.map((s) => ({ ...s })),
  // 环境检查角色配置：定义任务目录下「前端/后端」子目录的映射，空数组表示自动扫描全部子目录。
  // 每项 { name: string, dirs: string[] }，如 [{ name: '前端', dirs: ['web-app', 'h5'] }]。
  // 保存到 ~/.visualWorktree/config.json，检查时按角色过滤并分组展示结果。
  envCheckRoles: [],
  // 工作文档模板：新建任务时在任务根目录自动创建，删除任务前按同一配置归档；项目 worktree 只生成固定说明文件。
  // 每项 { type:'directory'|'file', path:string, content:string }，默认工作文档模板只包含 docs 目录。
  workDocumentTemplates: DEFAULT_WORK_DOCUMENT_TEMPLATES.map((template) => ({ ...template })),
  // 任务标题徽标展示开关：控制 Worktree 任务标题旁项目数量、状态、链接、环境、Token 用量是否展示。
  taskTitleBadges: {
    projectCount: true,
    taskStatus: true,
    taskLinks: true,
    envHealth: true,
    claudeUsage: true,
  },
};

// 旧配置目录（带连字符）：历史版本把 config.json 存这里，与 task-status 等所在的 .visualWorktree 目录不一致。
// 现统一到 .visualWorktree，loadConfig 时一次性迁移旧文件过来。仅用于默认目录的迁移，不影响测试注入的 baseDir。
const LEGACY_CONFIG_DIR = join(homedir(), '.visual-worktree');

/**
 * 克隆默认配置，避免调用方修改返回对象时污染模块级 DEFAULT_CONFIG。
 * @returns {object} 默认配置的深拷贝
 */
function cloneDefaultConfig() {
  // clonedConfig 存储可安全返回/写盘的默认配置副本；DEFAULT_CONFIG 只包含 JSON 可序列化数据。
  const clonedConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  return clonedConfig;
}

/**
 * 规范化单个路径组合，补齐 id/name/path 等字段。
 * @param {object} profile - 待规范化的路径组合
 * @param {number} index - 组合在列表中的下标，用于生成兜底名称和 id
 * @param {object} fallback - 兜底路径组合，缺字段时继承它的路径
 * @returns {{id:string,name:string,sourceProjectsPath:string,worktreesPath:string}} 规范化后的路径组合
 */
function normalizePathProfile(profile, index, fallback) {
  // fallbackId 存储当前行缺失 id 时的兜底 id；第一行沿用 default，后续按序号生成稳定值。
  const fallbackId = index === 0 ? DEFAULT_PATH_PROFILE_ID : `profile-${index + 1}`;
  // id 存储路径组合唯一标识；空白值会被兜底 id 替代。
  const id = String(profile?.id || fallbackId).trim() || fallbackId;
  // name 存储路径组合显示名称；空白时用「路径组合 N」兜底。
  const name = String(profile?.name || `路径组合 ${index + 1}`).trim() || `路径组合 ${index + 1}`;
  // sourceProjectsPath 存储该组合的源项目根目录；缺失时使用兜底组合路径。
  const sourceProjectsPath = String(profile?.sourceProjectsPath || fallback.sourceProjectsPath || '').trim();
  // worktreesPath 存储该组合的 worktree 根目录；缺失时使用兜底组合路径。
  const worktreesPath = String(profile?.worktreesPath || fallback.worktreesPath || '').trim();
  return { id, name, sourceProjectsPath, worktreesPath };
}

/**
 * 去重路径组合 id，避免表单复制或手写配置造成同 id 多组。
 * @param {Array<{id:string,name:string,sourceProjectsPath:string,worktreesPath:string}>} profiles - 已初步规范化的路径组合
 * @returns {Array<{id:string,name:string,sourceProjectsPath:string,worktreesPath:string}>} id 唯一的路径组合
 */
function dedupePathProfileIds(profiles) {
  // seenIds 存储已经出现过的组合 id。
  const seenIds = new Set();
  return profiles.map((profile, index) => {
    // baseId 存储当前组合原始 id，用于第一次出现时保持不变。
    const baseId = profile.id || (index === 0 ? DEFAULT_PATH_PROFILE_ID : `profile-${index + 1}`);
    // nextId 存储去重后的 id；重复时追加序号，保证 Select value 唯一。
    let nextId = baseId;
    // suffix 存储重复 id 的递增后缀。
    let suffix = 2;
    while (seenIds.has(nextId)) {
      nextId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    seenIds.add(nextId);
    return { ...profile, id: nextId };
  });
}

/**
 * 规范化完整配置里的路径组合，并把当前启用组合同步到顶层路径字段。
 * @param {object} config - 合并默认值后的配置对象
 * @param {{preferTopLevelPaths?:boolean}} [opts] - preferTopLevelPaths 为 true 时用顶层路径覆盖当前组合，兼容旧版保存调用
 * @returns {object} 已规范化路径组合并同步顶层路径的配置
 */
function normalizePathProfilesInConfig(config, opts = {}) {
  // preferTopLevelPaths 标记本次保存是否来自旧版顶层路径字段；为真时不让旧 pathProfiles 覆盖用户刚保存的路径。
  const { preferTopLevelPaths = false } = opts;
  // fallbackProfile 存储从顶层字段构造出的兜底路径组合。
  const fallbackProfile = {
    id: DEFAULT_PATH_PROFILE_ID,
    name: DEFAULT_PATH_PROFILE_NAME,
    sourceProjectsPath: config.sourceProjectsPath || DEFAULT_SOURCE_PROJECTS_PATH,
    worktreesPath: config.worktreesPath || DEFAULT_WORKTREES_PATH,
  };
  // rawProfiles 存储配置文件里的路径组合数组；旧配置没有该字段时回退空数组。
  const rawProfiles = Array.isArray(config.pathProfiles) ? config.pathProfiles : [];
  // normalizedProfiles 存储补齐字段且过滤无效项后的路径组合列表。
  let normalizedProfiles = rawProfiles
    .map((profile, index) => normalizePathProfile(profile, index, fallbackProfile))
    .filter((profile) => profile.sourceProjectsPath && profile.worktreesPath);
  if (normalizedProfiles.length === 0) normalizedProfiles = [normalizePathProfile(fallbackProfile, 0, fallbackProfile)];
  normalizedProfiles = dedupePathProfileIds(normalizedProfiles);

  // requestedActiveId 存储配置里声明的当前组合 id；缺失或失效时使用第一组。
  const requestedActiveId = String(config.activePathProfileId || normalizedProfiles[0].id).trim();
  // activeProfileIndex 存储当前组合在列表中的下标，用于覆盖或回退。
  const activeProfileIndex = normalizedProfiles.findIndex((profile) => profile.id === requestedActiveId);
  // activeIndex 存储最终启用的组合下标；找不到时回退第一组。
  const activeIndex = activeProfileIndex >= 0 ? activeProfileIndex : 0;

  if (preferTopLevelPaths) {
    // topLevelSourceProjectsPath 存储旧版保存入口传入的源项目根目录。
    const topLevelSourceProjectsPath = String(config.sourceProjectsPath || fallbackProfile.sourceProjectsPath || '').trim();
    // topLevelWorktreesPath 存储旧版保存入口传入的 worktree 根目录。
    const topLevelWorktreesPath = String(config.worktreesPath || fallbackProfile.worktreesPath || '').trim();
    normalizedProfiles[activeIndex] = {
      ...normalizedProfiles[activeIndex],
      sourceProjectsPath: topLevelSourceProjectsPath,
      worktreesPath: topLevelWorktreesPath,
    };
  }

  // activeProfile 存储最终启用的路径组合。
  const activeProfile = normalizedProfiles[activeIndex];
  return {
    ...config,
    pathProfiles: normalizedProfiles,
    activePathProfileId: activeProfile.id,
    sourceProjectsPath: activeProfile.sourceProjectsPath,
    worktreesPath: activeProfile.worktreesPath,
  };
}

/**
 * 计算配置文件存放路径
 * @param {string} [baseDir] - 配置目录（测试时可注入临时目录）
 * @returns {{dir:string, file:string}} 配置目录与文件路径
 */
export function getConfigPaths(baseDir) {
  // dir 为配置目录，默认 ~/.visualWorktree（与 task-status/links/workflow 等统一在同一目录）
  const dir = baseDir || join(homedir(), '.visualWorktree');
  return { dir, file: join(dir, 'config.json') };
}

/**
 * 计算流程步骤配置文件路径。
 * 流程步骤现与普通配置一起存放在 ~/.visualWorktree/config.json；保留此函数供测试/兼容调用。
 * @param {string} [baseDir] - 测试用根目录；默认用户 home
 * @returns {{dir:string, file:string}} 配置目录与 config.json 路径
 */
export function getWorkflowStepsPaths(baseDir) {
  return getConfigPaths(baseDir);
}

/**
 * 将旧目录 ~/.visual-worktree/config.json 一次性迁移到新目录 ~/.visualWorktree/config.json。
 * 仅当使用默认目录（未注入 baseDir）、新文件尚不存在、旧文件存在时执行。迁移后保留旧文件不删，规避误删风险。
 * @param {string} newFile - 新目录下的目标 config.json 完整路径
 * @returns {void}
 */
function migrateLegacyConfig(newFile) {
  // legacyFile 为旧目录下的 config.json 路径
  const legacyFile = join(LEGACY_CONFIG_DIR, 'config.json');
  // 新文件已存在或旧文件不存在时无需迁移
  if (existsSync(newFile) || !existsSync(legacyFile)) return;
  try {
    // newDir 为新配置目录，迁移前确保其存在
    const newDir = dirname(newFile);
    if (!existsSync(newDir)) mkdirSync(newDir, { recursive: true });
    // 直接复制旧文件内容到新位置（保留旧文件，便于回滚/排查）
    writeFileSync(newFile, readFileSync(legacyFile, 'utf8'), 'utf8');
  } catch (e) {
    // 迁移失败不阻断启动：后续按「新文件不存在」回退默认配置，用户可重新保存
  }
}

/**
 * 读取配置，文件不存在时返回默认配置并与默认值合并
 * @param {string} [baseDir] - 配置目录（测试用）
 * @returns {object} 配置对象
 */
export function loadConfig(baseDir) {
  const { file } = getConfigPaths(baseDir);
  // 仅默认目录（未注入 baseDir）时尝试从旧目录迁移，避免污染测试用的临时目录
  if (!baseDir) migrateLegacyConfig(file);
  if (!existsSync(file)) return cloneDefaultConfig();
  try {
    // 合并：用户配置覆盖默认，保证新增字段有默认值
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    // mergedConfig 存储默认配置与磁盘配置合并后的结果，随后统一规范化路径组合。
    const mergedConfig = { ...cloneDefaultConfig(), ...parsed };
    // hasPathProfiles 标记磁盘配置是否已经使用新路径组合结构；旧配置优先从顶层路径迁移。
    const hasPathProfiles = Array.isArray(parsed?.pathProfiles);
    return normalizePathProfilesInConfig(mergedConfig, { preferTopLevelPaths: !hasPathProfiles });
  } catch (e) {
    // 配置损坏时回退默认，避免应用启动失败
    return cloneDefaultConfig();
  }
}

/**
 * 保存配置到磁盘
 * @param {object} config - 待保存的配置
 * @param {string} [baseDir] - 配置目录（测试用）
 * @returns {object} 实际写入的完整配置
 */
export function saveConfig(config, baseDir) {
  const { dir, file } = getConfigPaths(baseDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // previous 为磁盘上现有配置；用于普通设置保存时保留流程步骤，避免缺省字段覆盖用户流程
  const previous = loadConfig(baseDir);
  // merged 为默认值、旧配置与传入配置的合并结果
  const merged = { ...cloneDefaultConfig(), ...previous, ...config };
  // hasIncomingProfiles 标记本次保存是否来自新版路径组合表单。
  const hasIncomingProfiles = Object.prototype.hasOwnProperty.call(config || {}, 'pathProfiles');
  // hasIncomingTopLevelPaths 标记本次保存是否来自旧版顶层路径字段。
  const hasIncomingTopLevelPaths = Object.prototype.hasOwnProperty.call(config || {}, 'sourceProjectsPath')
    || Object.prototype.hasOwnProperty.call(config || {}, 'worktreesPath');
  // normalized 存储写盘前的完整配置；旧版路径保存要同步覆盖当前路径组合。
  const normalized = normalizePathProfilesInConfig(merged, { preferTopLevelPaths: !hasIncomingProfiles && hasIncomingTopLevelPaths });
  writeFileSync(file, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

/**
 * 将配置文件恢复为应用默认设置。
 * @param {string} [baseDir] - 配置目录（测试用）
 * @returns {object} 写入磁盘并返回的默认配置
 */
export function resetConfig(baseDir) {
  const { dir, file } = getConfigPaths(baseDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // defaultConfig 存储即将写入磁盘的默认配置副本；恢复默认不合并旧配置，确保旧字段被清掉。
  const defaultConfig = cloneDefaultConfig();
  writeFileSync(file, JSON.stringify(defaultConfig, null, 2), 'utf8');
  return defaultConfig;
}

export { DEFAULT_CONFIG };
