import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Drawer,
  Form,
  Input,
  Switch,
  Select,
  AutoComplete,
  Button,
  Space,
  Tabs,
  App as AntApp,
  Typography,
  Tag,
  Modal,
  InputNumber,
  Tooltip,
  Checkbox,
} from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
  MinusCircleOutlined,
  EditOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { api } from '../api.ts'
import { useStore } from '../store/useStore.ts'
import {
  DEFAULT_WORKFLOW_STEPS,
  TASK_ARG_MODE_APPEND_PATH,
  TASK_ARG_MODE_AUTO,
  TASK_ARG_MODE_NONE,
  normalizeWorkflowSteps,
} from '../workflowLogic.ts'
import {
  TASK_TITLE_BADGE_ITEMS,
  normalizeTaskTitleBadges,
} from '../visibilityLogic.ts'
import { withConfirmDefaults } from '../modalDefaults.ts'
import {
  DEFAULT_TASK_STATUS,
  TASK_STATUS_COLOR_SEQUENCE,
  TASK_STATUS_LABEL_MAX_LENGTH,
  TASK_STATUS_MAX_COUNT,
  normalizeTaskStatuses,
} from '../../core/taskStatuses.js'
import { normalizeKanbanSettings } from '../../core/kanbanSettings.js'
import {
  TASK_TAG_COLOR_OPTIONS,
  TASK_TAG_LABEL_MAX_LENGTH,
  TASK_TAG_MAX_COUNT,
  createTaskTagDraft,
  normalizeTaskTags,
} from '../../core/taskTags.js'
import './SettingsModal.css'

// 默认工作文档模板：设置页缺省时只配置会归档的 docs 目录，固定说明文件由核心层单独生成。
const DEFAULT_WORK_DOCUMENT_TEMPLATES = [
  { type: 'directory', path: 'docs', content: '' },
]
// 设置抽屉：按业务分类配置路径、工具、工作文档、流程、Token 费用、展示与 CI/CD。
// Text 用于设置项内的辅助说明文字。
const { Text } = Typography
// 流程步骤详情弹层层级：需高于设置 Drawer，避免弹层被抽屉遮挡。
const WORKFLOW_STEP_EDITOR_Z_INDEX = 1300
// 工作文档详情弹层层级：需高于设置 Drawer，避免弹层被抽屉遮挡。
const WORK_DOCUMENT_EDITOR_Z_INDEX = 1300
// 路径组合管理弹层层级：需高于设置 Drawer，避免弹层被抽屉遮挡。
const PATH_PROFILE_EDITOR_Z_INDEX = 1300
// 任务状态编辑弹层层级：需高于设置 Drawer，避免弹层被抽屉遮挡。
const TASK_STATUS_EDITOR_Z_INDEX = 1300
// 任务分类编辑弹层层级：需高于设置 Drawer，避免弹层被抽屉遮挡。
const TASK_TAG_EDITOR_Z_INDEX = 1300
// Token 模型价格管理弹层层级：需高于设置 Drawer，避免弹层被抽屉遮挡。
const TOKEN_PRICING_EDITOR_Z_INDEX = 1300
// WORKFLOW_TASK_ARG_MODE_OPTIONS 存储流程步骤「任务目录参数」的下拉选项。
const WORKFLOW_TASK_ARG_MODE_OPTIONS = [
  { label: '自动', value: TASK_ARG_MODE_AUTO },
  { label: '不追加', value: TASK_ARG_MODE_NONE },
  { label: '总是追加', value: TASK_ARG_MODE_APPEND_PATH },
]
// AI_MODEL_OPTIONS 按官方模型家族组织常用选项，同时允许兼容接口输入自定义模型名称。
const AI_MODEL_OPTIONS = [
  {
    label: 'GPT-5.6 系列',
    options: [
      { label: 'GPT-5.6 Sol（旗舰能力）', value: 'gpt-5.6-sol' },
      { label: 'GPT-5.6（Sol 别名）', value: 'gpt-5.6' },
      { label: 'GPT-5.6 Terra（能力与成本平衡）', value: 'gpt-5.6-terra' },
      { label: 'GPT-5.6 Luna（低成本高吞吐）', value: 'gpt-5.6-luna' },
    ],
  },
  {
    label: 'GPT-5.5 系列',
    options: [
      { label: 'GPT-5.5（复杂专业任务）', value: 'gpt-5.5' },
      {
        label: 'GPT-5.5 Pro（当前流式聊天不可用）',
        value: 'gpt-5.5-pro',
        disabled: true,
      },
    ],
  },
  {
    label: 'GPT-5.4 系列',
    options: [
      { label: 'GPT-5.4', value: 'gpt-5.4' },
      { label: 'GPT-5.4 Mini', value: 'gpt-5.4-mini' },
      { label: 'GPT-5.4 Nano', value: 'gpt-5.4-nano' },
    ],
  },
]

// DISPLAY_BADGE_DESCRIPTIONS 存储「设置 → 展示」中每个任务标题徽标的用户友好说明。
const DISPLAY_BADGE_DESCRIPTIONS = {
  taskTag: '区分需求、BUG 等任务类型。',
  projectCount: '任务包含的项目数。',
  taskStatus: '任务当前状态。',
  taskLinks: '任务关联的需求链接。',
  claudeUsage: '任务 Token 与费用。',
}

// SETTINGS_HELP_TEXT 存储设置页各字段与分组标题的问号说明，统一维护用户可见的配置含义。
const SETTINGS_HELP_TEXT = {
  currentPathProfile: '切换项目和 Worktree 使用的路径组合。',
  mainBranches: '用于识别和切换仓库主分支，如 master、main。',
  gitlabMergeTargetBranches:
    'GitLab 新建 Merge Request 时可选择的目标分支，可配置多个。',
  ignoredProjects: '扫描时跳过指定目录名。',
  autoFetch: '同步远程引用，状态更准确但耗时更长。',
  editorCommand: '编辑器启动命令，{path} 代表项目路径。',
  terminalApp: '选择打开项目目录的终端应用。',
  aiModel: '后端调用的模型名称。',
  aiApiKey: 'Key 加密保存在本机，留空保留当前值。',
  aiBaseUrl: '兼容 OpenAI 协议的接口地址；留空使用默认地址。',
  workDocumentTemplates: '新建任务时创建、删除任务时归档；仅用于任务目录。',
  workDocumentType: '目录归档整个目录；文件可预置内容。',
  workDocumentPath: '相对任务根目录的路径，不支持绝对路径或 ..。',
  workDocumentContent: '新建文件时写入的初始内容。',
  workflowSteps: '任务流程步骤；命令支持 {path}、{task}、{branch}。',
  workflowStepName: '流程中显示的步骤名称。',
  workflowCommand: '步骤执行的命令，支持 {path}、{task}、{branch}。',
  workflowTaskArgMode: '控制是否向命令追加任务目录。',
  workflowAutoCheck: '命令成功后自动标记步骤完成。',
  workflowStopOnFailure: '步骤失败时停止后续命令。',
  aiUsageTool: '任务 Token 和费用统计的数据来源。',
  customPricing: '为当前统计工具单独设置 Token 单价。',
  tokenPricingModels: '按日志中的模型标识精确匹配；未匹配时使用默认价格。',
  tokenPricingMultiplier: '中转站对原始费用应用的计费倍率，如 0.30x 填 0.3。',
  tokenInputPrice: '每百万输入 Token 的美元单价。',
  tokenOutputPrice: '每百万输出 Token 的美元单价。',
  tokenCacheWritePrice: '每百万缓存写入 Token 的美元单价。',
  tokenCacheReadPrice: '每百万缓存读取 Token 的美元单价。',
  usdToCny: '费用换算使用的美元兑人民币汇率。',
  directCnyDisplay:
    '中转站通常按人民币 1:1 扣费；开启后按美元计价数值直接显示人民币。',
  displayPreferences: '选择任务标题显示的辅助信息。',
  taskTags: '区分需求、BUG 等任务类型，可自定义名称和颜色。',
  taskStatuses: '管理任务状态；状态顺序同时决定看板列顺序。',
  cicdLinks: '按项目配置 CI/CD 页面地址。',
  pathProfileEntry: '一组项目根目录和 Worktree 根目录。',
  pathProfileName: '路径组合的显示名称。',
  sourceProjectsPath: '存放源 Git 项目的根目录。',
  worktreesPath: '按“任务/项目”存放 Worktree 的根目录。',
}
// AI_USAGE_TOOL_OPTIONS 存储 Token 统计工具多选项及用户可见名称。
const AI_USAGE_TOOL_OPTIONS = [
  { label: 'Claude Code', value: 'claude-code' },
  { label: 'Codex', value: 'codex' },
]
// TOKEN_MODEL_OPTIONS_BY_TOOL 存储各统计工具常用的新模型，同时允许输入日志中的其他模型标识。
const TOKEN_MODEL_OPTIONS_BY_TOOL = {
  'claude-code': [
    {
      label: 'Claude Opus 5',
      value: 'claude-opus-5',
      pricing: {
        input: 5,
        output: 25,
        cacheWrite: 6.25,
        cacheRead: 0.5,
        multiplier: 0.4,
      },
    },
    {
      label: 'Claude Opus 4.8',
      value: 'claude-opus-4-8',
      pricing: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
    },
    {
      label: 'Claude Sonnet 5',
      value: 'claude-sonnet-5',
      pricing: {
        input: 2,
        output: 10,
        cacheWrite: 2.5,
        cacheRead: 0.2,
        multiplier: 0.4,
      },
    },
    {
      label: 'Claude Sonnet 4.6',
      value: 'claude-sonnet-4-6',
      pricing: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
    },
    {
      label: 'Claude Haiku 4.5',
      value: 'claude-haiku-4-5',
      pricing: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
    },
  ],
  codex: [
    {
      label: 'GPT-5.6 Sol',
      value: 'gpt-5.6-sol',
      pricing: {
        input: 5,
        output: 30,
        cacheWrite: 0,
        cacheRead: 0.5,
        multiplier: 0.3,
      },
    },
    {
      label: 'GPT-5.6 Terra',
      value: 'gpt-5.6-terra',
      pricing: {
        input: 2,
        output: 12,
        cacheWrite: 0,
        cacheRead: 0.2,
        multiplier: 0.3,
      },
    },
    { label: 'GPT-5.6 Luna', value: 'gpt-5.6-luna' },
    { label: 'GPT-5.5', value: 'gpt-5.5' },
  ],
}
// TOKEN_PRICING_FIELDS 存储每个工具独立维护的四种 Token 单价字段。
const TOKEN_PRICING_FIELDS = [
  {
    key: 'input',
    label: 'Input 单价',
    tooltip: SETTINGS_HELP_TEXT.tokenInputPrice,
  },
  {
    key: 'output',
    label: 'Output 单价',
    tooltip: SETTINGS_HELP_TEXT.tokenOutputPrice,
  },
  {
    key: 'cacheWrite',
    label: 'Cache write 单价',
    tooltip: SETTINGS_HELP_TEXT.tokenCacheWritePrice,
  },
  {
    key: 'cacheRead',
    label: 'Cache read 单价',
    tooltip: SETTINGS_HELP_TEXT.tokenCacheReadPrice,
  },
]
// DEFAULT_MODEL_PRICING_DRAFT 存储新增模型价格时的可编辑初始值。
const DEFAULT_MODEL_PRICING_DRAFT = {
  model: '',
  input: 3,
  output: 15,
  cacheWrite: 3.75,
  cacheRead: 0.3,
  multiplier: 1,
}

// 编辑器打开命令的预置选项：覆盖常见编辑器；用 AutoComplete 既可下拉选择也可手动输入自定义命令。
// {path} 为路径占位符；code 命令会在主进程自动注入 -n 新窗口打开，避免替换当前窗口。
const EDITOR_COMMAND_OPTIONS = [
  { label: 'VSCode（code {path}）', value: 'code {path}' },
  { label: 'Cursor（cursor {path}）', value: 'cursor {path}' },
  { label: 'Trae（trae {path}）', value: 'trae {path}' },
  { label: 'WebStorm（webstorm {path}）', value: 'webstorm {path}' },
]

// 各平台终端应用下拉选项：Windows 用 Windows Terminal/PowerShell/cmd，macOS 用 Terminal/iTerm2/Ghostty。
// value 与主进程 openInTerminal/resolveTerminalKind 识别的 terminalApp 取值保持一致。
const TERMINAL_OPTIONS_WIN32 = [
  { value: 'wt', label: 'Windows Terminal（推荐，Win11 自带）' },
  { value: 'powershell', label: 'PowerShell（Windows 自带）' },
  { value: 'cmd', label: 'cmd（Windows 自带，兜底）' },
]
// macOS 终端选项（保持原有）
const TERMINAL_OPTIONS_DARWIN = [
  { value: 'Terminal', label: 'Terminal（macOS 默认，推荐）' },
  { value: 'iTerm2', label: 'iTerm2' },
  { value: 'Ghostty', label: 'Ghostty' },
]
// PATH_PROFILE_ID_PREFIX 存储设置页新建路径组合时使用的 id 前缀。
const PATH_PROFILE_ID_PREFIX = 'path-profile'
// CUSTOM_TASK_STATUS_KEY_PREFIX 存储设置页新增状态生成稳定 key 时使用的前缀。
const CUSTOM_TASK_STATUS_KEY_PREFIX = 'custom-status'
// customTaskStatusSequence 存储当前进程新增状态的递增序号，与时间戳组合避免快速删加产生重复 key。
let customTaskStatusSequence = 0

/**
 * 创建一条尚未命名的新任务状态表单数据。
 * @param {number} index - 新状态加入列表前的状态数量，用于轮换语义颜色和生成唯一后缀。
 * @returns {{key:string,label:string,color:string}} 可直接加入 Form.List 的状态草稿。
 */
function createTaskStatusDraft(index) {
  customTaskStatusSequence += 1
  // color 存储按当前状态数量轮换得到的 Ant Design 语义标签颜色。
  const color =
    TASK_STATUS_COLOR_SEQUENCE[index % TASK_STATUS_COLOR_SEQUENCE.length]
  // key 存储不随标签重命名变化的状态标识；时间戳与进程序号组合避免连续新增冲突。
  const key = `${CUSTOM_TASK_STATUS_KEY_PREFIX}-${Date.now()}-${customTaskStatusSequence}`
  return { key, label: '', color }
}

/**
 * 渲染设置页列表底部的全宽新增按钮，统一工作文档、流程和路径组合的交互样式。
 * @param {object} props - 组件属性
 * @param {React.ReactNode} props.children - 按钮展示文案
 * @param {()=>void} props.onClick - 点击新增时执行的回调
 * @param {boolean} [props.disabled] - 是否禁用新增操作
 * @returns {JSX.Element} 全宽虚线新增按钮
 */
function AddListButton({ children, onClick, disabled = false }) {
  return (
    <Button
      block
      type="dashed"
      icon={<PlusOutlined />}
      className="settings-add-list-button"
      aria-label={typeof children === 'string' ? children : undefined}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  )
}

/**
 * 渲染带统一问号说明的非表单小标题。
 * @param {object} props - 组件属性
 * @param {string} props.label - 小标题文案
 * @param {string} props.help - 悬停问号时展示的说明
 * @returns {JSX.Element} 带问号 Tooltip 的小标题
 */
function SettingTitleWithHelp({ label, help }) {
  return (
    <span className="settings-title-with-help">
      <Text strong>{label}</Text>
      <Tooltip title={help}>
        <QuestionCircleOutlined
          aria-label={`${label}说明`}
          className="settings-title-help-icon"
        />
      </Tooltip>
    </span>
  )
}
// DEFAULT_PATH_PROFILE_NAME 存储旧配置迁移到路径组合时使用的默认名称。
const DEFAULT_PATH_PROFILE_NAME = '工作路径'

/**
 * 将配置里的路径组合规范化为设置表单可直接使用的结构。
 * @param {object|null} config - 当前应用配置
 * @returns {{pathProfiles:Array,activePathProfileId:string}} 表单路径组合与当前启用 id
 */
function normalizePathProfilesForForm(config) {
  // fallbackProfile 存储从旧版顶层路径字段构造出的默认组合。
  const fallbackProfile = {
    id: 'default',
    name: DEFAULT_PATH_PROFILE_NAME,
    sourceProjectsPath: config?.sourceProjectsPath || '',
    worktreesPath: config?.worktreesPath || '',
  }
  // rawProfiles 存储配置里的路径组合数组；旧配置没有该字段时用 fallbackProfile 迁移。
  const rawProfiles =
    Array.isArray(config?.pathProfiles) && config.pathProfiles.length > 0
      ? config.pathProfiles
      : [fallbackProfile]
  // profiles 存储清洗后的路径组合表单值。
  let profiles = rawProfiles
    .map((profile, index) => ({
      id: String(
        profile?.id ||
          (index === 0 ? 'default' : `${PATH_PROFILE_ID_PREFIX}-${index + 1}`)
      ).trim(),
      name: String(profile?.name || `路径组合 ${index + 1}`).trim(),
      sourceProjectsPath: String(
        profile?.sourceProjectsPath || fallbackProfile.sourceProjectsPath || ''
      ).trim(),
      worktreesPath: String(
        profile?.worktreesPath || fallbackProfile.worktreesPath || ''
      ).trim(),
    }))
    .filter((profile) => profile.id)
  if (profiles.length === 0) profiles = [fallbackProfile]
  // activePathProfileId 存储当前启用组合 id；失效时回退第一组。
  const activePathProfileId = profiles.some(
    (profile) => profile.id === config?.activePathProfileId
  )
    ? config.activePathProfileId
    : profiles[0].id
  return { pathProfiles: profiles, activePathProfileId }
}

/**
 * 创建一个新的路径组合草稿。
 * @param {number} index - 新组合即将插入的下标
 * @returns {{id:string,name:string,sourceProjectsPath:string,worktreesPath:string}} 新路径组合草稿
 */
function createPathProfileDraft(index) {
  // timestamp 存储当前时间戳，确保连续新增的组合 id 不与已有组合冲突。
  const timestamp = Date.now()
  // id 存储新组合的唯一标识。
  const id = `${PATH_PROFILE_ID_PREFIX}-${timestamp}-${index + 1}`
  // name 存储新组合名称；新增时留空，让用户手动输入并走必填校验。
  const name = ''
  // sourceProjectsPath 存储新组合源项目根目录；新增时留空，让用户明确选择/输入。
  const sourceProjectsPath = ''
  // worktreesPath 存储新组合 worktree 根目录；新增时留空，让用户明确选择/输入。
  const worktreesPath = ''
  return { id, name, sourceProjectsPath, worktreesPath }
}

/**
 * 把 Form 字段路径转成稳定字符串 key，用于目录选择按钮 loading 状态。
 * @param {string|string[]} fieldName - Form 字段名或字段路径数组
 * @returns {string} 可比较的字段 key
 */
function getFormFieldKey(fieldName) {
  return Array.isArray(fieldName)
    ? fieldName.join('.')
    : String(fieldName || '')
}

/**
 * 保存前清洗路径组合列表，过滤损坏项并补齐展示名。
 * @param {Array} rawProfiles - 表单收集到的路径组合数组
 * @returns {Array<{id:string,name:string,sourceProjectsPath:string,worktreesPath:string}>} 可保存的路径组合
 */
function normalizePathProfilesForSave(rawProfiles) {
  // profiles 存储表单里的路径组合数组；非数组时回退空数组。
  const profiles = Array.isArray(rawProfiles) ? rawProfiles : []
  return profiles
    .map((profile, index) => ({
      id: String(
        profile?.id || `${PATH_PROFILE_ID_PREFIX}-${index + 1}`
      ).trim(),
      name: String(profile?.name || `路径组合 ${index + 1}`).trim(),
      sourceProjectsPath: String(profile?.sourceProjectsPath || '').trim(),
      worktreesPath: String(profile?.worktreesPath || '').trim(),
    }))
    .filter(
      (profile) =>
        profile.id && profile.sourceProjectsPath && profile.worktreesPath
    )
}

/**
 * 从路径组合列表中解析当前启用的组合 id。
 * @param {string} rawActivePathProfileId - 表单当前选择的组合 id
 * @param {Array<{id:string}>} pathProfiles - 已清洗的路径组合列表
 * @returns {string} 有效的当前组合 id
 */
function resolveActivePathProfileId(rawActivePathProfileId, pathProfiles) {
  // activePathProfileId 存储去空白后的候选组合 id。
  const activePathProfileId = String(rawActivePathProfileId || '').trim()
  return pathProfiles.some((profile) => profile.id === activePathProfileId)
    ? activePathProfileId
    : pathProfiles[0]?.id
}

/**
 * 按运行平台返回终端应用下拉选项。
 * @param {string} platform - 运行平台标识（来自 api.platform，如 'win32'|'darwin'）
 * @returns {{value:string,label:string}[]} 当前平台可选的终端应用列表
 */
function getTerminalOptions(platform) {
  // Windows 展示 wt/powershell/cmd，其余（macOS/Linux）展示 Terminal 系
  return platform === 'win32' ? TERMINAL_OPTIONS_WIN32 : TERMINAL_OPTIONS_DARWIN
}

/**
 * 设置抽屉
 * @param {object} props - 组件属性
 * @param {boolean} props.open - 是否打开
 * @param {object|null} props.config - 当前配置
 * @param {()=>void} props.onClose - 关闭回调
 * @param {(cfg:object)=>void} props.onSaved - 保存成功回调
 * @returns {JSX.Element} 抽屉元素
 */
export default function SettingsModal({
  open,
  config,
  updateVersion,
  updateError,
  updateChecked,
  updateChecking,
  updateCheckDetails,
  updateDownloading,
  updateDownloadPercent,
  onCheckUpdate,
  onDownloadUpdate,
  onClose,
  onSaved,
}) {
  // antd 表单实例
  const [form] = Form.useForm()
  // watchedTaskStatuses 存储表单中的动态任务状态，用于实时清洗看板列设置。
  const watchedTaskStatuses = Form.useWatch('taskStatuses', {
    form,
    preserve: true,
  })
  // watchedKanbanSettings 存储表单中的看板显示与固定偏好，用于驱动状态行控件。
  const watchedKanbanSettings = Form.useWatch('kanbanSettings', {
    form,
    preserve: true,
  })
  // editorKanbanSettings 存储与当前任务状态一致的有效看板列设置。
  const editorKanbanSettings = normalizeKanbanSettings(
    watchedKanbanSettings || config?.kanbanSettings,
    watchedTaskStatuses || config?.taskStatuses
  )

  /**
   * 校验单个任务状态标签非空且不与其他状态重复，避免状态菜单出现无法区分的选项。
   * @param {object} _rule - Ant Design 传入的当前校验规则，本校验无需读取。
   * @param {string} value - 当前状态标签输入值。
   * @returns {Promise<void>} 标签有效时完成，否则返回字段校验错误。
   */
  const validateTaskStatusLabel = async (_rule, value) => {
    // normalizedLabel 存储去除首尾空白后的当前标签。
    const normalizedLabel = typeof value === 'string' ? value.trim() : ''
    if (!normalizedLabel) throw new Error('请输入状态标签')
    // currentStatuses 存储表单中全部动态状态，用于检测清理空白后的重复文案。
    const currentStatuses = form.getFieldValue('taskStatuses') || []
    // duplicateCount 存储与当前标签相同的字段数量；大于 1 表示菜单会出现重复项。
    const duplicateCount = currentStatuses.filter(
      (status) =>
        typeof status?.label === 'string' &&
        status.label.trim() === normalizedLabel
    ).length
    if (duplicateCount > 1) throw new Error('状态标签不能重复')
  }
  /**
   * 校验任务分类名称非空且不重复，保证下拉选项可明确区分。
   * @param {object} _rule - Ant Design 当前校验规则，本校验无需读取。
   * @param {string} value - 当前分类名称。
   * @returns {Promise<void>} 分类名称有效时完成，否则返回字段校验错误。
   */
  const validateTaskTagLabel = async (_rule, value) => {
    // normalizedLabel 存储去除首尾空白后的当前分类名称。
    const normalizedLabel = typeof value === 'string' ? value.trim() : ''
    if (!normalizedLabel) throw new Error('请输入分类名称')
    // currentTags 存储表单中的全部任务分类，用于检测重复名称。
    const currentTags = form.getFieldValue('taskTags') || []
    // duplicateCount 存储清理空白后与当前名称相同的分类数量。
    const duplicateCount = currentTags.filter(
      (tag) =>
        typeof tag?.label === 'string' && tag.label.trim() === normalizedLabel
    ).length
    if (duplicateCount > 1) throw new Error('分类名称不能重复')
  }
  // fallbackPathProfileState 存储从配置推导出的路径组合，用于路径组合表单尚未挂载时给当前组合下拉兜底。
  const fallbackPathProfileState = useMemo(
    () => normalizePathProfilesForForm(config),
    [config]
  )
  // watchedPathProfiles 存储路径组合表单当前值，用于驱动「当前路径组合」下拉选项实时刷新；preserve 允许读取尚未挂载到弹层中的字段。
  const watchedPathProfiles =
    Form.useWatch('pathProfiles', { form, preserve: true }) ||
    form.getFieldValue('pathProfiles')
  // effectivePathProfiles 存储当前用于渲染路径组合下拉的列表；表单未挂载/未同步时先使用配置兜底。
  const effectivePathProfiles =
    Array.isArray(watchedPathProfiles) && watchedPathProfiles.length > 0
      ? watchedPathProfiles
      : fallbackPathProfileState.pathProfiles
  // pathProfileOptions 存储当前路径组合下拉选项，名称编辑后立即反映在 Select 中。
  const pathProfileOptions = useMemo(() => {
    // profiles 存储可用于生成下拉选项的路径组合数组。
    return effectivePathProfiles
      .filter((profile) => profile?.id)
      .map((profile, index) => ({
        value: profile.id,
        label:
          String(profile.name || `路径组合 ${index + 1}`).trim() ||
          `路径组合 ${index + 1}`,
      }))
  }, [effectivePathProfiles])
  // workflowEditorIndex 当前正在编辑的流程步骤下标；null 表示未打开编辑弹层。
  const [workflowEditorIndex, setWorkflowEditorIndex] = useState(null)
  // workDocumentEditorIndex 当前正在编辑的工作文档模板下标；null 表示未打开编辑弹层。
  const [workDocumentEditorIndex, setWorkDocumentEditorIndex] = useState(null)
  // pathProfileEditorOpen 标记路径组合管理弹层是否打开。
  const [pathProfileEditorOpen, setPathProfileEditorOpen] = useState(false)
  // taskStatusEditorOpen 标记任务状态编辑弹层是否打开。
  const [taskStatusEditorOpen, setTaskStatusEditorOpen] = useState(false)
  // taskTagEditorOpen 标记任务分类编辑弹层是否打开。
  const [taskTagEditorOpen, setTaskTagEditorOpen] = useState(false)
  // tokenPricingEditorToolId 存储当前正在管理价格的工具标识；空值表示弹层关闭。
  const [tokenPricingEditorToolId, setTokenPricingEditorToolId] = useState('')
  // pickingPathField 当前正在打开系统目录选择器的字段名；空字符串表示没有选择器在执行。
  const [pickingPathField, setPickingPathField] = useState('')
  // saving 标记保存操作是否正在进行，防止重复提交并给按钮提供 loading 反馈。
  const [saving, setSaving] = useState(false)
  // aiApiKeyConfigured 标记当前后端或本机加密存储是否已有 Key，不保存 Key 明文。
  const [aiApiKeyConfigured, setAiApiKeyConfigured] = useState(false)
  // aiApiKeyHint 存储由主进程生成的 Key 末四位掩码，不包含完整凭据。
  const [aiApiKeyHint, setAiApiKeyHint] = useState('')
  // cliVersions 存储 AI CLI 版本检查和更新状态。
  const [cliVersions, setCliVersions] = useState({})
  // loadedAiSettingsRef 存储打开设置时读取到的安全 AI 配置，用于判断普通设置保存是否需要访问凭据存储。
  const loadedAiSettingsRef = useRef({ model: '', baseUrl: '' })
  // aiSettingsReadyRef 存储当前设置打开周期的安全摘要加载任务，保存时等待它完成以避免竞态。
  const aiSettingsReadyRef = useRef(Promise.resolve())
  // resetting 标记恢复默认设置是否正在进行，避免重复点击确认造成并发写配置。
  const [resetting, setResetting] = useState(false)
  // 从 AntApp 上下文取 message，使提示跟随明暗主题
  const { message, modal } = AntApp.useApp()
  /** 检查 AI CLI 版本。 */
  const checkCli = async (toolId) => {
    setCliVersions((s) => ({
      ...s,
      [toolId]: { ...(s[toolId] || {}), loading: true },
    }))
    try {
      const result = await api.checkCliVersion(toolId)
      setCliVersions((s) => ({ ...s, [toolId]: { ...result, loading: false } }))
    } catch (error) {
      setCliVersions((s) => ({
        ...s,
        [toolId]: {
          ...(s[toolId] || {}),
          loading: false,
          error: error?.message || '检查失败',
        },
      }))
    }
  }
  /** 更新 AI CLI 版本。 */
  const updateCli = async (toolId) => {
    setCliVersions((s) => ({
      ...s,
      [toolId]: { ...(s[toolId] || {}), updating: true },
    }))
    try {
      const result = await api.updateCliVersion(toolId)
      setCliVersions((s) => ({
        ...s,
        [toolId]: { ...result, updating: false },
      }))
      message.success(`${result.name} 已更新到 ${result.version}`)
    } catch (error) {
      setCliVersions((s) => ({
        ...s,
        [toolId]: {
          ...(s[toolId] || {}),
          updating: false,
          error: error?.message || '更新失败',
        },
      }))
    }
  }
  // 已扫描到的项目列表，用于 CI/CD Tab 的"项目目录名"下拉选项
  const projects = useStore((s) => s.projects)
  // projectLoading 标记源项目扫描是否正在进行，用于 CI/CD 项目下拉显示 loading 状态。
  const projectLoading = useStore((s) => s.loading)
  // scanProjects 触发源项目扫描；设置页需要在项目视图尚未加载时补齐 CI/CD 下拉选项。
  const scanProjects = useStore((s) => s.scan)
  // projectScanRequestedRef 记录本轮打开设置抽屉是否已发起过补扫，避免源目录为空时反复扫描。
  const projectScanRequestedRef = useRef(false)
  // projectOptions 将项目列表转为 Select options 格式
  const projectOptions = projects.map((p) => ({ label: p.name, value: p.name }))

  // 打开设置页时按需补扫项目列表；默认 worktree 视图启动不会填充 projects，但 CI/CD Tab 需要项目名下拉。
  useEffect(() => {
    if (!open) {
      // 设置页关闭后重置本轮补扫标记，便于下次打开时在项目列表仍为空的情况下重新尝试。
      projectScanRequestedRef.current = false
      // 设置抽屉关闭时同步收起任务状态弹层，避免下次打开残留弹层状态。
      setTaskStatusEditorOpen(false)
      // 设置抽屉关闭时同步收起模型价格弹层，避免下次打开残留状态。
      setTokenPricingEditorToolId('')
      return
    }
    // 已有项目、正在扫描或本轮已请求过时都不重复扫描；尤其要避免源目录暂无仓库时陷入循环。
    if (
      !config ||
      projects.length > 0 ||
      projectLoading ||
      projectScanRequestedRef.current
    )
      return
    projectScanRequestedRef.current = true
    scanProjects({ fetch: false })
  }, [open, config, projects.length, projectLoading, scanProjects])

  // 打开时用当前配置填充表单；cicdLinks 对象转为 Form.List 所需的数组格式
  useEffect(() => {
    if (open && config) {
      // cicdLinksArr 为 Form.List 内部使用的数组，方便增删行
      const cicdLinksArr = Object.entries(config.cicdLinks || {}).map(
        ([project, url]) => ({ project, url })
      )
      // workflowSteps 为流程步骤数组：未配置时用默认清单填充
      const workflowSteps = (
        config.workflowSteps ?? DEFAULT_WORKFLOW_STEPS
      ).map((s) => ({ ...s }))
      // workDocumentTemplates 为工作文档模板数组：未配置时只使用 docs 目录。
      const workDocumentTemplates = normalizeWorkDocumentTemplatesForForm(
        config.workDocumentTemplates ?? DEFAULT_WORK_DOCUMENT_TEMPLATES
      )
      // taskTitleBadges 为任务标题旁徽标展示开关；缺失字段默认全开。
      const taskTitleBadges = normalizeTaskTitleBadges(config.taskTitleBadges)
      // taskStatuses 为当前工作区动态状态定义；兼容旧版只保存标签映射的配置。
      const taskStatuses = normalizeTaskStatuses(
        config.taskStatuses,
        config.taskStatusLabels
      )
      // taskTags 存储当前工作区的自定义任务分类定义。
      const taskTags = normalizeTaskTags(config.taskTags)
      // pathProfileState 存储路径组合表单状态，兼容旧配置里的顶层路径字段。
      const pathProfileState = normalizePathProfilesForForm(config)
      form.setFieldsValue({
        ...config,
        // 旧版单值配置在表单边界迁移为数组，避免升级后保存其它设置时丢失用户原目标分支。
        gitlabMergeTargetBranches: Array.isArray(
          config.gitlabMergeTargetBranches
        )
          ? config.gitlabMergeTargetBranches
          : [config.gitlabMergeTargetBranch || 'test'],
        ...pathProfileState,
        cicdLinksArr,
        workflowSteps,
        workDocumentTemplates,
        taskTitleBadges,
        taskStatuses,
        taskTags,
      })
    }
  }, [open, config, form])

  // 打开设置页时通过 IPC 读取安全投影；返回值只包含模型、地址和 Key 是否存在。
  useEffect(() => {
    if (!open) return
    // canceled 标记组件关闭后的异步结果是否应忽略，避免给已关闭表单赋值。
    let canceled = false
    /**
     * 从 Electron 主进程加载 AI 模型设置并填入表单。
     * @returns {Promise<void>} 加载完成
     */
    const loadAiSettings = async () => {
      // result 存储主进程返回的安全模型配置结果。
      const result = await api.loadAiModelSettings()
      if (canceled) return
      if (!result?.success) {
        message.error(result?.error || '读取 AI 模型配置失败')
        return
      }
      // settings 存储不含 API Key 明文的模型设置。
      const settings = result.settings || {}
      setAiApiKeyConfigured(Boolean(settings.apiKeyConfigured))
      setAiApiKeyHint(settings.apiKeyHint || '')
      loadedAiSettingsRef.current = {
        model: settings.model || 'gpt-5.6-sol',
        baseUrl: settings.baseUrl || '',
      }
      form.setFieldsValue({
        aiModel: settings.model || 'gpt-5.6-sol',
        aiBaseUrl: settings.baseUrl || '',
        aiApiKey: '',
        clearAiApiKey: false,
      })
    }
    aiSettingsReadyRef.current = loadAiSettings().catch((error) => {
      if (!canceled) {
        message.error(`读取 AI 模型配置失败：${error.message}`)
      }
    })
    return () => {
      canceled = true
    }
  }, [open, form, message])

  /**
   * 校验并保存配置；将 Form.List 的数组形式转回对象再持久化
   */
  const handleOk = async () => {
    if (saving) return
    setSaving(true)
    try {
      await aiSettingsReadyRef.current
      await form.validateFields()
      // values 为表单收集的所有 Tab 下的配置值；getFieldsValue(true) 会包含未打开 Tab 中尚未挂载的字段。
      // WHY：antd Tabs 默认懒渲染，未进入「流程/工作文档/CI/CD」页时 validateFields 只返回已挂载字段，
      // 若直接保存会把这些 Form.List 当空数组写盘，导致重启后流程步骤等配置丢失。
      const values = form.getFieldsValue(true)
      // 拆出 Form.List 字段单独处理：路径组合、cicdLinksArr 转对象、workflowSteps / workDocumentTemplates 规范化。
      const {
        pathProfiles: rawPathProfiles = [],
        activePathProfileId: rawActivePathProfileId,
        sourceProjectsPath: legacySourceProjectsPath,
        worktreesPath: legacyWorktreesPath,
        cicdLinksArr = [],
        workflowSteps: rawSteps = [],
        workDocumentTemplates: rawWorkDocumentTemplates = [],
        taskTitleBadges: rawTaskTitleBadges = {},
        taskStatuses: rawTaskStatuses = [],
        taskTags: rawTaskTags,
        kanbanSettings: rawKanbanSettings = {},
        taskStatusLabels: legacyTaskStatusLabels,
        aiModel = 'gpt-5.6-sol',
        aiBaseUrl = '',
        aiApiKey = '',
        clearAiApiKey = false,
        ...rest
      } = values
      // legacySourceProjectsPath/legacyWorktreesPath 存储旧表单残留顶层路径字段；新版统一由 activePathProfile 同步，避免双源状态。
      void legacySourceProjectsPath
      void legacyWorktreesPath
      const cicdLinks = Object.fromEntries(
        cicdLinksArr
          .filter((i) => i?.project?.trim())
          .map((i) => [i.project.trim(), (i.url || '').trim()])
      )
      // pathProfiles 存储保存前清洗后的路径组合列表；至少需要一组完整路径。
      const pathProfiles = normalizePathProfilesForSave(rawPathProfiles)
      if (pathProfiles.length === 0) {
        message.error('请至少保留一组完整的路径组合')
        return
      }
      // activePathProfileId 存储有效的当前路径组合 id；原选择失效时回退第一组。
      const activePathProfileId = resolveActivePathProfileId(
        rawActivePathProfileId,
        pathProfiles
      )
      // activePathProfile 存储当前启用的路径组合，用于同步顶层路径字段。
      const activePathProfile =
        pathProfiles.find((profile) => profile.id === activePathProfileId) ||
        pathProfiles[0]
      // workflowSteps 规范化：过滤空 label、补全/去重 key
      const workflowSteps = normalizeWorkflowSteps(rawSteps)
      // workDocumentTemplates 规范化：过滤空路径，目录内容置空。
      const workDocumentTemplates = normalizeWorkDocumentTemplatesForForm(
        rawWorkDocumentTemplates
      )
      // taskTitleBadges 规范化：老配置缺失字段时按默认全开展示。
      const taskTitleBadges = normalizeTaskTitleBadges(rawTaskTitleBadges)
      // taskStatuses 规范化：保留用户顺序与稳定 key，并清理标签、颜色及旧看板兼容值异常。
      const taskStatuses = normalizeTaskStatuses(
        rawTaskStatuses,
        legacyTaskStatusLabels
      )
      // taskTags 规范化：保留稳定 key、用户顺序与语义颜色；显式空列表允许关闭分类功能。
      const taskTags = normalizeTaskTags(rawTaskTags)
      // kanbanSettings 存储按最终任务状态清洗后的列显示与固定偏好。
      const kanbanSettings = normalizeKanbanSettings(
        rawKanbanSettings,
        taskStatuses
      )
      // aiSettingsChanged 标记模型配置是否实际变化；普通设置保存必须完全跳过钥匙串读写。
      const aiSettingsChanged =
        Boolean(aiApiKey || clearAiApiKey) ||
        aiModel !== loadedAiSettingsRef.current.model ||
        aiBaseUrl !== loadedAiSettingsRef.current.baseUrl
      // aiSettingsResult 仅在 AI 配置变化时保存；null 表示本次只保存普通设置。
      const aiSettingsResult = aiSettingsChanged
        ? await api.saveAiModelSettings({
            model: aiModel,
            baseUrl: aiBaseUrl,
            apiKey: aiApiKey,
            clearApiKey: clearAiApiKey,
          })
        : null
      if (aiSettingsResult && !aiSettingsResult.success)
        throw new Error(aiSettingsResult.error || '保存 AI 模型配置失败')
      if (aiSettingsResult) {
        setAiApiKeyConfigured(
          Boolean(aiSettingsResult.settings?.apiKeyConfigured)
        )
        setAiApiKeyHint(aiSettingsResult.settings?.apiKeyHint || '')
      }
      const saved = await api.saveConfig({
        ...rest,
        onboardingCompleted: true,
        sourceProjectsPath: activePathProfile.sourceProjectsPath,
        worktreesPath: activePathProfile.worktreesPath,
        activePathProfileId,
        pathProfiles,
        cicdLinks,
        workflowSteps,
        workDocumentTemplates,
        taskTitleBadges,
        taskStatuses,
        taskTags,
        kanbanSettings,
      })
      // AI 后端是正式安装包之外的可选服务；离线时本地与普通设置均已保存，只提示同步状态而不判定失败。
      if (aiSettingsResult?.warning) message.warning(aiSettingsResult.warning)
      else message.success('配置已保存')
      onSaved(saved)
      onClose()
    } catch (e) {
      // isValidationError 标记 antd 表单校验失败；字段错误已由表单展示，不额外弹全局错误。
      const isValidationError = Array.isArray(e?.errorFields)
      if (!isValidationError) message.error(`保存配置失败：${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  /**
   * 弹出确认框并在确认后恢复默认配置。
   */
  const handleResetDefaults = () => {
    modal.confirm(
      withConfirmDefaults({
        title: '确认恢复默认设置？',
        content:
          '将恢复路径、工具、流程、工作文档、展示和 CI/CD 等设置；不会删除已有 worktree、任务状态、流程勾选、链接或历史记录。',
        okText: '确认恢复',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: async () => {
          if (resetting) return
          setResetting(true)
          try {
            // defaultConfig 存储主进程写入磁盘后的默认配置，用于同步刷新外层状态。
            const defaultConfig = await api.resetConfig()
            message.success('已恢复默认设置')
            onSaved(defaultConfig)
            onClose()
          } catch (e) {
            message.error(`恢复默认设置失败：${e.message}`)
            setResetting(false)
          }
        },
      })
    )
  }

  /**
   * 打开某个流程步骤的详情编辑弹层
   * @param {number} index - 流程步骤在 Form.List 中的下标
   */
  const openWorkflowStepEditor = (index) => {
    setWorkflowEditorIndex(index)
  }

  /**
   * 关闭流程步骤详情编辑弹层
   */
  const closeWorkflowStepEditor = () => {
    setWorkflowEditorIndex(null)
  }

  /**
   * 打开某个工作文档模板的详情编辑弹层
   * @param {number} index - 工作文档模板在 Form.List 中的下标
   */
  const openWorkDocumentEditor = (index) => {
    setWorkDocumentEditorIndex(index)
  }

  /**
   * 关闭工作文档详情编辑弹层
   */
  const closeWorkDocumentEditor = () => {
    setWorkDocumentEditorIndex(null)
  }

  /**
   * 打开路径组合管理弹层。
   */
  const openPathProfileEditor = () => {
    setPathProfileEditorOpen(true)
  }

  /**
   * 关闭路径组合管理弹层。
   */
  const closePathProfileEditor = () => {
    setPathProfileEditorOpen(false)
  }

  /**
   * 打开任务状态编辑弹层。
   */
  const openTaskStatusEditor = () => {
    setTaskStatusEditorOpen(true)
  }

  /**
   * 关闭任务状态编辑弹层，表单改动保留到设置主表单统一保存。
   */
  const closeTaskStatusEditor = () => {
    setTaskStatusEditorOpen(false)
  }

  /** 打开任务分类编辑弹层。 */
  const openTaskTagEditor = () => {
    setTaskTagEditorOpen(true)
  }

  /** 关闭任务分类编辑弹层，改动保留到设置主表单统一保存。 */
  const closeTaskTagEditor = () => {
    setTaskTagEditorOpen(false)
  }

  /**
   * 切换指定任务状态是否生成看板列，并保证至少保留一个可见列。
   * @param {string} statusKey - 待调整的任务状态稳定 key。
   * @param {boolean} visible - 调整后是否在看板展示。
   */
  const changeKanbanStatusVisibility = (statusKey, visible) => {
    // currentKanbanSettings 存储点击瞬间的最新表单值，避免连续操作使用上一渲染帧的旧配置。
    const currentKanbanSettings = normalizeKanbanSettings(
      form.getFieldValue('kanbanSettings'),
      form.getFieldValue('taskStatuses')
    )
    // hiddenStatusKeys 存储切换后的隐藏列 key。
    const hiddenStatusKeys = visible
      ? currentKanbanSettings.hiddenStatusKeys.filter(
          (hiddenStatusKey) => hiddenStatusKey !== statusKey
        )
      : [...currentKanbanSettings.hiddenStatusKeys, statusKey]
    form.setFieldValue('kanbanSettings', { hiddenStatusKeys })
  }

  /**
   * 打开系统目录选择器，并把选中的目录写回指定表单字段。
   * @param {string} fieldName - 要写回的路径字段名
   */
  const handlePickDirectory = async (fieldName) => {
    // fieldKey 存储当前选择动作的字段标识，用于定位对应按钮 loading。
    const fieldKey = getFormFieldKey(fieldName)
    // currentPath 存储当前表单字段里的路径，用作系统选择器默认打开目录。
    const currentPath = form.getFieldValue(fieldName)
    setPickingPathField(fieldKey)
    try {
      // result 存储主进程目录选择结果；取消选择时不覆盖用户已输入路径。
      const result = await api.selectDirectory({ defaultPath: currentPath })
      if (result?.canceled) return
      if (result?.path) {
        form.setFieldValue(fieldName, result.path)
        return
      }
      message.error(result?.error || '选择目录失败')
    } catch (e) {
      message.error(`选择目录失败：${e.message}`)
    } finally {
      setPickingPathField('')
    }
  }

  /**
   * 新增路径组合，新组合内容留空并由表单必填校验约束。
   * @param {(value:object)=>void} add - Form.List 新增函数
   * @param {number} index - 新组合插入下标
   */
  const handleAddPathProfile = (add, index) => {
    // activePathProfileId 存储当前启用组合 id。
    const activePathProfileId = form.getFieldValue('activePathProfileId')
    // draft 存储即将新增到表单里的路径组合草稿。
    const draft = createPathProfileDraft(index)
    add(draft)
    if (!activePathProfileId)
      form.setFieldValue('activePathProfileId', draft.id)
  }

  /**
   * 删除路径组合；若删除的是当前启用组合，则自动切到剩余第一组。
   * @param {(index:number)=>void} remove - Form.List 删除函数
   * @param {number} index - 待删除组合下标
   */
  const handleRemovePathProfile = (remove, index) => {
    // profiles 存储删除前的路径组合数组。
    const profiles = form.getFieldValue('pathProfiles') || []
    // activePathProfileId 存储当前启用组合 id。
    const activePathProfileId = form.getFieldValue('activePathProfileId')
    // removedProfile 存储即将删除的组合，用于判断是否需要切换当前组合。
    const removedProfile = profiles[index]
    // remainingProfiles 存储删除后的剩余组合列表。
    const remainingProfiles = profiles.filter(
      (_, profileIndex) => profileIndex !== index
    )
    remove(index)
    if (
      removedProfile?.id === activePathProfileId &&
      remainingProfiles[0]?.id
    ) {
      form.setFieldValue('activePathProfileId', remainingProfiles[0].id)
    }
  }

  /**
   * 打开系统文件选择器，把选中的文件路径拼接到「执行命令」字段。
   * WHY：命令可能是手写脚本片段 + 一个文件路径的组合（如 `python {path}`），
   * 已有文本不清空，只在末尾追加，保留手动输入与文件选择两种方式并存的能力。
   * @param {number} stepIndex - 流程步骤在 Form.List 中的下标
   */
  const handlePickCommandFile = async (stepIndex) => {
    // fieldName 命令字段在 Form 中的路径，用于读写该步骤的 command 值。
    const fieldName = ['workflowSteps', stepIndex, 'command']
    // currentCommand 当前命令输入框已有内容，用于判断追加时是否需要分隔空格。
    const currentCommand = form.getFieldValue(fieldName) || ''
    setPickingPathField(`workflowSteps.${stepIndex}.command`)
    try {
      // result 存储主进程文件选择结果；取消选择时不改动已输入内容。
      const result = await api.selectFile({})
      if (result?.canceled) return
      if (result?.path) {
        // nextCommand 追加选中的文件路径；已有内容非空时补一个空格分隔。
        const nextCommand =
          currentCommand && !currentCommand.endsWith(' ')
            ? `${currentCommand} ${result.path}`
            : `${currentCommand}${result.path}`
        form.setFieldValue(fieldName, nextCommand)
        return
      }
      message.error(result?.error || '选择文件失败')
    } catch (e) {
      message.error(`选择文件失败：${e.message}`)
    } finally {
      setPickingPathField('')
    }
  }

  // 三个 Tab 的内容定义
  const tabItems = [
    {
      key: 'paths',
      label: '路径',
      children: (
        <div className="settings-form-stack">
          <Form.Item
            label="当前路径组合"
            tooltip={SETTINGS_HELP_TEXT.currentPathProfile}
          >
            <Space.Compact className="settings-full-width-compact">
              <Form.Item
                name="activePathProfileId"
                noStyle
                rules={[{ required: true, message: '请选择当前路径组合' }]}
              >
                <Select
                  data-testid="active-path-profile-select"
                  showSearch
                  optionFilterProp="label"
                  options={pathProfileOptions}
                  placeholder="选择当前生效的路径组合"
                />
              </Form.Item>
              <Button icon={<EditOutlined />} onClick={openPathProfileEditor}>
                管理路径组合
              </Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item
            label="主分支名（可多个）"
            name="mainBranches"
            tooltip={SETTINGS_HELP_TEXT.mainBranches}
          >
            <Select
              mode="tags"
              placeholder="master, main"
              tokenSeparators={[',']}
            />
          </Form.Item>
          <Form.Item
            label="GitLab MR 目标分支（可多个）"
            name="gitlabMergeTargetBranches"
            tooltip={SETTINGS_HELP_TEXT.gitlabMergeTargetBranches}
            rules={[
              {
                required: true,
                type: 'array',
                min: 1,
                message: '请至少配置一个目标分支',
              },
            ]}
          >
            <Select
              mode="tags"
              placeholder="test, master, gamma"
              tokenSeparators={[',']}
            />
          </Form.Item>
          <Form.Item
            label="忽略的项目目录"
            name="ignoredProjects"
            tooltip={SETTINGS_HELP_TEXT.ignoredProjects}
          >
            <Select
              mode="tags"
              placeholder="输入要忽略的目录名"
              tokenSeparators={[',']}
            />
          </Form.Item>
          <Form.Item
            label="扫描时自动 fetch 远程（较慢，但能计算落后提交数）"
            name="autoFetch"
            valuePropName="checked"
            tooltip={SETTINGS_HELP_TEXT.autoFetch}
          >
            <Switch />
          </Form.Item>
        </div>
      ),
    },
    {
      key: 'tools',
      label: '工具',
      children: (
        <div className="settings-form-stack">
          {/* 编辑器命令配置：AutoComplete 既可从预置编辑器下拉选择，也可手动输入自定义命令，{path} 占位符会被替换为实际路径 */}
          <Form.Item
            label="编辑器打开命令"
            name="vscodeCommand"
            tooltip={SETTINGS_HELP_TEXT.editorCommand}
            rules={[{ required: true, message: '请选择或输入编辑器命令' }]}
          >
            <AutoComplete
              options={EDITOR_COMMAND_OPTIONS}
              placeholder="选择或输入，如 code {path} / cursor {path}"
              // 输入时按已输入内容过滤预置选项，便于在自定义与预置间快速切换
              filterOption={(input, opt) =>
                String(opt.value).toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          {/* 终端应用选择：按平台展示不同选项——Windows 为 wt/PowerShell/cmd，macOS 为 Terminal/iTerm2/Ghostty */}
          <Form.Item
            label="终端应用"
            name="terminalApp"
            tooltip={SETTINGS_HELP_TEXT.terminalApp}
          >
            <Select options={getTerminalOptions(api.platform)} />
          </Form.Item>
        </div>
      ),
    },
    {
      key: 'ai-assistant',
      label: 'AI 助手',
      children: (
        <div className="settings-form-stack">
          <div className="settings-app-update-row">
            <div>
              <Text strong>Visual Worktree 更新</Text>
              <div
                className={`settings-helper-text${updateError ? ' settings-update-error' : ''}`}
              >
                {updateError ||
                  (updateVersion
                    ? `发现新版本 v${updateVersion}`
                    : updateChecked
                      ? `当前 v${updateCheckDetails?.currentVersion || '-'} / 远端 v${updateCheckDetails?.latestVersion || '-'}，检查于 ${updateCheckDetails?.checkedAt ? new Date(updateCheckDetails.checkedAt).toLocaleTimeString() : '-'}`
                      : '尚未检查')}
              </div>
            </div>
            <Space>
              {updateVersion && !updateDownloading && (
                <Button type="primary" onClick={onDownloadUpdate}>
                  下载并安装
                </Button>
              )}
              {updateDownloading && (
                <Text type="secondary">
                  下载中 {Math.round(updateDownloadPercent)}%
                </Text>
              )}
              <Button
                htmlType="button"
                danger={Boolean(updateError)}
                loading={updateChecking}
                disabled={updateDownloading}
                onClick={onCheckUpdate}
              >
                {updateChecking ? '检查中…' : '检查更新'}
              </Button>
            </Space>
          </div>
          <div className="settings-cli-versions">
            {['claude', 'codex'].map((toolId) => {
              const state = cliVersions[toolId] || {}
              const canUpdate =
                state.version &&
                state.latestVersion &&
                state.version !== state.latestVersion
              return (
                <div className="settings-cli-version-row" key={toolId}>
                  <div>
                    <Text strong>
                      {toolId === 'claude' ? 'Claude Code' : 'Codex'}
                    </Text>
                    <div className="settings-helper-text">
                      {state.version
                        ? `当前 ${state.version} / 最新 ${state.latestVersion}`
                        : '尚未检查版本'}
                    </div>
                    {state.error && <Text type="danger">{state.error}</Text>}
                  </div>
                  <Space>
                    <Button
                      disabled={state.updating}
                      loading={state.loading}
                      onClick={() => checkCli(toolId)}
                    >
                      检查
                    </Button>
                    {canUpdate && (
                      <Button
                        type="primary"
                        loading={state.updating}
                        onClick={() => updateCli(toolId)}
                      >
                        更新
                      </Button>
                    )}
                  </Space>
                </div>
              )
            })}
          </div>
          <Form.Item
            label="模型"
            name="aiModel"
            tooltip={SETTINGS_HELP_TEXT.aiModel}
            rules={[{ required: true, message: '请选择或输入模型名称' }]}
          >
            <AutoComplete
              options={AI_MODEL_OPTIONS}
              placeholder="选择或输入模型名称"
              filterOption={(input, option) =>
                String(option?.value || option?.label || '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item
            label="API Key"
            name="aiApiKey"
            tooltip={SETTINGS_HELP_TEXT.aiApiKey}
            extra={
              <Space size={8}>
                <Tag color={aiApiKeyConfigured ? 'success' : 'default'}>
                  {aiApiKeyConfigured ? '已配置' : '未配置'}
                </Tag>
                <Text type="secondary" className="settings-helper-text">
                  {aiApiKeyHint || '留空保留当前 Key'}
                </Text>
              </Space>
            }
          >
            <Input.Password
              autoComplete="new-password"
              placeholder={aiApiKeyHint || '输入新的 API Key'}
            />
          </Form.Item>
          <Form.Item
            label="Base URL"
            name="aiBaseUrl"
            tooltip={SETTINGS_HELP_TEXT.aiBaseUrl}
            rules={[
              {
                pattern: /^(https?:\/\/.*)?$/i,
                message: 'Base URL 必须以 http:// 或 https:// 开头',
              },
            ]}
          >
            <Input placeholder="留空使用 OpenAI 官方接口" />
          </Form.Item>
          <Form.Item
            label="清除已保存的 API Key"
            name="clearAiApiKey"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </div>
      ),
    },
    {
      key: 'work-documents',
      label: '工作文档',
      children: (
        <Form.Item
          className="settings-list-section"
          label="工作文档模板"
          tooltip={SETTINGS_HELP_TEXT.workDocumentTemplates}
        >
          <Form.List name="workDocumentTemplates">
            {(fields, { add, remove, move }) => (
              <div className="settings-list-content">
                <div className="settings-list-items">
                  {fields.map(({ key, name }, index) => (
                    <Form.Item key={key} noStyle shouldUpdate>
                      {() => {
                        // template 当前行对应的工作文档模板表单值。
                        const template =
                          form.getFieldValue(['workDocumentTemplates', name]) ||
                          {}
                        // templatePath 当前模板路径，空值时给出友好占位。
                        const templatePath =
                          String(template.path || '').trim() ||
                          `未设置路径 ${index + 1}`
                        // templateType 当前模板类型；除 file 外均按目录展示。
                        const templateType =
                          template.type === 'file' ? 'file' : 'directory'
                        return (
                          <div
                            data-testid={`work-document-row-${index}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => openWorkDocumentEditor(name)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter')
                                openWorkDocumentEditor(name)
                            }}
                            className="settings-list-row settings-list-row-interactive"
                          >
                            <div className="settings-list-main">
                              <div className="settings-list-title">
                                <Text
                                  type="secondary"
                                  className="settings-list-kicker"
                                >
                                  模板 {index + 1}
                                </Text>
                                <Text
                                  strong
                                  ellipsis
                                  className="settings-list-title-text"
                                >
                                  {templatePath}
                                </Text>
                              </div>
                              <div className="settings-list-meta">
                                <Tag
                                  color={
                                    templateType === 'file' ? 'blue' : 'default'
                                  }
                                  className="settings-list-tag"
                                >
                                  {templateType === 'file' ? '文件' : '目录'}
                                </Tag>
                              </div>
                            </div>
                            <Space size={4} className="settings-list-actions">
                              <Button
                                size="small"
                                data-testid={`work-document-move-up-${index}`}
                                disabled={index === 0}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  // 上移模板：只调整展示/保存顺序，不改变模板内容。
                                  move(name, name - 1)
                                }}
                              >
                                上移
                              </Button>
                              <Button
                                size="small"
                                data-testid={`work-document-move-down-${index}`}
                                disabled={index === fields.length - 1}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  // 下移模板：只调整展示/保存顺序，不改变模板内容。
                                  move(name, name + 1)
                                }}
                              >
                                下移
                              </Button>
                              <Button
                                size="small"
                                icon={<EditOutlined />}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openWorkDocumentEditor(name)
                                }}
                              >
                                编辑
                              </Button>
                              <Button
                                type="text"
                                danger
                                size="small"
                                icon={<MinusCircleOutlined />}
                                aria-label={`删除工作文档 ${index + 1}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  // 删除正在编辑的模板时同步关闭弹层，避免 Modal 继续指向已不存在的下标。
                                  if (workDocumentEditorIndex === name)
                                    closeWorkDocumentEditor()
                                  remove(name)
                                }}
                              />
                            </Space>
                          </div>
                        )
                      }}
                    </Form.Item>
                  ))}
                </div>
                <Modal
                  title="编辑工作文档"
                  open={workDocumentEditorIndex != null}
                  rootClassName="settings-surface"
                  zIndex={WORK_DOCUMENT_EDITOR_Z_INDEX}
                  onCancel={closeWorkDocumentEditor}
                  footer={[
                    <Button
                      key="done"
                      type="primary"
                      onClick={closeWorkDocumentEditor}
                    >
                      完成
                    </Button>,
                  ]}
                >
                  {workDocumentEditorIndex != null && (
                    <Form.Item noStyle shouldUpdate>
                      {() => {
                        // template 当前正在编辑的工作文档模板。
                        const template =
                          form.getFieldValue([
                            'workDocumentTemplates',
                            workDocumentEditorIndex,
                          ]) || {}
                        // isFile 标记当前模板是否为文件，文件才展示默认内容输入。
                        const isFile = template.type === 'file'
                        return (
                          <>
                            <Form.Item
                              label="类型"
                              name={[workDocumentEditorIndex, 'type']}
                              initialValue="directory"
                              tooltip={SETTINGS_HELP_TEXT.workDocumentType}
                            >
                              <Select
                                options={[
                                  { label: '目录', value: 'directory' },
                                  { label: '文件', value: 'file' },
                                ]}
                              />
                            </Form.Item>
                            <Form.Item
                              label="路径"
                              name={[workDocumentEditorIndex, 'path']}
                              tooltip={SETTINGS_HELP_TEXT.workDocumentPath}
                              rules={[
                                {
                                  required: true,
                                  message: '请输入工作文档路径',
                                },
                              ]}
                            >
                              <Input placeholder="相对路径，如 docs 或 .ai/summary.md" />
                            </Form.Item>
                            {isFile && (
                              <Form.Item
                                label="文件默认内容"
                                name={[workDocumentEditorIndex, 'content']}
                                tooltip={SETTINGS_HELP_TEXT.workDocumentContent}
                              >
                                <Input.TextArea
                                  placeholder="文件默认内容"
                                  autoSize={{ minRows: 5, maxRows: 12 }}
                                />
                              </Form.Item>
                            )}
                          </>
                        )
                      }}
                    </Form.Item>
                  )}
                </Modal>
                <AddListButton
                  onClick={() => {
                    // nextIndex 为新增模板在列表中的下标；添加后立即打开详情弹层，减少用户再次点击。
                    const nextIndex = fields.length
                    add({ type: 'directory', path: '', content: '' })
                    openWorkDocumentEditor(nextIndex)
                  }}
                >
                  添加工作文档
                </AddListButton>
              </div>
            )}
          </Form.List>
        </Form.Item>
      ),
    },
    {
      key: 'workflow',
      label: '流程',
      children: (
        /* 需求流程步骤配置：每个任务在 worktree 视图中展示这组步骤，每步都可勾选标记完成；
           配置了「执行命令」的步骤还会额外提供「执行」按钮，点击在任务目录下跑该命令 */
        <Form.Item
          className="settings-list-section"
          label="需求流程步骤"
          tooltip={SETTINGS_HELP_TEXT.workflowSteps}
        >
          <Form.List name="workflowSteps">
            {(fields, { add, remove, move }) => (
              <div className="settings-list-content">
                <div className="settings-list-items">
                  {fields.map(({ key, name }, index) => (
                    <React.Fragment key={key}>
                      {/* key 隐藏字段：保留步骤稳定标识，改名时沿用以免丢失各任务的勾选状态 */}
                      <Form.Item name={[name, 'key']} noStyle hidden>
                        <Input />
                      </Form.Item>
                      {/* 主列表只展示每个流程步骤摘要，详情字段收敛到点击后的弹层中，避免步骤多时所有字段同时铺开。 */}
                      <Form.Item noStyle shouldUpdate>
                        {() => {
                          // step 当前行对应的流程步骤表单值
                          const step =
                            form.getFieldValue(['workflowSteps', name]) || {}
                          // label 当前步骤展示名称，空值时给出友好的占位文案
                          const label =
                            String(step.label || '').trim() ||
                            `未命名步骤 ${index + 1}`
                          // hasCommand 标记该步骤是否配置了可执行命令
                          const hasCommand = !!String(step.command || '').trim()
                          return (
                            <div
                              data-testid={`workflow-step-row-${index}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => openWorkflowStepEditor(name)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter')
                                  openWorkflowStepEditor(name)
                              }}
                              className="settings-list-row settings-list-row-interactive"
                            >
                              <div className="settings-list-main">
                                <div className="settings-list-title">
                                  <Text
                                    type="secondary"
                                    className="settings-list-kicker"
                                  >
                                    步骤 {index + 1}
                                  </Text>
                                  <Text
                                    strong
                                    ellipsis
                                    className="settings-list-title-text"
                                  >
                                    {label}
                                  </Text>
                                </div>
                                <div className="settings-list-meta">
                                  <Tag
                                    color={hasCommand ? 'blue' : 'default'}
                                    className="settings-list-tag"
                                  >
                                    {hasCommand ? '已配置命令' : '仅勾选'}
                                  </Tag>
                                </div>
                              </div>
                              <Space size={4} className="settings-list-actions">
                                <Button
                                  size="small"
                                  data-testid={`workflow-step-move-up-${index}`}
                                  disabled={index === 0}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    // 上移步骤：仅调整 Form.List 顺序，key 保持不变以免丢失历史勾选态。
                                    move(name, name - 1)
                                  }}
                                >
                                  上移
                                </Button>
                                <Button
                                  size="small"
                                  data-testid={`workflow-step-move-down-${index}`}
                                  disabled={index === fields.length - 1}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    // 下移步骤：只影响展示/保存顺序，不改变步骤稳定 key。
                                    move(name, name + 1)
                                  }}
                                >
                                  下移
                                </Button>
                                <Button
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    openWorkflowStepEditor(name)
                                  }}
                                >
                                  编辑
                                </Button>
                                <Button
                                  type="text"
                                  danger
                                  size="small"
                                  icon={<MinusCircleOutlined />}
                                  aria-label={`删除流程步骤 ${index + 1}`}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    // 删除正在编辑的步骤时同步关闭弹层，避免 Modal 继续指向已不存在的下标。
                                    if (workflowEditorIndex === name)
                                      closeWorkflowStepEditor()
                                    remove(name)
                                  }}
                                />
                              </Space>
                            </div>
                          )
                        }}
                      </Form.Item>
                    </React.Fragment>
                  ))}
                </div>
                {/* 当前选中步骤的详情编辑弹层：只在需要时展示名称和命令字段，主列表保持收敛。 */}
                <Modal
                  title="编辑流程步骤"
                  open={workflowEditorIndex != null}
                  rootClassName="settings-surface"
                  zIndex={WORKFLOW_STEP_EDITOR_Z_INDEX}
                  onCancel={closeWorkflowStepEditor}
                  footer={[
                    <Button
                      key="done"
                      type="primary"
                      onClick={closeWorkflowStepEditor}
                    >
                      完成
                    </Button>,
                  ]}
                >
                  {workflowEditorIndex != null && (
                    <>
                      {/* label 步骤展示名：弹层内独立编辑，主列表只展示摘要。 */}
                      <Form.Item
                        label="步骤名称"
                        name={[workflowEditorIndex, 'label']}
                        tooltip={SETTINGS_HELP_TEXT.workflowStepName}
                      >
                        <Input placeholder="步骤名称，如：需求确认" />
                      </Form.Item>
                      {/* command 执行命令：多行编辑，WHY：命令通常包含脚本路径与占位符，单行输入会显示不全。
                          下方额外提供「选择文件」按钮：可用系统文件选择器把某个脚本/文件路径追加到命令末尾，
                          也可以直接手动输入，两种方式不互斥。 */}
                      <Form.Item
                        label="执行命令（选填）"
                        name={[workflowEditorIndex, 'command']}
                        tooltip={SETTINGS_HELP_TEXT.workflowCommand}
                      >
                        <Input.TextArea
                          placeholder="执行命令（选填），如 ./deploy.sh {path}"
                          autoSize={{ minRows: 3, maxRows: 8 }}
                        />
                      </Form.Item>
                      {/* taskArgMode 控制任务目录如何传给脚本：auto 兼容 bash xxx.sh 这类常见脚本，特殊命令可显式关闭或强制追加。 */}
                      <Form.Item
                        label="任务目录参数"
                        name={[workflowEditorIndex, 'taskArgMode']}
                        initialValue={TASK_ARG_MODE_AUTO}
                        tooltip={SETTINGS_HELP_TEXT.workflowTaskArgMode}
                      >
                        <Select options={WORKFLOW_TASK_ARG_MODE_OPTIONS} />
                      </Form.Item>
                      <Form.Item noStyle>
                        <Button
                          size="small"
                          loading={
                            pickingPathField ===
                            `workflowSteps.${workflowEditorIndex}.command`
                          }
                          onClick={() =>
                            handlePickCommandFile(workflowEditorIndex)
                          }
                          className="settings-workflow-file-button"
                        >
                          选择文件
                        </Button>
                      </Form.Item>
                      {/* autoCheckOnSuccess 控制命令成功后是否自动勾选；默认开启以延续现有「成功即完成」体验。 */}
                      <Form.Item
                        label="成功后自动勾选"
                        name={[workflowEditorIndex, 'autoCheckOnSuccess']}
                        valuePropName="checked"
                        initialValue
                        tooltip={SETTINGS_HELP_TEXT.workflowAutoCheck}
                      >
                        <Switch checkedChildren="开" unCheckedChildren="关" />
                      </Form.Item>
                      {/* stopOnFailure 控制批量运行时失败是否停止；默认开启，避免前置失败后继续跑后续命令。 */}
                      <Form.Item
                        label="失败后停止后续步骤"
                        name={[workflowEditorIndex, 'stopOnFailure']}
                        valuePropName="checked"
                        initialValue
                        tooltip={SETTINGS_HELP_TEXT.workflowStopOnFailure}
                      >
                        <Switch checkedChildren="开" unCheckedChildren="关" />
                      </Form.Item>
                    </>
                  )}
                </Modal>
                {/* 新增步骤：默认命令为空（仅可勾选、不触发副作用），key 留空由保存时自动生成 */}
                <AddListButton
                  onClick={() => {
                    // nextIndex 为新增步骤在列表中的下标；添加后立即打开详情弹层，减少用户再次点击。
                    const nextIndex = fields.length
                    add({
                      label: '',
                      command: '',
                      taskArgMode: TASK_ARG_MODE_AUTO,
                    })
                    openWorkflowStepEditor(nextIndex)
                  }}
                >
                  添加流程步骤
                </AddListButton>
              </div>
            )}
          </Form.List>
        </Form.Item>
      ),
    },
    {
      key: 'token-pricing',
      label: 'Token 费用',
      children: (
        <div data-testid="token-pricing-settings-panel">
          <Form.Item
            className="token-pricing-tool-field"
            label="统计工具"
            name="aiUsageTools"
            tooltip={SETTINGS_HELP_TEXT.aiUsageTool}
            rules={[{ required: true, message: '请选择 Token 统计工具' }]}
          >
            <Select
              mode="multiple"
              options={AI_USAGE_TOOL_OPTIONS}
              placeholder="选择一个或多个统计工具"
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) => {
              // selectedUsageTools 存储当前已选工具，用于动态渲染紧凑的价格管理入口。
              const selectedUsageTools = Array.isArray(
                getFieldValue('aiUsageTools')
              )
                ? getFieldValue('aiUsageTools')
                : []
              return (
                <div className="token-pricing-tool-list">
                  {selectedUsageTools.map((toolId) => {
                    // toolOption 存储当前工具的用户可见名称，异常标识回退原值。
                    const toolOption = AI_USAGE_TOOL_OPTIONS.find(
                      (option) => option.value === toolId
                    )
                    // toolLabel 存储当前计价区标题使用的工具名称。
                    const toolLabel = toolOption?.label || toolId
                    // pricingEnabled 存储当前工具是否启用自定义计价，用于入口状态提示。
                    const pricingEnabled =
                      getFieldValue([
                        'tokenPricingByTool',
                        toolId,
                        'enabled',
                      ]) === true
                    // modelCount 存储当前工具已配置的专属模型价格数量。
                    const modelCount = Array.isArray(
                      getFieldValue(['tokenPricingByTool', toolId, 'models'])
                    )
                      ? getFieldValue(['tokenPricingByTool', toolId, 'models'])
                          .length
                      : 0
                    return (
                      <div className="token-pricing-tool-row" key={toolId}>
                        <div className="token-pricing-tool-summary">
                          <Text strong>{toolLabel}</Text>
                          <Text type="secondary">
                            {pricingEnabled
                              ? `自定义计价 · ${modelCount} 个模型`
                              : '使用内置价格'}
                          </Text>
                        </div>
                        <Button
                          icon={<SettingOutlined />}
                          onClick={() => setTokenPricingEditorToolId(toolId)}
                        >
                          价格配置
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )
            }}
          </Form.Item>
          <Modal
            title={`${AI_USAGE_TOOL_OPTIONS.find((option) => option.value === tokenPricingEditorToolId)?.label || ''} 价格配置`}
            open={Boolean(tokenPricingEditorToolId)}
            onCancel={() => setTokenPricingEditorToolId('')}
            onOk={() => setTokenPricingEditorToolId('')}
            okText="完成"
            cancelButtonProps={{ className: 'settings-hidden-action' }}
            width={680}
            zIndex={TOKEN_PRICING_EDITOR_Z_INDEX}
            rootClassName="settings-surface token-pricing-modal"
            destroyOnHidden
          >
            {tokenPricingEditorToolId && (
              <Form.Item noStyle shouldUpdate>
                {({ getFieldValue }) => {
                  // pricingEnabled 存储弹层当前工具是否启用自定义计价。
                  const pricingEnabled =
                    getFieldValue([
                      'tokenPricingByTool',
                      tokenPricingEditorToolId,
                      'enabled',
                    ]) === true
                  return (
                    <div className="token-pricing-editor">
                      <div className="token-pricing-rule-header">
                        <SettingTitleWithHelp
                          label="自定义计价"
                          help={SETTINGS_HELP_TEXT.customPricing}
                        />
                        <Form.Item
                          noStyle
                          name={[
                            'tokenPricingByTool',
                            tokenPricingEditorToolId,
                            'enabled',
                          ]}
                          valuePropName="checked"
                        >
                          <Switch aria-label="启用自定义计价" />
                        </Form.Item>
                      </div>
                      <SettingTitleWithHelp
                        label="未匹配模型价格"
                        help={SETTINGS_HELP_TEXT.tokenPricingModels}
                      />
                      <div className="token-pricing-fields-grid">
                        {TOKEN_PRICING_FIELDS.map((pricingField) => (
                          <Form.Item
                            className="token-pricing-field"
                            key={pricingField.key}
                            label={pricingField.label}
                            name={[
                              'tokenPricingByTool',
                              tokenPricingEditorToolId,
                              pricingField.key,
                            ]}
                            tooltip={pricingField.tooltip}
                            rules={[{ required: true, message: '请输入单价' }]}
                          >
                            <InputNumber
                              min={0}
                              precision={6}
                              disabled={!pricingEnabled}
                              prefix="$"
                              className="settings-full-width-control"
                            />
                          </Form.Item>
                        ))}
                        <Form.Item
                          className="token-pricing-field"
                          label="计费倍率"
                          name={[
                            'tokenPricingByTool',
                            tokenPricingEditorToolId,
                            'multiplier',
                          ]}
                          tooltip={SETTINGS_HELP_TEXT.tokenPricingMultiplier}
                          rules={[
                            { required: true, message: '请输入计费倍率' },
                          ]}
                        >
                          <InputNumber
                            min={0}
                            precision={6}
                            disabled={!pricingEnabled}
                            suffix="x"
                            className="settings-full-width-control"
                          />
                        </Form.Item>
                      </div>
                      <Form.List
                        name={[
                          'tokenPricingByTool',
                          tokenPricingEditorToolId,
                          'models',
                        ]}
                      >
                        {(fields, { add, remove }) => (
                          <div className="token-model-pricing-list">
                            <Form.Item
                              label="计价模型"
                              tooltip={SETTINGS_HELP_TEXT.tokenPricingModels}
                            >
                              <Select
                                mode="tags"
                                disabled={!pricingEnabled}
                                placeholder="选择一个或多个模型"
                                options={
                                  TOKEN_MODEL_OPTIONS_BY_TOOL[
                                    tokenPricingEditorToolId
                                  ] || []
                                }
                                value={fields
                                  .map((field) =>
                                    getFieldValue([
                                      'tokenPricingByTool',
                                      tokenPricingEditorToolId,
                                      'models',
                                      field.name,
                                      'model',
                                    ])
                                  )
                                  .filter(Boolean)}
                                onChange={(selectedModels) => {
                                  // currentModels 存储变更前模型名与表单下标的对应关系。
                                  const currentModels = fields.map((field) => ({
                                    name: field.name,
                                    model: getFieldValue([
                                      'tokenPricingByTool',
                                      tokenPricingEditorToolId,
                                      'models',
                                      field.name,
                                      'model',
                                    ]),
                                  }))
                                  // removedIndexes 存储取消选择的模型下标，倒序删除避免下标移动误删。
                                  const removedIndexes = currentModels
                                    .filter(
                                      (item) =>
                                        !selectedModels.includes(item.model)
                                    )
                                    .map((item) => item.name)
                                    .sort((left, right) => right - left)
                                  removedIndexes.forEach((index) =>
                                    remove(index)
                                  )
                                  // existingModels 存储变更前已有模型名，用于只新增本次选择项。
                                  const existingModels = new Set(
                                    currentModels.map((item) => item.model)
                                  )
                                  selectedModels
                                    .filter(
                                      (model) => !existingModels.has(model)
                                    )
                                    .forEach((model) => {
                                      // selectedOption 存储当前预置模型及其内置价格；自定义模型继续使用通用草稿价。
                                      const selectedOption = (
                                        TOKEN_MODEL_OPTIONS_BY_TOOL[
                                          tokenPricingEditorToolId
                                        ] || []
                                      ).find((option) => option.value === model)
                                      add({
                                        ...DEFAULT_MODEL_PRICING_DRAFT,
                                        ...(selectedOption?.pricing || {}),
                                        model,
                                      })
                                    })
                                }}
                              />
                            </Form.Item>
                            {fields.map(({ key, name }) => (
                              <div
                                className="token-model-pricing-row"
                                key={key}
                              >
                                <div className="token-model-pricing-header">
                                  <Text strong>
                                    {getFieldValue([
                                      'tokenPricingByTool',
                                      tokenPricingEditorToolId,
                                      'models',
                                      name,
                                      'model',
                                    ])}
                                  </Text>
                                  <Button
                                    aria-label="删除模型价格"
                                    danger
                                    type="text"
                                    disabled={!pricingEnabled}
                                    icon={<DeleteOutlined />}
                                    onClick={() => remove(name)}
                                  />
                                </div>
                                <Form.Item name={[name, 'model']} hidden>
                                  <Input />
                                </Form.Item>
                                {TOKEN_PRICING_FIELDS.map((pricingField) => (
                                  <Form.Item
                                    className="token-pricing-field"
                                    key={pricingField.key}
                                    label={pricingField.label}
                                    name={[name, pricingField.key]}
                                    rules={[
                                      { required: true, message: '请输入单价' },
                                    ]}
                                  >
                                    <InputNumber
                                      min={0}
                                      precision={6}
                                      disabled={!pricingEnabled}
                                      prefix="$"
                                      className="settings-full-width-control"
                                    />
                                  </Form.Item>
                                ))}
                                <Form.Item
                                  className="token-pricing-field"
                                  label="倍率"
                                  name={[name, 'multiplier']}
                                  rules={[
                                    { required: true, message: '请输入倍率' },
                                  ]}
                                >
                                  <InputNumber
                                    min={0}
                                    precision={6}
                                    disabled={!pricingEnabled}
                                    suffix="x"
                                    className="settings-full-width-control"
                                  />
                                </Form.Item>
                              </div>
                            ))}
                          </div>
                        )}
                      </Form.List>
                    </div>
                  )
                }}
              </Form.Item>
            )}
          </Modal>
          <div className="token-pricing-rule-header token-pricing-currency-header">
            <SettingTitleWithHelp
              label="直接人民币显示"
              help={SETTINGS_HELP_TEXT.directCnyDisplay}
            />
            <Form.Item
              noStyle
              name={['tokenPricing', 'directCnyDisplay']}
              valuePropName="checked"
            >
              <Switch aria-label="直接人民币显示" />
            </Form.Item>
          </div>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) => {
              // directCnyDisplay 存储是否直接按人民币 1:1 展示，用于停用不再生效的汇率输入。
              const directCnyDisplay =
                getFieldValue(['tokenPricing', 'directCnyDisplay']) === true
              return (
                <div className="token-pricing-fields-grid">
                  <Form.Item
                    className="token-pricing-field token-pricing-exchange-field"
                    label="美元兑人民币汇率"
                    name={['tokenPricing', 'usdToCny']}
                    tooltip={SETTINGS_HELP_TEXT.usdToCny}
                    rules={[
                      { required: true, message: '请输入美元兑人民币汇率' },
                    ]}
                  >
                    <InputNumber
                      min={0.000001}
                      precision={6}
                      disabled={directCnyDisplay}
                      className="settings-full-width-control"
                    />
                  </Form.Item>
                </div>
              )
            }}
          </Form.Item>
        </div>
      ),
    },
    {
      key: 'display',
      label: '展示',
      children: (
        <div
          data-testid="display-settings-panel"
          className="settings-display-panel"
        >
          <SettingTitleWithHelp
            label="任务标题展示偏好"
            help={SETTINGS_HELP_TEXT.displayPreferences}
          />
          <div
            data-testid="display-badge-grid"
            className="settings-display-grid"
          >
            {TASK_TITLE_BADGE_ITEMS.map((item) => (
              <div
                key={item.key}
                data-testid={`display-badge-card-${item.key}`}
                className="settings-display-card"
              >
                <div className="settings-display-card-header">
                  <SettingTitleWithHelp
                    label={item.label}
                    help={DISPLAY_BADGE_DESCRIPTIONS[item.key]}
                  />
                  <div className="settings-display-card-actions">
                    {item.key === 'taskStatus' && (
                      <Button
                        type="text"
                        icon={<SettingOutlined />}
                        aria-label="配置任务状态"
                        title="配置任务状态"
                        onClick={openTaskStatusEditor}
                      />
                    )}
                    {item.key === 'taskTag' && (
                      <Button
                        type="text"
                        icon={<SettingOutlined />}
                        aria-label="配置任务分类标签"
                        title="配置任务分类标签"
                        onClick={openTaskTagEditor}
                      />
                    )}
                    <Form.Item
                      name={['taskTitleBadges', item.key]}
                      valuePropName="checked"
                      className="settings-display-switch-field"
                    >
                      <Switch checkedChildren="展示" unCheckedChildren="隐藏" />
                    </Form.Item>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Form.List name="taskTags">
            {(fields, { add, remove, move }) => (
              <Modal
                title={`任务分类标签（${fields.length}/${TASK_TAG_MAX_COUNT}）`}
                open={taskTagEditorOpen}
                onCancel={closeTaskTagEditor}
                footer={
                  <Button type="primary" onClick={closeTaskTagEditor}>
                    完成
                  </Button>
                }
                width={640}
                zIndex={TASK_TAG_EDITOR_Z_INDEX}
                className="settings-task-tag-modal"
              >
                <div className="settings-task-tag-section">
                  <Text type="secondary" className="settings-helper-text">
                    标签用于区分任务类型，不影响任务状态和看板列。
                  </Text>
                  {fields.length > 0 && (
                    <div className="settings-task-tag-list">
                      {fields.map(({ key, name }, index) => (
                        <div key={key} className="settings-task-tag-row">
                          <Form.Item name={[name, 'key']} hidden>
                            <Input />
                          </Form.Item>
                          <Form.Item
                            className="settings-task-tag-field"
                            label="分类名称"
                            name={[name, 'label']}
                            rules={[
                              { validator: validateTaskTagLabel },
                              {
                                max: TASK_TAG_LABEL_MAX_LENGTH,
                                message: `最多 ${TASK_TAG_LABEL_MAX_LENGTH} 个字符`,
                              },
                            ]}
                          >
                            <Input
                              maxLength={TASK_TAG_LABEL_MAX_LENGTH}
                              aria-label="分类名称"
                            />
                          </Form.Item>
                          <Form.Item
                            className="settings-task-tag-field"
                            label="颜色"
                            name={[name, 'color']}
                          >
                            <Select
                              aria-label="分类颜色"
                              options={TASK_TAG_COLOR_OPTIONS.map((option) => ({
                                // value 存储写入分类定义的 Ant Design 语义颜色。
                                value: option.value,
                                // label 使用真实色签和中文名称，避免用户理解英文颜色值。
                                label: (
                                  <Tag color={option.value}>{option.label}</Tag>
                                ),
                              }))}
                            />
                          </Form.Item>
                          <div className="settings-task-tag-actions">
                            <Button
                              type="text"
                              icon={<ArrowUpOutlined />}
                              aria-label="上移分类"
                              disabled={index === 0}
                              onClick={() => move(index, index - 1)}
                            />
                            <Button
                              type="text"
                              icon={<ArrowDownOutlined />}
                              aria-label="下移分类"
                              disabled={index === fields.length - 1}
                              onClick={() => move(index, index + 1)}
                            />
                            <Button
                              type="text"
                              danger
                              icon={<DeleteOutlined />}
                              aria-label="删除分类"
                              onClick={() => remove(index)}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <AddListButton
                    disabled={fields.length >= TASK_TAG_MAX_COUNT}
                    onClick={() => add(createTaskTagDraft(fields.length))}
                  >
                    添加任务分类
                  </AddListButton>
                </div>
              </Modal>
            )}
          </Form.List>
          <Form.List name="taskStatuses">
            {(fields, { add, remove, move }) => (
              <Modal
                title={`任务状态（${fields.length}/${TASK_STATUS_MAX_COUNT}）`}
                open={taskStatusEditorOpen}
                onCancel={closeTaskStatusEditor}
                footer={
                  <Button type="primary" onClick={closeTaskStatusEditor}>
                    完成
                  </Button>
                }
                width={640}
                zIndex={TASK_STATUS_EDITOR_Z_INDEX}
                className="settings-task-status-modal"
              >
                <div
                  data-testid="task-status-settings"
                  className="settings-status-label-section"
                >
                  <Text type="secondary" className="settings-helper-text">
                    状态顺序同时决定任务菜单、排序和看板列顺序。
                  </Text>
                  <div className="settings-status-list">
                    {fields.map(({ key, name }, index) => {
                      // statusKey 存储当前行不随重命名变化的稳定状态标识。
                      const statusKey = form.getFieldValue([
                        'taskStatuses',
                        name,
                        'key',
                      ])
                      // statusColor 存储当前行用于菜单和任务标题标签的语义颜色。
                      const statusColor = form.getFieldValue([
                        'taskStatuses',
                        name,
                        'color',
                      ])
                      // statusLabel 存储当前状态文案，用于看板设置控件的无障碍名称。
                      const statusLabel = form.getFieldValue([
                        'taskStatuses',
                        name,
                        'label',
                      ])
                      // isDefaultStatus 标记不可删除、不可移动的默认兜底状态。
                      const isDefaultStatus = statusKey === DEFAULT_TASK_STATUS
                      // statusVisible 标记当前状态是否在看板中生成列。
                      const statusVisible =
                        !editorKanbanSettings.hiddenStatusKeys.includes(
                          statusKey
                        )
                      // visibleStatusCount 存储当前可见看板列数量，用于阻止隐藏最后一列。
                      const visibleStatusCount = fields.filter((field) => {
                        // fieldStatusKey 存储待统计状态的稳定 key。
                        const fieldStatusKey = form.getFieldValue([
                          'taskStatuses',
                          field.name,
                          'key',
                        ])
                        return !editorKanbanSettings.hiddenStatusKeys.includes(
                          fieldStatusKey
                        )
                      }).length
                      return (
                        <div
                          key={key}
                          className="settings-status-row"
                          data-testid={`task-status-row-${statusKey}`}
                        >
                          <Form.Item name={[name, 'key']} hidden>
                            <Input />
                          </Form.Item>
                          <Form.Item name={[name, 'color']} hidden>
                            <Input />
                          </Form.Item>
                          <Form.Item
                            className="settings-status-field settings-status-name-field"
                            label={
                              <span className="settings-status-name-label">
                                状态名称
                                {isDefaultStatus && (
                                  <Tag
                                    color={statusColor}
                                    className="settings-status-default-tag"
                                  >
                                    默认
                                  </Tag>
                                )}
                              </span>
                            }
                            name={[name, 'label']}
                            rules={[
                              { validator: validateTaskStatusLabel },
                              {
                                max: TASK_STATUS_LABEL_MAX_LENGTH,
                                message: `最多 ${TASK_STATUS_LABEL_MAX_LENGTH} 个字符`,
                              },
                            ]}
                          >
                            <Input
                              maxLength={TASK_STATUS_LABEL_MAX_LENGTH}
                              aria-label="状态名称"
                              placeholder="输入状态名称"
                            />
                          </Form.Item>
                          <div className="settings-status-row-actions">
                            <Checkbox
                              checked={statusVisible}
                              disabled={
                                statusVisible && visibleStatusCount <= 1
                              }
                              aria-label={`看板展示 ${statusLabel}`}
                              onChange={(event) =>
                                changeKanbanStatusVisibility(
                                  statusKey,
                                  event.target.checked
                                )
                              }
                            >
                              看板
                            </Checkbox>
                            <Button
                              type="text"
                              icon={<ArrowUpOutlined />}
                              aria-label="上移状态"
                              title="上移"
                              disabled={isDefaultStatus || index <= 1}
                              onClick={() => move(index, index - 1)}
                            />
                            <Button
                              type="text"
                              icon={<ArrowDownOutlined />}
                              aria-label="下移状态"
                              title="下移"
                              disabled={
                                isDefaultStatus || index === fields.length - 1
                              }
                              onClick={() => move(index, index + 1)}
                            />
                            <Button
                              type="text"
                              danger
                              icon={<DeleteOutlined />}
                              aria-label="删除状态"
                              title={
                                isDefaultStatus
                                  ? '默认状态不可删除'
                                  : '删除状态'
                              }
                              disabled={isDefaultStatus}
                              onClick={() => remove(index)}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <AddListButton
                    disabled={fields.length >= TASK_STATUS_MAX_COUNT}
                    onClick={() => add(createTaskStatusDraft(fields.length))}
                  >
                    添加任务状态
                  </AddListButton>
                </div>
              </Modal>
            )}
          </Form.List>
        </div>
      ),
    },
    {
      key: 'cicd',
      label: 'CI/CD',
      children: (
        /* CI/CD 流水线地址：按项目名配置，有则填写，任务视图中显示跳转按钮 */
        <Form.Item
          className="settings-list-section"
          label="CI/CD 流水线地址（按项目配置，选填）"
          tooltip={SETTINGS_HELP_TEXT.cicdLinks}
        >
          <Form.List name="cicdLinksArr">
            {(fields, { add, remove }) => (
              <div className="settings-list-content">
                {/* 空列表不渲染滚动容器，避免不可见子项仍触发 12px sibling gap。 */}
                {fields.length > 0 && (
                  <div className="settings-list-scroll">
                    <div className="settings-list-items">
                      {fields.map(({ key, name }, index) => (
                        // 每行三栏：项目与 URL 按比例分配宽度，删除按钮保持稳定尺寸。
                        <div key={key} className="settings-cicd-row">
                          {/* project 项目目录名：从已扫描项目中下拉选择，也支持手动输入。 */}
                          <div className="settings-cicd-project">
                            <Form.Item name={[name, 'project']} noStyle>
                              <Select
                                showSearch
                                allowClear
                                placeholder="选择项目"
                                className="settings-full-width-control"
                                options={projectOptions}
                                loading={
                                  projectLoading && projectOptions.length === 0
                                }
                                filterOption={(input, opt) =>
                                  opt.value
                                    .toLowerCase()
                                    .includes(input.toLowerCase())
                                }
                              />
                            </Form.Item>
                          </div>
                          {/* url 对应项目的 CI/CD 流水线 URL，占满剩余弹性宽度。 */}
                          <div className="settings-cicd-url">
                            <Form.Item name={[name, 'url']} noStyle>
                              <Input
                                className="settings-full-width-control"
                                placeholder="https://ci.example.com/pipeline/..."
                              />
                            </Form.Item>
                          </div>
                          {/* 删除按钮固定列宽，保证每行右侧对齐。 */}
                          <Button
                            type="text"
                            danger
                            size="small"
                            icon={<MinusCircleOutlined />}
                            aria-label={`删除 CI/CD 地址 ${index + 1}`}
                            onClick={() => remove(name)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <AddListButton onClick={() => add()}>
                  添加项目 CI/CD 地址
                </AddListButton>
              </div>
            )}
          </Form.List>
        </Form.Item>
      ),
    },
  ]

  return (
    <Drawer
      title="设置"
      open={open}
      onClose={onClose}
      size={640}
      rootClassName="settings-surface settings-drawer"
      destroyOnHidden
      footer={
        // 底部操作按钮
        <div className="settings-footer">
          <Button
            danger
            loading={resetting}
            disabled={saving || resetting}
            onClick={handleResetDefaults}
          >
            恢复默认设置
          </Button>
          <Space>
            <Button disabled={saving || resetting} onClick={onClose}>
              取消
            </Button>
            <Button
              type="primary"
              loading={saving}
              disabled={saving || resetting}
              onClick={handleOk}
            >
              保存
            </Button>
          </Space>
        </div>
      }
    >
      <Form form={form} layout="vertical">
        <Tabs items={tabItems} />
        <Modal
          title="管理路径组合"
          open={pathProfileEditorOpen}
          rootClassName="settings-surface settings-path-profile-modal"
          zIndex={PATH_PROFILE_EDITOR_Z_INDEX}
          width={720}
          onOk={closePathProfileEditor}
          onCancel={closePathProfileEditor}
          okText="完成"
          cancelButtonProps={{ className: 'settings-hidden-action' }}
        >
          <Form.List name="pathProfiles">
            {(fields, { add, remove }) => (
              <div className="settings-list-content">
                <div className="settings-list-items">
                  {fields.map(({ key, name }, index) => (
                    <div
                      key={key}
                      data-testid={`path-profile-row-${index}`}
                      className="settings-path-profile-row"
                    >
                      <Form.Item name={[name, 'id']} hidden>
                        <Input />
                      </Form.Item>
                      <div className="settings-path-profile-header">
                        <SettingTitleWithHelp
                          label={`路径组合 ${index + 1}`}
                          help={SETTINGS_HELP_TEXT.pathProfileEntry}
                        />
                        <Button
                          type="text"
                          danger
                          size="small"
                          icon={<MinusCircleOutlined />}
                          disabled={fields.length <= 1}
                          aria-label={`删除路径组合 ${index + 1}`}
                          onClick={() => handleRemovePathProfile(remove, name)}
                        />
                      </div>
                      <Form.Item
                        label="组合名称"
                        name={[name, 'name']}
                        tooltip={SETTINGS_HELP_TEXT.pathProfileName}
                        rules={[{ required: true, message: '请输入组合名称' }]}
                      >
                        <Input placeholder="例如：工作 / 个人" />
                      </Form.Item>
                      <Form.Item
                        label="源项目根目录"
                        required
                        tooltip={SETTINGS_HELP_TEXT.sourceProjectsPath}
                      >
                        <Space.Compact className="settings-full-width-compact">
                          <Form.Item
                            name={[name, 'sourceProjectsPath']}
                            rules={[
                              { required: true, message: '请输入源项目根目录' },
                            ]}
                            noStyle
                          >
                            <Input
                              className="settings-compact-flex-control"
                              placeholder="/Users/you/Desktop/work/projects"
                            />
                          </Form.Item>
                          <Button
                            aria-label={`选择源项目根目录 ${index + 1}`}
                            loading={
                              pickingPathField ===
                              getFormFieldKey([
                                'pathProfiles',
                                name,
                                'sourceProjectsPath',
                              ])
                            }
                            onClick={() =>
                              handlePickDirectory([
                                'pathProfiles',
                                name,
                                'sourceProjectsPath',
                              ])
                            }
                          >
                            选择
                          </Button>
                        </Space.Compact>
                      </Form.Item>
                      <Form.Item
                        label="Worktree 根目录"
                        required
                        className="settings-path-profile-last-field"
                        tooltip={SETTINGS_HELP_TEXT.worktreesPath}
                      >
                        <Space.Compact className="settings-full-width-compact">
                          <Form.Item
                            name={[name, 'worktreesPath']}
                            rules={[
                              {
                                required: true,
                                message: '请输入 Worktree 根目录',
                              },
                            ]}
                            noStyle
                          >
                            <Input
                              className="settings-compact-flex-control"
                              placeholder="/Users/you/Desktop/work/worktrees"
                            />
                          </Form.Item>
                          <Button
                            aria-label={`选择 Worktree 根目录 ${index + 1}`}
                            loading={
                              pickingPathField ===
                              getFormFieldKey([
                                'pathProfiles',
                                name,
                                'worktreesPath',
                              ])
                            }
                            onClick={() =>
                              handlePickDirectory([
                                'pathProfiles',
                                name,
                                'worktreesPath',
                              ])
                            }
                          >
                            选择
                          </Button>
                        </Space.Compact>
                      </Form.Item>
                    </div>
                  ))}
                </div>
                <AddListButton
                  onClick={() => handleAddPathProfile(add, fields.length)}
                >
                  添加路径组合
                </AddListButton>
              </div>
            )}
          </Form.List>
        </Modal>
      </Form>
    </Drawer>
  )
}

/**
 * 规范化设置页中的工作文档模板，过滤空路径并补齐类型/内容字段。
 * @param {Array<{type?:string,path?:string,content?:string}>} templates - 表单里的工作文档模板数组
 * @returns {Array<{type:'directory'|'file',path:string,content:string}>} 可提交给配置保存的模板数组
 */
function normalizeWorkDocumentTemplatesForForm(templates) {
  // sourceTemplates 存储待规范化的模板数组；非数组时回退到默认 docs 目录。
  const sourceTemplates = Array.isArray(templates)
    ? templates
    : DEFAULT_WORK_DOCUMENT_TEMPLATES
  // normalizedTemplates 累积表单可保存的模板；核心层会继续做路径安全过滤。
  const normalizedTemplates = []

  for (const template of sourceTemplates) {
    // path 存储用户填写的相对路径，空路径在保存时忽略。
    const path = String(template?.path || '').trim()
    if (!path) continue
    if (isFixedInstructionPathForForm(path)) continue
    // type 存储模板类型；除 file 外统一按目录保存。
    const type = template?.type === 'file' ? 'file' : 'directory'
    // content 存储文件默认内容，目录模板不需要内容。
    const content = type === 'file' ? String(template?.content || '') : ''
    normalizedTemplates.push({ type, path, content })
  }

  return normalizedTemplates.length > 0
    ? normalizedTemplates
    : DEFAULT_WORK_DOCUMENT_TEMPLATES.map((template) => ({ ...template }))
}

/**
 * 判断表单路径是否为固定说明文件路径。
 * @param {string} path - 用户填写的工作文档路径
 * @returns {boolean} 是否为固定说明文件
 */
function isFixedInstructionPathForForm(path) {
  // normalizedPath 存储统一分隔符和大小写后的路径，用于匹配根目录固定说明文件。
  const normalizedPath = String(path || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
  return normalizedPath === 'claude.md' || normalizedPath === 'agents.md'
}
