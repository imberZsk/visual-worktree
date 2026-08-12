import { normalizeTaskTags } from '../core/taskTags.js'

// TASK_TAG_STORAGE_KEY 存储浏览器降级环境中的任务分类映射键。
export const TASK_TAG_STORAGE_KEY = 'vw-task-tags'

/**
 * 按分类 key 读取任务分类定义；未选择或定义已删除时返回空值。
 * @param {string} tagKey - 任务当前保存的分类 key。
 * @param {Array<object>} taskTags - 当前工作区任务分类定义。
 * @returns {{key:string,label:string,color:string}|null} 有效分类定义或 null。
 */
export function getTaskTagMeta(tagKey, taskTags) {
  // normalizedTags 存储清洗后的当前工作区分类定义。
  const normalizedTags = normalizeTaskTags(taskTags)
  // matchedTag 存储与任务映射匹配的分类定义。
  const matchedTag = normalizedTags.find((tag) => tag.key === tagKey)
  return matchedTag ? { ...matchedTag } : null
}

/**
 * 在任务分类映射上设置或清除单个任务分类，不修改原对象。
 * @param {Record<string,string>} map - 现有任务名到分类 key 的映射。
 * @param {string} taskName - 待修改的任务名。
 * @param {string} tagKey - 目标分类 key；为空或未知时清除映射。
 * @param {Array<object>} taskTags - 当前工作区允许选择的分类定义。
 * @returns {Record<string,string>} 更新后的任务分类映射。
 */
export function setTaskTagInMap(map, taskName, tagKey, taskTags) {
  // nextMap 存储不可变更新后的任务分类映射。
  const nextMap = { ...(map || {}) }
  if (!taskName) return nextMap
  // validTagKeys 存储当前工作区可写入任务映射的分类 key。
  const validTagKeys = new Set(
    normalizeTaskTags(taskTags).map((tag) => tag.key)
  )
  if (!tagKey || !validTagKeys.has(tagKey)) delete nextMap[taskName]
  else nextMap[taskName] = tagKey
  return nextMap
}

/**
 * 从 localStorage 读取任务分类映射，缺失或损坏时回退空对象。
 * @returns {Record<string,string>} 任务名到分类 key 的映射。
 */
export function loadTaskTagMap() {
  try {
    // rawValue 存储 localStorage 中的原始分类映射 JSON。
    const rawValue = localStorage.getItem(TASK_TAG_STORAGE_KEY)
    if (!rawValue) return {}
    // parsedMap 存储反序列化后的候选分类映射。
    const parsedMap = JSON.parse(rawValue)
    return parsedMap &&
      typeof parsedMap === 'object' &&
      !Array.isArray(parsedMap)
      ? parsedMap
      : {}
  } catch {
    return {}
  }
}
