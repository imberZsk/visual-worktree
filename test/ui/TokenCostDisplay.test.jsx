import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import ClaudeUsageTag from '../../src/ui/components/ClaudeUsageTag.tsx'
import WorktreeToolbar from '../../src/ui/components/WorktreeToolbar.tsx'

// TASK_USAGE 存储人民币 1:1 模式下的任务 Token 与费用汇总。
const TASK_USAGE = {
  sessionCount: 1,
  usage: { input: 10_000, output: 0, cacheWrite: 0, cacheRead: 0 },
  cost: { usd: 0.02, cny: 0.02 },
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

afterEach(() => cleanup())

describe('Token 费用币种展示', () => {
  it('直接人民币模式下任务徽标只显示人民币费用', () => {
    render(
      <ClaudeUsageTag
        taskName="TASK-CNY"
        summary={TASK_USAGE}
        directCnyDisplay
      />
    )

    expect(screen.getByText('10.0K · ¥0.020')).toBeTruthy()
    expect(document.body.textContent).not.toContain('$0.020')
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

    expect(screen.getByText(/总计 10\.0K · ¥0\.020/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('$0.020')
  })

  it('双工具模式下任务徽标显示 Claude、Codex 和合计费用', () => {
    render(
      <ClaudeUsageTag
        taskName="TASK-BOTH"
        summary={COMBINED_TASK_USAGE}
        usageTools={['claude-code', 'codex']}
        directCnyDisplay
      />
    )

    expect(
      screen.getByText('Claude ¥0.020 · Codex ¥0.030 · 合计 ¥0.050')
    ).toBeTruthy()
  })

  it('双工具模式下顶部显示各工具累计费用和合计', () => {
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

    expect(
      screen.getByText(/Claude ¥0\.020 · Codex ¥0\.030 · 合计 ¥0\.050/)
    ).toBeTruthy()
  })
})
