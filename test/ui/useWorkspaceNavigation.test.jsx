import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useWorkspaceNavigation from '../../src/ui/hooks/useWorkspaceNavigation.ts'

/**
 * 创建 Worktree 视图手动刷新所需的 hook 参数。
 * @param {Function} scanWorktrees - 模拟的 Worktree 扫描函数。
 * @param {Function} onWorktreesRefreshed - 扫描完成后的用量统计通知回调。
 * @returns {object} 导航 hook 的完整依赖。
 */
function createNavigationOptions(scanWorktrees, onWorktreesRefreshed) {
  return {
    projects: [],
    worktreeTasks: [],
    projectsLoading: false,
    worktreesLoading: false,
    scanProjects: vi.fn(),
    scanWorktrees,
    loadConfig: vi.fn(),
    loadTaskStatus: vi.fn(),
    loadTaskTags: vi.fn(),
    loadTaskLinks: vi.fn(),
    loadTaskVisibility: vi.fn(),
    loadProjectVisibility: vi.fn(),
    loadTaskWorkflow: vi.fn(),
    loadTaskBlockers: vi.fn(),
    clearKeyword: vi.fn(),
    clearWorktreeKeyword: vi.fn(),
    clearActiveTaskKeys: vi.fn(),
    onWorktreesRefreshed,
    message: { warning: vi.fn() },
  }
}

describe('useWorkspaceNavigation 手动刷新', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('Worktree 扫描未完成时已经通知用量统计重新计算', async () => {
    // finishScan 存储受控扫描的完成函数，用于验证价格刷新不等待 Git 状态扫描。
    let finishScan
    // scanWorktrees 存储尚未完成的异步扫描替身，避免测试读取真实工作目录。
    const scanWorktrees = vi.fn(
      () =>
        new Promise((resolve) => {
          finishScan = resolve
        })
    )
    // onWorktreesRefreshed 存储统计版本递增回调的替身。
    const onWorktreesRefreshed = vi.fn()
    // hookResult 存储导航 hook 的挂载结果，用于调用顶部刷新按钮对应的方法。
    const hookResult = renderHook(() =>
      useWorkspaceNavigation(
        createNavigationOptions(scanWorktrees, onWorktreesRefreshed)
      )
    )

    await waitFor(() => expect(scanWorktrees).toHaveBeenCalledTimes(1))
    await act(async () => finishScan([]))
    scanWorktrees.mockClear()

    // refreshRequest 存储刷新 Promise；此时故意不完成扫描，验证通知已经同步触发。
    let refreshRequest
    act(() => {
      refreshRequest = hookResult.result.current.refresh()
    })

    expect(scanWorktrees).toHaveBeenCalledTimes(1)
    expect(onWorktreesRefreshed).toHaveBeenCalledTimes(1)
    finishScan([])
    await act(async () => refreshRequest)
  })
})
