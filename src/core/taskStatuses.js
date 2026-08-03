// TASK_STATUS_LABEL_MAX_LENGTH 存储任务状态标签允许的最大字符数，避免过长文案挤压任务操作区。
export const TASK_STATUS_LABEL_MAX_LENGTH = 16
// TASK_STATUS_MAX_COUNT 存储单个工作区允许配置的状态数量上限，避免异常配置生成过大的菜单。
export const TASK_STATUS_MAX_COUNT = 20
// DEFAULT_TASK_STATUS 存储没有人工标记时使用的稳定状态 key。
export const DEFAULT_TASK_STATUS = 'not-started'

// TASK_STATUS_KANBAN_COLUMNS 存储状态可归入的三个稳定看板分组及其展示名称。
export const TASK_STATUS_KANBAN_COLUMNS = [
  { value: 'pending', label: '待启动' },
  { value: 'inProgress', label: '进行中' },
  { value: 'completed', label: '已完成' },
]

// TASK_STATUS_COLOR_SEQUENCE 存储新增状态自动轮换使用的 Ant Design 语义标签颜色。
export const TASK_STATUS_COLOR_SEQUENCE = [
  'processing',
  'cyan',
  'orange',
  'purple',
  'gold',
  'success',
  'blue',
  'magenta',
  'volcano',
  'geekblue',
]

// DEFAULT_TASK_STATUSES 存储任务状态的稳定 key、默认文案、语义颜色和看板归类。
export const DEFAULT_TASK_STATUSES = [
  {
    key: DEFAULT_TASK_STATUS,
    label: '未开始',
    color: 'default',
    kanbanColumn: 'pending',
  },
  {
    key: 'developing',
    label: '开发中',
    color: 'processing',
    kanbanColumn: 'inProgress',
  },
  {
    key: 'self-testing',
    label: '自测中',
    color: 'cyan',
    kanbanColumn: 'inProgress',
  },
  {
    key: 'pending-test',
    label: '待提测',
    color: 'orange',
    kanbanColumn: 'inProgress',
  },
  {
    key: 'testing',
    label: '测试中',
    color: 'purple',
    kanbanColumn: 'inProgress',
  },
  {
    key: 'pending-release',
    label: '待发布',
    color: 'gold',
    kanbanColumn: 'inProgress',
  },
  {
    key: 'released',
    label: '已发布',
    color: 'success',
    kanbanColumn: 'completed',
  },
]

// DEFAULT_TASK_STATUS_LABELS 存储旧版「状态 key → 展示文案」默认映射，仅用于兼容迁移。
export const DEFAULT_TASK_STATUS_LABELS = Object.fromEntries(
  DEFAULT_TASK_STATUSES.map((status) => [status.key, status.label])
)
// VALID_KANBAN_COLUMNS 存储允许写入配置的看板分组 key。
const VALID_KANBAN_COLUMNS = new Set(
  TASK_STATUS_KANBAN_COLUMNS.map((column) => column.value)
)
// VALID_STATUS_COLORS 存储默认色和新增状态颜色，损坏配置中的其他值会回退自动颜色。
const VALID_STATUS_COLORS = new Set(['default', ...TASK_STATUS_COLOR_SEQUENCE])
// TASK_STATUS_KEY_PATTERN 存储允许持久化的状态 key 格式，避免空白和特殊字符进入任务状态映射。
const TASK_STATUS_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

/**
 * 规范化旧版用户标签配置，只保留七个内置状态 key 并补齐默认文案。
 * @param {Record<string,string>|null|undefined} labels - 旧版状态标签映射。
 * @returns {Record<string,string>} 包含全部内置状态 key 的有效标签映射。
 */
export function normalizeTaskStatusLabels(labels) {
  // sourceLabels 存储可读取的原始标签对象，数组和标量配置按空对象处理。
  const sourceLabels =
    labels && typeof labels === 'object' && !Array.isArray(labels) ? labels : {}
  // normalizedLabels 累积按默认状态顺序清洗后的完整标签映射。
  const normalizedLabels = {}
  for (const status of DEFAULT_TASK_STATUSES) {
    // rawLabel 存储当前状态配置的原始文案，非字符串值按空值处理。
    const rawLabel =
      typeof sourceLabels[status.key] === 'string'
        ? sourceLabels[status.key].trim()
        : ''
    // resolvedLabel 存储当前状态最终使用的标签；空值回退默认文案。
    const resolvedLabel = rawLabel || status.label
    normalizedLabels[status.key] = resolvedLabel.slice(
      0,
      TASK_STATUS_LABEL_MAX_LENGTH
    )
  }
  return normalizedLabels
}

/**
 * 为损坏或重复的自定义状态生成当前列表中唯一的稳定 key。
 * @param {number} index - 当前状态在输入列表中的下标。
 * @param {Set<string>} usedKeys - 已被前序状态占用的 key 集合。
 * @returns {string} 未被占用的自定义状态 key。
 */
function createFallbackStatusKey(index, usedKeys) {
  // baseKey 存储当前状态首选的回退 key。
  const baseKey = `custom-status-${index + 1}`
  // candidateKey 存储尝试写入的唯一 key。
  let candidateKey = baseKey
  // suffix 存储 key 冲突时递增的后缀。
  let suffix = 2
  while (usedKeys.has(candidateKey)) {
    candidateKey = `${baseKey}-${suffix}`
    suffix += 1
  }
  return candidateKey
}

/**
 * 规范化动态任务状态列表，并兼容此前只保存标签映射的配置。
 * @param {Array<object>|null|undefined} statuses - 当前工作区动态状态列表。
 * @param {Record<string,string>|null|undefined} legacyLabels - 旧版自定义标签映射。
 * @returns {Array<{key:string,label:string,color:string,kanbanColumn:string}>} 可安全展示和持久化的状态列表。
 */
export function normalizeTaskStatuses(statuses, legacyLabels) {
  // normalizedLegacyLabels 存储旧版标签配置，只有缺失动态列表时用于迁移默认状态。
  const normalizedLegacyLabels = normalizeTaskStatusLabels(legacyLabels)
  // sourceStatuses 存储本次参与清洗的状态列表；旧配置从七个默认状态迁移。
  const sourceStatuses =
    Array.isArray(statuses) && statuses.length > 0
      ? statuses
      : DEFAULT_TASK_STATUSES.map((status) => ({
          ...status,
          label: normalizedLegacyLabels[status.key],
        }))
  // usedKeys 存储已经接受的状态 key，防止状态菜单与任务映射出现歧义。
  const usedKeys = new Set()
  // normalizedStatuses 累积清洗后的动态状态定义。
  const normalizedStatuses = []
  for (const [index, rawStatus] of sourceStatuses
    .slice(0, TASK_STATUS_MAX_COUNT)
    .entries()) {
    // rawKey 存储去除空白后的候选状态 key。
    const rawKey =
      typeof rawStatus?.key === 'string' ? rawStatus.key.trim() : ''
    // key 存储最终唯一且符合格式约束的稳定状态 key。
    const key =
      TASK_STATUS_KEY_PATTERN.test(rawKey) && !usedKeys.has(rawKey)
        ? rawKey
        : createFallbackStatusKey(index, usedKeys)
    usedKeys.add(key)
    // fallbackStatus 存储同 key 的内置状态定义，为损坏字段提供稳定兜底。
    const fallbackStatus =
      DEFAULT_TASK_STATUSES.find((status) => status.key === key) || null
    // rawLabel 存储用户配置的状态文案，空白值回退内置文案或顺序名称。
    const rawLabel =
      typeof rawStatus?.label === 'string' ? rawStatus.label.trim() : ''
    // label 存储限制长度后的最终状态文案。
    const label = (
      rawLabel ||
      fallbackStatus?.label ||
      `状态 ${index + 1}`
    ).slice(0, TASK_STATUS_LABEL_MAX_LENGTH)
    // fallbackColor 存储当前下标自动分配的标签颜色。
    const fallbackColor =
      fallbackStatus?.color ||
      TASK_STATUS_COLOR_SEQUENCE[index % TASK_STATUS_COLOR_SEQUENCE.length]
    // color 存储经过白名单校验的 Ant Design 标签颜色。
    const color = VALID_STATUS_COLORS.has(rawStatus?.color)
      ? rawStatus.color
      : fallbackColor
    // kanbanColumn 存储状态对应的看板分组；新增和损坏配置默认归入“进行中”。
    const kanbanColumn = VALID_KANBAN_COLUMNS.has(rawStatus?.kanbanColumn)
      ? rawStatus.kanbanColumn
      : fallbackStatus?.kanbanColumn || 'inProgress'
    normalizedStatuses.push({ key, label, color, kanbanColumn })
  }

  // defaultStatusIndex 存储“未开始”在清洗结果中的位置；默认状态必须始终存在并排在第一位。
  const defaultStatusIndex = normalizedStatuses.findIndex(
    (status) => status.key === DEFAULT_TASK_STATUS
  )
  if (defaultStatusIndex < 0) {
    normalizedStatuses.unshift({ ...DEFAULT_TASK_STATUSES[0] })
  } else if (defaultStatusIndex > 0) {
    // defaultStatus 存储从原位置取出的默认状态，移动时保留用户自定义文案。
    const [defaultStatus] = normalizedStatuses.splice(defaultStatusIndex, 1)
    normalizedStatuses.unshift(defaultStatus)
  }
  return normalizedStatuses.slice(0, TASK_STATUS_MAX_COUNT)
}
