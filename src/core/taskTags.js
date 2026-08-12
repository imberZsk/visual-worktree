// TASK_TAG_LABEL_MAX_LENGTH 存储任务分类标签允许的最大字符数，避免标签挤压任务标题操作区。
export const TASK_TAG_LABEL_MAX_LENGTH = 12
// TASK_TAG_MAX_COUNT 存储单个工作区允许配置的任务分类数量上限。
export const TASK_TAG_MAX_COUNT = 20
// TASK_TAG_COLOR_SEQUENCE 存储任务分类可选的 Ant Design 语义颜色及新增分类的轮换顺序。
export const TASK_TAG_COLOR_SEQUENCE = [
  'blue',
  'red',
  'cyan',
  'orange',
  'purple',
  'gold',
  'green',
  'magenta',
  'volcano',
  'geekblue',
]
// TASK_TAG_COLOR_OPTIONS 存储设置页颜色选择器的稳定值和中文名称。
export const TASK_TAG_COLOR_OPTIONS = [
  { value: 'blue', label: '蓝色' }, // value 写入 Ant Design Tag 颜色；label 供设置页展示。
  { value: 'red', label: '红色' }, // 红色用于 BUG 等错误类任务。
  { value: 'cyan', label: '青色' }, // 青色用于信息类任务。
  { value: 'orange', label: '橙色' }, // 橙色用于需关注任务。
  { value: 'purple', label: '紫色' }, // 紫色用于扩展分类。
  { value: 'gold', label: '金色' }, // 金色用于待确认分类。
  { value: 'green', label: '绿色' }, // 绿色用于正常或完成类分类。
  { value: 'magenta', label: '品红' }, // 品红用于醒目的自定义分类。
  { value: 'volcano', label: '火山红' }, // 火山红用于高优先级问题分类。
  { value: 'geekblue', label: '深蓝' }, // 深蓝用于技术类自定义分类。
]
// DEFAULT_TASK_TAGS 存储首次安装提供的任务分类；稳定 key 保证改名后已有任务映射不丢失。
export const DEFAULT_TASK_TAGS = [
  { key: 'requirement', label: '需求', color: 'magenta' },
  { key: 'bug', label: 'BUG', color: 'red' },
]
// TASK_TAG_KEY_PATTERN 存储允许持久化的分类 key 格式。
const TASK_TAG_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
// VALID_TASK_TAG_COLORS 存储可安全交给 Ant Design Tag 的颜色白名单。
const VALID_TASK_TAG_COLORS = new Set(TASK_TAG_COLOR_SEQUENCE)

/**
 * 为新增或损坏的分类生成当前列表中唯一的稳定 key。
 * @param {number} index - 当前分类在输入列表中的下标。
 * @param {Set<string>} usedKeys - 已被前序分类占用的 key 集合。
 * @returns {string} 未被占用的分类 key。
 */
function createFallbackTaskTagKey(index, usedKeys) {
  // baseKey 存储当前分类首选的回退 key。
  const baseKey = `custom-tag-${index + 1}`
  // candidateKey 存储本轮尝试写入的唯一 key。
  let candidateKey = baseKey
  // suffix 存储 key 冲突时递增的数字后缀。
  let suffix = 2
  while (usedKeys.has(candidateKey)) {
    candidateKey = `${baseKey}-${suffix}`
    suffix += 1
  }
  return candidateKey
}

/**
 * 规范化工作区任务分类定义，保留用户顺序、稳定 key 和可配置颜色。
 * @param {Array<object>|null|undefined} tags - 原始任务分类列表；缺失时使用首次安装默认值。
 * @returns {Array<{key:string,label:string,color:string}>} 可安全展示和持久化的分类列表。
 */
export function normalizeTaskTags(tags) {
  // sourceTags 存储参与清洗的分类；显式空数组表示用户已删除全部分类，不能恢复默认项。
  const sourceTags = Array.isArray(tags) ? tags : DEFAULT_TASK_TAGS
  // usedKeys 存储已接受的稳定 key，防止任务映射产生歧义。
  const usedKeys = new Set()
  // normalizedTags 累积清洗后的任务分类定义。
  const normalizedTags = []
  for (const [index, rawTag] of sourceTags
    .slice(0, TASK_TAG_MAX_COUNT)
    .entries()) {
    // rawKey 存储去除空白后的候选分类 key。
    const rawKey = typeof rawTag?.key === 'string' ? rawTag.key.trim() : ''
    // key 存储符合格式约束且在当前列表唯一的稳定分类 key。
    const key =
      TASK_TAG_KEY_PATTERN.test(rawKey) && !usedKeys.has(rawKey)
        ? rawKey
        : createFallbackTaskTagKey(index, usedKeys)
    usedKeys.add(key)
    // defaultTag 存储同 key 的内置分类，为损坏字段提供稳定兜底。
    const defaultTag = DEFAULT_TASK_TAGS.find((tag) => tag.key === key)
    // rawLabel 存储去除首尾空白后的用户分类名称。
    const rawLabel =
      typeof rawTag?.label === 'string' ? rawTag.label.trim() : ''
    // label 存储限制长度后的最终分类名称。
    const label = (rawLabel || defaultTag?.label || `分类 ${index + 1}`).slice(
      0,
      TASK_TAG_LABEL_MAX_LENGTH
    )
    // fallbackColor 存储损坏或缺失颜色时使用的语义色。
    const fallbackColor =
      defaultTag?.color ||
      TASK_TAG_COLOR_SEQUENCE[index % TASK_TAG_COLOR_SEQUENCE.length]
    // color 存储通过白名单校验的最终语义颜色。
    const color = VALID_TASK_TAG_COLORS.has(rawTag?.color)
      ? rawTag.color
      : fallbackColor
    normalizedTags.push({ key, label, color })
  }
  return normalizedTags
}

/**
 * 创建设置页新增分类使用的草稿定义。
 * @param {number} index - 新分类在当前列表中的下标。
 * @returns {{key:string,label:string,color:string}} 带稳定 key 和默认颜色的分类草稿。
 */
export function createTaskTagDraft(index) {
  // safeIndex 存储经过非负整数约束的列表下标。
  const safeIndex = Number.isInteger(index) && index >= 0 ? index : 0
  return {
    key: `custom-tag-${Date.now()}-${safeIndex + 1}`,
    label: `分类 ${safeIndex + 1}`,
    color: TASK_TAG_COLOR_SEQUENCE[safeIndex % TASK_TAG_COLOR_SEQUENCE.length],
  }
}
