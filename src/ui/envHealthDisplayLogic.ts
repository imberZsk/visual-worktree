// ENV_ISSUE_CHECK_KEYS 存储会计入环境问题的检查项；Git 状态只作为明细提示。
const ENV_ISSUE_CHECK_KEYS = ['deps', 'ports', 'services']

// ENV_HEALTH_CACHE_VERSION 存储环境检查缓存结构版本。
export const ENV_HEALTH_CACHE_VERSION = 4

// DEFAULT_WORK_DOCUMENT_ENTRY_NAMES 存储默认跳过的任务根级工作文档入口。
const DEFAULT_WORK_DOCUMENT_ENTRY_NAMES = ['docs']

/**
 * 计算环境检查展示时需要跳过的任务根级工作文档入口名。
 * @param {Array<{path?:string}>} workDocumentTemplates - 用户配置的工作文档模板
 * @returns {Set<string>} 需要过滤的第一层目录名
 */
function getSkippedEntryNames(workDocumentTemplates = []) {
  // skippedNames 存储默认入口和有效模板的第一层目录名。
  const skippedNames = new Set(DEFAULT_WORK_DOCUMENT_ENTRY_NAMES)
  // templates 存储安全归一化后的模板数组。
  const templates = Array.isArray(workDocumentTemplates)
    ? workDocumentTemplates
    : []
  for (const template of templates) {
    // normalizedPath 存储统一分隔符后的模板相对路径。
    const normalizedPath = String(template?.path || '')
      .trim()
      .replace(/\\/g, '/')
    // firstSegment 存储模板在任务根目录下的第一层入口名。
    const firstSegment = normalizedPath.split('/').filter(Boolean)[0]
    if (
      firstSegment &&
      firstSegment !== '..' &&
      !normalizedPath.startsWith('/')
    ) {
      skippedNames.add(firstSegment)
    }
  }
  return skippedNames
}

/**
 * 判断项目是否为任务根级工作文档目录。
 * @param {object} project - 环境检查项目结果
 * @param {string} taskDir - 任务根目录
 * @param {Set<string>} skippedNames - 需要跳过的入口名
 * @returns {boolean} 是否应过滤
 */
function isRootWorkDocument(project, taskDir, skippedNames) {
  // projectName 存储项目显示名。
  const projectName = String(project?.name || '').trim()
  if (!projectName || !skippedNames.has(projectName)) return false
  // cleanTaskDir 存储去掉末尾斜杠的任务目录。
  const cleanTaskDir = String(taskDir || '').replace(/\/+$/, '')
  // projectPath 存储兼容新旧字段的项目路径。
  const projectPath = String(project?.path || project?.dir || '').replace(
    /\/+$/,
    ''
  )
  // expectedPath 存储该入口在任务目录下应有的完整路径。
  const expectedPath = cleanTaskDir ? `${cleanTaskDir}/${projectName}` : ''
  return !projectPath || !expectedPath || projectPath === expectedPath
}

/**
 * 判断项目是否为旧缓存中的未知非业务目录。
 * @param {object} project - 环境检查项目结果
 * @returns {boolean} 是否应过滤
 */
function isUncheckableProject(project) {
  // kind 存储核心层识别的项目类型。
  const kind = String(project?.kind || '').toLowerCase()
  // kindLabel 存储旧缓存中的项目类型标签。
  const kindLabel = String(project?.kindLabel || '').trim()
  return kind === 'unknown' || kindLabel === '未知'
}

/**
 * 计算单项目展示状态。
 * @param {object} project - 环境检查项目结果
 * @returns {'ok'|'warning'|'failed'} 展示状态
 */
function getProjectStatus(project) {
  // checks 存储项目各检查项结果。
  const checks =
    project?.checks && typeof project.checks === 'object' ? project.checks : {}
  // statuses 存储真正环境检查项的有效状态。
  const statuses = ENV_ISSUE_CHECK_KEYS.map(
    (key) => checks[key]?.status
  ).filter(Boolean)
  if (statuses.includes('error')) return 'failed'
  if (statuses.includes('warning')) return 'warning'
  // currentStatus 存储没有结构化检查项时沿用的旧状态。
  const currentStatus = project?.status
  if (
    Object.keys(checks).length === 0 &&
    (currentStatus === 'warning' || currentStatus === 'failed')
  ) {
    return currentStatus
  }
  return 'ok'
}

/**
 * 统计单项目真正计入环境问题的检查项数量。
 * @param {object} project - 环境检查项目结果
 * @returns {number} 环境问题数量
 */
function countProjectIssues(project) {
  // checks 存储项目各检查项结果。
  const checks =
    project?.checks && typeof project.checks === 'object' ? project.checks : {}
  return ENV_ISSUE_CHECK_KEYS.reduce((sum, key) => {
    // status 存储当前检查项状态。
    const status = checks[key]?.status
    return status && status !== 'ok' ? sum + 1 : sum
  }, 0)
}

/**
 * 归一化单项目状态和问题数量。
 * @param {object} project - 环境检查项目结果
 * @returns {object} 归一化后的项目
 */
function normalizeProject(project) {
  // status 存储重新计算后的展示状态。
  const status = getProjectStatus(project)
  // issueCount 存储重新计算后的问题数量。
  const issueCount = countProjectIssues(project)
  if (status === project?.status && issueCount === (project?.issueCount || 0)) {
    return project
  }
  return { ...project, status, issueCount }
}

/**
 * 根据可见项目重算任务摘要。
 * @param {Array<object>} projects - 可见项目检查结果
 * @returns {object} 任务级摘要
 */
function summarizeProjects(projects) {
  // projectCount 存储项目数量。
  const projectCount = projects.length
  // issueCount 存储问题总数。
  const issueCount = projects.reduce(
    (sum, project) => sum + (project.issueCount || 0),
    0
  )
  // failedProjects 存储仍存在问题的项目名。
  const failedProjects = projects
    .filter((project) => project.status !== 'ok')
    .map((project) => project.name)
  // status 存储任务级展示状态。
  const status = projects.some((project) => project.status === 'failed')
    ? 'failed'
    : projects.some((project) => project.status === 'warning') || issueCount > 0
      ? 'warning'
      : 'ok'
  // message 存储任务级摘要文案。
  const message =
    projectCount === 0
      ? '任务目录下未找到项目'
      : status === 'ok'
        ? `${projectCount} 个项目环境正常`
        : `${failedProjects.length} 个项目存在 ${issueCount} 个环境问题`
  return { status, projectCount, issueCount, failedProjects, message }
}

/**
 * 判断结果是否为旧缓存中的空任务目录场景。
 * @param {object} result - 环境检查结果
 * @returns {boolean} 是否为空任务目录旧结果
 */
function isEmptyTaskDirResult(result) {
  // summary 存储任务级摘要。
  const summary = result?.summary || {}
  return (
    Array.isArray(result?.projects) &&
    result.projects.length === 0 &&
    summary.projectCount === 0 &&
    summary.message === '任务目录下未找到项目'
  )
}

/**
 * 将核心环境检查结果转换为任务行状态。
 * @param {object} result - 核心环境检查结果
 * @returns {'ok'|'warning'|'failed'} 任务行状态
 */
export function getEnvStatusFromResult(result) {
  // status 存储核心层汇总状态。
  const status = result?.summary?.status
  return status === 'ok' || status === 'warning' || status === 'failed'
    ? status
    : 'failed'
}

/**
 * 归一化环境检查结果并过滤非业务目录。
 * @param {object} result - 环境检查结果
 * @param {string} taskDir - 任务根目录
 * @param {Array<{path?:string}>} workDocumentTemplates - 工作文档模板
 * @returns {object} 归一化结果
 */
export function normalizeEnvHealthResultForDisplay(
  result,
  taskDir,
  workDocumentTemplates = []
) {
  if (!Array.isArray(result?.projects)) return result
  // skippedNames 存储需要过滤的工作文档入口名。
  const skippedNames = getSkippedEntryNames(workDocumentTemplates)
  // normalizedProjects 存储状态归一化后的全部项目。
  const normalizedProjects = result.projects.map(normalizeProject)
  // visibleProjects 存储过滤后的真实业务项目。
  const visibleProjects = normalizedProjects.filter(
    (project) =>
      !isRootWorkDocument(project, taskDir, skippedNames) &&
      !isUncheckableProject(project)
  )
  // emptyTaskDirResult 标记旧缓存中的空任务目录场景。
  const emptyTaskDirResult = isEmptyTaskDirResult(result)
  // summary 存储基于可见项目重算的摘要。
  const summary = summarizeProjects(visibleProjects)
  // currentSummary 存储原始摘要。
  const currentSummary = result.summary || {}
  // summaryChanged 标记空目录摘要是否需要修正。
  const summaryChanged =
    emptyTaskDirResult &&
    (currentSummary.status !== summary.status ||
      currentSummary.projectCount !== summary.projectCount ||
      currentSummary.issueCount !== summary.issueCount ||
      currentSummary.message !== summary.message)
  // emptyChecksChanged 标记空目录顶层检查项是否需要修正。
  const emptyChecksChanged =
    emptyTaskDirResult &&
    ['deps', 'ports', 'services', 'git'].some(
      (key) => result?.[key]?.status !== 'ok'
    )
  // changed 标记归一化是否实际改变数据。
  const changed =
    visibleProjects.length !== result.projects.length ||
    normalizedProjects.some(
      (project, index) => project !== result.projects[index]
    ) ||
    summaryChanged ||
    emptyChecksChanged
  if (!changed) return result
  if (!emptyTaskDirResult)
    return { ...result, projects: visibleProjects, summary }
  // emptyCheck 存储空任务目录的说明状态。
  const emptyCheck = {
    status: 'ok',
    message: '任务目录下未找到项目',
    fixes: [],
  }
  return {
    ...result,
    deps: emptyCheck,
    ports: emptyCheck,
    services: emptyCheck,
    git: emptyCheck,
    projects: visibleProjects,
    summary,
  }
}

/**
 * 归一化任务环境检查缓存映射。
 * @param {Record<string,object>} map - 环境检查缓存映射
 * @param {Array<{task:string,path:string}>} tasks - 当前任务列表
 * @param {Array<{path?:string}>} workDocumentTemplates - 工作文档模板
 * @returns {Record<string,object>} 归一化缓存映射
 */
export function normalizeEnvHealthMapForDisplay(
  map,
  tasks,
  workDocumentTemplates = []
) {
  // sourceMap 存储安全归一化后的缓存映射。
  const sourceMap =
    map && typeof map === 'object' && !Array.isArray(map) ? map : {}
  // taskDirByName 存储任务名到任务目录的映射。
  const taskDirByName = new Map(
    (Array.isArray(tasks) ? tasks : []).map((task) => [task.task, task.path])
  )
  // normalizedMap 存储归一化后的缓存映射。
  const normalizedMap = {}
  for (const [taskName, entry] of Object.entries(sourceMap)) {
    // taskDir 存储当前任务目录。
    const taskDir = taskDirByName.get(taskName) || entry?.taskDir || ''
    if (!entry || typeof entry !== 'object') {
      normalizedMap[taskName] = entry
      continue
    }
    // isChecking 标记正在执行中的临时状态。
    const isChecking = entry.status === 'checking'
    if (!isChecking && entry.version !== ENV_HEALTH_CACHE_VERSION) {
      normalizedMap[taskName] = {
        ...entry,
        status: 'idle',
        issueCount: 0,
        result: null,
        stale: true,
        taskDir: taskDir || entry.taskDir,
      }
      continue
    }
    // normalizedResult 存储当前条目的归一化检查结果。
    const normalizedResult = normalizeEnvHealthResultForDisplay(
      entry.result,
      taskDir || entry.taskDir,
      workDocumentTemplates
    )
    normalizedMap[taskName] = {
      ...entry,
      status: normalizedResult
        ? getEnvStatusFromResult(normalizedResult)
        : entry.status,
      issueCount:
        normalizedResult?.summary?.issueCount ?? entry.issueCount ?? 0,
      result: normalizedResult,
    }
  }
  return normalizedMap
}

/**
 * 拼出任务目录路径。
 * @param {string} root - Worktree 根目录
 * @param {string} taskName - 任务名
 * @returns {string} 任务目录绝对路径
 */
export function buildTaskDir(root, taskName) {
  // cleanRoot 存储去掉末尾斜杠后的根目录。
  const cleanRoot = String(root || '').replace(/\/+$/, '')
  // cleanTask 存储去掉开头斜杠后的任务名。
  const cleanTask = String(taskName || '').replace(/^\/+/, '')
  return cleanRoot && cleanTask ? `${cleanRoot}/${cleanTask}` : ''
}

/**
 * 生成任务环境自动检查的会话内去重 key。
 * @param {object} task - 任务分组项
 * @returns {string} 稳定去重 key
 */
export function getEnvAutoCheckKey(task) {
  // taskName 存储任务名。
  const taskName = String(task?.task || '')
  // taskPath 存储任务目录。
  const taskPath = String(task?.path || '')
  return `${taskName}::${taskPath}`
}

/**
 * 根据环境检查结果构造任务缓存条目。
 * @param {object} task - 任务分组项
 * @param {object} result - 环境检查结果
 * @param {Array<{path?:string}>} workDocumentTemplates - 工作文档模板
 * @returns {object} 环境检查缓存条目
 */
export function makeEnvHealthEntry(task, result, workDocumentTemplates = []) {
  // normalizedResult 存储过滤非业务目录后的检查结果。
  const normalizedResult = normalizeEnvHealthResultForDisplay(
    result,
    task.path,
    workDocumentTemplates
  )
  return {
    version: ENV_HEALTH_CACHE_VERSION,
    status: getEnvStatusFromResult(normalizedResult),
    issueCount: normalizedResult?.summary?.issueCount || 0,
    result: normalizedResult,
    taskDir: task.path,
    checkedAt: new Date().toISOString(),
  }
}

/**
 * 根据异常构造环境检查失败缓存条目。
 * @param {object} task - 任务分组项
 * @param {Error} error - 检查异常
 * @returns {object} 环境检查失败条目
 */
export function makeEnvHealthErrorEntry(task, error) {
  // message 存储用户可见的异常信息。
  const message = error?.message || '环境检查失败'
  return {
    version: ENV_HEALTH_CACHE_VERSION,
    status: 'failed',
    issueCount: 1,
    error: message,
    result: { error: message },
    taskDir: task.path,
    checkedAt: new Date().toISOString(),
  }
}
