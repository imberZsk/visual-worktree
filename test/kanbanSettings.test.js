import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KANBAN_SETTINGS,
  normalizeKanbanSettings,
} from '../src/core/kanbanSettings.js'
import { DEFAULT_TASK_STATUSES } from '../src/core/taskStatuses.js'

describe('看板列设置', () => {
  it('默认展示全部任务状态', () => {
    expect(normalizeKanbanSettings(undefined, DEFAULT_TASK_STATUSES)).toEqual(
      DEFAULT_KANBAN_SETTINGS
    )
  })

  it('保留合法隐藏列并清理重复、未知状态和旧固定列字段', () => {
    // settings 存储包含重复、未知状态的原始看板设置。
    const settings = {
      hiddenStatusKeys: ['testing', 'testing', 'removed-status'],
      pinnedStatusKey: 'developing',
    }

    expect(normalizeKanbanSettings(settings, DEFAULT_TASK_STATUSES)).toEqual({
      hiddenStatusKeys: ['testing'],
    })
  })

  it('异常配置隐藏全部状态时恢复默认状态列', () => {
    // allStatusKeys 存储当前工作区全部任务状态 key。
    const allStatusKeys = DEFAULT_TASK_STATUSES.map((status) => status.key)
    // normalizedSettings 存储恢复至少一个可见列后的配置。
    const normalizedSettings = normalizeKanbanSettings(
      { hiddenStatusKeys: allStatusKeys },
      DEFAULT_TASK_STATUSES
    )

    expect(normalizedSettings.hiddenStatusKeys).not.toContain('not-started')
    expect(normalizedSettings.hiddenStatusKeys).toHaveLength(
      DEFAULT_TASK_STATUSES.length - 1
    )
  })

  it('新增任务状态默认可见', () => {
    // expandedStatuses 存储设置页新增状态后的完整状态定义。
    const expandedStatuses = [
      ...DEFAULT_TASK_STATUSES,
      {
        key: 'accepted',
        label: '已验收',
        color: 'blue',
        kanbanColumn: 'completed',
      },
    ]
    // normalizedSettings 存储沿用旧隐藏偏好后的新看板配置。
    const normalizedSettings = normalizeKanbanSettings(
      { hiddenStatusKeys: ['testing'] },
      expandedStatuses
    )

    expect(normalizedSettings.hiddenStatusKeys).not.toContain('accepted')
  })
})
