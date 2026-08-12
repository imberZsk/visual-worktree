import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TASK_TAGS,
  TASK_TAG_LABEL_MAX_LENGTH,
  TASK_TAG_MAX_COUNT,
  normalizeTaskTags,
} from '../src/core/taskTags.js'

describe('任务分类定义', () => {
  it('首次使用时提供需求和 BUG 两个默认分类', () => {
    expect(normalizeTaskTags(undefined)).toEqual(DEFAULT_TASK_TAGS)
    expect(DEFAULT_TASK_TAGS[0]).toEqual({
      key: 'requirement',
      label: '需求',
      color: 'magenta',
    })
  })

  it('保留用户新增、改名、改色和排序后的分类', () => {
    // configuredTags 存储用户保存的自定义分类顺序和展示属性。
    const configuredTags = [
      { key: 'bug', label: '缺陷', color: 'volcano' },
      { key: 'research', label: '调研', color: 'purple' },
    ]
    expect(normalizeTaskTags(configuredTags)).toEqual(configuredTags)
  })

  it('允许显式清空分类并限制损坏配置的数量和名称长度', () => {
    expect(normalizeTaskTags([])).toEqual([])
    // oversizedTags 存储超过设置上限且名称过长的异常分类定义。
    const oversizedTags = Array.from(
      { length: TASK_TAG_MAX_COUNT + 2 },
      (_value, index) => ({
        key: `tag-${index}`,
        label: '分类'.repeat(TASK_TAG_LABEL_MAX_LENGTH),
        color: 'unknown',
      })
    )
    // normalizedTags 存储异常配置清洗后的分类定义。
    const normalizedTags = normalizeTaskTags(oversizedTags)
    expect(normalizedTags).toHaveLength(TASK_TAG_MAX_COUNT)
    expect(normalizedTags[0].label).toHaveLength(TASK_TAG_LABEL_MAX_LENGTH)
    expect(normalizedTags[0].color).toBe('blue')
  })
})
