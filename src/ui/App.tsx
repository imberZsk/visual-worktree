import React, { useEffect, useState, useMemo, useRef } from 'react'
import {
  Layout,
  Input,
  Segmented,
  Button,
  Space,
  Statistic,
  Row,
  Col,
  Card,
  Modal,
  Progress,
  App as AntApp,
  Dropdown,
  Grid,
  Tooltip,
  Spin,
  theme,
  List,
  Typography,
  Tag,
  Pagination,
  Select,
} from 'antd'
import {
  ReloadOutlined,
  SettingOutlined,
  DownOutlined,
  PlusOutlined,
  SunOutlined,
  MoonOutlined,
  HistoryOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons'
import { useStore } from './store/useStore.ts'
import { filterProjects, summarize, FILTERS } from './projectLogic.ts'
import {
  computeActiveKeysAfterCreate,
  STATUS_SORT_ORDER,
  getTaskStatusMeta,
  normalizeTaskLinkItems,
  quotePathForCopy,
} from './worktreeLogic.ts'
import {
  normalizeWorkflowSteps,
  DEFAULT_WORKFLOW_STEPS,
} from './workflowLogic.ts'
import { getRunnableWorkflowSteps } from './workflowRunLogic.ts'
import {
  filterVisibleItems,
  hasVisibilityKey,
  normalizeTaskTitleBadges,
  prepareVisibleItems,
} from './visibilityLogic.ts'
import {
  computeHistoryPageSize,
  getHistoryGlobalIndex,
  HISTORY_PAGE_SIZE_FALLBACK,
} from './historyPaginationLogic.ts'
import {
  isStepEventFor,
  appendStepChunk,
  stepRunKey,
} from '../core/stepOutputLog.js'
import { api } from './api.ts'
import { withConfirmDefaults } from './modalDefaults.ts'
import ProjectTable from './components/ProjectTable.tsx'
import ProjectDetail from './components/ProjectDetail.tsx'
import SettingsModal from './components/SettingsModal.tsx'
import WorktreePanel from './components/WorktreePanel.tsx'
import CreateWorktreeModal from './components/CreateWorktreeModal.tsx'
import CleanupSuggestionsModal from './components/CleanupSuggestionsModal.tsx'
import KanbanView from './components/KanbanView.tsx'
import WorkflowTabView from './components/WorkflowTabView.tsx'
import { VscodeIcon } from './icons.tsx'
import SingleLineText from './components/SingleLineText.tsx'

const { Header, Content } = Layout
// 响应式断点 hook：用于根据屏幕宽度调整布局
const { useBreakpoint } = Grid
// 步骤执行输出 Modal 的层级：需高于流程弹层和常规浮层，避免被操作界面盖住。
const STEP_OUTPUT_MODAL_Z_INDEX = 1400

// HIDE_ANIMATION_MS 存储隐藏项退出动画时长；App 在动画结束后再写入隐藏偏好，让列表优雅消失。
const HIDE_ANIMATION_MS = 180

// 环境检查项中文名映射：详情弹窗按项目展示时复用
const ENV_CHECK_LABELS = {
  deps: '依赖',
  ports: '端口',
  services: '服务',
  git: 'Git',
}

// ENV_ISSUE_CHECK_KEYS 存储会计入环境问题的检查项；Git 状态只作为明细提示展示。
const ENV_ISSUE_CHECK_KEYS = ['deps', 'ports', 'services']

// ENV_PROJECT_PAGE_SIZE 存储环境检查详情中每页展示的项目卡片数量，避免弹窗被过多卡片撑高。
const ENV_PROJECT_PAGE_SIZE = 2

// ENV_PROJECT_STATUS_SORT_ORDER 存储环境检查详情的项目排序权重，优先把错误和警告项目放在第一页。
const ENV_PROJECT_STATUS_SORT_ORDER = { failed: 0, warning: 1, ok: 2 }

// ENV_HEALTH_CACHE_VERSION 存储环境检查缓存结构版本；识别规则升级后旧缓存必须重新检查。
const ENV_HEALTH_CACHE_VERSION = 4

// DEFAULT_WORK_DOCUMENT_ENTRY_NAMES 存储环境检查展示层默认跳过的任务根级工作文档入口。
const DEFAULT_WORK_DOCUMENT_ENTRY_NAMES = ['docs']

/**
 * 计算环境检查展示时需要跳过的任务根级工作文档入口名。
 * @param {Array<{path?:string}>} [workDocumentTemplates] - 用户配置的工作文档模板
 * @returns {Set<string>} 需要过滤的第一层目录名
 */
function getSkippedEnvWorkDocumentEntryNames(workDocumentTemplates = []) {
  // skippedNames 存储默认 docs 与用户配置模板的第一层目录名。
  const skippedNames = new Set(DEFAULT_WORK_DOCUMENT_ENTRY_NAMES)
  // templates 存储待读取的用户模板数组；配置损坏时按空数组处理。
  const templates = Array.isArray(workDocumentTemplates)
    ? workDocumentTemplates
    : []

  for (const template of templates) {
    // normalizedPath 存储统一分隔符后的模板相对路径文本。
    const normalizedPath = String(template?.path || '')
      .trim()
      .replace(/\\/g, '/')
    // firstSegment 存储模板在任务根目录下的第一层入口名。
    const firstSegment = normalizedPath.split('/').filter(Boolean)[0]
    if (
      firstSegment &&
      firstSegment !== '..' &&
      !normalizedPath.startsWith('/')
    )
      skippedNames.add(firstSegment)
  }

  return skippedNames
}

/**
 * 判断环境检查项目是否为任务根级工作文档目录。
 * @param {object} project - 环境检查项目结果
 * @param {string} taskDir - 任务根目录
 * @param {Set<string>} skippedNames - 需要跳过的工作文档入口名集合
 * @returns {boolean} 是否应从展示结果中剔除
 */
function isRootWorkDocumentEnvProject(project, taskDir, skippedNames) {
  // projectName 存储项目显示名，通常等于任务根目录下一层目录名。
  const projectName = String(project?.name || '').trim()
  if (!projectName || !skippedNames.has(projectName)) return false

  // cleanTaskDir 存储去掉末尾斜杠后的任务根目录，用于精确匹配根级 docs。
  const cleanTaskDir = String(taskDir || '').replace(/\/+$/, '')
  // projectPath 存储项目路径；兼容核心层旧字段 dir 与新字段 path。
  const projectPath = String(project?.path || project?.dir || '').replace(
    /\/+$/,
    ''
  )
  // expectedPath 存储工作文档入口在任务根目录下应有的绝对路径。
  const expectedPath = cleanTaskDir ? `${cleanTaskDir}/${projectName}` : ''

  return !projectPath || !expectedPath || projectPath === expectedPath
}

/**
 * 判断环境检查项目是否为旧缓存里的 unknown 非业务目录。
 * @param {object} project - 环境检查项目结果
 * @returns {boolean} 是否应从展示结果中剔除
 */
function isUncheckableEnvProject(project) {
  // kind 存储核心层识别出的项目类型；unknown 表示未命中前端/后端/小程序特征。
  const kind = String(project?.kind || '').toLowerCase()
  // kindLabel 存储旧缓存可能只有中文标签的情况。
  const kindLabel = String(project?.kindLabel || '').trim()
  return kind === 'unknown' || kindLabel === '未知'
}

/**
 * 根据环境检查项状态计算项目级展示状态。
 * @param {object} project - 环境检查项目结果
 * @returns {'ok'|'warning'|'failed'} 项目级展示状态
 */
function getEnvProjectDisplayStatus(project) {
  // checks 存储项目内各检查项结果；旧缓存可能只有部分检查项。
  const checks =
    project?.checks && typeof project.checks === 'object' ? project.checks : {}
  // envCheckStatuses 存储真正环境检查项的有效状态，排除 Git 工作区提示。
  const envCheckStatuses = ENV_ISSUE_CHECK_KEYS.map(
    (key) => checks[key]?.status
  ).filter(Boolean)
  // hasError 存储是否存在真正错误项；只有 error 才应红色展示。
  const hasError = envCheckStatuses.includes('error')
  if (hasError) return 'failed'
  // hasWarning 存储是否存在环境 warning 项；Git 未提交改动不再影响环境状态。
  const hasWarning = envCheckStatuses.includes('warning')
  if (hasWarning) return 'warning'
  // hasAnyCheck 存储是否存在结构化检查项；没有检查项的极旧缓存继续尊重原状态。
  const hasAnyCheck = Object.keys(checks).length > 0
  // currentStatus 存储核心层或旧缓存中已有的项目状态。
  const currentStatus = project?.status
  if (
    !hasAnyCheck &&
    (currentStatus === 'warning' || currentStatus === 'failed')
  )
    return currentStatus
  return 'ok'
}

/**
 * 统计单项目真正计入环境问题的检查项数量。
 * @param {object} project - 环境检查项目结果
 * @returns {number} 环境问题数量
 */
function countEnvProjectIssues(project) {
  // checks 存储项目内各检查项结果；旧缓存可能只有 Git 或部分字段。
  const checks =
    project?.checks && typeof project.checks === 'object' ? project.checks : {}
  return ENV_ISSUE_CHECK_KEYS.reduce((sum, key) => {
    // status 存储当前环境检查项状态，缺失时不从旧缓存凭空制造问题。
    const status = checks[key]?.status
    return status && status !== 'ok' ? sum + 1 : sum
  }, 0)
}

/**
 * 归一化单项目环境检查结果，修正旧缓存把 Git warning-only 计成环境问题的情况。
 * @param {object} project - 环境检查项目结果
 * @returns {object} 已归一化的项目结果
 */
function normalizeEnvProjectForDisplay(project) {
  // status 存储基于检查项状态重新计算后的展示状态。
  const status = getEnvProjectDisplayStatus(project)
  // issueCount 存储基于真正环境检查项重算后的问题数量。
  const issueCount = countEnvProjectIssues(project)
  if (status === project?.status && issueCount === (project?.issueCount || 0))
    return project
  return { ...project, status, issueCount }
}

/**
 * 基于过滤后的项目列表重算环境检查摘要。
 * @param {Array<{name:string,status:string,issueCount:number}>} projects - 已过滤的项目检查结果
 * @returns {{status:'ok'|'warning'|'failed',projectCount:number,issueCount:number,failedProjects:string[],message:string}} 展示摘要
 */
function summarizeVisibleEnvProjects(projects) {
  // projectCount 存储过滤后真实项目数量。
  const projectCount = projects.length
  // issueCount 存储过滤后项目的问题总数。
  const issueCount = projects.reduce(
    (sum, project) => sum + (project.issueCount || 0),
    0
  )
  // failedProjects 保留历史字段名，实际存储过滤后仍有问题的项目名。
  const failedProjects = projects
    .filter((project) => project.status !== 'ok')
    .map((project) => project.name)
  // hasFailed 存储是否存在真正错误项目。
  const hasFailed = projects.some((project) => project.status === 'failed')
  // hasWarning 存储是否存在 warning-only 项目。
  const hasWarning = projects.some((project) => project.status === 'warning')
  // status 存储任务级展示状态：error 红色，warning 黄色，全部正常绿色。
  const status = hasFailed
    ? 'failed'
    : hasWarning || issueCount > 0
      ? 'warning'
      : 'ok'
  // message 存储详情顶部摘要文案，与核心层摘要文案保持一致。
  const message =
    projectCount === 0
      ? '任务目录下未找到项目'
      : status === 'ok'
        ? `${projectCount} 个项目环境正常`
        : `${failedProjects.length} 个项目存在 ${issueCount} 个环境问题`
  return { status, projectCount, issueCount, failedProjects, message }
}

/**
 * 判断环境检查结果是否为旧缓存里的空任务目录结果。
 * @param {object} result - 环境检查结果
 * @returns {boolean} 是否为“任务目录下未找到项目”场景
 */
function isEmptyTaskDirEnvResult(result) {
  // summary 存储任务级摘要；旧缓存可能把空目录摘要写成 failed/issueCount=1。
  const summary = result?.summary || {}
  return (
    Array.isArray(result?.projects) &&
    result.projects.length === 0 &&
    summary.projectCount === 0 &&
    summary.message === '任务目录下未找到项目'
  )
}

/**
 * 归一化环境检查结果，过滤旧缓存或旧主进程写入的根级工作文档目录和 unknown 非业务目录。
 * @param {object} result - 环境检查结果
 * @param {string} taskDir - 任务根目录
 * @param {Array<{path?:string}>} [workDocumentTemplates] - 用户配置的工作文档模板
 * @returns {object} 已过滤并重算摘要的环境检查结果
 */
function normalizeEnvHealthResultForDisplay(
  result,
  taskDir,
  workDocumentTemplates = []
) {
  if (!Array.isArray(result?.projects)) return result

  // skippedNames 存储需要从旧结果里过滤掉的工作文档入口名。
  const skippedNames = getSkippedEnvWorkDocumentEntryNames(
    workDocumentTemplates
  )
  // normalizedProjects 存储修正过状态的项目结果，用于兼容旧缓存。
  const normalizedProjects = result.projects.map((project) =>
    normalizeEnvProjectForDisplay(project)
  )
  // visibleProjects 存储过滤后的真实项目检查结果。
  const visibleProjects = normalizedProjects.filter(
    (project) =>
      !isRootWorkDocumentEnvProject(project, taskDir, skippedNames) &&
      !isUncheckableEnvProject(project)
  )
  // emptyTaskDirResult 标记旧缓存中的空任务目录结果；它需要清掉历史 failed/issueCount=1。
  const emptyTaskDirResult = isEmptyTaskDirEnvResult(result)
  // summary 存储基于真实项目重算后的摘要，避免旧缓存继续显示“3 个项目”或空目录环境问题。
  const summary = summarizeVisibleEnvProjects(visibleProjects)
  // currentSummary 存储原始摘要，用于判断旧缓存是否需要重写摘要字段。
  const currentSummary = result.summary || {}
  // summaryChanged 标记空任务目录旧摘要是否仍保留 failed/issueCount=1 等旧状态。
  const summaryChanged =
    emptyTaskDirResult &&
    (currentSummary.status !== summary.status ||
      currentSummary.projectCount !== summary.projectCount ||
      currentSummary.issueCount !== summary.issueCount ||
      currentSummary.message !== summary.message)
  // emptyChecksChanged 标记空任务目录旧顶层检查项是否仍是 warning/failed。
  const emptyChecksChanged =
    emptyTaskDirResult &&
    ['deps', 'ports', 'services', 'git'].some(
      (key) => result?.[key]?.status !== 'ok'
    )
  // changed 标记本次归一化是否实际改动了项目列表、项目状态或空目录摘要。
  const changed =
    visibleProjects.length !== result.projects.length ||
    normalizedProjects.some(
      (project, index) => project !== result.projects[index]
    ) ||
    summaryChanged ||
    emptyChecksChanged
  if (!changed) return result

  if (emptyTaskDirResult) {
    // emptyCheck 存储空任务目录的顶层检查项状态；它是说明，不是环境问题。
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

  return { ...result, projects: visibleProjects, summary }
}

/**
 * 归一化单条任务环境检查缓存，供任务列表直接展示。
 * @param {object} entry - 任务环境检查缓存条目
 * @param {string} taskDir - 任务根目录
 * @param {Array<{path?:string}>} [workDocumentTemplates] - 用户配置的工作文档模板
 * @returns {object} 已归一化的缓存条目
 */
function normalizeEnvHealthEntryForDisplay(
  entry,
  taskDir,
  workDocumentTemplates = []
) {
  if (!entry || typeof entry !== 'object') return entry
  // isChecking 标记正在执行中的临时态；旧临时态没有版本号时仍继续展示 loading。
  const isChecking = entry.status === 'checking'
  // isCurrentVersion 标记缓存是否由当前识别规则生成；旧缓存可能缺 PHP/Java/Python 后端项目，不能继续直接展示。
  const isCurrentVersion = entry.version === ENV_HEALTH_CACHE_VERSION
  if (!isChecking && !isCurrentVersion) {
    return {
      ...entry,
      status: 'idle',
      issueCount: 0,
      result: null,
      stale: true,
      taskDir: taskDir || entry.taskDir,
    }
  }
  // normalizedResult 存储过滤工作文档并修正 warning-only 状态后的检查结果。
  const normalizedResult = normalizeEnvHealthResultForDisplay(
    entry.result,
    taskDir || entry.taskDir,
    workDocumentTemplates
  )
  // status 存储任务行应展示的状态。
  const status = normalizedResult
    ? getEnvStatusFromResult(normalizedResult)
    : entry.status
  // issueCount 存储任务行问题数量，优先使用归一化后的摘要。
  const issueCount =
    normalizedResult?.summary?.issueCount ?? entry.issueCount ?? 0
  return { ...entry, status, issueCount, result: normalizedResult }
}

/**
 * 归一化任务环境检查缓存映射，兼容旧缓存并保护任务列表颜色。
 * @param {Record<string,object>} map - 任务名到环境检查缓存的映射
 * @param {Array<{task:string,path:string}>} tasks - 当前任务列表
 * @param {Array<{path?:string}>} [workDocumentTemplates] - 用户配置的工作文档模板
 * @returns {Record<string,object>} 已归一化的映射
 */
function normalizeEnvHealthMapForDisplay(
  map,
  tasks,
  workDocumentTemplates = []
) {
  // sourceMap 存储待归一化的缓存映射，配置损坏时回退空对象。
  const sourceMap =
    map && typeof map === 'object' && !Array.isArray(map) ? map : {}
  // taskDirByName 存储任务名到任务根目录的映射，用于识别根级 docs。
  const taskDirByName = new Map(
    (Array.isArray(tasks) ? tasks : []).map((task) => [task.task, task.path])
  )
  // normalizedMap 存储归一化后的缓存映射。
  const normalizedMap = {}

  for (const [taskName, entry] of Object.entries(sourceMap)) {
    // taskDir 存储当前任务对应的根目录；没有当前任务时退回缓存里的 taskDir。
    const taskDir = taskDirByName.get(taskName) || entry?.taskDir || ''
    normalizedMap[taskName] = normalizeEnvHealthEntryForDisplay(
      entry,
      taskDir,
      workDocumentTemplates
    )
  }

  return normalizedMap
}

/**
 * 拼出任务目录路径，避免渲染进程引入 Node path 依赖。
 * @param {string} root - worktree 根目录
 * @param {string} taskName - 任务名
 * @returns {string} 任务目录绝对路径；缺参时返回空字符串
 */
function buildTaskDir(root, taskName) {
  // cleanRoot 为去掉末尾斜杠后的根目录，避免拼出双斜杠
  const cleanRoot = String(root || '').replace(/\/+$/, '')
  // cleanTask 为任务名字符串，允许包含子路径片段
  const cleanTask = String(taskName || '').replace(/^\/+/, '')
  if (!cleanRoot || !cleanTask) return ''
  return `${cleanRoot}/${cleanTask}`
}

/**
 * 生成任务环境自动检查的会话内去重 key。
 * @param {object} task - 任务分组项（含 task/path）
 * @returns {string} 任务名与路径组成的稳定 key
 */
function getEnvAutoCheckKey(task) {
  // taskName 存储任务名；同名不同路径时仍需区分。
  const taskName = String(task?.task || '')
  // taskPath 存储任务目录路径；刷新后同一任务路径一致时只自动检查一次。
  const taskPath = String(task?.path || '')
  return `${taskName}::${taskPath}`
}

/**
 * 将核心环境检查结果转换成任务行状态。
 * @param {object} result - checkEnvHealth 返回结果
 * @returns {'ok'|'warning'|'failed'} 任务行状态
 */
function getEnvStatusFromResult(result) {
  // status 存储核心层汇总状态，旧结构缺失时按 failed 兜底。
  const status = result?.summary?.status
  return status === 'ok' || status === 'warning' || status === 'failed'
    ? status
    : 'failed'
}

/**
 * 根据环境检查结果构造任务级缓存条目。
 * @param {object} task - 任务分组项（含 task/path）
 * @param {object} result - checkEnvHealth 返回结果
 * @param {Array<{path?:string}>} [workDocumentTemplates] - 用户配置的工作文档模板
 * @returns {object} envHealthMap 条目
 */
function makeEnvHealthEntry(task, result, workDocumentTemplates = []) {
  // normalizedResult 存储过滤掉根级工作文档目录后的检查结果，用于兼容旧缓存/旧主进程返回。
  const normalizedResult = normalizeEnvHealthResultForDisplay(
    result,
    task.path,
    workDocumentTemplates
  )
  // status 为任务行展示的红/黄/绿状态
  const status = getEnvStatusFromResult(normalizedResult)
  // issueCount 为任务级问题数，非 ok 标签展示用
  const issueCount = normalizedResult?.summary?.issueCount || 0
  return {
    version: ENV_HEALTH_CACHE_VERSION,
    status,
    issueCount,
    result: normalizedResult,
    taskDir: task.path,
    checkedAt: new Date().toISOString(),
  }
}

/**
 * 根据异常构造任务级环境检查失败条目。
 * @param {object} task - 任务分组项（含 task/path）
 * @param {Error} error - 检查异常
 * @returns {object} envHealthMap 条目
 */
function makeEnvHealthErrorEntry(task, error) {
  // message 为用户可见的异常信息
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

/**
 * 把检查项状态映射为 antd Tag 颜色。
 * @param {string} status - 检查项状态 ok/warning/error
 * @returns {string} antd Tag color
 */
function getCheckTagColor(status) {
  return status === 'ok'
    ? 'success'
    : status === 'warning'
      ? 'warning'
      : 'error'
}

/**
 * 判断环境检查项是否应在详情中隐藏。
 * @param {string} key - 检查项 key
 * @param {object} item - 检查项结果
 * @returns {boolean} 是否隐藏
 */
function shouldHideEnvCheckItem(key, item) {
  // 端口未声明只是“没有检查依据”，不是环境问题；按用户反馈从详情里隐藏
  if (
    key === 'ports' &&
    (item?.skipped || item?.message === '未在 scripts 中发现端口声明')
  )
    return true
  return false
}

/**
 * 环境检查详情内容：优先展示项目级自动识别结果，旧结构作为兜底继续兼容。
 * @param {object} props - 组件属性
 * @param {object} props.result - 环境检查结果
 * @param {object} props.token - antd 主题 token
 * @returns {JSX.Element|null} 详情内容
 */
function EnvHealthResultContent({ result, token }) {
  // projectPage 存储环境检查项目卡片当前页码。
  const [projectPage, setProjectPage] = useState(1)
  useEffect(() => {
    setProjectPage(1)
  }, [result])

  if (!result) return null
  if (result.error)
    return <div style={{ color: token.colorError }}>{result.error}</div>

  // hasProjectDetails 标记核心层是否返回了新项目级结构
  const hasProjectDetails = Array.isArray(result.projects)
  if (hasProjectDetails) {
    // summary 为任务级汇总，缺失时给出兜底结构
    const summary = result.summary || {
      status: 'failed',
      projectCount: result.projects.length,
      issueCount: 0,
      message: '环境检查完成',
    }
    // summaryColor 为顶部摘要标签颜色：warning 黄色，failed 红色。
    const summaryColor =
      summary.status === 'ok'
        ? 'success'
        : summary.status === 'warning'
          ? 'warning'
          : 'error'
    // allProjects 存储全部可展示项目检查结果；有问题的项目前置，避免分页时真正需要处理的卡片藏到后一页。
    const allProjects = [...result.projects].sort(
      (a, b) =>
        (ENV_PROJECT_STATUS_SORT_ORDER[a.status] ?? 3) -
        (ENV_PROJECT_STATUS_SORT_ORDER[b.status] ?? 3)
    )
    // totalPages 存储项目卡片总页数，用于修正缓存切换后的越界页码。
    const totalPages = Math.max(
      1,
      Math.ceil(allProjects.length / ENV_PROJECT_PAGE_SIZE)
    )
    // safeProjectPage 存储不会超过总页数的当前页码。
    const safeProjectPage = Math.min(projectPage, totalPages)
    // visibleProjects 存储当前页实际展示的项目卡片。
    const visibleProjects = allProjects.slice(
      (safeProjectPage - 1) * ENV_PROJECT_PAGE_SIZE,
      safeProjectPage * ENV_PROJECT_PAGE_SIZE
    )
    // showProjectPagination 标记是否需要分页；分页器放在卡片前，避免最后一页项目数变少时按钮跟着跳动。
    const showProjectPagination = allProjects.length > ENV_PROJECT_PAGE_SIZE
    // projectListMinHeight 存储分页列表的最小高度，让奇数项目的最后一页仍保持稳定的内容区域。
    const projectListMinHeight = showProjectPagination ? 240 : undefined
    return (
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              minWidth: 0,
            }}
          >
            <Tag color={summaryColor} style={{ marginInlineEnd: 0 }}>
              {summary.status === 'ok'
                ? '环境正常'
                : `${summary.issueCount || 1} 个环境问题`}
            </Tag>
            <Typography.Text>{summary.message}</Typography.Text>
          </div>
          {showProjectPagination && (
            <Pagination
              size="small"
              current={safeProjectPage}
              pageSize={ENV_PROJECT_PAGE_SIZE}
              total={allProjects.length}
              showSizeChanger={false}
              onChange={(page) => setProjectPage(page)}
            />
          )}
        </div>
        <div
          style={{ display: 'grid', gap: 12, minHeight: projectListMinHeight }}
        >
          {visibleProjects.map((project) => {
            // projectStatusColor 为单项目状态标签颜色：warning 黄色，failed 红色。
            const projectStatusColor =
              project.status === 'ok'
                ? 'success'
                : project.status === 'warning'
                  ? 'warning'
                  : 'error'
            // checks 为该项目 4 类检查结果
            const checks = project.checks || {}
            // reasons 为类型识别依据，限制展示前 3 条避免标题区过长
            const reasons = Array.isArray(project.reasons)
              ? project.reasons.slice(0, 3)
              : []
            return (
              <Card
                key={project.path || project.name}
                size="small"
                title={
                  <Space wrap size={6}>
                    <Typography.Text strong>{project.name}</Typography.Text>
                    <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                      {project.kindLabel || project.kind || '未知'}
                    </Tag>
                    <Tag
                      color={projectStatusColor}
                      style={{ marginInlineEnd: 0 }}
                    >
                      {project.status === 'ok'
                        ? '正常'
                        : `${project.issueCount || 1} 个问题`}
                    </Tag>
                  </Space>
                }
              >
                <Space
                  orientation="vertical"
                  size={8}
                  style={{ width: '100%' }}
                >
                  {reasons.length > 0 && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      识别依据：{reasons.join('、')}
                    </Typography.Text>
                  )}
                  {['deps', 'ports', 'services', 'git'].map((key) => {
                    // item 为当前检查项结果，缺失时按错误兜底展示
                    const item = checks[key] || {
                      status: 'error',
                      message: '检查结果缺失',
                      fixes: [],
                    }
                    if (shouldHideEnvCheckItem(key, item)) return null
                    return (
                      <div
                        key={key}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 8,
                        }}
                      >
                        <Tag
                          color={getCheckTagColor(item.status)}
                          style={{ flex: '0 0 auto', marginInlineEnd: 0 }}
                        >
                          {ENV_CHECK_LABELS[key]}
                        </Tag>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <Typography.Text>{item.message}</Typography.Text>
                          {item.fixes && item.fixes.length > 0 && (
                            <ul
                              style={{
                                marginTop: 4,
                                marginBottom: 0,
                                paddingInlineStart: 18,
                              }}
                            >
                              {item.fixes.map((fix, idx) => (
                                <li key={idx}>
                                  <Typography.Text type="secondary">
                                    {fix}
                                  </Typography.Text>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </Space>
              </Card>
            )
          })}
        </div>
      </Space>
    )
  }

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      {['deps', 'ports', 'services', 'git'].map((key) => {
        // item 为旧结构下该项检查结果；结果异常缺失时兜底，避免 item.status 取值崩溃
        const item = result[key] || {
          status: 'error',
          message: '无结果',
          fixes: [],
        }
        if (shouldHideEnvCheckItem(key, item)) return null
        return (
          <Card key={key} size="small" title={ENV_CHECK_LABELS[key]}>
            <Space orientation="vertical" size={8} style={{ width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag color={getCheckTagColor(item.status)}>
                  {String(item.status || '').toUpperCase()}
                </Tag>
                <Typography.Text>{item.message}</Typography.Text>
              </div>
              {item.fixes && item.fixes.length > 0 && (
                <div>
                  <Typography.Text type="secondary">修复建议：</Typography.Text>
                  <ul style={{ marginTop: 4, marginBottom: 0 }}>
                    {item.fixes.map((fix, idx) => (
                      <li key={idx}>{fix}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Space>
          </Card>
        )
      })}
    </Space>
  )
}

/**
 * 历史任务单行文本：复用全局单行 Tooltip 组件，内容过长时不撑高列表，悬停查看完整文案。
 * @param {object} props - 组件入参
 * @param {string} props.text - 列表中展示的完整文本
 * @param {string} props.className - 应用于列表文本元素的样式类名
 * @param {boolean} [props.strong] - 是否按粗体任务名展示
 * @param {boolean} [props.isLink] - 是否按链接样式展示
 * @param {() => void} [props.onClick] - 链接点击回调
 * @returns {JSX.Element} 历史任务单行文本
 */
function HistorySingleLineText({
  text,
  className,
  strong = false,
  isLink = false,
  onClick,
}) {
  // displayText 存储字符串化后的历史任务文本，兼容旧数据中的空值。
  const displayText = String(text || '')
  // Component 存储历史任务文本的渲染组件；链接继续使用 antd Typography.Link 的交互样式。
  const Component = isLink ? Typography.Link : 'span'
  // textStyle 存储历史任务文本的附加样式；核心省略样式由 SingleLineText 统一提供。
  const textStyle = {
    fontSize: isLink ? 12 : undefined,
    fontWeight: strong ? 600 : undefined,
  }
  /**
   * 处理历史链接点击：阻止 Typography.Link 默认跳转后交给应用统一外链打开逻辑。
   * @param {React.MouseEvent} event - 链接点击事件
   */
  const handleClick = (event) => {
    if (!isLink) return
    event.preventDefault()
    onClick?.()
  }

  return (
    <SingleLineText
      text={displayText}
      className={className}
      as={Component}
      style={textStyle}
      tooltipPlacement="topLeft"
      onClick={isLink ? handleClick : undefined}
    />
  )
}

// 主应用组件：组合工具栏、统计卡片、项目表格、详情抽屉、设置弹窗与批量操作。
export default function App() {
  // 从全局 store 取状态与动作
  const {
    projects,
    loading,
    filter,
    keyword,
    selectedPaths,
    batchProgress,
    config,
  } = useStore()
  const {
    worktreeTasks,
    worktreeLoading,
    theme: themeMode,
    taskStatusMap,
    taskLinkMap,
    taskWorkflowMap,
    taskBlockerMap,
    taskEnvHealthMap,
    runningSteps,
    taskVisibility,
    projectVisibility,
  } = useStore()
  const {
    setFilter,
    setKeyword,
    setSelectedPaths,
    scan,
    loadConfig,
    runBatch,
    scanWorktrees,
    toggleTheme,
    setTaskStatus,
    loadTaskStatus,
    setTaskLink,
    loadTaskLinks,
    toggleWorkflowStep,
    loadTaskWorkflow,
    setTaskBlocker,
    loadTaskBlockers,
    setTaskEnvHealthMap,
    loadTaskEnvHealth,
    startRunningStep,
    finishRunningStep,
    loadTaskVisibility,
    loadProjectVisibility,
    setTaskHidden,
    setTaskPinned,
    setProjectHidden,
    setProjectPinned,
  } = useStore()
  // 从 AntApp 上下文取 message/modal，使提示与确认框跟随明暗主题（替代脱离上下文的静态方法）
  const { message, modal } = AntApp.useApp()
  // 取当前主题 token，用于替换写死的颜色，使 Header 等区域跟随明暗主题
  const { token } = theme.useToken()
  // detailProject 当前查看详情的项目
  const [detailProject, setDetailProject] = useState(null)
  // settingsOpen 设置弹窗开关
  const [settingsOpen, setSettingsOpen] = useState(false)
  // activeView 当前主视图：'worktrees'|'projects'|'kanban'|'workflow'，持久化到 localStorage 避免刷新后跳回 worktrees
  const [activeView, setActiveView] = useState(
    () => localStorage.getItem('vw-active-view') || 'worktrees'
  )
  // createWtOpen 创建 worktree 弹窗开关
  const [createWtOpen, setCreateWtOpen] = useState(false)
  // createWtDefaultTask 从任务行点击「+」时预填的任务名；null 表示全新创建
  const [createWtDefaultTask, setCreateWtDefaultTask] = useState(null)
  // worktreeActiveKeys 受控的 worktree 任务面板展开集合（任务名数组）；
  // 初值 [] 表示全部收起，刷新后保持收起态
  const [worktreeActiveKeys, setWorktreeActiveKeys] = useState([])
  // historyOpen 已删除任务历史弹窗开关
  const [historyOpen, setHistoryOpen] = useState(false)
  // taskHistory 已删除任务历史列表（{ task, link, status, deletedAt }[]，link 兼容 URL 或 {name,url} 数组）
  const [taskHistory, setTaskHistory] = useState([])
  // historyListShellRef 指向历史任务列表可用高度容器，用于根据弹层尺寸计算每页条数。
  const historyListShellRef = useRef(null)
  // historyPage 存储历史任务 antd List 当前页码，受控后可在 pageSize 变化时做边界修正。
  const [historyPage, setHistoryPage] = useState(1)
  // historyPageSize 存储历史任务每页条数，初始沿用旧版 10 条，弹层打开后按容器高度重算。
  const [historyPageSize, setHistoryPageSize] = useState(
    HISTORY_PAGE_SIZE_FALLBACK
  )
  // wtSortOrder worktree 任务排序方式：'name' 按名称（默认）| 'status' 按状态
  // wtSortOrder 默认按状态排序，便于快速看到进行中的任务
  const [wtSortOrder, setWtSortOrder] = useState('status')
  // showHiddenTasks 控制 Worktree 视图是否临时展示已隐藏任务，默认 false。
  const [showHiddenTasks, setShowHiddenTasks] = useState(false)
  // showHiddenProjects 控制项目视图是否临时展示已隐藏项目，默认 false。
  const [showHiddenProjects, setShowHiddenProjects] = useState(false)
  // hidingTaskKeys 存储正在播放隐藏退出动画的任务名列表。
  const [hidingTaskKeys, setHidingTaskKeys] = useState([])
  // hidingProjectKeys 存储正在播放隐藏退出动画的项目路径列表。
  const [hidingProjectKeys, setHidingProjectKeys] = useState([])
  // claudeUsageMap 任务名 → Claude Code 用量汇总 {sessionCount, usage, cost} 的映射，
  // 用于在 worktree 任务栏展示每个任务的 token 量与费用
  const [claudeUsageMap, setClaudeUsageMap] = useState({})
  // envHealthLoaded 标记历史环境检查缓存是否已从磁盘加载完成，避免自动检查结果被随后到达的旧缓存覆盖。
  const [envHealthLoaded, setEnvHealthLoaded] = useState(false)
  // stepOutput 当前正在展示「实时输出」的步骤执行态，null 表示无：
  // { taskName, stepKey, label, content, status:'running'|'success'|'error', code }
  // 执行开始即打开 Modal、随 STEP_OUTPUT 事件追加 content，结束后更新 status 显示成败
  const [stepOutput, setStepOutput] = useState(null)
  // cleanupOpen 清理建议模态框开关
  const [cleanupOpen, setCleanupOpen] = useState(false)
  // envHealthMap 任务名 → 环境检查状态缓存；渲染前归一化旧缓存，避免 warning-only 被历史 failed 状态染红。
  const envHealthMap = useMemo(
    () =>
      normalizeEnvHealthMapForDisplay(
        taskEnvHealthMap || {},
        worktreeTasks,
        config?.workDocumentTemplates
      ),
    [taskEnvHealthMap, worktreeTasks, config?.workDocumentTemplates]
  )
  // envCheckOpen 环境检查模态框开关
  const [envCheckOpen, setEnvCheckOpen] = useState(false)
  // envCheckResult 环境检查结果
  const [envCheckResult, setEnvCheckResult] = useState(null)
  // envCheckLoading 环境检查执行中
  const [envCheckLoading, setEnvCheckLoading] = useState(false)
  // envCheckTaskName 当前检查的任务名
  const [envCheckTaskName, setEnvCheckTaskName] = useState(null)
  // envCheckTaskDir 当前检查的任务目录
  const [envCheckTaskDir, setEnvCheckTaskDir] = useState(null)
  // projectLoadingPaths 存储正在执行「切主分支」「拉取」或「同步更新」操作的项目路径集合，用于按钮 loading 反馈。
  const [projectLoadingPaths, setProjectLoadingPaths] = useState(new Set())
  // lastStepOutputs 保存每个步骤最近一次的执行输出，key 为 stepRunKey(任务名,步骤key)。
  // WHY 用 ref：关闭 Modal 后输出不丢，用户可点步骤旁「查看」重新打开；ref 不触发重渲染，
  // 通过 lastOutputVersion 自增显式触发「查看」按钮的出现/更新。
  const lastStepOutputs = useRef({})
  // runningOutputs 保存「正在执行中」步骤的实时输出累积，key 同上。
  // WHY 独立于 stepOutput state：执行中关掉 Modal 后 stepOutput 变 null 会丢弃后续 chunk，
  // 改由此 ref 持续累积，用户点「查看实时输出」可恢复完整内容。
  const runningOutputs = useRef({})
  // autoEnvCheckedTaskKeys 记录本次 App 会话已自动触发过环境检查的任务，防止刷新状态时重复后台检查。
  const autoEnvCheckedTaskKeys = useRef(new Set())
  // projectTabInitialFetchDoneRef 记录本次 App 会话是否已在项目 Tab 自动 fetch 过远程，避免视图切换时重复拉远程。
  const projectTabInitialFetchDoneRef = useRef(false)
  // initialViewScanHandledRef 记录首屏视图扫描是否已由首次加载 effect 处理，避免挂载后的视图 effect 重复扫描。
  const initialViewScanHandledRef = useRef(false)
  // hideTaskTimers 保存任务隐藏退出动画的定时器；恢复或卸载时清理，避免过期写入隐藏状态。
  const hideTaskTimers = useRef(new Map())
  // hideProjectTimers 保存项目隐藏退出动画的定时器；恢复或卸载时清理，避免过期写入隐藏状态。
  const hideProjectTimers = useRef(new Map())
  // lastOutputVersion 每次写入 lastStepOutputs 后自增，驱动依赖它的 UI（查看按钮）刷新
  const [lastOutputVersion, setLastOutputVersion] = useState(0)
  // screens 当前命中的响应式断点集合（如 { xs:true, sm:true, ... }）
  const screens = useBreakpoint()
  // isNarrow 窄屏标记：lg 断点未命中（<992px）时为真，用于压缩 Header 与工具栏
  const isNarrow = !screens.lg
  // pathProfiles 存储当前配置里的所有路径组合；缺失时回退空数组。
  const pathProfiles = useMemo(
    () => (Array.isArray(config?.pathProfiles) ? config.pathProfiles : []),
    [config?.pathProfiles]
  )
  // activePathProfileId 存储当前启用的路径组合 id；配置缺失时回退第一组。
  const activePathProfileId =
    config?.activePathProfileId || pathProfiles[0]?.id || ''
  // pathProfileOptions 存储顶部快速切换路径组合的下拉选项。
  const pathProfileOptions = useMemo(
    () =>
      pathProfiles
        .filter((profile) => profile?.id)
        .map((profile) => ({
          value: profile.id,
          label: profile.name || profile.id,
        })),
    [pathProfiles]
  )

  // 首次加载：读配置 + 从文件加载任务状态/链接/工作流进度。
  // 只扫当前视图（默认 worktrees）的数据，另一视图等切过去时由下方 useEffect 按需补扫，
  // 避免首屏同时跑 scan()+scanWorktrees() 两批 git 调用相互竞争、拖慢首屏。
  useEffect(() => {
    // cancelled 标记组件卸载后不再写入本地 loaded state。
    let cancelled = false
    loadConfig()
    if (activeView === 'projects') {
      // 项目视图首屏需要强制 fetch 一次，确保刚打开软件时能拿到最新 behind。
      projectTabInitialFetchDoneRef.current = true
      scan({ fetch: true })
    } else {
      scanWorktrees()
    }
    loadTaskStatus()
    loadTaskLinks()
    loadTaskVisibility()
    loadProjectVisibility()
    loadTaskWorkflow()
    Promise.resolve(api.loadTaskWorkflowOutput?.() ?? {})
      .then((rawOutputMap) => {
        // rawOutputMap 为主进程读取到的流程步骤输出缓存；可能因旧版本/损坏文件返回非对象。
        if (cancelled) return
        // outputMap 存储校验后的输出缓存映射，非法结构回退空对象。
        const outputMap =
          rawOutputMap &&
          typeof rawOutputMap === 'object' &&
          !Array.isArray(rawOutputMap)
            ? rawOutputMap
            : {}
        // 合并时让当前会话已产生的输出覆盖磁盘旧值，避免启动加载慢于用户执行时把新结果冲掉。
        lastStepOutputs.current = { ...outputMap, ...lastStepOutputs.current }
        // 触发 WorktreePanel 重新渲染，使恢复出的「查看/未通过」状态立即可见。
        setLastOutputVersion((v) => v + 1)
      })
      .catch(() => {
        // 输出缓存只是体验增强，读取失败不阻塞主流程。
      })
    loadTaskBlockers()
    loadTaskEnvHealth().finally(() => {
      if (!cancelled) setEnvHealthLoaded(true)
    })
    return () => {
      cancelled = true
    }
    // Store action 引用会随 Zustand 快照变化；初始化加载必须只执行一次，避免形成扫描循环。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 卸载时清理隐藏动画定时器，避免 App 已离开但延迟回调继续写 store。
  useEffect(
    () => () => {
      hideTaskTimers.current.forEach((timerId) =>
        globalThis.clearTimeout(timerId)
      )
      hideProjectTimers.current.forEach((timerId) =>
        globalThis.clearTimeout(timerId)
      )
      hideTaskTimers.current.clear()
      hideProjectTimers.current.clear()
    },
    []
  )

  // 切换视图时按需补扫：项目 Tab 首次进入强制 fetch 一次，其余视图无数据时补扫本地状态。
  useEffect(() => {
    if (!initialViewScanHandledRef.current) {
      // 挂载后的第一次 activeView effect 与首次加载 effect 处在同一轮渲染，跳过可避免首屏重复扫描。
      initialViewScanHandledRef.current = true
      return
    }
    // worktrees 和 kanban 视图都基于 worktree 数据，无数据时补扫
    if (
      (activeView === 'worktrees' || activeView === 'kanban') &&
      worktreeTasks.length === 0
    )
      scanWorktrees()
    if (activeView !== 'projects') return
    if (!projectTabInitialFetchDoneRef.current) {
      // 首次真正进入项目 Tab 时不依赖 autoFetch 设置，强制 fetch 远程以拿到准确落后提交数。
      projectTabInitialFetchDoneRef.current = true
      scan({ fetch: true })
      return
    }
    if (projects.length === 0) scan()
    // 扫描函数和列表长度会随扫描结果变化；这里只由视图切换触发补扫，避免结果写回后重复 fetch。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView])

  // taskTitleBadges 当前任务标题徽标展示配置；老配置缺失字段时默认全部展示。
  const taskTitleBadges = useMemo(
    () => normalizeTaskTitleBadges(config?.taskTitleBadges),
    [config?.taskTitleBadges]
  )
  // visibleProjectsForStats 存储真正参与统计与批量判断的项目列表，隐藏项目始终排除。
  const visibleProjectsForStats = useMemo(
    () =>
      filterVisibleItems(
        projects,
        projectVisibility,
        (project) => project.path,
        false
      ),
    [projects, projectVisibility]
  )
  // projectBaseForDisplay 存储项目 Tab 当前展示基础列表；打开显示隐藏时隐藏项也参与搜索与查看。
  const projectBaseForDisplay = useMemo(
    () =>
      prepareVisibleItems(
        projects,
        projectVisibility,
        (project) => project.path,
        showHiddenProjects,
        (a, b) => a.name.localeCompare(b.name)
      ),
    [projects, projectVisibility, showHiddenProjects]
  )
  // 过滤后的项目列表（随筛选/搜索/数据变化重算）
  const filtered = useMemo(
    () => filterProjects(projectBaseForDisplay, filter, keyword),
    [projectBaseForDisplay, filter, keyword]
  )
  // 概览统计
  const stats = useMemo(
    () => summarize(visibleProjectsForStats),
    [visibleProjectsForStats]
  )
  // visibleSelectedPaths 存储未隐藏的已选项目路径；隐藏项目即使历史上被选中过也不计入批量操作。
  const visibleSelectedPaths = useMemo(
    () =>
      selectedPaths.filter(
        (path) => !hasVisibilityKey(projectVisibility, 'hidden', path)
      ),
    [selectedPaths, projectVisibility]
  )
  // taskCompare 当前任务排序的二级比较函数；置顶排序会在它之前生效。
  const taskCompare = useMemo(
    () =>
      wtSortOrder === 'status'
        ? (a, b) => {
            // sa/sb 分别为两任务的状态排序权重，未设置时视为默认「未开始」权重 0
            const sa = STATUS_SORT_ORDER[taskStatusMap[a.task]] ?? 0
            const sb = STATUS_SORT_ORDER[taskStatusMap[b.task]] ?? 0
            return sa - sb || a.task.localeCompare(b.task)
          }
        : (a, b) => a.task.localeCompare(b.task),
    [wtSortOrder, taskStatusMap]
  )
  // sortedTasks 按隐藏/置顶与排序方式处理后的 worktree 任务列表
  const sortedTasks = useMemo(
    () =>
      prepareVisibleItems(
        worktreeTasks,
        taskVisibility,
        (task) => task.task,
        showHiddenTasks,
        taskCompare
      ),
    [worktreeTasks, taskVisibility, showHiddenTasks, taskCompare]
  )
  // visibleWorktreeTasks 存储不含隐藏项的任务列表，用于看板、后台环境检查和 Claude 用量汇总。
  const visibleWorktreeTasks = useMemo(
    () =>
      prepareVisibleItems(
        worktreeTasks,
        taskVisibility,
        (task) => task.task,
        false,
        taskCompare
      ),
    [worktreeTasks, taskVisibility, taskCompare]
  )
  // hasHiddenTasks 标记是否存在已隐藏任务，用于控制 Worktree 显示隐藏入口是否可用。
  const hasHiddenTasks =
    Array.isArray(taskVisibility?.hidden) && taskVisibility.hidden.length > 0
  // hasHiddenProjects 标记是否存在已隐藏项目，用于控制项目显示隐藏入口是否可用。
  const hasHiddenProjects =
    Array.isArray(projectVisibility?.hidden) &&
    projectVisibility.hidden.length > 0

  // 加载 Claude Code 用量汇总：可见 worktree 任务列表变化时批量拉取各任务的 token 用量与费用。
  // 失败静默处理（如非 Electron 环境降级返回空），不阻断主流程。
  useEffect(() => {
    // 无任务时清空，避免残留旧数据
    if (visibleWorktreeTasks.length === 0) {
      setClaudeUsageMap({})
      return
    }
    let cancelled = false
    // taskNames 当前所有可见任务名，用于批量查询用量汇总；隐藏任务不计入总计。
    const taskNames = visibleWorktreeTasks.map((t) => t.task)
    api
      .getClaudeTasksSummary(taskNames)
      .then((summary) => {
        if (!cancelled) setClaudeUsageMap(summary || {})
      })
      .catch(() => {
        if (!cancelled) setClaudeUsageMap({})
      })
    return () => {
      cancelled = true
    }
  }, [visibleWorktreeTasks])

  // workflowSteps 当前生效的工作流（需求流程）步骤清单：来自配置，规范化后兜底默认清单。
  // 用 ?? 而非 || 区分「未配置（undefined → 用默认）」与「显式清空（[] → 尊重为空）」。
  const workflowSteps = useMemo(() => {
    // raw 为配置中的步骤数组；未设置时回退默认清单
    const raw = config?.workflowSteps ?? DEFAULT_WORKFLOW_STEPS
    return normalizeWorkflowSteps(raw)
  }, [config])

  // claudeTotal 所有任务的 Claude 用量总计：累加各任务的 token 总量与费用，
  // 用于在 worktree 工具栏展示全局 AI 成本概览
  const claudeTotal = useMemo(() => {
    // acc 累加器：总 token 数、总美元费用、总人民币费用
    return Object.values(claudeUsageMap).reduce(
      (acc, s) => {
        // u 当前任务的 token 分项用量
        const u = s?.usage || {}
        const tokens =
          (u.input || 0) +
          (u.output || 0) +
          (u.cacheWrite || 0) +
          (u.cacheRead || 0)
        return {
          tokens: acc.tokens + tokens,
          usd: acc.usd + (s?.cost?.usd || 0),
          cny: acc.cny + (s?.cost?.cny || 0),
        }
      },
      { tokens: 0, usd: 0, cny: 0 }
    )
  }, [claudeUsageMap])

  /**
   * 单个项目切换到主分支（带 master/main 兜底，由主进程按仓库实际存在的主分支切换）
   * @param {object} project - 项目
   */
  const handleCheckoutMain = async (project) => {
    // 防止同一项目重复触发
    if (projectLoadingPaths.has(project.path)) return
    setProjectLoadingPaths((prev) => new Set([...prev, project.path]))
    try {
      // mainBranch 取配置首个主分支名作为请求目标，主进程会据此识别为主分支并兜底切到实际存在的那个
      const mainBranch = config?.mainBranches?.[0] || 'master'
      const res = await api.checkoutBranch(project.path, mainBranch)
      if (res.success) {
        // res.branch 为实际切到的分支名（可能是 main 而非 master），无则回退展示请求名
        message.success(`${project.name} 已切到 ${res.branch || mainBranch}`)
        scan()
      } else {
        message.error(`切换失败：${res.error}`)
      }
    } finally {
      setProjectLoadingPaths((prev) => {
        const next = new Set(prev)
        next.delete(project.path)
        return next
      })
    }
  }

  /**
   * 单个项目拉取更新
   * @param {object} project - 项目
   */
  const handlePull = async (project) => {
    // 防止同一项目重复触发
    if (projectLoadingPaths.has(project.path)) return
    setProjectLoadingPaths((prev) => new Set([...prev, project.path]))
    try {
      const res = await api.pullUpdates(project.path)
      if (res.success) {
        message.success(`${project.name} 已拉取更新`)
        scan()
      } else {
        message.error(`拉取失败：${res.error}`)
      }
    } finally {
      setProjectLoadingPaths((prev) => {
        const next = new Set(prev)
        next.delete(project.path)
        return next
      })
    }
  }

  /**
   * 二次确认后提交项目全部变更，并推送当前分支到远程。
   * @param {object} project - 待同步的项目
   */
  const handleSyncUpdates = (project) => {
    modal.confirm(
      withConfirmDefaults({
        title: `同步更新 ${project.name}`,
        content:
          '此操作会提交当前项目的全部 Git 变更记录，并推送当前分支到远程。提交信息为「feat: 优化」，是否继续？',
        okText: '提交并推送',
        onOk: async () => {
          if (projectLoadingPaths.has(project.path)) return
          setProjectLoadingPaths((prev) => new Set([...prev, project.path]))
          try {
            // commitMessage 存储同步更新统一使用的通用提交信息。
            const commitMessage = 'feat: 优化'
            // res 存储主进程返回的提交与推送结果，committed 用于区分是否产生新提交。
            const res = await api.syncUpdates(project.path, commitMessage)
            if (res.success) {
              message.success(
                res.committed
                  ? `${project.name} 已提交并推送`
                  : `${project.name} 无新变更，已有提交已推送`
              )
              scan()
            } else {
              message.error(`同步更新失败：${res.error}`)
            }
          } finally {
            setProjectLoadingPaths((prev) => {
              // next 存储移除当前项目后的 loading 路径集合。
              const next = new Set(prev)
              next.delete(project.path)
              return next
            })
          }
        },
      })
    )
  }

  /**
   * 在 Finder 中打开路径
   * @param {object|string} target - 项目对象或路径字符串
   */
  const handleOpenFinder = (target) => {
    // path 兼容传入项目对象或直接路径
    const path = typeof target === 'string' ? target : target.path
    api.openInFinder(path)
  }

  /**
   * 在 VSCode 中打开路径
   * @param {object|string} target - 项目对象或路径字符串
   */
  const handleOpenVscode = async (target) => {
    // path 兼容传入项目对象或直接路径
    const path = typeof target === 'string' ? target : target.path
    const res = await api.openInVscode(path)
    // 打开失败时提示（如未安装 VSCode）
    if (res && !res.success) message.error(res.error || '打开 VSCode 失败')
  }

  /**
   * 在终端中打开路径（优先 Ghostty，否则系统 Terminal）
   * @param {object|string} target - 任务/worktree 对象或路径字符串
   */
  const handleOpenTerminal = async (target) => {
    // path 兼容传入对象或直接路径
    const path = typeof target === 'string' ? target : target.path
    const res = await api.openInTerminal(path)
    // 打开失败时提示（如未找到可用终端）
    if (res && !res.success) message.error(res.error || '打开终端失败')
  }

  /**
   * 复制绝对路径到剪贴板
   * @param {object|string} target - 任务/worktree 对象或路径字符串
   */
  const handleCopyPath = async (target) => {
    // path 兼容传入对象或直接路径
    const path = typeof target === 'string' ? target : target.path
    // copyText 为可安全粘贴到终端的形式：含空格/&/括号等特殊字符时自动加引号，
    // 纯英文/中文路径保持裸路径。修复含 & 等字符的目录裸贴终端被拆词、cd 不进去的问题。
    const copyText = quotePathForCopy(path)
    // ok 标记剪贴板写入是否成功（preload 同步返回布尔）
    const ok = await api.copyText(copyText)
    if (ok) message.success('已复制路径')
    else message.error('复制失败')
  }

  /**
   * 删除单个 worktree，删前确认；有未提交变更时先安全删除，失败再询问是否强制
   * @param {object} wt - worktree 项（含 projectPath、path、branch）
   */
  const handleRemoveWorktree = (wt) => {
    modal.confirm(
      withConfirmDefaults({
        title: '删除 Worktree',
        content: `确认删除 ${wt.project} 的 worktree（分支 ${wt.branch}）？`,
        okType: 'danger',
        onOk: async () => {
          // 先安全删除（有未提交变更会被 git 拒绝）
          const res = await api.removeWorktree(wt.projectPath, wt.path, {})
          if (res.success) {
            message.success('已删除')
            scanWorktrees()
            return
          }
          // 安全删除失败：二次确认是否强制删除（丢弃未提交变更）
          modal.confirm(
            withConfirmDefaults({
              title: '该 worktree 有未提交变更',
              content: '强制删除将丢弃这些变更，是否继续？',
              okType: 'danger',
              okText: '强制删除',
              onOk: async () => {
                const forced = await api.removeWorktree(
                  wt.projectPath,
                  wt.path,
                  { force: true }
                )
                if (forced.success) {
                  message.success('已强制删除')
                  scanWorktrees()
                } else {
                  message.error(`删除失败：${forced.error}`)
                }
              },
            })
          )
        },
      })
    )
  }

  /**
   * 清理某项目的失效 worktree（git worktree prune）
   * @param {object} wt - worktree 项（含 projectPath）
   */
  const handlePruneWorktree = async (wt) => {
    const res = await api.pruneWorktrees(wt.projectPath)
    if (res.success) {
      message.success('已清理失效 worktree')
      scanWorktrees()
    } else {
      message.error(`清理失败：${res.error}`)
    }
  }

  /**
   * 执行任务环境健康检查，并同步任务行状态缓存。
   * @param {object} task - 任务分组项（含 task 名、path）
   * @param {{open?:boolean}} [opts] - 执行选项；open 为 true 时同步打开/刷新详情弹窗
   */
  const runEnvHealthCheck = async (task, opts = {}) => {
    if (!task?.task || !task?.path) return
    // autoEnvCheckedTaskKeys 同步记录所有已触发检查的任务，避免自动检查与创建/手动检查互相重复。
    autoEnvCheckedTaskKeys.current.add(getEnvAutoCheckKey(task))
    // open 标记本次检查是否需要驱动详情弹窗 loading/result
    const open = !!opts.open
    // checkingEntry 为任务行即时 loading 状态，创建成功后无需等 IPC 返回即可反馈给用户
    const checkingEntry = {
      version: ENV_HEALTH_CACHE_VERSION,
      status: 'checking',
      issueCount: 0,
      taskDir: task.path,
      startedAt: new Date().toISOString(),
    }
    setTaskEnvHealthMap({
      ...useStore.getState().taskEnvHealthMap,
      [task.task]: checkingEntry,
    })
    if (open) {
      setEnvCheckTaskName(task.task)
      setEnvCheckTaskDir(task.path)
      setEnvCheckOpen(true)
      setEnvCheckLoading(true)
      setEnvCheckResult((currentResult) =>
        envCheckTaskName === task.task && envCheckTaskDir === task.path
          ? currentResult
          : null
      )
    }

    try {
      // result 为核心层环境检查结果：兼容旧聚合字段，并包含新 summary/projects 结构
      const result = await api.checkEnvHealth(task.path)
      // entry 为任务行红/绿状态缓存
      const entry = makeEnvHealthEntry(
        task,
        result,
        config?.workDocumentTemplates
      )
      setTaskEnvHealthMap({
        ...useStore.getState().taskEnvHealthMap,
        [task.task]: entry,
      })
      if (open) setEnvCheckResult(entry.result)
    } catch (e) {
      // entry 为异常失败缓存，保证任务行能显示红色并可点开看到错误
      const entry = makeEnvHealthErrorEntry(task, e)
      setTaskEnvHealthMap({
        ...useStore.getState().taskEnvHealthMap,
        [task.task]: entry,
      })
      if (open) setEnvCheckResult(entry.result)
    } finally {
      if (open) setEnvCheckLoading(false)
    }
  }

  /**
   * 打开任务环境检查详情；已有结果则直接展示，否则触发一次检查。
   * @param {object} task - 任务分组项（含 task 名、path）
   */
  const handleEnvCheck = async (task) => {
    // entry 为该任务已有的环境检查缓存
    const entry = envHealthMap[task.task]
    setEnvCheckTaskName(task.task)
    setEnvCheckTaskDir(task.path)
    setEnvCheckOpen(true)

    // 已有完成结果时直接展示，避免用户点红/绿状态又无意义地重复检查
    if (entry?.result && entry.status !== 'checking') {
      // normalizedResult 存储过滤旧缓存中根级 docs 工作文档目录后的结果。
      const normalizedResult = normalizeEnvHealthResultForDisplay(
        entry.result,
        task.path,
        config?.workDocumentTemplates
      )
      setEnvCheckLoading(false)
      setEnvCheckResult(normalizedResult)
      return
    }

    await runEnvHealthCheck(task, { open: true })
  }

  // 任务列表进入页面后，像 AI token/费用统计一样对未检查或旧缓存任务做一次后台环境检查。
  useEffect(() => {
    if (!envHealthLoaded || !config || visibleWorktreeTasks.length === 0) return

    // pendingTasks 存储本次需要自动检查的任务：仅限当前会话没跑过，且没有可直接展示的有效结果。
    const pendingTasks = visibleWorktreeTasks.filter((task) => {
      // autoKey 存储任务在当前 App 会话中的自动检查去重标识。
      const autoKey = getEnvAutoCheckKey(task)
      if (autoEnvCheckedTaskKeys.current.has(autoKey)) return false
      // entry 存储该任务当前展示层环境检查状态；旧缓存会被归一化为无 result 的 idle。
      const entry = envHealthMap[task.task]
      if (entry?.status === 'checking') return false
      return !entry?.result
    })

    for (const task of pendingTasks) {
      // fire-and-forget：任务行会进入 loading，但不等待检查完成，不阻塞页面交互。
      void runEnvHealthCheck(task, { open: false })
    }
    // runEnvHealthCheck 会读取并更新 envHealthMap；加入依赖会让检查结果触发新一轮自动检查。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleWorktreeTasks, envHealthLoaded, config, envHealthMap])

  /**
   * 删除任务前归档 docs 工作记录。
   * @param {object} task - 任务分组项（含 task/path）
   * @returns {Promise<{success:boolean, docsPath?:string}>} 归档结果；失败时 success 为 false
   */
  const archiveTaskBeforeRemove = async (task) => {
    // archiveResult 存储 docs 归档结果；失败时不继续删除任务目录，避免工作记录丢失。
    const archiveResult = await api.archiveTaskDocs(task.path, task.task)
    if (!archiveResult?.success) {
      message.error(`归档工作记录失败：${archiveResult?.error || '未知错误'}`)
      return { success: false }
    }
    return { success: true, docsPath: archiveResult.docsPath || '' }
  }

  /**
   * 完成任务删除收尾：删除任务目录并写入历史记录。
   * @param {object} task - 任务分组项（含 task/path）
   * @param {string} docsPath - 已归档工作记录目录路径
   * @returns {Promise<boolean>} 是否完成删除收尾
   */
  const finalizeRemoveTask = async (task, docsPath = '') => {
    // removeResult 存储任务目录删除结果；旧实现未检查返回值，这里补上失败提示。
    const removeResult = await api.removeTaskFolder(task.path)
    if (removeResult && !removeResult.success) {
      message.error(`删除任务目录失败：${removeResult.error || '未知错误'}`)
      return false
    }

    // historyEntry 存储历史任务记录，携带归档 docsPath 供历史弹窗打开工作记录。
    const historyEntry = {
      task: task.task,
      link: normalizeTaskLinkItems(taskLinkMap[task.task]),
      status: taskStatusMap[task.task] || '',
      docsPath,
    }
    await api.appendTaskHistory(historyEntry)
    return true
  }

  /**
   * 删除某个任务目录下的全部 worktree，二次确认；安全删除失败的再询问是否强制
   * 成功后同时删除任务文件夹（二次确认弹层中已提示）
   * @param {object} task - 任务分组项（含 task 名、path、worktrees 列表）
   */
  const handleRemoveTask = (task) => {
    // wts 为该任务下的全部 worktree 项
    const wts = task.worktrees || []
    // 任务下无 worktree（空目录）：直接询问是否删除任务文件夹
    if (!wts.length) {
      modal.confirm(
        withConfirmDefaults({
          title: `删除任务「${task.task}」`,
          content: `该任务下没有 worktree，将直接删除任务目录「${task.task}」。是否继续？`,
          okType: 'danger',
          okText: '删除',
          onOk: async () => {
            // 先归档 docs 工作记录，再删除任务目录并记录历史。
            const archive = await archiveTaskBeforeRemove(task)
            if (!archive.success) return
            const done = await finalizeRemoveTask(task, archive.docsPath)
            if (!done) return
            message.success(`已删除任务「${task.task}」`)
            scanWorktrees()
          },
        })
      )
      return
    }
    modal.confirm(
      withConfirmDefaults({
        title: `删除任务「${task.task}」`,
        content: `将删除该任务下全部 ${wts.length} 个 worktree 并删除任务目录「${task.task}」。此操作不可撤销，是否继续？`,
        okType: 'danger',
        okText: '删除',
        onOk: async () => {
          // archive 先保存当前任务下所有项目 docs；必须发生在 git worktree remove 删除目录之前。
          const archive = await archiveTaskBeforeRemove(task)
          if (!archive.success) return
          // prunables 为失效项；removables 为正常 worktree
          const prunables = wts.filter((w) => w.prunable || w.missing)
          const removables = wts.filter((w) => !(w.prunable || w.missing))
          // blocked 累积因未提交变更而安全删除失败的项
          const blocked = []
          for (const wt of removables) {
            const res = await api.removeWorktree(wt.projectPath, wt.path, {})
            if (!res.success) blocked.push(wt)
          }
          // 清理涉及项目的失效引用（去重 projectPath）
          const pruneRepos = [
            ...new Set([...prunables, ...wts].map((w) => w.projectPath)),
          ]
          await Promise.all(pruneRepos.map((p) => api.pruneWorktrees(p)))
          if (blocked.length === 0) {
            // 正常全量删除成功后删除任务目录并记录历史。
            const done = await finalizeRemoveTask(task, archive.docsPath)
            if (!done) return
            message.success(`已删除任务「${task.task}」`)
            scanWorktrees()
            return
          }
          // 有未提交变更被拦截：二次确认是否强制删除
          modal.confirm(
            withConfirmDefaults({
              title: `${blocked.length} 个 worktree 有未提交变更`,
              content: '强制删除将丢弃这些未提交的改动，是否继续？',
              okType: 'danger',
              okText: '强制删除',
              onOk: async () => {
                for (const wt of blocked) {
                  await api.removeWorktree(wt.projectPath, wt.path, {
                    force: true,
                  })
                }
                await Promise.all(
                  [...new Set(blocked.map((w) => w.projectPath))].map((p) =>
                    api.pruneWorktrees(p)
                  )
                )
                // 强制删除成功后删除任务目录并记录历史。
                const done = await finalizeRemoveTask(task, archive.docsPath)
                if (!done) return
                message.success(`已删除任务「${task.task}」`)
                scanWorktrees()
              },
              onCancel: () => {
                message.info(
                  `已删除 ${removables.length - blocked.length} 个，保留 ${blocked.length} 个有变更的`
                )
                scanWorktrees()
              },
            })
          )
        },
      })
    )
  }

  /**
   * 提交按任务批量创建 worktree
   * @param {object} values - 表单值：{ task, projectPaths, branch, newBranch }
   */
  const handleCreateWorktree = async (values) => {
    // results 为各项目创建结果
    const results = await api.batchAddWorktree(values)
    // ok 成功数量（含新建与复用补链接）
    const ok = results.filter((r) => r.success).length
    // fail 失败数量
    const fail = results.length - ok
    // linked 成功软链接 node_modules 的数量，用于提示依赖已复用
    const linked = results.filter(
      (r) => r.success && r.nodeModulesLinked
    ).length
    // linkedTip 软链接提示后缀：有则附带说明，无则空
    const linkedTip =
      linked > 0 ? `，其中 ${linked} 个已软链接 node_modules` : ''
    // links 存储本次创建时填写的需求链接条目；为空则不改变已有任务链接。
    const links = normalizeTaskLinkItems(values.links)
    if (links.length > 0) setTaskLink(values.task, links)
    if (fail === 0) {
      if ((values.projectPaths || []).length === 0) {
        message.success('已创建任务目录')
      } else {
        message.success(`已为 ${ok} 个项目创建 worktree${linkedTip}`)
      }
    } else {
      // 列出失败项目及其错误原因便于排查
      const failDetails = results
        .filter((r) => !r.success)
        .map((r) => `${r.project}：${r.error || '未知错误'}`)
        .join('；')
      message.warning(
        `成功 ${ok}，失败 ${fail}（${failDetails}）${linkedTip}`,
        8
      )
    }
    setCreateWtOpen(false)
    setCreateWtDefaultTask(null)
    scanWorktrees()
    // 新建成功后只展开刚创建的任务面板（其余收起），便于用户立即定位
    setWorktreeActiveKeys(computeActiveKeysAfterCreate(values.task))
    // 创建成功后自动触发环境检查：任务行先显示 loading，完成后变为绿色/红色
    if (ok > 0) {
      // taskDir 为本次创建的任务目录，路径规则与核心 batchAddWorktree 保持一致
      const taskDir = buildTaskDir(config?.worktreesPath, values.task)
      if (taskDir)
        runEnvHealthCheck({ task: values.task, path: taskDir }, { open: false })
    }
  }

  /**
   * 打开创建 worktree 弹窗，并在项目列表尚未加载时先补扫源项目。
   * @param {string|null} defaultTask - 预填任务名；为空表示新建任务
   */
  const openCreateWorktreeModal = (defaultTask = null) => {
    setCreateWtDefaultTask(defaultTask)
    setCreateWtOpen(true)
    // Worktree/看板视图首屏不会扫描项目列表；创建弹窗依赖项目选项，打开时按需补扫。
    if (projects.length === 0) scan()
  }

  /**
   * 从某个任务行点击「+」触发的创建 worktree：预填任务名，打开弹窗
   * @param {object} task - 任务分组项
   */
  const handleAddWorktreeToTask = (task) => {
    openCreateWorktreeModal(task.task)
  }

  /**
   * 隐藏或恢复显示任务；隐藏时先播放退出动画，动画结束后再写入隐藏偏好。
   * @param {string} taskName - 任务名
   * @param {boolean} hidden - true 隐藏，false 恢复显示
   */
  const handleTaskHiddenChange = (taskName, hidden) => {
    // existingTimer 存储该任务上一次隐藏动画定时器；重复操作前先清掉，避免过期回调覆盖新状态。
    const existingTimer = hideTaskTimers.current.get(taskName)
    if (existingTimer) globalThis.clearTimeout(existingTimer)
    hideTaskTimers.current.delete(taskName)

    if (!hidden) {
      setHidingTaskKeys((keys) => keys.filter((key) => key !== taskName))
      setTaskHidden(taskName, false)
      return
    }

    setHidingTaskKeys((keys) =>
      keys.includes(taskName) ? keys : [...keys, taskName]
    )
    setWorktreeActiveKeys((keys) => keys.filter((key) => key !== taskName))
    // timerId 存储隐藏退出动画结束后的写入定时器。
    const timerId = globalThis.setTimeout(() => {
      setTaskHidden(taskName, true)
      setHidingTaskKeys((keys) => keys.filter((key) => key !== taskName))
      hideTaskTimers.current.delete(taskName)
    }, HIDE_ANIMATION_MS)
    hideTaskTimers.current.set(taskName, timerId)
  }

  /**
   * 隐藏或恢复显示项目；隐藏时先播放退出动画，动画结束后再写入隐藏偏好。
   * @param {string} projectPath - 项目绝对路径
   * @param {boolean} hidden - true 隐藏，false 恢复显示
   */
  const handleProjectHiddenChange = (projectPath, hidden) => {
    // existingTimer 存储该项目上一次隐藏动画定时器；重复操作前先清掉，避免过期回调覆盖新状态。
    const existingTimer = hideProjectTimers.current.get(projectPath)
    if (existingTimer) globalThis.clearTimeout(existingTimer)
    hideProjectTimers.current.delete(projectPath)

    if (!hidden) {
      setHidingProjectKeys((keys) => keys.filter((key) => key !== projectPath))
      setProjectHidden(projectPath, false)
      return
    }

    setHidingProjectKeys((keys) =>
      keys.includes(projectPath) ? keys : [...keys, projectPath]
    )
    if (detailProject?.path === projectPath) setDetailProject(null)
    // timerId 存储隐藏退出动画结束后的写入定时器。
    const timerId = globalThis.setTimeout(() => {
      setProjectHidden(projectPath, true)
      setHidingProjectKeys((keys) => keys.filter((key) => key !== projectPath))
      hideProjectTimers.current.delete(projectPath)
    }, HIDE_ANIMATION_MS)
    hideProjectTimers.current.set(projectPath, timerId)
  }

  /**
   * 打开已删除任务历史弹窗，并从持久化文件异步加载历史列表
   */
  const handleOpenHistory = async () => {
    setHistoryOpen(true)
    setHistoryPage(1)
    // history 为最新的已删除任务记录数组（时间倒序）
    const history = await api.loadTaskHistory()
    setTaskHistory(Array.isArray(history) ? history : [])
  }

  /**
   * 从历史列表中删除指定下标的记录，并同步更新本地状态
   * @param {number} idx - 要删除的记录在 taskHistory 中的下标
   */
  const handleDeleteHistory = async (idx) => {
    await api.removeTaskHistory(idx)
    setTaskHistory((prev) => prev.filter((_, i) => i !== idx))
  }

  /**
   * 请求移除历史任务记录，先弹出确认框避免误删历史列表项。
   * @param {number} idx - 要删除的记录在 taskHistory 中的下标
   * @param {string} taskName - 历史记录对应的任务名，用于确认框展示
   */
  const requestDeleteHistory = (idx, taskName) => {
    // confirmTaskName 存储确认框内展示的任务名；历史脏数据缺失 task 时用兜底文案。
    const confirmTaskName = taskName || '未命名任务'
    modal.confirm(
      withConfirmDefaults({
        title: `移除历史任务「${confirmTaskName}」？`,
        content:
          '仅会从历史任务列表移除此记录，不会删除 worktree、分支或归档工作记录。',
        okType: 'danger',
        okText: '移除',
        cancelText: '取消',
        onOk: () => handleDeleteHistory(idx),
      })
    )
  }

  useEffect(() => {
    if (!historyOpen) return undefined

    /**
     * 测量历史任务弹层可用高度，并同步 antd List 的 pageSize。
     */
    const measureHistoryPageSize = () => {
      // shellElement 存储历史任务列表外层容器，clientHeight 表示当前弹层给列表的可用高度。
      const shellElement = historyListShellRef.current
      // firstItemElement 存储第一页第一条历史记录，用真实行高估算当前每页可容纳条数。
      const firstItemElement = shellElement?.querySelector(
        '.history-task-list-item'
      )
      // itemRectHeight 存储 getBoundingClientRect 得到的列表项高度；浏览器环境下更贴近真实渲染。
      const itemRectHeight =
        firstItemElement?.getBoundingClientRect?.().height || 0
      // itemHeight 存储最终用于计算的单条记录高度；happy-dom 等环境可能只能拿到 offsetHeight。
      const itemHeight = itemRectHeight || firstItemElement?.offsetHeight || 0
      // nextPageSize 存储按当前容器尺寸计算出的每页条数。
      const nextPageSize = computeHistoryPageSize({
        containerHeight: shellElement?.clientHeight,
        itemHeight,
      })
      setHistoryPageSize((currentPageSize) =>
        currentPageSize === nextPageSize ? currentPageSize : nextPageSize
      )
    }

    measureHistoryPageSize()

    // ResizeObserverCtor 存储浏览器 ResizeObserver 构造器；可监听弹层尺寸随窗口变化而变动。
    const ResizeObserverCtor = globalThis.ResizeObserver
    if (ResizeObserverCtor && historyListShellRef.current) {
      // resizeObserver 监听历史列表容器尺寸变化，实时修正 pageSize。
      const resizeObserver = new ResizeObserverCtor(measureHistoryPageSize)
      resizeObserver.observe(historyListShellRef.current)
      return () => resizeObserver.disconnect()
    }

    globalThis.addEventListener?.('resize', measureHistoryPageSize)
    return () =>
      globalThis.removeEventListener?.('resize', measureHistoryPageSize)
  }, [historyOpen, taskHistory.length])

  useEffect(() => {
    // maxHistoryPage 存储当前历史条数和 pageSize 下的最大页码，至少为 1。
    const maxHistoryPage = Math.max(
      1,
      Math.ceil(taskHistory.length / historyPageSize)
    )
    setHistoryPage((currentPage) => Math.min(currentPage, maxHistoryPage))
  }, [taskHistory.length, historyPageSize])

  /**
   * 在系统默认浏览器中打开外部 URL（Jira/工单链接）
   * @param {string} url - 要打开的 URL
   */
  const handleOpenUrl = async (url) => {
    const res = await api.openExternalUrl(url)
    if (res && !res.success) message.error('打开链接失败')
  }

  /**
   * 执行前按步骤 key 读取最新流程配置，避免运行中的 App 继续使用启动时缓存的旧命令。
   * @param {{key:string,label:string,command?:string}} step - 当前 UI 里点击的步骤定义
   * @returns {Promise<object>} 若最新配置中存在同 key 步骤则返回合并后的步骤，否则返回原步骤
   */
  const resolveLatestWorkflowStep = async (step) => {
    try {
      // latestConfig 存储磁盘上刚读取的最新配置；loadConfig 同时会刷新全局 store，后续 UI 也会跟上。
      const latestConfig = await loadConfig()
      // latestSteps 存储最新配置里的规范化流程步骤；配置缺失时不使用默认步骤覆盖当前用户点击的步骤。
      const latestSteps = normalizeWorkflowSteps(
        Array.isArray(latestConfig?.workflowSteps)
          ? latestConfig.workflowSteps
          : []
      )
      // latestStep 存储与当前步骤 key 相同的最新步骤配置，用于覆盖 command/taskArgMode 等可执行字段。
      const latestStep = latestSteps.find((item) => item.key === step?.key)
      return latestStep ? { ...step, ...latestStep } : step
    } catch (e) {
      // 最新配置读取失败时保留当前步骤，避免临时读盘错误阻断用户已有流程。
      return step
    }
  }

  /**
   * 执行某任务工作流步骤配置的 shell 命令（在任务目录下运行），并返回结构化结果供批量流程判断是否继续。
   * 命令模板由用户在「设置 → 流程」配置，支持 {path}/{task}/{branch} 占位符，渲染与执行在主进程完成。
   * 体验优化：① 执行中只在该步骤的「执行」按钮上显示 loading（runningSteps 标记，任务级而非全屏遮罩）；
   * ② 执行开始即打开「实时输出」Modal，订阅 STEP_OUTPUT 事件把脚本输出逐段追加展示，结束后更新成败。
   * @param {object} task - 任务分组项（含 task 名、path、worktrees，提供执行上下文）
   * @param {{key:string,label:string,command:string}} step - 被点击的步骤定义
   * @returns {Promise<{success:boolean,code:number|null,error?:string}>} 单步执行结果
   */
  const runWorkflowStepForTask = async (task, step) => {
    // effectiveStep 存储执行前刷新后的步骤配置；若配置未变化则等同于传入 step。
    const effectiveStep = await resolveLatestWorkflowStep(step)
    // 未配置命令的步骤理论上不会显示「执行」按钮，这里兜底提示，引导用户去设置补命令
    if (!effectiveStep.command || !String(effectiveStep.command).trim()) {
      message.info(
        `「${effectiveStep.label}」未配置执行命令，请在「设置 → 流程」中填写`
      )
      return { success: false, code: null, error: '未配置执行命令' }
    }
    // branch 取该任务第一个 worktree 的分支名，作为 {branch} 占位符的值（同一任务各仓库分支通常一致）
    const branch = task.worktrees?.[0]?.branch || ''
    // taskName/stepKey 为本次执行的路由标识：标记按钮 loading、过滤 STEP_OUTPUT 事件归属
    const taskName = task.task
    const stepKey = effectiveStep.key
    // rk 为本次执行的路由 key，用于在 runningOutputs ref 里独立累积输出
    const rk = stepRunKey(taskName, stepKey)
    // 标记该步骤进入执行中：对应「执行」按钮显示 loading 并禁用，其他任务/步骤不受影响
    startRunningStep(taskName, stepKey)
    // 在 ref 中为本次执行初始化输出累积槽：无论 Modal 是否打开都持续累积，
    // WHY：用户执行中关掉 Modal 后，stepOutput 变 null 会丢弃后续 chunk；改由 ref 持久累积，
    // 关掉再点「查看实时输出」能恢复完整内容。
    runningOutputs.current[rk] = {
      taskName,
      stepKey,
      label: effectiveStep.label,
      content: '',
      status: 'running',
      code: null,
    }
    // 打开实时输出 Modal，初始为 running 态、内容为空，随后由 STEP_OUTPUT 事件填充
    setStepOutput({ ...runningOutputs.current[rk] })
    // 订阅主进程推送的步骤输出事件：只累积归属于本任务本步骤的 chunk（多任务并发时彼此隔离）
    const unsub = api.onStepOutput((evt) => {
      if (!isStepEventFor(evt, taskName, stepKey)) return
      // 先把片段累积到 ref（不依赖 Modal 是否打开），保证关掉重开也不丢内容
      const slot = runningOutputs.current[rk]
      if (slot) slot.content = appendStepChunk(slot.content, evt.chunk)
      // 再同步到 Modal（仅当当前正展示本步骤时）
      setStepOutput((prev) => {
        if (!prev || prev.taskName !== taskName || prev.stepKey !== stepKey)
          return prev
        return {
          ...prev,
          content: slot
            ? slot.content
            : appendStepChunk(prev.content, evt.chunk),
        }
      })
    })
    try {
      // taskArgMode 为任务目录参数模式：控制主进程是否把 task.path 追加为脚本参数。
      const taskArgMode = effectiveStep.taskArgMode || 'auto'
      // 调主进程在任务目录（task.path）下流式执行命令，回传汇总 {success,code,stdout,stderr,error}
      const res = await api.runWorkflowStep({
        command: effectiveStep.command,
        cwd: task.path,
        task: taskName,
        branch,
        taskName,
        stepKey,
        taskArgMode,
      })
      // finalStatus/finalCode 为本次执行最终状态；slotContent 为 ref 累积的完整流式内容
      const finalStatus = res?.success ? 'success' : 'error'
      const finalCode = res?.code ?? null
      // summary 为主进程回传的完整 stdout/stderr 合并文本，作为流式内容的兜底（事件丢失时仍有完整输出）
      const summary = [res?.stdout, res?.stderr]
        .filter((s) => s && s.trim())
        .join('\n')
      const slot = runningOutputs.current[rk]
      const finalContent =
        slot && slot.content && slot.content.trim()
          ? slot.content
          : summary || (slot ? slot.content : '')
      // 更新 ref 槽为最终态
      runningOutputs.current[rk] = {
        taskName,
        stepKey,
        label: effectiveStep.label,
        content: finalContent,
        status: finalStatus,
        code: finalCode,
      }
      // 同步到 Modal（仅当仍在展示本步骤时）
      setStepOutput((prev) => {
        if (!prev || prev.taskName !== taskName || prev.stepKey !== stepKey)
          return prev
        return {
          ...prev,
          content: finalContent,
          status: finalStatus,
          code: finalCode,
        }
      })
      if (res?.success) {
        // autoCheckOnSuccess 为该步骤成功后是否自动勾选；旧配置默认开启，用户可在设置里关闭。
        const autoCheckOnSuccess = effectiveStep.autoCheckOnSuccess !== false
        if (autoCheckOnSuccess) {
          // 命令执行成功视为该流程步骤已完成，同步勾选前面的完成框，减少用户二次操作。
          toggleWorkflowStep(taskName, stepKey, true)
        }
        message.success(`「${effectiveStep.label}」执行成功`)
      } else {
        // 命令失败说明该流程检查未通过，必须撤销完成勾选，避免单测失败后仍显示已完成。
        toggleWorkflowStep(taskName, stepKey, false)
        message.error(
          `「${effectiveStep.label}」未通过${res?.code != null ? `（退出码 ${res.code}）` : ''}`
        )
      }
      return { success: !!res?.success, code: finalCode, error: res?.error }
    } catch (e) {
      // 链路异常（如 IPC 失败）兜底：在 ref 与 Modal 标记失败并追加异常信息
      const slot = runningOutputs.current[rk]
      if (slot) {
        slot.status = 'error'
        slot.content = appendStepChunk(
          slot.content,
          `\n[执行异常] ${e.message}\n`
        )
      }
      setStepOutput((prev) => {
        if (!prev || prev.taskName !== taskName || prev.stepKey !== stepKey)
          return prev
        return {
          ...prev,
          status: 'error',
          content: slot
            ? slot.content
            : appendStepChunk(prev.content, `\n[执行异常] ${e.message}\n`),
        }
      })
      // 执行链路异常同样代表检查未完成，撤销勾选保持状态一致。
      toggleWorkflowStep(taskName, stepKey, false)
      message.error(`「${effectiveStep.label}」未通过：${e.message}`)
      return { success: false, code: null, error: e.message }
    } finally {
      // 无论成败都取消订阅并清除按钮 loading，避免事件泄漏与按钮卡在执行中
      unsub?.()
      finishRunningStep(taskName, stepKey)
      // 把本次执行的最终输出存入 lastStepOutputs，关闭 Modal 后用户仍可点「查看」重新打开；清理 running 槽
      const slot = runningOutputs.current[rk]
      if (slot) {
        // nextLastStepOutputs 存储写入内存与磁盘的最新输出缓存快照；不可变更新便于后续扩展为 state。
        const nextLastStepOutputs = {
          ...lastStepOutputs.current,
          [rk]: { ...slot },
        }
        lastStepOutputs.current = nextLastStepOutputs
        // fire-and-forget 持久化最近一次执行输出；失败只影响下次启动恢复，不影响当前执行结果反馈。
        api.saveTaskWorkflowOutput?.(nextLastStepOutputs)?.catch?.(() => {})
        delete runningOutputs.current[rk]
        // 自增版本号，驱动步骤旁「查看」按钮出现/更新
        setLastOutputVersion((v) => v + 1)
      }
    }
  }

  /**
   * 执行某任务工作流步骤配置的 shell 命令（在任务目录下运行）。
   * @param {object} task - 任务分组项（含 task 名、path、worktrees，提供执行上下文）
   * @param {{key:string,label:string,command:string}} step - 被点击的步骤定义
   */
  const handleRunStepAction = async (task, step) => {
    await runWorkflowStepForTask(task, step)
  }

  /**
   * 从任务流程起点或指定步骤开始串行执行所有可执行步骤。
   * @param {object} task - 任务分组项（含 task 名、path、worktrees）
   * @param {string} [startKey] - 可选起始步骤 key；为空表示运行全部
   */
  const handleRunWorkflowSteps = async (task, startKey) => {
    // runnableSteps 存储从 startKey 开始的可执行步骤队列。
    const runnableSteps = getRunnableWorkflowSteps(workflowSteps, startKey)
    if (!runnableSteps.length) {
      message.info('当前流程没有可执行命令')
      return
    }
    for (const step of runnableSteps) {
      // result 存储单步执行结果，用于失败后停止。
      const result = await runWorkflowStepForTask(task, step)
      // 失败后默认停止，除非步骤配置 stopOnFailure=false，避免后续命令在前置失败时误运行。
      if (!result.success && step.stopOnFailure !== false) {
        message.warning(`已在「${step.label}」失败后停止后续步骤`)
        break
      }
    }
  }

  /**
   * 查看某步骤「正在执行」的实时输出（从 runningOutputs ref 取，执行中关掉 Modal 后可重新打开）。
   * @param {object} task - 任务分组项
   * @param {{key:string,label:string}} step - 步骤定义
   */
  const handleViewCurrentOutput = (task, step) => {
    // slot 为该步骤当前执行中的输出累积；存在则重新打开 Modal 展示
    const slot = runningOutputs.current[stepRunKey(task.task, step.key)]
    if (slot) setStepOutput({ ...slot })
  }

  /**
   * 重新打开某步骤最近一次的执行输出（从 lastStepOutputs 取）。
   * @param {object} task - 任务分组项
   * @param {{key:string,label:string}} step - 步骤定义
   */
  const handleViewLastOutput = (task, step) => {
    // saved 为该步骤上次保存的输出快照；不存在则忽略
    const saved = lastStepOutputs.current[stepRunKey(task.task, step.key)]
    if (saved) setStepOutput({ ...saved })
  }

  /**
   * 批量操作入口，弹窗确认后执行
   * @param {string} operation - 操作类型
   * @param {object} args - 操作参数
   * @param {string} label - 操作中文名（用于确认文案）
   */
  const handleBatch = (operation, args, label) => {
    if (!visibleSelectedPaths.length) return message.warning('请先勾选项目')
    modal.confirm(
      withConfirmDefaults({
        title: `批量${label}`,
        content: `将对选中的 ${visibleSelectedPaths.length} 个项目执行「${label}」，是否继续？`,
        // onOk 不返回 Promise：否则 antd 会让确认框保持打开（按钮转圈）直到批量结束，
        // 进而一直盖在进度弹窗上方。这里同步触发异步流程后立即返回，确认框瞬间关闭，
        // 随后由 runBatch 内部设置的 batchProgress 弹出进度弹窗。
        onOk: () => {
          // 不 await：让确认框立即关闭，批量过程在后台推进并通过进度弹窗展示
          runBatchFlow(operation, args)
        },
      })
    )
  }

  /**
   * 执行批量操作并在完成后提示结果（与确认框生命周期解耦）
   * @param {string} operation - 操作类型
   * @param {object} args - 操作参数
   */
  const runBatchFlow = async (operation, args) => {
    // results 为批量执行结果
    const results = await runBatch(operation, args)
    // ok 成功数量
    const ok = results.filter((r) => r.success).length
    // fail 失败数量
    const fail = results.length - ok
    if (fail === 0) message.success(`全部成功（${ok} 个）`)
    else message.warning(`完成：成功 ${ok}，失败 ${fail}`)
  }

  // 主分支名，用于批量切换参数
  const mainBranch = config?.mainBranches?.[0] || 'master'

  // viewLoading 当前视图对应的加载态：项目视图看 loading，worktree/看板看 worktreeLoading，
  // 工作流视图自管数据、不参与扫描，恒为 false，避免被无关的 worktreeLoading 误遮罩
  const viewLoading =
    activeView === 'workflow'
      ? false
      : activeView === 'projects'
        ? loading
        : worktreeLoading

  // 批量操作下拉菜单项
  const batchMenuItems = [
    { key: 'checkout', label: `批量切到 ${mainBranch}` },
    { key: 'pull', label: '批量拉取更新' },
    { key: 'stash', label: '批量暂存变更' },
  ]

  /**
   * 切换历史任务分页页码。
   * @param {number} page - antd Pagination 回传的目标页码
   */
  const handleHistoryPageChange = (page) => {
    setHistoryPage(page)
  }

  // historyPagination 存储传给 antd List 的受控分页配置；记录数不足一页时关闭分页。
  const historyPagination =
    taskHistory.length > historyPageSize
      ? {
          current: historyPage,
          pageSize: historyPageSize,
          size: 'small',
          align: 'center',
          responsive: true,
          showSizeChanger: false,
          onChange: handleHistoryPageChange,
        }
      : false

  /**
   * 批量菜单点击分发
   * @param {{key:string}} param - 菜单项 key
   */
  const onBatchMenuClick = ({ key }) => {
    // 批量切主分支用 checkoutMain 操作（带 master/main 兜底），由主进程注入候选主分支名
    if (key === 'checkout')
      handleBatch('checkoutMain', {}, `切到 ${mainBranch}`)
    else if (key === 'pull') handleBatch('pull', {}, '拉取更新')
    else if (key === 'stash') handleBatch('stash', {}, '暂存变更')
  }

  /**
   * 配置变更后刷新当前视图使用的数据。
   * @param {object} nextConfig - 保存后的完整配置
   */
  const applySavedConfig = (nextConfig) => {
    // nextState 存储配置切换后需要同步清空的旧目录数据，避免短暂展示上一套路径的项目或任务。
    const nextState = {
      config: nextConfig,
      projects: [],
      worktreeTasks: [],
      selectedPaths: [],
    }
    useStore.setState(nextState)
    setDetailProject(null)
    setWorktreeActiveKeys([])
    if (activeView === 'projects') {
      scan()
      return
    }
    if (activeView === 'worktrees' || activeView === 'kanban') scanWorktrees()
  }

  /**
   * 顶部快速切换路径组合，并保存为当前配置。
   * @param {string} profileId - 用户选择的路径组合 id
   */
  const handleSwitchPathProfile = async (profileId) => {
    if (!config || profileId === activePathProfileId) return
    // targetProfile 存储用户选择的目标路径组合。
    const targetProfile = pathProfiles.find(
      (profile) => profile.id === profileId
    )
    if (!targetProfile) return
    try {
      // nextConfig 存储主进程保存后返回的完整配置；顶层路径会同步为目标组合路径。
      const nextConfig = await api.saveConfig({
        ...config,
        activePathProfileId: targetProfile.id,
        sourceProjectsPath: targetProfile.sourceProjectsPath,
        worktreesPath: targetProfile.worktreesPath,
      })
      applySavedConfig(nextConfig)
      message.success(`已切换到「${targetProfile.name || targetProfile.id}」`)
    } catch (e) {
      message.error(`切换路径组合失败：${e.message}`)
    }
  }

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <Header
        style={{
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          gap: 12,
        }}
      >
        {/* 左侧：标题 + 视图切换 */}
        <Space size={12} style={{ minWidth: 0 }}>
          <span
            style={{
              fontSize: 16,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            Visual Worktree
          </span>
          <Space size={8} style={{ minWidth: 0 }}>
            <Segmented
              value={activeView}
              // 切换主视图时清空项目搜索关键词，避免切回项目视图时输入框已空但列表仍按旧关键词过滤
              onChange={(v) => {
                setActiveView(v)
                localStorage.setItem('vw-active-view', v)
                setKeyword('')
              }}
              options={[
                { label: 'Worktree', value: 'worktrees' },
                { label: '项目', value: 'projects' },
                { label: '看板', value: 'kanban' },
                // { label: '工作流', value: 'workflow' },
              ]}
            />
            {pathProfileOptions.length > 1 && (
              <Select
                className="path-profile-select"
                value={activePathProfileId}
                options={pathProfileOptions}
                style={{ width: isNarrow ? 104 : 132 }}
                popupMatchSelectWidth={false}
                onChange={handleSwitchPathProfile}
              />
            )}
          </Space>
        </Space>
        <Space>
          {/* 创建 worktree：worktree 和看板视图显示 */}
          {(activeView === 'worktrees' || activeView === 'kanban') && (
            <Tooltip title="按任务创建 Worktree">
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => openCreateWorktreeModal()}
              >
                {isNarrow ? '' : '创建 Worktree'}
              </Button>
            </Tooltip>
          )}
          {/* 刷新：按当前视图刷新对应数据；worktree/看板视图刷新时重置展开状态为全部收起。工作流视图自管数据，不显示刷新 */}
          {activeView !== 'workflow' && (
            <Tooltip title="刷新">
              <Button
                icon={<ReloadOutlined />}
                loading={viewLoading}
                onClick={async () => {
                  if (activeView === 'projects') {
                    // 带 fetch 刷新：拿到本次连不上远程的项目名列表，给用户友好提示
                    // （fetch 已在核心层加超时，远程不可达不会再让 loading 无限挂起）
                    const { fetchFailedNames } = await scan({ fetch: true })
                    if (fetchFailedNames.length > 0) {
                      // 远程拉取失败但本地状态已正常展示：用 warning 告知而非 error，避免误以为整体失败
                      message.warning(
                        `${fetchFailedNames.length} 个项目连不上远程，已显示本地状态（领先/落后可能不准）：${fetchFailedNames.join('、')}`,
                        5
                      )
                    }
                  } else {
                    setWorktreeActiveKeys([])
                    scanWorktrees()
                  }
                }}
              >
                {isNarrow ? '' : '刷新'}
              </Button>
            </Tooltip>
          )}
          {/* 主题切换：暗色显示太阳（点击切亮色），亮色显示月亮（点击切暗色） */}
          <Tooltip title={themeMode === 'dark' ? '切换到亮色' : '切换到暗色'}>
            <Button
              icon={themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
              onClick={toggleTheme}
            />
          </Tooltip>
          <Tooltip title="设置">
            <Button
              icon={<SettingOutlined />}
              onClick={() => setSettingsOpen(true)}
            >
              {isNarrow ? '' : '设置'}
            </Button>
          </Tooltip>
        </Space>
      </Header>
      <Content style={{ padding: 16, overflow: 'auto' }}>
        {/* 视图切换：用 Spin 遮罩当前视图的加载态，并用 key 触发淡入，避免切换生硬 */}
        {/* wrapperClassName 撑满高度，让加载转圈在整个内容区垂直居中，而非贴在顶部 */}
        <Spin
          spinning={viewLoading}
          wrapperClassName={viewLoading ? 'full-height-spin' : ''}
        >
          <div key={activeView} className="view-fade">
            {/* worktree 视图：排序栏 + 按任务分组面板 */}
            {activeView === 'worktrees' ? (
              <>
                {/* 工具栏：左侧历史任务按钮 + Claude 总用量，右侧排序选择器 */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  <Space size={8}>
                    <Button
                      size="small"
                      icon={<HistoryOutlined />}
                      onClick={handleOpenHistory}
                    >
                      历史任务
                    </Button>
                    <Button
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => setCleanupOpen(true)}
                    >
                      清理建议
                    </Button>
                    {/* Claude 总用量概览：所有任务的累计 token 量与费用，无数据时不显示 */}
                    {claudeTotal.tokens > 0 && (
                      <Tooltip
                        title={
                          // 多行结构化展示：标题独占一行，下方每个指标一行（Token / 美元 / 人民币），
                          // 标签与数值左右对齐，避免原先全挤在一行不易阅读
                          <div style={{ minWidth: 180, lineHeight: 1.8 }}>
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>
                              所有任务累计
                            </div>
                            {/* Token 总量：用千分位完整展示，便于核对精确值 */}
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: 16,
                              }}
                            >
                              <span>Token</span>
                              <span>{claudeTotal.tokens.toLocaleString()}</span>
                            </div>
                            {/* 美元费用：保留 3 位小数 */}
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: 16,
                              }}
                            >
                              <span>美元</span>
                              <span>${claudeTotal.usd.toFixed(3)}</span>
                            </div>
                            {/* 人民币费用：保留 2 位小数 */}
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: 16,
                              }}
                            >
                              <span>人民币</span>
                              <span>¥{claudeTotal.cny.toFixed(2)}</span>
                            </div>
                          </div>
                        }
                      >
                        <Tag
                          icon={<ThunderboltOutlined />}
                          color="purple"
                          style={{ cursor: 'help', margin: 0 }}
                        >
                          总计{' '}
                          {claudeTotal.tokens >= 1000
                            ? `${(claudeTotal.tokens / 1000).toFixed(1)}K`
                            : claudeTotal.tokens}{' '}
                          · ${claudeTotal.usd.toFixed(3)}
                        </Tag>
                      </Tooltip>
                    )}
                  </Space>
                  <Space size={12}>
                    <Button
                      size="small"
                      disabled={!hasHiddenTasks && !showHiddenTasks}
                      onClick={() => setShowHiddenTasks((value) => !value)}
                    >
                      {showHiddenTasks ? '收起隐藏任务' : '显示隐藏任务'}
                    </Button>
                    <Space size={4}>
                      <span
                        style={{
                          color: token.colorTextSecondary,
                          fontSize: 12,
                        }}
                      >
                        排序：
                      </span>
                      <Segmented
                        className="worktree-sort-segmented"
                        size="small"
                        value={wtSortOrder}
                        onChange={setWtSortOrder}
                        options={[
                          { label: '状态', value: 'status' },
                          { label: '名称', value: 'name' },
                        ]}
                      />
                    </Space>
                  </Space>
                </div>
                <WorktreePanel
                  tasks={sortedTasks}
                  loading={worktreeLoading}
                  activeKeys={worktreeActiveKeys}
                  onActiveKeysChange={setWorktreeActiveKeys}
                  onOpenFinder={handleOpenFinder}
                  onOpenVscode={handleOpenVscode}
                  onOpenTerminal={handleOpenTerminal}
                  onCopyPath={handleCopyPath}
                  onRemove={handleRemoveWorktree}
                  onRemoveTask={handleRemoveTask}
                  onPrune={handlePruneWorktree}
                  taskStatusMap={taskStatusMap}
                  onTaskStatusChange={setTaskStatus}
                  taskLinkMap={taskLinkMap}
                  onTaskLinkChange={setTaskLink}
                  onOpenUrl={handleOpenUrl}
                  onAddWorktree={handleAddWorktreeToTask}
                  onEnvCheck={handleEnvCheck}
                  envHealthMap={envHealthMap}
                  cicdLinks={config?.cicdLinks ?? {}}
                  claudeUsageMap={claudeUsageMap}
                  workflowSteps={workflowSteps}
                  workflowMap={taskWorkflowMap}
                  hiddenTaskKeys={taskVisibility.hidden}
                  pinnedTaskKeys={taskVisibility.pinned}
                  hidingTaskKeys={hidingTaskKeys}
                  showHiddenTasks={showHiddenTasks}
                  onTaskHiddenChange={handleTaskHiddenChange}
                  onTaskPinnedChange={setTaskPinned}
                  taskTitleBadges={taskTitleBadges}
                  onToggleStep={toggleWorkflowStep}
                  onRunStepAction={handleRunStepAction}
                  onRunWorkflowSteps={handleRunWorkflowSteps}
                  runningSteps={runningSteps}
                  lastStepOutputs={lastStepOutputs.current}
                  lastOutputVersion={lastOutputVersion}
                  onViewLastOutput={handleViewLastOutput}
                  onViewCurrentOutput={handleViewCurrentOutput}
                />
              </>
            ) : activeView === 'kanban' ? (
              <KanbanView
                tasks={visibleWorktreeTasks}
                workflowSteps={workflowSteps}
                taskWorkflowMap={taskWorkflowMap}
                taskStatusMap={taskStatusMap}
                taskBlockerMap={taskBlockerMap}
                onBlockerChange={setTaskBlocker}
                onTaskClick={(taskName) => {
                  setActiveView('worktrees')
                  localStorage.setItem('vw-active-view', 'worktrees')
                  setWorktreeActiveKeys([taskName])
                }}
              />
            ) : activeView === 'workflow' ? (
              <WorkflowTabView />
            ) : (
              <>
                {/* 概览统计卡片：响应式 —— 大屏一行 4 个，中屏 2x2，超窄屏单列 */}
                <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                  <Col xs={12} sm={12} md={6}>
                    <Card size="small">
                      <Statistic title="项目总数" value={stats.total} />
                    </Card>
                  </Col>
                  <Col xs={12} sm={12} md={6}>
                    <Card size="small">
                      <Statistic
                        title="非主分支"
                        value={stats.nonMain}
                        valueStyle={{ color: '#fa8c16' }}
                      />
                    </Card>
                  </Col>
                  <Col xs={12} sm={12} md={6}>
                    <Card size="small">
                      <Statistic
                        title="有未提交变更"
                        value={stats.hasChanges}
                        valueStyle={{ color: '#cf1322' }}
                      />
                    </Card>
                  </Col>
                  <Col xs={12} sm={12} md={6}>
                    <Card size="small">
                      <Statistic
                        title="可拉取更新"
                        value={stats.canPull}
                        valueStyle={{ color: '#d48806' }}
                      />
                    </Card>
                  </Col>
                </Row>

                {/* 工具栏：筛选 + 搜索 + 批量操作。用 flex-wrap 让窄屏自动换行 */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    marginBottom: 12,
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Space size={10} wrap>
                    <Segmented
                      value={filter}
                      onChange={setFilter}
                      options={[
                        { label: '全部', value: FILTERS.ALL },
                        { label: '非主分支', value: FILTERS.NON_MAIN },
                        { label: '有变更', value: FILTERS.HAS_CHANGES },
                        { label: '可拉取', value: FILTERS.CAN_PULL },
                      ]}
                    />
                    <Input.Search
                      placeholder="搜索项目名"
                      allowClear
                      // 受控绑定 keyword：保证输入框文案与过滤状态始终一致（如切换视图清空关键词时输入框同步清空）
                      value={keyword}
                      // 窄屏下搜索框收窄，避免溢出
                      style={{ width: isNarrow ? 150 : 200 }}
                      onChange={(e) => setKeyword(e.target.value)}
                    />
                    <Button
                      size="small"
                      disabled={!hasHiddenProjects && !showHiddenProjects}
                      onClick={() => setShowHiddenProjects((value) => !value)}
                    >
                      {showHiddenProjects ? '收起隐藏项目' : '显示隐藏项目'}
                    </Button>
                  </Space>
                  <Dropdown
                    menu={{ items: batchMenuItems, onClick: onBatchMenuClick }}
                    disabled={!visibleSelectedPaths.length}
                  >
                    <Button type="primary">
                      批量操作（{visibleSelectedPaths.length}） <DownOutlined />
                    </Button>
                  </Dropdown>
                </div>

                {/* 项目表格：loading 交给外层居中的 Spin 遮罩，这里不再用 Table 自带 loading（避免双转圈） */}
                <ProjectTable
                  data={filtered}
                  loading={false}
                  selectedPaths={visibleSelectedPaths}
                  onSelectChange={setSelectedPaths}
                  onDetail={setDetailProject}
                  onCheckoutMain={handleCheckoutMain}
                  onPull={handlePull}
                  onSyncUpdates={handleSyncUpdates}
                  onOpenFinder={handleOpenFinder}
                  onOpenVscode={handleOpenVscode}
                  onOpenUrl={handleOpenUrl}
                  onOpenTerminal={handleOpenTerminal}
                  onCopyPath={handleCopyPath}
                  hiddenProjectKeys={projectVisibility.hidden}
                  pinnedProjectKeys={projectVisibility.pinned}
                  hidingProjectKeys={hidingProjectKeys}
                  loadingPaths={projectLoadingPaths}
                  showHiddenProjects={showHiddenProjects}
                  onProjectHiddenChange={handleProjectHiddenChange}
                  onProjectPinnedChange={setProjectPinned}
                />
              </>
            )}
          </div>
        </Spin>
      </Content>

      {/* 批量进度弹窗 */}
      <Modal
        title="批量处理中"
        open={!!batchProgress}
        footer={null}
        closable={false}
      >
        {batchProgress && (
          <>
            <Progress
              percent={Math.round(
                (batchProgress.done / batchProgress.total) * 100
              )}
            />
            <div
              style={{
                marginTop: 8,
                color: token.colorTextSecondary,
                fontSize: 12,
              }}
            >
              {batchProgress.done}/{batchProgress.total} ·{' '}
              {batchProgress.current}
            </div>
          </>
        )}
      </Modal>

      {/* 工作流步骤「实时输出」弹窗：执行开始即打开，随 STEP_OUTPUT 事件逐段追加脚本输出，
          结束后顶部状态条显示成败。始终可关闭——关闭后输出仍保存在 lastStepOutputs，
          可通过步骤旁「查看」按钮重新打开；执行中关闭不会中断后台执行（命令仍在跑） */}
      <Modal
        title={
          stepOutput
            ? `「${stepOutput.label}」执行${stepOutput.status === 'running' ? '中…' : '输出'}`
            : ''
        }
        open={!!stepOutput}
        width={720}
        zIndex={STEP_OUTPUT_MODAL_Z_INDEX}
        // 始终允许关闭（按钮/蒙层/ESC）；执行中关闭只是收起弹窗，命令仍在后台跑，结束后可重新查看
        closable={true}
        maskClosable={true}
        keyboard={true}
        onCancel={() => setStepOutput(null)}
        footer={
          // 执行中额外提示「关闭不影响后台执行」；结束后只给「关闭」
          stepOutput?.status === 'running'
            ? [
                <span
                  key="hint"
                  style={{
                    marginRight: 12,
                    color: token.colorTextSecondary,
                    fontSize: 12,
                  }}
                >
                  关闭不会中断执行，可稍后重新查看
                </span>,
                <Button key="close" onClick={() => setStepOutput(null)}>
                  关闭
                </Button>,
              ]
            : [
                <Button key="close" onClick={() => setStepOutput(null)}>
                  关闭
                </Button>,
              ]
        }
      >
        {stepOutput && (
          <>
            {/* 顶部状态条：执行中转圈、成功绿色、失败红色，让用户一眼看到当前阶段 */}
            <div style={{ marginBottom: 8, fontSize: 12 }}>
              {stepOutput.status === 'running' && (
                <span style={{ color: token.colorPrimary }}>
                  <Spin size="small" /> 正在执行，实时输出如下…
                </span>
              )}
              {stepOutput.status === 'success' && (
                <span style={{ color: token.colorSuccess }}>
                  执行成功（退出码 0）
                </span>
              )}
              {stepOutput.status === 'error' && (
                <span style={{ color: token.colorError }}>
                  执行失败
                  {stepOutput.code != null
                    ? `（退出码 ${stepOutput.code}）`
                    : ''}
                </span>
              )}
            </div>
            {/* 实时输出区：等宽预格式块，保留换行；ref 回调在内容更新后自动滚动到底部，始终展示最新输出 */}
            <pre
              ref={(el) => {
                if (el) el.scrollTop = el.scrollHeight
              }}
              style={{
                maxHeight: 420,
                minHeight: 120,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                fontSize: 12,
                margin: 0,
                background: token.colorFillQuaternary,
                padding: 8,
                borderRadius: 4,
              }}
            >
              {stepOutput.content ||
                (stepOutput.status === 'running'
                  ? '（等待输出…）'
                  : '（无输出）')}
            </pre>
          </>
        )}
      </Modal>

      {/* 详情抽屉：宽度自适应，窄屏占满，宽屏固定 560 */}
      <ProjectDetail
        project={detailProject}
        drawerWidth={isNarrow ? '100%' : 560}
        onClose={() => setDetailProject(null)}
        onOpenFinder={handleOpenFinder}
        onOpenVscode={handleOpenVscode}
        worktreesRoot={config?.worktreesPath}
        hiddenTaskKeys={taskVisibility.hidden}
        pinnedTaskKeys={taskVisibility.pinned}
        showHiddenTasks={showHiddenTasks}
      />

      {/* 设置弹窗 */}
      <SettingsModal
        open={settingsOpen}
        config={config}
        onClose={() => setSettingsOpen(false)}
        onSaved={applySavedConfig}
      />

      {/* 按任务创建 worktree 弹窗 */}
      <CreateWorktreeModal
        open={createWtOpen}
        projects={projects}
        projectsLoading={loading}
        worktreesPath={config?.worktreesPath}
        defaultTask={createWtDefaultTask}
        onSubmit={handleCreateWorktree}
        onClose={() => {
          setCreateWtOpen(false)
          setCreateWtDefaultTask(null)
        }}
      />

      {/* Worktree 清理建议弹窗：展示可安全删除的 worktree（已合并+无改动），勾选+二次确认删除 */}
      <CleanupSuggestionsModal
        open={cleanupOpen}
        onClose={() => setCleanupOpen(false)}
        onDeleted={scanWorktrees}
      />

      {/* 环境健康检查结果弹窗：展示依赖/端口/服务/Git 检查结果 */}
      <Modal
        title={envCheckTaskName ? `环境检查 · ${envCheckTaskName}` : '环境检查'}
        open={envCheckOpen}
        onCancel={() => setEnvCheckOpen(false)}
        className="env-health-modal"
        footer={[
          <Button
            key="refresh"
            loading={envCheckLoading}
            onClick={() =>
              runEnvHealthCheck(
                { task: envCheckTaskName, path: envCheckTaskDir },
                { open: true }
              )
            }
            style={{ minWidth: 92 }}
          >
            重新检查
          </Button>,
          <Button key="close" onClick={() => setEnvCheckOpen(false)}>
            关闭
          </Button>,
        ]}
        width={720}
      >
        {/* 统一 minHeight：首次检查时 loading 态有稳定高度；重新检查时保留旧结果并叠加遮罩，避免弹窗内容高度骤变（CLS）。 */}
        <div
          className="env-health-result-shell"
          style={{
            minHeight: 240,
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            justifyContent:
              !envCheckResult && envCheckLoading ? 'center' : 'flex-start',
          }}
        >
          {envCheckResult ? (
            <EnvHealthResultContent result={envCheckResult} token={token} />
          ) : envCheckLoading ? (
            <Space orientation="vertical" align="center" size={8}>
              <Spin />
              <Typography.Text type="secondary">检查中...</Typography.Text>
            </Space>
          ) : null}
          {envCheckLoading && envCheckResult ? (
            <div
              className="env-health-refresh-overlay"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: token.borderRadiusLG,
                zIndex: 1,
              }}
            >
              <Space orientation="vertical" align="center" size={8}>
                <Spin />
                <Typography.Text type="secondary">检查中...</Typography.Text>
              </Space>
            </div>
          ) : null}
        </div>
      </Modal>

      {/* 已删除任务历史弹窗：展示任务名、链接、删除时间，支持删除单条和分页 */}
      <Modal
        title="历史任务"
        open={historyOpen}
        onCancel={() => setHistoryOpen(false)}
        footer={null}
        width={560}
      >
        <div ref={historyListShellRef} className="history-task-list-shell">
          <List
            className="history-task-list"
            dataSource={taskHistory}
            locale={{ emptyText: '暂无历史任务记录' }}
            pagination={historyPagination}
            renderItem={(item, idx) => {
              // historyIndex 存储当前页内下标换算后的完整历史数组下标，用于删除 IPC。
              const historyIndex = getHistoryGlobalIndex({
                page: historyPage,
                pageSize: historyPageSize,
                pageIndex: idx,
              })
              // historyTaskName 存储当前历史记录的任务名，供列表展示、浮层展示和复制复用。
              const historyTaskName = String(item.task || '')
              // historyLinks 存储当前历史记录归一化后的需求/工单链接列表，兼容旧版字符串和新版对象数组。
              const historyLinks = normalizeTaskLinkItems(item.link)
              // hasDocsPath 标记该历史记录是否存在已归档工作记录目录，决定 Finder/VSCode 操作是否可用。
              const hasDocsPath = Boolean(item.docsPath)
              // finderTitle 存储 Finder 按钮的可访问标题和悬停提示；无归档目录时解释禁用原因。
              const finderTitle = hasDocsPath
                ? '在 Finder 显示工作记录'
                : '暂无工作记录归档，无法在 Finder 显示'
              // vscodeTitle 存储 VSCode 按钮的可访问标题和悬停提示；无归档目录时解释禁用原因。
              const vscodeTitle = hasDocsPath
                ? '用 VSCode 打开工作记录'
                : '暂无工作记录归档，无法用 VSCode 打开'
              // statusMeta 存储历史任务人工状态的展示元信息；空状态不渲染标签。
              const statusMeta = item.status
                ? getTaskStatusMeta(item.status)
                : null

              return (
                <List.Item className="history-task-list-item">
                  <div className="history-task-entry">
                    <div className="history-task-content">
                      <div className="history-task-title-row">
                        {/* taskName 任务名：列表中固定单行省略，完整内容通过统一 Tooltip 查看。 */}
                        <HistorySingleLineText
                          text={historyTaskName}
                          className="history-task-name"
                          strong
                        />
                        {statusMeta && (
                          <Tag
                            color={statusMeta.color}
                            style={{ marginInlineEnd: 0 }}
                          >
                            {statusMeta.label}
                          </Tag>
                        )}
                      </div>
                      {/* link 工单/需求链接（若有）：兼容旧版 URL 字符串/数组与新版命名链接数组。 */}
                      {historyLinks.map((link, linkIndex) => {
                        // linkText 存储列表中展示的链接文本，优先使用用户配置的链接名称。
                        const linkText = link.name || link.url
                        // linkKey 存储链接项 React key，URL 缺失时用下标兜底以兼容历史脏数据。
                        const linkKey = link.url || `${linkText}-${linkIndex}`

                        return (
                          <HistorySingleLineText
                            key={linkKey}
                            text={linkText}
                            className="history-task-link"
                            isLink
                            onClick={() => handleOpenUrl(link.url)}
                          />
                        )
                      })}
                      {/* deletedAt 删除时间戳：格式化为本地时间。 */}
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12 }}
                      >
                        删除于 {new Date(item.deletedAt).toLocaleString()}
                      </Typography.Text>
                    </div>
                    <div className="history-task-actions">
                      <Tooltip title={finderTitle}>
                        <span className="history-task-action-slot">
                          <Button
                            size="small"
                            type="text"
                            title={finderTitle}
                            aria-label={finderTitle}
                            disabled={!hasDocsPath}
                            icon={<FolderOpenOutlined />}
                            onClick={
                              hasDocsPath
                                ? () => handleOpenFinder(item.docsPath)
                                : undefined
                            }
                          />
                        </span>
                      </Tooltip>
                      <Tooltip title={vscodeTitle}>
                        <span className="history-task-action-slot">
                          <Button
                            size="small"
                            type="text"
                            title={vscodeTitle}
                            aria-label={vscodeTitle}
                            disabled={!hasDocsPath}
                            icon={<VscodeIcon />}
                            onClick={
                              hasDocsPath
                                ? () => handleOpenVscode(item.docsPath)
                                : undefined
                            }
                          />
                        </span>
                      </Tooltip>
                      <Tooltip title="从历史中移除">
                        <span className="history-task-action-slot">
                          <Button
                            size="small"
                            type="text"
                            danger
                            title="从历史中移除"
                            aria-label="从历史中移除"
                            icon={<DeleteOutlined />}
                            onClick={() =>
                              requestDeleteHistory(
                                historyIndex,
                                historyTaskName
                              )
                            }
                          />
                        </span>
                      </Tooltip>
                    </div>
                  </div>
                </List.Item>
              )
            }}
          />
        </div>
      </Modal>
    </Layout>
  )
}
