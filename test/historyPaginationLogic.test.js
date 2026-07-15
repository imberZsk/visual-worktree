import { describe, expect, it } from 'vitest'
import {
  computeHistoryPageSize,
  getHistoryGlobalIndex,
} from '../src/ui/historyPaginationLogic.ts'

describe('历史任务分页纯逻辑', () => {
  it('按容器高度和列表项高度计算每页条数，并限制在合理范围', () => {
    // compactPageSize 存储小容器下可展示的历史任务条数。
    const compactPageSize = computeHistoryPageSize({
      containerHeight: 224,
      itemHeight: 56,
    })
    // roomyPageSize 存储大容器下可展示的历史任务条数，应该被上限保护。
    const roomyPageSize = computeHistoryPageSize({
      containerHeight: 1200,
      itemHeight: 56,
    })

    expect(compactPageSize).toBe(4)
    expect(roomyPageSize).toBe(12)
  })

  it('测量数据无效时回退到默认每页 10 条', () => {
    // fallbackPageSize 存储 DOM 尚未完成测量时的兜底分页条数。
    const fallbackPageSize = computeHistoryPageSize({
      containerHeight: 0,
      itemHeight: 0,
    })

    expect(fallbackPageSize).toBe(10)
  })

  it('把当前页内下标换算成历史列表全局下标', () => {
    // globalIndex 存储第 3 页第 2 条在完整历史数组里的下标。
    const globalIndex = getHistoryGlobalIndex({
      page: 3,
      pageSize: 4,
      pageIndex: 1,
    })

    expect(globalIndex).toBe(9)
  })
})
