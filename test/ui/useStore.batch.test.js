import { beforeEach, describe, expect, it, vi } from 'vitest'

// mockApi 模拟渲染进程通过 api 层调用主进程的批量操作能力。
const mockApi = vi.hoisted(() => ({
  batchOperate: vi.fn(),
  onBatchProgress: vi.fn(),
  scanProjects: vi.fn(),
  loadTaskLinks: vi.fn(),
  saveTaskLinks: vi.fn(),
  loadTaskVisibility: vi.fn(),
  saveTaskVisibility: vi.fn(),
  loadProjectVisibility: vi.fn(),
  saveProjectVisibility: vi.fn(),
}))

vi.mock('../../src/ui/api.ts', () => ({
  api: {
    ...mockApi,
    loadTaskStatus: vi.fn().mockResolvedValue({}),
    saveTaskStatus: vi.fn().mockResolvedValue(true),
    loadTaskLinks: mockApi.loadTaskLinks,
    saveTaskLinks: mockApi.saveTaskLinks,
    loadTaskVisibility: mockApi.loadTaskVisibility,
    saveTaskVisibility: mockApi.saveTaskVisibility,
    loadProjectVisibility: mockApi.loadProjectVisibility,
    saveProjectVisibility: mockApi.saveProjectVisibility,
    loadTaskWorkflow: vi.fn().mockResolvedValue({}),
    saveTaskWorkflow: vi.fn().mockResolvedValue(true),
    loadTaskBlockers: vi.fn().mockResolvedValue({}),
    saveTaskBlockers: vi.fn().mockResolvedValue(true),
  },
}))

const { useStore } = await import('../../src/ui/store/useStore.ts')

// initialState 保存 store 的初始快照，用于每个用例前还原 Zustand 状态。
const initialState = useStore.getState()

/**
 * 重置 store 与 api mock，保证批量操作用例彼此隔离。
 */
function resetStore() {
  useStore.setState(initialState, true)
  mockApi.batchOperate.mockReset()
  mockApi.onBatchProgress.mockReset()
  mockApi.scanProjects.mockReset()
  mockApi.loadTaskLinks.mockReset().mockResolvedValue({})
  mockApi.saveTaskLinks.mockReset().mockResolvedValue(true)
  mockApi.loadTaskVisibility
    .mockReset()
    .mockResolvedValue({ hidden: [], pinned: [] })
  mockApi.saveTaskVisibility.mockReset().mockResolvedValue(true)
  mockApi.loadProjectVisibility
    .mockReset()
    .mockResolvedValue({ hidden: [], pinned: [] })
  mockApi.saveProjectVisibility.mockReset().mockResolvedValue(true)
  mockApi.onBatchProgress.mockReturnValue(() => {})
  mockApi.scanProjects.mockResolvedValue([])
}

describe('useStore runBatch selection behavior', () => {
  beforeEach(() => {
    resetStore()
  })

  it('批量拉取结束后清空项目勾选', async () => {
    // selectedPaths 为用户在项目 Tab 中批量勾选的项目路径。
    const selectedPaths = ['/repo/a', '/repo/b']
    // results 为批量拉取返回的逐项目结果，包含失败项也代表流程已经结束。
    const results = [
      { success: true },
      { success: false, error: 'remote failed' },
    ]
    useStore.getState().setSelectedPaths(selectedPaths)
    mockApi.batchOperate.mockResolvedValue(results)

    await useStore.getState().runBatch('pull', {})

    expect(useStore.getState().selectedPaths).toEqual([])
  })

  it('非拉取批量操作结束后保留项目勾选', async () => {
    // selectedPaths 为用户在项目 Tab 中批量勾选的项目路径。
    const selectedPaths = ['/repo/a', '/repo/b']
    useStore.getState().setSelectedPaths(selectedPaths)
    mockApi.batchOperate.mockResolvedValue([
      { success: true },
      { success: true },
    ])

    await useStore.getState().runBatch('stash', {})

    expect(useStore.getState().selectedPaths).toEqual(selectedPaths)
  })

  it('批量操作会跳过已隐藏的项目路径', async () => {
    // selectedPaths 为用户之前勾选的项目路径，其中 /repo/b 已被隐藏。
    const selectedPaths = ['/repo/a', '/repo/b']
    useStore.getState().setSelectedPaths(selectedPaths)
    useStore.getState().setProjectHidden('/repo/b', true)
    mockApi.batchOperate.mockResolvedValue([{ success: true }])

    await useStore.getState().runBatch('stash', {})

    expect(mockApi.batchOperate).toHaveBeenCalledWith(['/repo/a'], 'stash', {})
  })
})

describe('useStore task link behavior', () => {
  beforeEach(() => {
    resetStore()
  })

  it('loadTaskLinks 会把旧版单字符串链接规范化为命名链接条目数组', async () => {
    mockApi.loadTaskLinks.mockResolvedValue({
      'TASK-1': 'https://jira.example.com/TASK-1',
    })

    await useStore.getState().loadTaskLinks()

    expect(useStore.getState().taskLinkMap).toEqual({
      'TASK-1': [{ name: '', url: 'https://jira.example.com/TASK-1' }],
    })
  })

  it('setTaskLink 保存多条链接并过滤空白重复项', () => {
    useStore
      .getState()
      .setTaskLink('TASK-1', [
        'https://jira.example.com/TASK-1',
        '',
        ' https://larksuite.example.com/docx/abc ',
        'https://jira.example.com/TASK-1',
      ])

    // expected 存储保存后的规范化链接映射；旧版纯 URL 会升级为无名称链接条目。
    const expected = {
      'TASK-1': [
        { name: '', url: 'https://jira.example.com/TASK-1' },
        { name: '', url: 'https://larksuite.example.com/docx/abc' },
      ],
    }
    expect(useStore.getState().taskLinkMap).toEqual(expected)
    expect(mockApi.saveTaskLinks).toHaveBeenCalledWith(expected)
  })
})

describe('useStore visibility behavior', () => {
  beforeEach(() => {
    resetStore()
  })

  it('隐藏项目时会清掉该项目的现有勾选并持久化', () => {
    useStore.getState().setSelectedPaths(['/repo/a', '/repo/b'])

    useStore.getState().setProjectHidden('/repo/b', true)

    expect(useStore.getState().selectedPaths).toEqual(['/repo/a'])
    expect(useStore.getState().projectVisibility).toEqual({
      hidden: ['/repo/b'],
      pinned: [],
    })
    expect(mockApi.saveProjectVisibility).toHaveBeenCalledWith({
      hidden: ['/repo/b'],
      pinned: [],
    })
  })

  it('置顶任务时会写入任务可见性偏好', () => {
    useStore.getState().setTaskPinned('TASK-A', true)

    expect(useStore.getState().taskVisibility).toEqual({
      hidden: [],
      pinned: ['TASK-A'],
    })
    expect(mockApi.saveTaskVisibility).toHaveBeenCalledWith({
      hidden: [],
      pinned: ['TASK-A'],
    })
  })
})
