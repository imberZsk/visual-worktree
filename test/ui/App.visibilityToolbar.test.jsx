import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { App as AntApp } from 'antd'

// mockApi 模拟 App 启动与显隐工具栏测试所需的 Electron API。
const mockApi = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  selectDirectory: vi.fn(),
  scanWorktreesByTask: vi.fn(),
  scanProjects: vi.fn(),
  loadTaskStatus: vi.fn(),
  loadTaskLinks: vi.fn(),
  loadTaskVisibility: vi.fn(),
  loadProjectVisibility: vi.fn(),
  loadTaskWorkflow: vi.fn(),
  loadTaskBlockers: vi.fn(),
  loadTaskEnvHealth: vi.fn(),
  getClaudeTasksSummary: vi.fn(),
  getClaudeSessionsByTask: vi.fn(),
  checkEnvHealth: vi.fn(),
  saveTaskEnvHealth: vi.fn(),
  onStepOutput: vi.fn(),
  onBatchProgress: vi.fn(),
}))

vi.mock('../../src/ui/api.ts', () => ({
  api: {
    loadConfig: mockApi.loadConfig,
    saveConfig: mockApi.saveConfig,
    selectDirectory: mockApi.selectDirectory,
    scanWorktreesByTask: mockApi.scanWorktreesByTask,
    scanProjects: mockApi.scanProjects,
    loadTaskStatus: mockApi.loadTaskStatus,
    loadTaskLinks: mockApi.loadTaskLinks,
    loadTaskVisibility: mockApi.loadTaskVisibility,
    loadProjectVisibility: mockApi.loadProjectVisibility,
    loadTaskWorkflow: mockApi.loadTaskWorkflow,
    loadTaskBlockers: mockApi.loadTaskBlockers,
    loadTaskEnvHealth: mockApi.loadTaskEnvHealth,
    getClaudeTasksSummary: mockApi.getClaudeTasksSummary,
    getClaudeSessionsByTask: mockApi.getClaudeSessionsByTask,
    checkEnvHealth: mockApi.checkEnvHealth,
    saveTaskEnvHealth: mockApi.saveTaskEnvHealth,
    onStepOutput: mockApi.onStepOutput,
    onBatchProgress: mockApi.onBatchProgress,
    openInFinder: vi.fn(),
    openInVscode: vi.fn(),
    openInTerminal: vi.fn(),
    copyText: vi.fn(),
    loadTaskHistory: vi.fn(),
    removeTaskHistory: vi.fn(),
    openExternalUrl: vi.fn(),
    removeWorktree: vi.fn(),
    pruneWorktrees: vi.fn(),
    removeTaskFolder: vi.fn(),
    appendTaskHistory: vi.fn(),
    archiveTaskDocs: vi.fn(),
    batchOperate: vi.fn(),
    batchAddWorktree: vi.fn(),
    runWorkflowStep: vi.fn(),
  },
}))

const { default: App } = await import('../../src/ui/App.tsx')
const { useStore } = await import('../../src/ui/store/useStore.ts')

// initialState 保存 Zustand 初始状态，用于每个用例前还原。
const initialState = useStore.getState()

// worktreeTasks 测试用 worktree 任务列表，包含一个可见任务和一个隐藏任务。
const worktreeTasks = [
  {
    task: 'TASK-A',
    path: '/wt/TASK-A',
    worktrees: [
      {
        project: 'projA',
        projectPath: '/src/projA',
        path: '/wt/TASK-A/projA',
        branch: 'feat-a',
        prunable: false,
        missing: false,
        hasUncommittedChanges: false,
        ahead: 0,
        behind: 0,
      },
    ],
  },
  {
    task: 'TASK-HIDDEN',
    path: '/wt/TASK-HIDDEN',
    worktrees: [
      {
        project: 'projB',
        projectPath: '/src/projB',
        path: '/wt/TASK-HIDDEN/projB',
        branch: 'feat-hidden',
        prunable: false,
        missing: false,
        hasUncommittedChanges: false,
        ahead: 0,
        behind: 0,
      },
    ],
  },
]

// projects 测试用项目列表，包含一个可见项目和一个隐藏项目。
const projects = [
  {
    name: 'alpha',
    path: '/repo/alpha',
    isGitRepo: true,
    isMainBranch: true,
    hasUncommittedChanges: false,
    hasUnpushedCommits: false,
    canPull: false,
    ahead: 0,
    behind: 0,
  },
  {
    name: 'beta',
    path: '/repo/beta',
    isGitRepo: true,
    isMainBranch: true,
    hasUncommittedChanges: false,
    hasUnpushedCommits: false,
    canPull: false,
    ahead: 0,
    behind: 0,
  },
]

/**
 * 构造 App 测试用配置。
 * @returns {object} 配置对象
 */
function makeConfig() {
  return {
    sourceProjectsPath: '/repo',
    worktreesPath: '/wt',
    mainBranches: ['master', 'main'],
    ignoredProjects: [],
    autoFetch: false,
    vscodeCommand: 'code {path}',
    terminalApp: 'Terminal',
    workflowSteps: [],
    cicdLinks: {},
    envCheckRoles: [],
  }
}

/**
 * 渲染 App 并注入 antd App 上下文。
 * @returns {ReturnType<typeof render>} 渲染结果
 */
function renderApp() {
  return render(
    <AntApp>
      <App />
    </AntApp>
  )
}

/**
 * 断言工具栏显隐按钮不展示眼睛图标。
 * @param {HTMLElement} button - 待检查按钮
 */
function expectNoEyeIcon(button) {
  expect(button.querySelector('.anticon-eye')).toBeNull()
  expect(button.querySelector('.anticon-eye-invisible')).toBeNull()
}

describe('App 显示隐藏项工具栏', () => {
  beforeEach(() => {
    localStorage.clear()
    useStore.setState(initialState, true)
    mockApi.loadConfig.mockReset().mockResolvedValue(makeConfig())
    mockApi.saveConfig.mockReset().mockImplementation(async (config) => config)
    mockApi.selectDirectory.mockReset()
    mockApi.scanWorktreesByTask.mockReset().mockResolvedValue(worktreeTasks)
    mockApi.scanProjects.mockReset().mockResolvedValue(projects)
    mockApi.loadTaskStatus.mockReset().mockResolvedValue({})
    mockApi.loadTaskLinks.mockReset().mockResolvedValue({})
    mockApi.loadTaskVisibility
      .mockReset()
      .mockResolvedValue({ hidden: ['TASK-HIDDEN'], pinned: [] })
    mockApi.loadProjectVisibility
      .mockReset()
      .mockResolvedValue({ hidden: ['/repo/beta'], pinned: [] })
    mockApi.loadTaskWorkflow.mockReset().mockResolvedValue({})
    mockApi.loadTaskBlockers.mockReset().mockResolvedValue({})
    mockApi.loadTaskEnvHealth.mockReset().mockResolvedValue({})
    mockApi.getClaudeTasksSummary.mockReset().mockResolvedValue({})
    mockApi.getClaudeSessionsByTask.mockReset().mockResolvedValue([])
    mockApi.checkEnvHealth.mockReset().mockResolvedValue({})
    mockApi.saveTaskEnvHealth.mockReset().mockResolvedValue(true)
    mockApi.onStepOutput.mockReset().mockReturnValue(() => {})
    mockApi.onBatchProgress.mockReset().mockReturnValue(() => {})
  })

  afterEach(() => cleanup())

  it('首次安装在专用弹层保存两条路径后完成初始化', async () => {
    // initialConfig 存储尚未完成首次配置的新安装配置。
    const initialConfig = { ...makeConfig(), onboardingCompleted: false }
    mockApi.loadConfig.mockResolvedValueOnce(initialConfig)
    mockApi.selectDirectory.mockResolvedValueOnce({
      canceled: false,
      path: '/new/source',
    })
    renderApp()

    expect(await screen.findByText('配置项目路径')).toBeTruthy()
    expect(screen.getByText(/请选择本地 Git 仓库所在目录/)).toBeTruthy()
    // sourceInput 存储首次初始化的源项目根目录输入框。
    const sourceInput = screen.getByRole('textbox', { name: '源项目根目录' })
    // worktreeInput 存储首次初始化的 Worktree 根目录输入框。
    const worktreeInput = screen.getByRole('textbox', {
      name: 'Worktree 根目录',
    })
    fireEvent.click(screen.getByRole('button', { name: '选择源项目根目录' }))
    await waitFor(() => expect(sourceInput.value).toBe('/new/source'))
    expect(mockApi.selectDirectory).toHaveBeenCalledWith({
      defaultPath: '/repo',
    })
    fireEvent.change(worktreeInput, { target: { value: '/new/worktrees' } })

    fireEvent.click(screen.getByRole('button', { name: '保存并开始使用' }))

    await waitFor(() => {
      expect(mockApi.saveConfig).toHaveBeenCalledTimes(1)
    })
    // savedConfig 存储首次初始化提交给主进程的配置，验证顶层路径与当前路径组合保持一致。
    const savedConfig = mockApi.saveConfig.mock.calls[0][0]
    expect(savedConfig.onboardingCompleted).toBe(true)
    expect(savedConfig.sourceProjectsPath).toBe('/new/source')
    expect(savedConfig.worktreesPath).toBe('/new/worktrees')
    expect(savedConfig.pathProfiles[0]).toMatchObject({
      sourceProjectsPath: '/new/source',
      worktreesPath: '/new/worktrees',
    })
  })

  it('首次进入项目 Tab 会自动 fetch 一次，后续切回不重复自动 fetch', async () => {
    localStorage.setItem('vw-active-view', 'worktrees')
    renderApp()

    await waitFor(() =>
      expect(mockApi.scanWorktreesByTask).toHaveBeenCalledTimes(1)
    )
    expect(mockApi.scanProjects).not.toHaveBeenCalled()

    // projectTab 存储顶部视图切换中的项目入口。
    const projectTab = screen.getByText('项目')
    fireEvent.click(projectTab)

    await waitFor(() =>
      expect(mockApi.scanProjects).toHaveBeenCalledWith({ fetch: true })
    )
    expect(mockApi.scanProjects).toHaveBeenCalledTimes(1)

    // worktreeTab 存储顶部视图切换中的 Worktree 入口，用于验证再次切回项目不会触发第二次自动 fetch。
    const worktreeTab = screen.getByText('Worktree')
    fireEvent.click(worktreeTab)
    fireEvent.click(projectTab)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /显示隐藏项目/ })).toBeTruthy()
    )
    expect(mockApi.scanProjects).toHaveBeenCalledTimes(1)
  })

  it('启动时停留在项目 Tab 只触发一次带 fetch 的项目扫描', async () => {
    localStorage.setItem('vw-active-view', 'projects')
    renderApp()

    await waitFor(() =>
      expect(mockApi.scanProjects).toHaveBeenCalledWith({ fetch: true })
    )
    expect(mockApi.scanProjects).toHaveBeenCalledTimes(1)
  })

  it('项目较多且刷新未完成时使用相对应用视口居中的全屏 loading', async () => {
    // manyProjects 存储长项目列表，复现原嵌套 Spin 按列表总高度计算中心点的问题。
    const manyProjects = Array.from({ length: 40 }, (_, index) => ({
      ...projects[0],
      name: `project-${index + 1}`,
      path: `/repo/project-${index + 1}`,
    }))
    localStorage.setItem('vw-active-view', 'projects')
    useStore.setState({ projects: manyProjects })
    mockApi.scanProjects.mockReturnValue(new Promise(() => {}))

    renderApp()

    await waitFor(
      () => {
        // fullscreenSpin 存储 Ant Design 相对应用视口固定定位的加载层。
        const fullscreenSpin = document.querySelector(
          '.ant-spin-fullscreen.ant-spin-spinning'
        )
        expect(fullscreenSpin).toBeTruthy()
      },
      { timeout: 5000 }
    )
    expect(useStore.getState().projects).toHaveLength(40)
    expect(document.querySelector('.full-height-spin')).toBeNull()
  })

  it('Worktree 工具栏显隐入口只展示文案，并与排序控件保持清晰间距', async () => {
    localStorage.setItem('vw-active-view', 'worktrees')
    renderApp()

    // showButton 存储默认状态的显隐入口；顶部工具栏只保留文案，避免和行级状态眼睛混淆。
    const showButton = await screen.findByRole('button', {
      name: /显示隐藏任务/,
    })
    await waitFor(() => expect(showButton.disabled).toBe(false))
    expectNoEyeIcon(showButton)
    expect(showButton.closest('.ant-space').style.columnGap).toBe('12px')
    // statusSortOption 存储排序切换器里的“状态”选项。
    const statusSortOption = screen.getByText('状态')
    // nameSortOption 存储排序切换器里的“名称”选项。
    const nameSortOption = screen.getByText('名称')
    expect(
      statusSortOption.compareDocumentPosition(nameSortOption) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    fireEvent.click(showButton)

    // hideButton 存储显示隐藏项后的入口；收起状态同样只展示文案。
    const hideButton = await screen.findByRole('button', {
      name: /收起隐藏任务/,
    })
    expectNoEyeIcon(hideButton)
  })

  it('项目工具栏显隐入口只展示文案', async () => {
    localStorage.setItem('vw-active-view', 'projects')
    renderApp()

    // showButton 存储默认状态的显隐入口；顶部工具栏只保留文案，避免和行级状态眼睛混淆。
    const showButton = await screen.findByRole('button', {
      name: /显示隐藏项目/,
    })
    await waitFor(() => expect(showButton.disabled).toBe(false))
    expectNoEyeIcon(showButton)

    fireEvent.click(showButton)

    // hideButton 存储显示隐藏项后的入口；收起状态同样只展示文案。
    const hideButton = await screen.findByRole('button', {
      name: /收起隐藏项目/,
    })
    expectNoEyeIcon(hideButton)
  })
})
