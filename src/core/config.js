import { homedir } from 'os'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { DEFAULT_WORKFLOW_STEPS } from './workflowSteps.js'
import { DEFAULT_WORK_DOCUMENT_TEMPLATES } from './taskDocsService.js'
import { DEFAULT_TASK_STATUSES, normalizeTaskStatuses } from './taskStatuses.js'
import { DEFAULT_TASK_TAGS, normalizeTaskTags } from './taskTags.js'
import {
  DEFAULT_KANBAN_SETTINGS,
  normalizeKanbanSettings,
} from './kanbanSettings.js'

// 配置文件只全局保存当前工作区 id；路径与全部系统设置均归属于各自工作区。

// DEFAULT_SOURCE_PROJECTS_PATH 存储默认源项目根目录。
const DEFAULT_SOURCE_PROJECTS_PATH = join(
  homedir(),
  'Desktop',
  'work',
  'projects'
)
// DEFAULT_WORKTREES_PATH 存储默认 Worktree 根目录。
const DEFAULT_WORKTREES_PATH = join(homedir(), 'Desktop', 'work', 'worktrees')
// DEFAULT_PATH_PROFILE_ID 存储默认工作区的稳定 id。
const DEFAULT_PATH_PROFILE_ID = 'default'
// DEFAULT_PATH_PROFILE_NAME 存储默认工作区名称。
const DEFAULT_PATH_PROFILE_NAME = '工作路径'
// SWITCH_WORKSPACE_ONLY_FIELD 存储切换工作区时使用的瞬时控制字段，不会写入磁盘。
export const SWITCH_WORKSPACE_ONLY_FIELD = '__switchWorkspaceOnly'
// DEFAULT_TOKEN_PRICING 存储默认 Token 计价配置；单价单位为美元/百万 Token。
const DEFAULT_TOKEN_PRICING = {
  enabled: false,
  input: 3,
  output: 15,
  cacheWrite: 3.75,
  cacheRead: 0.3,
  multiplier: 1,
  models: [],
  usdToCny: 7.2,
  directCnyDisplay: true, // 首次安装默认按中转站人民币 1:1 扣费口径展示。
}
// AI_USAGE_TOOL_IDS 存储支持参与 Token 统计的工具标识。
export const AI_USAGE_TOOL_IDS = ['claude-code', 'codex']
// DEFAULT_AI_USAGE_TOOL 存储默认参与 Token 统计的本地 AI 工具。
const DEFAULT_AI_USAGE_TOOL = 'claude-code'
// DEFAULT_TOKEN_PRICING_BY_TOOL 存储每个统计工具独立的默认 Token 单价。
const DEFAULT_TOKEN_PRICING_BY_TOOL = Object.fromEntries(
  AI_USAGE_TOOL_IDS.map((toolId) => [toolId, { ...DEFAULT_TOKEN_PRICING }])
)

// DEFAULT_WORKSPACE_SETTINGS 存储每个工作区独立拥有的系统设置默认值。
const DEFAULT_WORKSPACE_SETTINGS = {
  onboardingCompleted: false,
  mainBranches: ['master', 'main'],
  gitlabMergeTargetBranches: ['test'],
  ignoredProjects: [],
  autoFetch: false,
  cicdLinks: {},
  vscodeCommand: 'code {path}',
  terminalApp: process.platform === 'win32' ? 'wt' : 'Terminal',
  workflowSteps: DEFAULT_WORKFLOW_STEPS.map((step) => ({ ...step })),
  projectWorkflowSteps: {},
  workDocumentTemplates: DEFAULT_WORK_DOCUMENT_TEMPLATES.map((template) => ({
    ...template,
  })),
  taskTitleBadges: {
    taskTag: true,
    projectCount: true,
    taskStatus: true,
    taskLinks: true,
    claudeUsage: true,
  },
  taskStatuses: DEFAULT_TASK_STATUSES.map((status) => ({ ...status })),
  taskTags: DEFAULT_TASK_TAGS.map((tag) => ({ ...tag })),
  kanbanSettings: { ...DEFAULT_KANBAN_SETTINGS },
  tokenPricing: { ...DEFAULT_TOKEN_PRICING },
  tokenPricingByTool: cloneJson(DEFAULT_TOKEN_PRICING_BY_TOOL),
  aiUsageTool: DEFAULT_AI_USAGE_TOOL,
  aiUsageTools: [DEFAULT_AI_USAGE_TOOL],
}
// WORKSPACE_SETTING_KEYS 存储允许写入单个工作区 settings 的字段，阻止运行时字段混入磁盘。
const WORKSPACE_SETTING_KEYS = Object.keys(DEFAULT_WORKSPACE_SETTINGS)

/**
 * 深拷贝 JSON 可序列化数据，避免默认对象引用被调用方修改。
 * @param {object} value - 待克隆对象
 * @returns {object} 独立副本
 */
function cloneJson(value) {
  // clonedValue 存储通过 JSON 往返生成的独立对象。
  const clonedValue = JSON.parse(JSON.stringify(value))
  return clonedValue
}

/**
 * 规范化 Token 费用配置，避免损坏配置或负数价格进入费用计算。
 * @param {object} pricing - 待规范化的 Token 费用配置
 * @returns {object} 有效计价配置
 */
function normalizeTokenPricing(pricing) {
  // normalizedPricing 存储合并默认值后的计价配置。
  const normalizedPricing = { ...DEFAULT_TOKEN_PRICING, ...(pricing || {}) }
  // numericKeys 存储必须为非负有限数的单价字段。
  const numericKeys = [
    'input',
    'output',
    'cacheWrite',
    'cacheRead',
    'multiplier',
  ]
  for (const key of numericKeys) {
    // numericValue 存储当前字段转换后的数值。
    const numericValue = Number(normalizedPricing[key])
    normalizedPricing[key] =
      Number.isFinite(numericValue) && numericValue >= 0
        ? numericValue
        : DEFAULT_TOKEN_PRICING[key]
  }
  // exchangeRate 存储美元兑人民币汇率，必须为正数。
  const exchangeRate = Number(normalizedPricing.usdToCny)
  normalizedPricing.usdToCny =
    Number.isFinite(exchangeRate) && exchangeRate > 0
      ? exchangeRate
      : DEFAULT_TOKEN_PRICING.usdToCny
  normalizedPricing.enabled = normalizedPricing.enabled === true
  normalizedPricing.directCnyDisplay =
    normalizedPricing.directCnyDisplay === true
  // configuredModels 存储按模型维护的自定义价格；空模型名不会参与匹配。
  const configuredModels = Array.isArray(pricing?.models) ? pricing.models : []
  // normalizedModels 存储清洗后的模型价格，保留用户顺序便于设置页管理。
  const normalizedModels = configuredModels
    .map((modelPricing) => {
      // model 存储日志中用于精确匹配价格的模型标识。
      const model = String(modelPricing?.model || '').trim()
      // normalizedModelPricing 存储当前模型合并默认兜底后的有效价格。
      const normalizedModelPricing = {
        ...DEFAULT_TOKEN_PRICING,
        ...(modelPricing || {}),
        model,
      }
      for (const key of numericKeys) {
        // numericValue 存储当前模型价格字段转换后的数值。
        const numericValue = Number(normalizedModelPricing[key])
        normalizedModelPricing[key] =
          Number.isFinite(numericValue) && numericValue >= 0
            ? numericValue
            : DEFAULT_TOKEN_PRICING[key]
      }
      delete normalizedModelPricing.enabled
      delete normalizedModelPricing.models
      delete normalizedModelPricing.usdToCny
      delete normalizedModelPricing.directCnyDisplay
      return normalizedModelPricing
    })
    .filter((modelPricing) => modelPricing.model)
  normalizedPricing.models = normalizedModels
  return normalizedPricing
}

/**
 * 规范化单个工作区的独立系统设置。
 * @param {object} settings - 原始工作区设置
 * @returns {object} 补齐默认值后的设置
 */
function normalizeWorkspaceSettings(settings) {
  // normalizedSettings 存储默认设置与磁盘设置合并后的结果。
  const normalizedSettings = {
    ...cloneJson(DEFAULT_WORKSPACE_SETTINGS),
    ...(settings || {}),
  }
  normalizedSettings.tokenPricing = normalizeTokenPricing(
    normalizedSettings.tokenPricing
  )
  // requestedGitlabTargetBranches 存储新版多目标分支配置；旧版单值配置会迁移为单元素数组。
  const requestedGitlabTargetBranches = Array.isArray(
    settings?.gitlabMergeTargetBranches
  )
    ? settings.gitlabMergeTargetBranches
    : [settings?.gitlabMergeTargetBranch]
  // gitlabMergeTargetBranches 存储去空、去重后的 MR 目标分支列表；无有效配置时回退 test。
  const gitlabMergeTargetBranches = [
    ...new Set(
      requestedGitlabTargetBranches
        .map((branch) => String(branch || '').trim())
        .filter(Boolean)
    ),
  ]
  normalizedSettings.gitlabMergeTargetBranches =
    gitlabMergeTargetBranches.length > 0 ? gitlabMergeTargetBranches : ['test']
  // 旧版单值字段完成迁移后不再向运行时和磁盘配置扩散。
  delete normalizedSettings.gitlabMergeTargetBranch
  // legacyUsageTool 存储旧版单选配置，用于把既有单价迁移到原来选中的工具。
  const legacyUsageTool =
    settings?.aiUsageTool === 'codex' ? 'codex' : DEFAULT_AI_USAGE_TOOL
  // requestedUsageTools 存储新版多选值；旧配置缺失时回退原单选工具。
  const requestedUsageTools = Array.isArray(settings?.aiUsageTools)
    ? settings.aiUsageTools
    : [legacyUsageTool]
  // normalizedUsageTools 存储去重且受支持的统计工具，空选择回退 Claude Code。
  const normalizedUsageTools = [
    ...new Set(
      requestedUsageTools.filter((toolId) => AI_USAGE_TOOL_IDS.includes(toolId))
    ),
  ]
  normalizedSettings.aiUsageTools =
    normalizedUsageTools.length > 0
      ? normalizedUsageTools
      : [DEFAULT_AI_USAGE_TOOL]
  // 保留旧字段供尚未迁移的调用方读取，值始终为当前第一个统计工具。
  normalizedSettings.aiUsageTool = normalizedSettings.aiUsageTools[0]
  // configuredPricingByTool 存储新版每工具单价配置；不存在时只把旧单价迁移给旧版所选工具。
  const configuredPricingByTool = settings?.tokenPricingByTool || {}
  normalizedSettings.tokenPricingByTool = Object.fromEntries(
    AI_USAGE_TOOL_IDS.map((toolId) => {
      // fallbackPricing 存储当前工具的迁移回退值，避免旧配置被复制到两个工具。
      const fallbackPricing =
        toolId === legacyUsageTool
          ? normalizedSettings.tokenPricing
          : DEFAULT_TOKEN_PRICING_BY_TOOL[toolId]
      return [
        toolId,
        normalizeTokenPricing(
          configuredPricingByTool[toolId] || fallbackPricing
        ),
      ]
    })
  )
  // rawTaskStatuses 存储磁盘中显式保存的动态状态列表；旧版配置缺失时交由标签映射迁移。
  const rawTaskStatuses = Array.isArray(settings?.taskStatuses)
    ? settings.taskStatuses
    : undefined
  normalizedSettings.taskStatuses = normalizeTaskStatuses(
    rawTaskStatuses,
    settings?.taskStatusLabels
  )
  normalizedSettings.taskTags = normalizeTaskTags(settings?.taskTags)
  normalizedSettings.kanbanSettings = normalizeKanbanSettings(
    normalizedSettings.kanbanSettings,
    normalizedSettings.taskStatuses
  )
  // 旧版标签映射完成迁移后不再向运行时和磁盘配置继续扩散。
  delete normalizedSettings.taskStatusLabels
  normalizedSettings.onboardingCompleted =
    normalizedSettings.onboardingCompleted === true
  return normalizedSettings
}

/**
 * 从运行时扁平配置提取当前工作区允许持久化的系统设置。
 * @param {object} config - 渲染层提交的当前工作区配置
 * @param {object} fallbackSettings - 缺省字段使用的已有设置
 * @param {object} [submittedConfig] - 用户本次实际提交的字段，用于识别旧版调用
 * @returns {object} 当前工作区完整设置
 */
function extractWorkspaceSettings(
  config,
  fallbackSettings,
  submittedConfig = config
) {
  // mergedSettings 存储已有设置与本次提交字段合并后的结果。
  const mergedSettings = { ...fallbackSettings }
  for (const key of WORKSPACE_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(config || {}, key)) {
      mergedSettings[key] = config[key]
    }
  }
  // 旧版调用只提交单选字段时移除新版默认数组，确保迁移逻辑采用用户原来的工具。
  if (
    Object.prototype.hasOwnProperty.call(
      submittedConfig || {},
      'aiUsageTool'
    ) &&
    !Object.prototype.hasOwnProperty.call(submittedConfig || {}, 'aiUsageTools')
  ) {
    delete mergedSettings.aiUsageTools
  }
  // 旧版调用只提交统一单价时移除新版默认分工具配置，确保单价迁移到原工具。
  if (
    Object.prototype.hasOwnProperty.call(
      submittedConfig || {},
      'tokenPricing'
    ) &&
    !Object.prototype.hasOwnProperty.call(
      submittedConfig || {},
      'tokenPricingByTool'
    )
  ) {
    delete mergedSettings.tokenPricingByTool
  }
  return normalizeWorkspaceSettings(mergedSettings)
}

/**
 * 创建默认工作区磁盘对象。
 * @returns {object} 包含路径和独立 settings 的默认工作区
 */
function createDefaultWorkspace() {
  // workspace 存储首次启动使用的默认工作区。
  const workspace = {
    id: DEFAULT_PATH_PROFILE_ID,
    name: DEFAULT_PATH_PROFILE_NAME,
    sourceProjectsPath: DEFAULT_SOURCE_PROJECTS_PATH,
    worktreesPath: DEFAULT_WORKTREES_PATH,
    settings: normalizeWorkspaceSettings(),
  }
  return workspace
}

/**
 * 创建新的磁盘配置结构。
 * @returns {{activePathProfileId:string,pathProfiles:Array<object>}} 默认磁盘配置
 */
function createDefaultPersistedConfig() {
  // persistedConfig 存储只包含工作区索引与工作区数据的磁盘结构。
  const persistedConfig = {
    activePathProfileId: DEFAULT_PATH_PROFILE_ID,
    pathProfiles: [createDefaultWorkspace()],
  }
  return persistedConfig
}

/**
 * 规范化单个磁盘工作区。
 * @param {object} profile - 原始工作区
 * @param {number} index - 工作区下标
 * @param {object|null} existingProfile - 同 id 的已有工作区，用于保留未提交设置
 * @returns {object} 有效工作区
 */
function normalizeWorkspaceProfile(profile, index, existingProfile = null) {
  // fallbackId 存储缺失 id 时使用的稳定标识。
  const fallbackId =
    index === 0 ? DEFAULT_PATH_PROFILE_ID : `profile-${index + 1}`
  // id 存储工作区唯一标识。
  const id = String(profile?.id || fallbackId).trim() || fallbackId
  // name 存储工作区展示名称。
  const name =
    String(profile?.name || `工作区 ${index + 1}`).trim() ||
    `工作区 ${index + 1}`
  // sourceProjectsPath 存储工作区源项目路径。
  const sourceProjectsPath = String(
    profile?.sourceProjectsPath || DEFAULT_SOURCE_PROJECTS_PATH
  ).trim()
  // worktreesPath 存储工作区 Worktree 路径。
  const worktreesPath = String(
    profile?.worktreesPath || DEFAULT_WORKTREES_PATH
  ).trim()
  // rawSettings 存储显式设置或同工作区已有设置，新工作区使用默认值。
  const rawSettings = profile?.settings || existingProfile?.settings
  return {
    id,
    name,
    sourceProjectsPath,
    worktreesPath,
    settings: normalizeWorkspaceSettings(rawSettings),
  }
}

/**
 * 规范化磁盘配置，过滤无效工作区并保证 id 唯一。
 * @param {object} persistedConfig - 原始磁盘配置
 * @returns {object} 有效磁盘配置
 */
function normalizePersistedConfig(persistedConfig) {
  // rawProfiles 存储原始工作区数组；早期版本的路径组合尚未包含 settings，不能因此丢弃用户已保存的路径。
  const rawProfiles = Array.isArray(persistedConfig?.pathProfiles)
    ? persistedConfig.pathProfiles.filter(
        (profile) => profile && typeof profile === 'object'
      )
    : []
  // sourceProfiles 存储最终参与规范化的工作区源数组。
  const sourceProfiles = rawProfiles.length
    ? rawProfiles
    : [createDefaultWorkspace()]
  // requestedActiveId 存储磁盘声明的当前工作区 id。
  const requestedActiveId = String(
    persistedConfig?.activePathProfileId || ''
  ).trim()
  // legacySettingsProfileId 存储应继承旧顶层设置的工作区 id；旧结构只有一份顶层设置，因此只迁移到当时启用的工作区。
  const legacySettingsProfileId = sourceProfiles.some(
    (profile) => profile?.id === requestedActiveId
  )
    ? requestedActiveId
    : sourceProfiles[0]?.id
  // legacySettings 存储旧扁平配置中属于工作区的设置字段；仅用于兼容尚未写入 profile.settings 的已存路径组合。
  const legacySettings = extractWorkspaceSettings(persistedConfig, {})
  // seenIds 存储已经占用的工作区 id。
  const seenIds = new Set()
  // pathProfiles 存储清洗且 id 唯一的工作区列表。
  const pathProfiles = sourceProfiles.map((profile, index) => {
    // profileWithSettings 存储补齐 settings 后的路径组合；其他非活动旧组合使用默认设置，避免一份旧顶层设置错误复制到多个工作区。
    const profileWithSettings = profile?.settings
      ? profile
      : {
          ...profile,
          settings:
            profile?.id === legacySettingsProfileId
              ? legacySettings
              : undefined,
        }
    // normalizedProfile 存储当前规范化后的工作区。
    const normalizedProfile = normalizeWorkspaceProfile(
      profileWithSettings,
      index
    )
    // baseId 存储去重前的工作区 id。
    const baseId = normalizedProfile.id
    // uniqueId 存储最终唯一 id。
    let uniqueId = baseId
    // suffix 存储重复 id 的递增后缀。
    let suffix = 2
    while (seenIds.has(uniqueId)) {
      uniqueId = `${baseId}-${suffix}`
      suffix += 1
    }
    seenIds.add(uniqueId)
    return { ...normalizedProfile, id: uniqueId }
  })
  // activePathProfileId 存储存在于列表中的当前工作区 id。
  const activePathProfileId = pathProfiles.some(
    (profile) => profile.id === requestedActiveId
  )
    ? requestedActiveId
    : pathProfiles[0].id
  return { activePathProfileId, pathProfiles }
}

/**
 * 将磁盘工作区结构投影为现有业务组件使用的当前工作区扁平配置。
 * @param {object} persistedConfig - 已规范化磁盘配置
 * @returns {object} 当前工作区运行时配置
 */
function toRuntimeConfig(persistedConfig) {
  // activeProfile 存储当前启用工作区。
  const activeProfile =
    persistedConfig.pathProfiles.find(
      (profile) => profile.id === persistedConfig.activePathProfileId
    ) || persistedConfig.pathProfiles[0]
  // pathProfiles 存储供设置页和顶部选择器使用的工作区元数据，不暴露其他工作区 settings。
  const pathProfiles = persistedConfig.pathProfiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    sourceProjectsPath: profile.sourceProjectsPath,
    worktreesPath: profile.worktreesPath,
  }))
  return {
    ...cloneJson(activeProfile.settings),
    sourceProjectsPath: activeProfile.sourceProjectsPath,
    worktreesPath: activeProfile.worktreesPath,
    activePathProfileId: activeProfile.id,
    pathProfiles,
  }
}

// DEFAULT_CONFIG 存储提供给渲染层的默认工作区扁平配置。
const DEFAULT_CONFIG = toRuntimeConfig(createDefaultPersistedConfig())

/**
 * 计算配置文件存放路径。
 * @param {string} [baseDir] - 配置目录（测试时可注入）
 * @returns {{dir:string,file:string}} 配置目录与文件路径
 */
export function getConfigPaths(baseDir) {
  // dir 存储配置目录，默认使用 ~/.visualWorktree。
  const dir = baseDir || join(homedir(), '.visualWorktree')
  return { dir, file: join(dir, 'config.json') }
}

/**
 * 计算流程步骤所在配置文件路径。
 * @param {string} [baseDir] - 配置目录
 * @returns {{dir:string,file:string}} 配置目录与文件路径
 */
export function getWorkflowStepsPaths(baseDir) {
  return getConfigPaths(baseDir)
}

/**
 * 读取并规范化磁盘配置；旧扁平结构不迁移，直接回退新默认结构。
 * @param {string} [baseDir] - 配置目录
 * @returns {object} 磁盘工作区配置
 */
function readPersistedConfig(baseDir) {
  // paths 存储配置目录与文件路径。
  const paths = getConfigPaths(baseDir)
  if (!existsSync(paths.file)) {
    // defaultPersistedConfig 存储文件不存在时使用的新结构。
    const defaultPersistedConfig = createDefaultPersistedConfig()
    if (existsSync(paths.dir)) {
      defaultPersistedConfig.pathProfiles[0].settings.onboardingCompleted = true
    }
    return defaultPersistedConfig
  }
  try {
    // parsedConfig 存储磁盘 JSON 解析结果。
    const parsedConfig = JSON.parse(readFileSync(paths.file, 'utf8'))
    return normalizePersistedConfig(parsedConfig)
  } catch {
    // fallbackConfig 存储文件损坏时的安全新结构。
    const fallbackConfig = createDefaultPersistedConfig()
    fallbackConfig.pathProfiles[0].settings.onboardingCompleted = true
    return fallbackConfig
  }
}

/**
 * 读取当前工作区配置。
 * @param {string} [baseDir] - 配置目录
 * @returns {object} 当前工作区扁平配置
 */
export function loadConfig(baseDir) {
  // persistedConfig 存储磁盘上的多工作区配置。
  const persistedConfig = readPersistedConfig(baseDir)
  return toRuntimeConfig(persistedConfig)
}

/**
 * 保存工作区列表或当前工作区设置。
 * @param {object} config - 渲染层提交的当前工作区扁平配置
 * @param {string} [baseDir] - 配置目录
 * @returns {object} 保存后的当前工作区扁平配置
 */
export function saveConfig(config, baseDir) {
  // paths 存储配置目录与文件路径。
  const paths = getConfigPaths(baseDir)
  if (!existsSync(paths.dir)) mkdirSync(paths.dir, { recursive: true })
  // previousPersistedConfig 存储保存前的完整多工作区配置。
  const previousPersistedConfig = readPersistedConfig(baseDir)
  // previousRuntimeConfig 存储当前工作区扁平配置，用于补齐部分保存调用。
  const previousRuntimeConfig = toRuntimeConfig(previousPersistedConfig)
  // incomingConfig 存储补齐缺省字段后的本次提交。
  const incomingConfig = { ...previousRuntimeConfig, ...(config || {}) }
  // switchesWorkspaceOnly 标记本次仅切换工作区，不能把旧工作区设置写入目标工作区。
  const switchesWorkspaceOnly = config?.[SWITCH_WORKSPACE_ONLY_FIELD] === true
  // requestedProfiles 存储本次提交的工作区元数据；缺失时沿用原列表。
  const requestedProfiles = Array.isArray(incomingConfig.pathProfiles)
    ? incomingConfig.pathProfiles
    : previousRuntimeConfig.pathProfiles
  // pathProfiles 存储合并路径变更并保留各自 settings 后的工作区列表。
  const pathProfiles = requestedProfiles.map((profile, index) => {
    // existingProfile 存储同 id 的已有工作区，负责保留未激活工作区设置。
    const existingProfile = previousPersistedConfig.pathProfiles.find(
      (item) => item.id === profile?.id
    )
    return normalizeWorkspaceProfile(profile, index, existingProfile)
  })
  // requestedActiveId 存储本次要求启用的工作区 id。
  const requestedActiveId = String(
    incomingConfig.activePathProfileId || ''
  ).trim()
  // activePathProfileId 存储列表中有效的目标工作区 id。
  const activePathProfileId = pathProfiles.some(
    (profile) => profile.id === requestedActiveId
  )
    ? requestedActiveId
    : pathProfiles[0]?.id || DEFAULT_PATH_PROFILE_ID
  // activeProfile 存储即将返回给渲染层的目标工作区。
  const activeProfile = pathProfiles.find(
    (profile) => profile.id === activePathProfileId
  )
  if (activeProfile && !switchesWorkspaceOnly) {
    // 顶层路径是现有表单与初始化流程的运行时字段，显式提交时必须同步回当前工作区。
    if (
      Object.prototype.hasOwnProperty.call(config || {}, 'sourceProjectsPath')
    ) {
      activeProfile.sourceProjectsPath = String(
        config.sourceProjectsPath || DEFAULT_SOURCE_PROJECTS_PATH
      ).trim()
    }
    if (Object.prototype.hasOwnProperty.call(config || {}, 'worktreesPath')) {
      activeProfile.worktreesPath = String(
        config.worktreesPath || DEFAULT_WORKTREES_PATH
      ).trim()
    }
    // settingsFallback 存储目标工作区原设置，部分提交时以它补齐。
    const settingsFallback = activeProfile.settings
    activeProfile.settings = extractWorkspaceSettings(
      incomingConfig,
      settingsFallback,
      config
    )
  }
  // persistedConfig 存储最终写入磁盘的新结构。
  const persistedConfig = normalizePersistedConfig({
    activePathProfileId,
    pathProfiles,
  })
  writeFileSync(paths.file, JSON.stringify(persistedConfig, null, 2), 'utf8')
  return toRuntimeConfig(persistedConfig)
}

/**
 * 只恢复当前工作区默认设置，不影响其他工作区。
 * @param {string} [baseDir] - 配置目录
 * @returns {object} 重置后的当前工作区扁平配置
 */
export function resetConfig(baseDir) {
  // paths 存储配置目录与文件路径。
  const paths = getConfigPaths(baseDir)
  if (!existsSync(paths.dir)) mkdirSync(paths.dir, { recursive: true })
  // persistedConfig 存储重置前完整工作区配置。
  const persistedConfig = readPersistedConfig(baseDir)
  // activeProfile 存储本次唯一需要恢复默认的工作区。
  const activeProfile = persistedConfig.pathProfiles.find(
    (profile) => profile.id === persistedConfig.activePathProfileId
  )
  if (activeProfile) {
    activeProfile.sourceProjectsPath = DEFAULT_SOURCE_PROJECTS_PATH
    activeProfile.worktreesPath = DEFAULT_WORKTREES_PATH
    activeProfile.settings = normalizeWorkspaceSettings({
      onboardingCompleted: true,
    })
  }
  writeFileSync(paths.file, JSON.stringify(persistedConfig, null, 2), 'utf8')
  return toRuntimeConfig(persistedConfig)
}

export {
  DEFAULT_CONFIG,
  DEFAULT_TOKEN_PRICING,
  DEFAULT_AI_USAGE_TOOL,
  DEFAULT_WORKSPACE_SETTINGS,
}
