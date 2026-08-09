import { DEFAULT_TASK_STATUS, normalizeTaskStatuses } from './taskStatuses.js'

// DEFAULT_KANBAN_SETTINGS 存储新工作区的看板列偏好：默认展示全部状态且不固定列。
export const DEFAULT_KANBAN_SETTINGS = {
  hiddenStatusKeys: [],
}

/**
 * 规范化当前工作区的看板列偏好，并清理已删除任务状态对应的失效 key。
 * @param {object|null|undefined} settings - 待清洗的看板列设置。
 * @param {Array<object>|null|undefined} taskStatuses - 当前工作区任务状态定义。
 * @returns {{hiddenStatusKeys:string[]}} 可安全持久化和展示的看板设置。
 */
export function normalizeKanbanSettings(settings, taskStatuses) {
  // normalizedStatuses 存储清洗后的任务状态，用于建立合法列 key 集合。
  const normalizedStatuses = normalizeTaskStatuses(taskStatuses)
  // validStatusKeys 存储当前工作区仍存在的任务状态 key。
  const validStatusKeys = new Set(
    normalizedStatuses.map((status) => status.key)
  )
  // sourceHiddenStatusKeys 存储原始隐藏列数组，异常类型按空数组处理。
  const sourceHiddenStatusKeys = Array.isArray(settings?.hiddenStatusKeys)
    ? settings.hiddenStatusKeys
    : []
  // hiddenStatusKeys 存储去重并过滤失效状态后的隐藏列 key。
  const hiddenStatusKeys = Array.from(
    new Set(
      sourceHiddenStatusKeys.filter(
        (statusKey) =>
          typeof statusKey === 'string' && validStatusKeys.has(statusKey)
      )
    )
  )

  // 所有状态都被隐藏时恢复默认状态列，保证看板始终存在至少一个可见列。
  if (hiddenStatusKeys.length >= normalizedStatuses.length) {
    const defaultStatusIndex = hiddenStatusKeys.indexOf(DEFAULT_TASK_STATUS)
    if (defaultStatusIndex >= 0) hiddenStatusKeys.splice(defaultStatusIndex, 1)
    else hiddenStatusKeys.pop()
  }

  return { hiddenStatusKeys }
}
