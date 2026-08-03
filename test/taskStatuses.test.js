import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TASK_STATUS,
  DEFAULT_TASK_STATUS_LABELS,
  DEFAULT_TASK_STATUSES,
  TASK_STATUS_LABEL_MAX_LENGTH,
  TASK_STATUS_MAX_COUNT,
  normalizeTaskStatusLabels,
  normalizeTaskStatuses,
} from '../src/core/taskStatuses.js'

describe('任务状态标签配置', () => {
  it('旧配置缺失标签时保留全部现有默认文案', () => {
    expect(normalizeTaskStatusLabels(undefined)).toEqual(
      DEFAULT_TASK_STATUS_LABELS
    )
  })

  it('只覆盖已配置的稳定状态 key，并清理空白和未知字段', () => {
    // normalizedLabels 存储混合有效、自定义和未知字段后的规范化结果。
    const normalizedLabels = normalizeTaskStatusLabels({
      developing: '  处理中  ',
      testing: '   ',
      unknown: '无效状态',
    })

    expect(normalizedLabels.developing).toBe('处理中')
    expect(normalizedLabels.testing).toBe(DEFAULT_TASK_STATUS_LABELS.testing)
    expect(normalizedLabels.unknown).toBeUndefined()
  })

  it('损坏配置中的超长标签会被限制到界面允许长度', () => {
    // oversizedLabel 存储超过任务标题可承载长度的异常配置文案。
    const oversizedLabel = '状态'.repeat(TASK_STATUS_LABEL_MAX_LENGTH)
    expect(
      normalizeTaskStatusLabels({ developing: oversizedLabel }).developing
    ).toHaveLength(TASK_STATUS_LABEL_MAX_LENGTH)
  })
})

describe('动态任务状态配置', () => {
  it('缺失动态列表时从旧版标签配置迁移全部内置状态', () => {
    // statuses 存储从旧版标签映射迁移出的动态状态列表。
    const statuses = normalizeTaskStatuses(undefined, {
      developing: '处理中',
    })

    expect(statuses).toHaveLength(DEFAULT_TASK_STATUSES.length)
    expect(
      statuses.find((status) => status.key === 'developing')
    ).toMatchObject({
      label: '处理中',
      kanbanColumn: 'inProgress',
    })
  })

  it('保留新增、删除和排序后的稳定状态定义', () => {
    // customStatuses 存储删除自测、交换内置状态并新增联调状态后的配置。
    const customStatuses = [
      DEFAULT_TASK_STATUSES[0],
      DEFAULT_TASK_STATUSES[3],
      DEFAULT_TASK_STATUSES[1],
      {
        key: 'custom-integration',
        label: '联调中',
        color: 'magenta',
        kanbanColumn: 'inProgress',
      },
    ]
    // normalizedStatuses 存储清洗后的动态状态顺序。
    const normalizedStatuses = normalizeTaskStatuses(customStatuses)

    expect(normalizedStatuses.map((status) => status.key)).toEqual([
      DEFAULT_TASK_STATUS,
      'pending-test',
      'developing',
      'custom-integration',
    ])
    expect(normalizedStatuses.at(-1)).toMatchObject({
      label: '联调中',
      color: 'magenta',
      kanbanColumn: 'inProgress',
    })
  })

  it('默认状态被误删或移位时自动补回列表首位', () => {
    // statusesWithoutDefault 存储损坏配置中仅剩的自定义状态。
    const statusesWithoutDefault = [
      {
        key: 'custom-done',
        label: '归档',
        color: 'success',
        kanbanColumn: 'completed',
      },
    ]
    expect(normalizeTaskStatuses(statusesWithoutDefault)[0].key).toBe(
      DEFAULT_TASK_STATUS
    )
  })

  it('异常状态数量不会超过设置上限', () => {
    // oversizedStatuses 存储超过界面允许数量的损坏配置。
    const oversizedStatuses = Array.from(
      { length: TASK_STATUS_MAX_COUNT + 5 },
      (_value, index) => ({
        key: `custom-${index}`,
        label: `状态 ${index}`,
        color: 'blue',
        kanbanColumn: 'inProgress',
      })
    )
    expect(normalizeTaskStatuses(oversizedStatuses)).toHaveLength(
      TASK_STATUS_MAX_COUNT
    )
  })
})
