import { homedir } from 'os';
import { dirname, join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { DEFAULT_WORKFLOW_STEPS } from './workflowSteps.js';
import { DEFAULT_WORK_DOCUMENT_TEMPLATES } from './taskDocsService.js';

// 应用配置管理：持久化用户设置（源项目路径、worktree 路径、主分支名、忽略列表）。
// 配置存于用户目录下，纯 Node 模块便于测试。

// 默认配置：基于用户的实际工作目录
const DEFAULT_CONFIG = {
  // 源项目根目录：扫描的主要对象
  sourceProjectsPath: join(homedir(), 'work/projects'),
  // worktree 根目录：实际开发时建立 worktree 的位置
  worktreesPath: join(homedir(), 'work/worktrees'),
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
  // 工作文档模板：新建任务和项目 worktree 时自动创建，删除任务前按同一配置归档；固定说明文件由 taskDocsService 单独生成。
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
  if (!existsSync(file)) return { ...DEFAULT_CONFIG };
  try {
    // 合并：用户配置覆盖默认，保证新增字段有默认值
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (e) {
    // 配置损坏时回退默认，避免应用启动失败
    return { ...DEFAULT_CONFIG };
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
  // merged 为默认值与传入配置的合并结果
  const merged = { ...DEFAULT_CONFIG, ...previous, ...config };
  writeFileSync(file, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
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
