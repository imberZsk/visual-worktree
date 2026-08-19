import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import ClaudeUsageTag from '../../src/ui/components/ClaudeUsageTag.tsx'
import WorktreeToolbar from '../../src/ui/components/WorktreeToolbar.tsx'

// mockApi 存储单任务用量查询替身，用于确认批量计算期间不会触发重复扫描。
const mockApi = vi.hoisted(() => ({
  getClaudeSessionsByTask: vi.fn(),
}))

vi.mock('../../src/ui/api.ts', () => ({ api: mockApi }))

// TASK_USAGE 存储人民币 1:1 模式下的任务 Token 与费用汇总。
const TASK_USAGE = {
  sessionCount: 1,
  usage: { input: 10_000, output: 0, cacheWrite: 0, cacheRead: 0 },
  cost: { usd: 0.02, cny: 0.02 },
}
// CACHE_WRITE_USAGE 存储与中转实际账单一致的缓存创建用量及费用。
const CACHE_WRITE_USAGE = {
  sessionCount: 1,
  usage: { input: 85, output: 21, cacheWrite: 91_226, cacheRead: 0 },
  cost: { usd: 0.091378, cny: 0.091378 },
}
// COMBINED_TASK_USAGE 存储 Claude 与 Codex 分工具费用及合计。
const COMBINED_TASK_USAGE = {
  sessionCount: 2,
  usage: { input: 15_000, output: 0, cacheWrite: 0, cacheRead: 0 },
  cost: { usd: 0.05, cny: 0.05 },
  tools: {
    'claude-code': {
      sessionCount: 1,
      usage: { input: 10_000 },
      cost: { usd: 0.02, cny: 0.02 },
    },
    codex: {
      sessionCount: 1,
      usage: { input: 5_000 },
      cost: { usd: 0.03, cny: 0.03 },
    },
  },
}
// TOOLBAR_CALLBACKS 存储工具栏渲染所需的无副作用回调。
const TOOLBAR_CALLBACKS = {
  onOpenHistory: vi.fn(),
  onOpenCleanup: vi.fn(),
  onToggleHiddenTasks: vi.fn(),
  onSortOrderChange: vi.fn(),
  onKeywordChange: vi.fn(),
}

afterEach(() => {
  cleanup()
  mockApi.getClaudeSessionsByTask.mockReset()
})

describe('Token 费用币种展示', () => {
  it('批量价格计算中只显示等待标签，不发起单任务重复扫描', () => {
    render(
      <ClaudeUsageTag
        taskName="TASK-LOADING"
        summaryLoading
        fetchWhenSummaryMissing={false}
      />
    )

    // loadingTag 存储计算中的完整费用标签，用于验证交互类名覆盖标签与 Spin 子节点。
    const loadingTag = screen.getByText('AI 用量').closest('.claude-usage-tag')
    expect(loadingTag).toBeTruthy()
    expect(loadingTag?.querySelector('.ant-spin')).toBeTruthy()
    expect(mockApi.getClaudeSessionsByTask).not.toHaveBeenCalled()
  })

  it('直接人民币模式下任务徽标只显示人民币费用', () => {
    render(
      <ClaudeUsageTag
        taskName="TASK-CNY"
        summary={TASK_USAGE}
        directCnyDisplay
      />
    )

    expect(screen.getByText('¥0.020000')).toBeTruthy()
    expect(document.body.textContent).not.toContain('$0.020000')
  })

  it('直接人民币模式下列表只显示实际费用', () => {
    render(
      <ClaudeUsageTag
        taskName="TASK-CACHE-WRITE"
        summary={CACHE_WRITE_USAGE}
        directCnyDisplay
      />
    )

    expect(screen.getByText('¥0.091378')).toBeTruthy()
    expect(document.body.textContent).not.toContain('缓存创建 91.2K')
  })

  it('直接人民币模式下顶部总计只显示人民币费用', () => {
    render(
      <WorktreeToolbar
        aiUsageTotal={{ tokens: 10_000, usd: 0.02, cny: 0.02 }}
        directCnyDisplay
        hasHiddenTasks={false}
        showHiddenTasks={false}
        sortOrder="status"
        keyword=""
        {...TOOLBAR_CALLBACKS}
      />
    )

    expect(screen.getByText('总计 ¥0.020000')).toBeTruthy()
    expect(document.body.textContent).not.toContain('$0.020')
  })

  it('双工具模式下任务徽标只显示合计费用，悬浮提示按工具分组 Token', async () => {
    render(
      <ClaudeUsageTag
        taskName="TASK-BOTH"
        summary={COMBINED_TASK_USAGE}
        usageTools={['claude-code', 'codex']}
        directCnyDisplay
      />
    )

    const totalCostTag = screen.getByText('¥0.050000')
    expect(totalCostTag).toBeTruthy()
    fireEvent.mouseEnter(totalCostTag)

    await waitFor(() => {
      expect(screen.getByText('Claude')).toBeTruthy()
      expect(screen.getByText('Codex')).toBeTruthy()
      expect(screen.getAllByText('Input tokens')).toHaveLength(2)
      expect(screen.getAllByText('Cache read')).toHaveLength(2)
      expect(screen.getByText('¥0.020000')).toBeTruthy()
      expect(screen.getByText('¥0.030000')).toBeTruthy()
    })
  })

  it('双工具模式下顶部只显示合计费用', () => {
    render(
      <WorktreeToolbar
        aiUsageTotal={{
          tokens: 15_000,
          usd: 0.05,
          cny: 0.05,
          byTool: {
            'claude-code': { tokens: 10_000, usd: 0.02, cny: 0.02 },
            codex: { tokens: 5_000, usd: 0.03, cny: 0.03 },
          },
        }}
        aiUsageTools={['claude-code', 'codex']}
        directCnyDisplay
        hasHiddenTasks={false}
        showHiddenTasks={false}
        sortOrder="status"
        keyword=""
        {...TOOLBAR_CALLBACKS}
      />
    )

    expect(screen.getByText('总计 ¥0.050000')).toBeTruthy()
  })
})
