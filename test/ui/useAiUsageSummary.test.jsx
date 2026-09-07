import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useAiUsageSummary from '../../src/ui/hooks/useAiUsageSummary.ts'

// mockApi 存储用量查询替身，用于验证首屏扫描的防抖时机。
const mockApi = vi.hoisted(() => ({
  getClaudeTasksSummary: vi.fn(),
}))

vi.mock('../../src/ui/api.ts', () => ({ api: mockApi }))

/**
 * 挂载用量 hook，模拟 App 向其传入可见任务和价格配置。
 * @param {object} props - 用量 hook 参数
 * @returns {null} 测试组件不渲染可见内容
 */
function UsageSummaryHarness(props) {
  useAiUsageSummary(props)
  return null
}

describe('useAiUsageSummary 启动调度', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockApi.getClaudeTasksSummary.mockReset().mockResolvedValue({})
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('首屏稳定前不扫描会话，等待结束后只发起一次', async () => {
    render(
      <UsageSummaryHarness
        tasks={[{ task: 'TASK-A' }]}
        usageTools={['claude-code', 'codex']}
        pricingConfig={{ tokenPricing: { directCnyDisplay: true } }}
      />
    )

    await act(async () => vi.advanceTimersByTimeAsync(1499))
    expect(mockApi.getClaudeTasksSummary).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(mockApi.getClaudeTasksSummary).toHaveBeenCalledTimes(1)
    expect(mockApi.getClaudeTasksSummary).toHaveBeenCalledWith(['TASK-A'])
  })

  it('任务列表在等待期间变化时取消旧扫描', async () => {
    // renderResult 存储测试挂载结果，用于在计时器结束前替换任务列表。
    const renderResult = render(
      <UsageSummaryHarness
        tasks={[{ task: 'TASK-A' }]}
        usageTools={['claude-code']}
        pricingConfig={{}}
      />
    )
    renderResult.rerender(
      <UsageSummaryHarness
        tasks={[{ task: 'TASK-B' }]}
        usageTools={['claude-code']}
        pricingConfig={{}}
      />
    )

    await act(async () => vi.advanceTimersByTimeAsync(1500))
    expect(mockApi.getClaudeTasksSummary).toHaveBeenCalledTimes(1)
    expect(mockApi.getClaudeTasksSummary).toHaveBeenCalledWith(['TASK-B'])
  })

  it('手动刷新后即使任务列表未变化也会重新统计价格', async () => {
    // renderResult 存储测试挂载结果，用于模拟顶部刷新按钮递增统计版本。
    const renderResult = render(
      <UsageSummaryHarness
        tasks={[{ task: 'TASK-A' }]}
        usageTools={['claude-code']}
        pricingConfig={{}}
        refreshVersion={0}
      />
    )

    await act(async () => vi.advanceTimersByTimeAsync(1500))
    renderResult.rerender(
      <UsageSummaryHarness
        tasks={[{ task: 'TASK-A' }]}
        usageTools={['claude-code']}
        pricingConfig={{}}
        refreshVersion={1}
      />
    )
    await act(async () => vi.advanceTimersByTimeAsync(1500))

    expect(mockApi.getClaudeTasksSummary).toHaveBeenCalledTimes(2)
    expect(mockApi.getClaudeTasksSummary).toHaveBeenLastCalledWith(['TASK-A'], {
      refreshVersion: 1,
    })
  })

  it('删除任务时只裁剪已有结果，不重新扫描剩余任务', async () => {
    // renderResult 存储测试挂载结果，用于模拟删除 TASK-B 后任务列表刷新。
    const renderResult = render(
      <UsageSummaryHarness
        tasks={[{ task: 'TASK-A' }, { task: 'TASK-B' }]}
        usageTools={['claude-code']}
        pricingConfig={{}}
      />
    )

    await act(async () => vi.advanceTimersByTimeAsync(1500))
    expect(mockApi.getClaudeTasksSummary).toHaveBeenCalledTimes(1)

    renderResult.rerender(
      <UsageSummaryHarness
        tasks={[{ task: 'TASK-A' }]}
        usageTools={['claude-code']}
        pricingConfig={{}}
      />
    )
    await act(async () => vi.advanceTimersByTimeAsync(2000))

    expect(mockApi.getClaudeTasksSummary).toHaveBeenCalledTimes(1)
  })

  it('新增任务时只统计新任务并保留已有任务结果', async () => {
    mockApi.getClaudeTasksSummary
      .mockResolvedValueOnce({ 'TASK-A': { cost: { cny: 1 } } })
      .mockResolvedValueOnce({ 'TASK-B': { cost: { cny: 2 } } })
    // renderResult 存储测试挂载结果，用于模拟新建 TASK-B 后的任务列表刷新。
    const renderResult = render(
      <UsageSummaryHarness
        tasks={[{ task: 'TASK-A' }]}
        usageTools={['claude-code']}
        pricingConfig={{}}
      />
    )

    await act(async () => vi.advanceTimersByTimeAsync(1500))
    renderResult.rerender(
      <UsageSummaryHarness
        tasks={[{ task: 'TASK-A' }, { task: 'TASK-B' }]}
        usageTools={['claude-code']}
        pricingConfig={{}}
      />
    )
    await act(async () => vi.advanceTimersByTimeAsync(1500))

    expect(mockApi.getClaudeTasksSummary).toHaveBeenCalledTimes(2)
    expect(mockApi.getClaudeTasksSummary).toHaveBeenNthCalledWith(1, ['TASK-A'])
    expect(mockApi.getClaudeTasksSummary).toHaveBeenNthCalledWith(2, ['TASK-B'])
  })

  it('非 Worktree 页面不启动用量扫描', async () => {
    render(
      <UsageSummaryHarness
        tasks={[{ task: 'TASK-A' }]}
        usageTools={['claude-code']}
        pricingConfig={{}}
        enabled={false}
      />
    )

    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(mockApi.getClaudeTasksSummary).not.toHaveBeenCalled()
  })
})
