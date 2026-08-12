import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_TASK_TAGS } from '../src/core/taskTags.js'
import {
  TASK_TAG_STORAGE_KEY,
  getTaskTagMeta,
  loadTaskTagMap,
  setTaskTagInMap,
} from '../src/ui/taskTagLogic.ts'

describe('任务分类映射', () => {
  beforeEach(() => {
    // storedValues 存储本用例的内存键值，模拟浏览器 localStorage。
    const storedValues = new Map()
    globalThis.localStorage = {
      getItem: (key) => storedValues.get(key) ?? null,
      setItem: (key, value) => storedValues.set(key, String(value)),
      clear: () => storedValues.clear(),
    }
  })

  it('只保存当前工作区存在的分类 key，并支持清除', () => {
    // selectedMap 存储为任务选择 BUG 分类后的映射。
    const selectedMap = setTaskTagInMap({}, 'TASK-1', 'bug', DEFAULT_TASK_TAGS)
    expect(selectedMap).toEqual({ 'TASK-1': 'bug' })
    expect(
      setTaskTagInMap(selectedMap, 'TASK-1', 'removed', DEFAULT_TASK_TAGS)
    ).toEqual({})
  })

  it('分类定义被删除后不展示陈旧映射', () => {
    expect(getTaskTagMeta('removed', DEFAULT_TASK_TAGS)).toBeNull()
    expect(getTaskTagMeta('bug', DEFAULT_TASK_TAGS)?.label).toBe('BUG')
  })

  it('从 localStorage 恢复有效对象并容错损坏数据', () => {
    localStorage.setItem(TASK_TAG_STORAGE_KEY, JSON.stringify({ TASK: 'bug' }))
    expect(loadTaskTagMap()).toEqual({ TASK: 'bug' })
    localStorage.setItem(TASK_TAG_STORAGE_KEY, '[]')
    expect(loadTaskTagMap()).toEqual({})
  })
})
