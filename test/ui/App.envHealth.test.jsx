import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react'
import { App as AntApp } from 'antd'
import {
  TASK_LINK_NAME_PLACEHOLDER,
  TASK_LINK_PLACEHOLDER,
} from '../../src/ui/components/TaskLinksEditor.tsx'

// mockApi 模拟 App 创建 worktree 后自动触发环境检查所需的 Electron API。
const mockApi = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  scanWorktreesByTask: vi.fn(),
  scanProjects: vi.fn(),
  batchAddWorktree: vi.fn(),
  checkEnvHealth: vi.fn(),
  loadTaskStatus: vi.fn(),
  loadTaskLinks: vi.fn(),
  loadTaskWorkflow: vi.fn(),
  loadTaskBlockers: vi.fn(),
  loadTaskEnvHealth: vi.fn(),
  getClaudeTasksSummary: vi.fn(),
  getClaudeSessionsByTask: vi.fn(),
  onStepOutput: vi.fn(),
  saveTaskWorkflow: vi.fn(),
  saveTaskEnvHealth: vi.fn(),
  saveTaskLinks: vi.fn(),
}))

vi.mock('../../src/ui/api.ts', () => ({
  api: {
    loadConfig: mockApi.loadConfig,
    scanWorktreesByTask: mockApi.scanWorktreesByTask,
    scanProjects: mockApi.scanProjects,
    batchAddWorktree: mockApi.batchAddWorktree,
    checkEnvHealth: mockApi.checkEnvHealth,
    loadTaskStatus: mockApi.loadTaskStatus,
    loadTaskLinks: mockApi.loadTaskLinks,
    loadTaskWorkflow: mockApi.loadTaskWorkflow,
    loadTaskBlockers: mockApi.loadTaskBlockers,
    loadTaskEnvHealth: mockApi.loadTaskEnvHealth,
    getClaudeTasksSummary: mockApi.getClaudeTasksSummary,
    getClaudeSessionsByTask: mockApi.getClaudeSessionsByTask,
    onStepOutput: mockApi.onStepOutput,
    saveTaskWorkflow: mockApi.saveTaskWorkflow,
    saveTaskEnvHealth: mockApi.saveTaskEnvHealth,
    saveTaskLinks: mockApi.saveTaskLinks,
    openInFinder: vi.fn(),
    openInVscode: vi.fn(),
    openInTerminal: vi.fn(),
    copyText: vi.fn(),
    runWorkflowStep: vi.fn(),
    removeWorktree: vi.fn(),
    pruneWorktrees: vi.fn(),
    removeTaskFolder: vi.fn(),
    appendTaskHistory: vi.fn(),
    loadTaskHistory: vi.fn(),
    removeTaskHistory: vi.fn(),
    openExternalUrl: vi.fn(),
    getSafeToRemoveWorktrees: vi.fn(),
  },
}))

const { default: App } = await import('../../src/ui/App.tsx')
const { useStore } = await import('../../src/ui/store/useStore.ts')

// initialState 保存 Zustand 初始状态，用于每个用例前还原。
const initialState = useStore.getState()

// projects 测试用源项目列表，CreateWorktreeModal 只展示 isGitRepo 为 true 的项目。
const projects = [{ name: 'projA', path: '/src/projA', isGitRepo: true }]

// createdTasks 模拟创建后扫描到的新 worktree 任务。
const createdTasks = [
  {
    task: 'TASK-NEW',
    path: '/wt/TASK-NEW',
    worktrees: [
      {
        project: 'projA',
        projectPath: '/src/projA',
        path: '/wt/TASK-NEW/projA',
        branch: 'TASK-NEW',
        prunable: false,
        missing: false,
        hasUncommittedChanges: false,
        ahead: 0,
        behind: 0,
      },
    ],
  },
]

/**
 * 构造 App 测试用配置。
 * @returns {object} 配置对象
 */
function makeConfig() {
  return {
    sourceProjectsPath: '/src',
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
 * 渲染 App 并提供 antd App 上下文。
 * @returns {ReturnType<typeof render>} 渲染结果
 */
function renderApp() {
  return render(
    <AntApp>
      <App />
    </AntApp>
  )
}

// getCreateConfirmButton 取创建 worktree Modal 的确认按钮。
function getCreateConfirmButton() {
  return document.querySelector('.ant-modal-footer .ant-btn-primary')
}

describe('App 自动环境检查', () => {
  beforeEach(() => {
    // activeView 固定为 worktrees，确保首屏展示 Worktree Tab。
    localStorage.setItem('vw-active-view', 'worktrees')
    // 重置全局 store，避免上一个用例留下任务/项目状态。
    useStore.setState(initialState, true)
    useStore.setState({ projects })
    mockApi.loadConfig.mockReset().mockResolvedValue(makeConfig())
    mockApi.scanWorktreesByTask
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValue(createdTasks)
    mockApi.scanProjects.mockReset().mockResolvedValue(projects)
    mockApi.batchAddWorktree
      .mockReset()
      .mockResolvedValue([
        { project: 'projA', success: true, path: '/wt/TASK-NEW/projA' },
      ])
    mockApi.checkEnvHealth.mockReset().mockResolvedValue({
      summary: {
        status: 'ok',
        projectCount: 1,
        issueCount: 0,
        failedProjects: [],
        message: '1 个项目环境正常',
      },
      projects: [],
      deps: { status: 'ok', message: 'ok', fixes: [] },
      ports: { status: 'ok', message: 'ok', fixes: [] },
      services: { status: 'ok', message: 'ok', fixes: [] },
      git: { status: 'ok', message: '工作区干净', fixes: [] },
    })
    mockApi.loadTaskStatus.mockReset().mockResolvedValue({})
    mockApi.loadTaskLinks.mockReset().mockResolvedValue({})
    mockApi.loadTaskWorkflow.mockReset().mockResolvedValue({})
    mockApi.loadTaskBlockers.mockReset().mockResolvedValue({})
    mockApi.loadTaskEnvHealth.mockReset().mockResolvedValue({})
    mockApi.getClaudeTasksSummary.mockReset().mockResolvedValue({})
    mockApi.getClaudeSessionsByTask.mockReset().mockResolvedValue([])
    mockApi.onStepOutput.mockReset().mockReturnValue(() => {})
    mockApi.saveTaskWorkflow.mockReset().mockResolvedValue(true)
    mockApi.saveTaskEnvHealth.mockReset().mockResolvedValue(true)
    mockApi.saveTaskLinks.mockReset().mockResolvedValue(true)
  })

  afterEach(() => cleanup())

  it('创建 worktree 成功后自动触发环境检查并在任务行显示 loading', async () => {
    // resolveEnvHealth 延迟环境检查完成，用于断言中间的 checking 状态
    let resolveEnvHealth
    mockApi.checkEnvHealth.mockReset().mockReturnValue(
      new Promise((resolve) => {
        resolveEnvHealth = resolve
      })
    )

    renderApp()

    await waitFor(() => expect(screen.getByText('创建 Worktree')).toBeTruthy())
    fireEvent.click(screen.getByText('创建 Worktree'))
    fireEvent.change(screen.getByPlaceholderText('PROJ-1234-需求简述'), {
      target: { value: 'TASK-NEW' },
    })
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0])
    fireEvent.click(screen.getByTitle('projA'))
    fireEvent.click(getCreateConfirmButton())

    await waitFor(() => {
      expect(mockApi.checkEnvHealth).toHaveBeenCalledWith('/wt/TASK-NEW')
      expect(screen.getByText('环境检查中')).toBeTruthy()
    })

    resolveEnvHealth({
      summary: {
        status: 'ok',
        projectCount: 1,
        issueCount: 0,
        failedProjects: [],
        message: '1 个项目环境正常',
      },
      projects: [],
      deps: { status: 'ok', message: 'ok', fixes: [] },
      ports: { status: 'ok', message: 'ok', fixes: [] },
      services: { status: 'ok', message: 'ok', fixes: [] },
      git: { status: 'ok', message: 'ok', fixes: [] },
    })

    await waitFor(() => {
      expect(screen.getByText('环境正常')).toBeTruthy()
    })
  })

  it('从 Worktree 视图直接打开创建弹窗时会先加载项目选项', async () => {
    // 模拟首屏停留在 Worktree 视图：默认只扫任务列表，项目列表尚未加载。
    useStore.setState({ projects: [] })

    renderApp()

    await waitFor(() => expect(screen.getByText('创建 Worktree')).toBeTruthy())
    fireEvent.click(screen.getByText('创建 Worktree'))
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0])

    await waitFor(() => {
      expect(mockApi.scanProjects).toHaveBeenCalledTimes(1)
      expect(screen.getByTitle('projA')).toBeTruthy()
    })
  })

  it('创建时填写需求链接会保存到任务链接映射', async () => {
    renderApp()

    await waitFor(() => expect(screen.getByText('创建 Worktree')).toBeTruthy())
    fireEvent.click(screen.getByText('创建 Worktree'))
    fireEvent.change(screen.getByPlaceholderText('PROJ-1234-需求简述'), {
      target: { value: 'TASK-NEW' },
    })
    // firstNameInput 存储默认展示的第一条需求链接名称输入框。
    const firstNameInput = screen.getByPlaceholderText(
      TASK_LINK_NAME_PLACEHOLDER
    )
    fireEvent.change(firstNameInput, { target: { value: 'Jira' } })
    // firstLinkInput 存储默认展示的第一条需求链接地址输入框。
    const firstLinkInput = screen.getByPlaceholderText(TASK_LINK_PLACEHOLDER)
    fireEvent.change(firstLinkInput, {
      target: { value: 'https://jira.example.com/TASK-NEW' },
    })
    fireEvent.click(screen.getByText('添加链接'))
    // nameInputs 存储新增后的所有需求链接名称输入框。
    const nameInputs = screen.getAllByPlaceholderText(
      TASK_LINK_NAME_PLACEHOLDER
    )
    fireEvent.change(nameInputs[1], { target: { value: '需求文档' } })
    // linkInputs 存储新增后的所有需求链接输入框。
    const linkInputs = screen.getAllByPlaceholderText(TASK_LINK_PLACEHOLDER)
    fireEvent.change(linkInputs[1], {
      target: { value: 'https://larksuite.example.com/docx/abc' },
    })
    fireEvent.click(getCreateConfirmButton())

    await waitFor(() =>
      expect(mockApi.saveTaskLinks).toHaveBeenCalledWith({
        'TASK-NEW': [
          { name: 'Jira', url: 'https://jira.example.com/TASK-NEW' },
          { name: '需求文档', url: 'https://larksuite.example.com/docx/abc' },
        ],
      })
    )
  })

  it('环境详情不展示未声明端口的跳过项', async () => {
    mockApi.scanWorktreesByTask.mockReset().mockResolvedValue(createdTasks)
    mockApi.checkEnvHealth.mockReset().mockResolvedValue({
      summary: {
        status: 'ok',
        projectCount: 1,
        issueCount: 0,
        failedProjects: [],
        message: '1 个项目环境正常',
      },
      projects: [
        {
          name: 'projA',
          path: '/wt/TASK-NEW/projA',
          kind: 'frontend',
          kindLabel: '前端',
          status: 'ok',
          issueCount: 0,
          reasons: ['前端依赖 vite'],
          checks: {
            deps: { status: 'ok', message: '依赖完整', fixes: [] },
            ports: {
              status: 'ok',
              message: '未在 scripts 中发现端口声明',
              fixes: [],
              skipped: true,
            },
            services: {
              status: 'ok',
              message: '无 .env，跳过服务检查',
              fixes: [],
              skipped: true,
            },
            git: { status: 'ok', message: '工作区干净', fixes: [] },
          },
        },
      ],
      deps: { status: 'ok', message: '依赖完整', fixes: [] },
      ports: {
        status: 'ok',
        message: '未在 scripts 中发现端口声明',
        fixes: [],
      },
      services: { status: 'ok', message: '无 .env，跳过服务检查', fixes: [] },
      git: { status: 'ok', message: '工作区干净', fixes: [] },
    })

    renderApp()

    await waitFor(() => expect(screen.getByText('环境正常')).toBeTruthy())
    fireEvent.click(screen.getByText('环境正常'))

    await waitFor(() => {
      expect(screen.getByText('依赖完整')).toBeTruthy()
    })
    expect(screen.queryByText('未在 scripts 中发现端口声明')).toBeNull()
  })

  it('自动执行环境检查完成后会保存任务环境状态缓存', async () => {
    mockApi.scanWorktreesByTask.mockReset().mockResolvedValue(createdTasks)
    mockApi.checkEnvHealth.mockReset().mockResolvedValue({
      summary: {
        status: 'failed',
        projectCount: 1,
        issueCount: 2,
        failedProjects: ['projA'],
        message: '发现 2 个环境问题',
      },
      projects: [],
      deps: { status: 'error', message: '依赖缺失', fixes: ['npm install'] },
      ports: { status: 'ok', message: '端口正常', fixes: [] },
      services: { status: 'ok', message: '服务正常', fixes: [] },
      git: { status: 'ok', message: '工作区干净', fixes: [] },
    })

    renderApp()

    await waitFor(() => {
      // saveCalls 存储环境检查期间写入缓存的所有调用；至少包含 checking 和最终 failed 两次
      const saveCalls = mockApi.saveTaskEnvHealth.mock.calls
      // lastSavedMap 存储最后一次持久化的环境检查映射，应包含完成后的 TASK-NEW 状态
      const lastSavedMap = saveCalls.at(-1)?.[0]
      expect(lastSavedMap?.['TASK-NEW']?.status).toBe('failed')
      expect(lastSavedMap?.['TASK-NEW']?.issueCount).toBe(2)
      expect(lastSavedMap?.['TASK-NEW']?.result?.summary?.message).toBe(
        '发现 2 个环境问题'
      )
    })
  })

  it('启动后加载已持久化的环境检查状态并显示在任务行', async () => {
    mockApi.scanWorktreesByTask.mockReset().mockResolvedValue(createdTasks)
    mockApi.loadTaskEnvHealth.mockReset().mockResolvedValue({
      'TASK-NEW': {
        version: 4,
        status: 'ok',
        issueCount: 0,
        taskDir: '/wt/TASK-NEW',
        checkedAt: '2026-06-30T10:00:00.000Z',
        result: {
          summary: {
            status: 'ok',
            projectCount: 1,
            issueCount: 0,
            failedProjects: [],
            message: '1 个项目环境正常',
          },
          projects: [],
        },
      },
    })

    renderApp()

    await waitFor(() => {
      expect(screen.getByText('环境正常')).toBeTruthy()
    })
  })

  it('启动后对旧版本环境检查缓存重新执行检查', async () => {
    mockApi.scanWorktreesByTask.mockReset().mockResolvedValue(createdTasks)
    mockApi.loadTaskEnvHealth.mockReset().mockResolvedValue({
      'TASK-NEW': {
        version: 3,
        status: 'failed',
        issueCount: 1,
        taskDir: '/wt/TASK-NEW',
        checkedAt: '2026-07-02T06:53:02.412Z',
        result: {
          summary: {
            status: 'failed',
            projectCount: 1,
            issueCount: 1,
            failedProjects: ['logistics'],
            message: '1 个项目存在 1 个环境问题',
          },
          projects: [
            {
              name: 'logistics',
              path: '/wt/TASK-NEW/logistics',
              kind: 'backend_php',
              kindLabel: 'PHP 后端',
              status: 'failed',
              issueCount: 1,
              reasons: ['PHP 后端文件 composer.json'],
              checks: {
                deps: {
                  status: 'error',
                  message: '未安装 PHP 依赖（缺少 vendor）',
                  fixes: [],
                },
              },
            },
          ],
        },
      },
    })
    mockApi.checkEnvHealth.mockReset().mockResolvedValue({
      summary: {
        status: 'ok',
        projectCount: 1,
        issueCount: 0,
        failedProjects: [],
        message: '1 个项目环境正常',
      },
      projects: [],
      deps: {
        status: 'ok',
        message: '检测到 Docker 运行配置，跳过本机 PHP vendor 检查',
        fixes: [],
      },
      ports: { status: 'ok', message: 'ok', fixes: [] },
      services: { status: 'ok', message: 'ok', fixes: [] },
      git: { status: 'ok', message: '工作区干净', fixes: [] },
    })

    renderApp()

    await waitFor(() =>
      expect(mockApi.checkEnvHealth).toHaveBeenCalledWith('/wt/TASK-NEW')
    )
    await waitFor(() => expect(screen.getByText('环境正常')).toBeTruthy())
    expect(screen.queryByText('1 个环境问题')).toBeNull()
  })

  it('启动后对未检查任务自动后台执行环境检查并保持页面可操作', async () => {
    // resolveEnvHealth 延迟环境检查完成，用于断言启动后先展示 checking。
    let resolveEnvHealth
    mockApi.scanWorktreesByTask.mockReset().mockResolvedValue(createdTasks)
    mockApi.loadTaskEnvHealth.mockReset().mockResolvedValue({})
    mockApi.checkEnvHealth.mockReset().mockReturnValue(
      new Promise((resolve) => {
        resolveEnvHealth = resolve
      })
    )

    renderApp()

    await waitFor(() => {
      expect(mockApi.checkEnvHealth).toHaveBeenCalledWith('/wt/TASK-NEW')
      expect(screen.getByText('环境检查中')).toBeTruthy()
    })
    expect(screen.getByText('创建 Worktree').closest('button').disabled).toBe(
      false
    )

    resolveEnvHealth({
      summary: {
        status: 'ok',
        projectCount: 1,
        issueCount: 0,
        failedProjects: [],
        message: '1 个项目环境正常',
      },
      projects: [],
      deps: { status: 'ok', message: 'ok', fixes: [] },
      ports: { status: 'ok', message: 'ok', fixes: [] },
      services: { status: 'ok', message: 'ok', fixes: [] },
      git: { status: 'ok', message: '工作区干净', fixes: [] },
    })

    await waitFor(() =>
      expect(screen.getAllByText('环境正常').length).toBeGreaterThan(0)
    )
  })

  it('打开旧环境检查缓存时不展示根级 docs 工作文档目录', async () => {
    mockApi.scanWorktreesByTask.mockReset().mockResolvedValue(createdTasks)
    mockApi.loadTaskEnvHealth.mockReset().mockResolvedValue({
      'TASK-NEW': {
        version: 4,
        status: 'ok',
        issueCount: 0,
        taskDir: '/wt/TASK-NEW',
        checkedAt: '2026-07-02T06:53:02.412Z',
        result: {
          summary: {
            status: 'ok',
            projectCount: 3,
            issueCount: 0,
            failedProjects: [],
            message: '3 个项目环境正常',
          },
          projects: [
            {
              name: 'projA',
              path: '/wt/TASK-NEW/projA',
              kind: 'frontend',
              kindLabel: '前端',
              status: 'ok',
              issueCount: 0,
              reasons: ['前端依赖 vite'],
              checks: {},
            },
            {
              name: 'projB',
              path: '/wt/TASK-NEW/projB',
              kind: 'backend',
              kindLabel: '后端',
              status: 'ok',
              issueCount: 0,
              reasons: ['后端依赖 express'],
              checks: {},
            },
            {
              name: 'docs',
              path: '/wt/TASK-NEW/docs',
              kind: 'unknown',
              kindLabel: '未知',
              status: 'ok',
              issueCount: 0,
              reasons: ['未命中常见前端/后端/小程序特征，仅执行通用检查'],
              checks: {},
            },
          ],
        },
      },
    })

    renderApp()

    await waitFor(() => expect(screen.getByText('环境正常')).toBeTruthy())
    fireEvent.click(screen.getByText('环境正常'))

    await waitFor(() => {
      expect(screen.getByText('2 个项目环境正常')).toBeTruthy()
    })
    expect(screen.getByText('projA')).toBeTruthy()
    expect(screen.getByText('projB')).toBeTruthy()
    expect(screen.queryByText('docs')).toBeNull()
    expect(screen.queryByText('3 个项目环境正常')).toBeNull()
  })

  it('启动后将旧缓存里的 Git warning-only 结果显示为环境正常', async () => {
    mockApi.scanWorktreesByTask.mockReset().mockResolvedValue(createdTasks)
    mockApi.loadTaskEnvHealth.mockReset().mockResolvedValue({
      'TASK-NEW': {
        version: 4,
        status: 'failed',
        issueCount: 1,
        taskDir: '/wt/TASK-NEW',
        checkedAt: '2026-07-02T06:53:02.412Z',
        result: {
          summary: {
            status: 'failed',
            projectCount: 1,
            issueCount: 1,
            failedProjects: ['projA'],
            message: '1 个项目存在 1 个环境问题',
          },
          projects: [
            {
              name: 'projA',
              path: '/wt/TASK-NEW/projA',
              kind: 'frontend',
              kindLabel: '前端',
              status: 'failed',
              issueCount: 1,
              reasons: ['前端依赖 vite'],
              checks: {
                git: {
                  status: 'warning',
                  message: '4 个未提交改动',
                  fixes: [],
                },
              },
            },
          ],
        },
      },
    })

    const { container } = renderApp()

    await waitFor(() => expect(screen.getByText('环境正常')).toBeTruthy())
    // okTag 存储任务行环境检查标签，旧缓存 Git-only warning 不应继续展示为环境问题。
    const okTag = [...container.querySelectorAll('.ant-tag')].find((tag) =>
      tag.textContent.includes('环境正常')
    )

    expect(okTag.className).toContain('ant-tag-success')
    expect(screen.queryByText('1 个环境问题')).toBeNull()
    fireEvent.click(screen.getByText('环境正常'))
    await waitFor(() => expect(screen.getByText('4 个未提交改动')).toBeTruthy())
  })

  it('启动后将旧缓存里的空任务目录结果显示为环境正常', async () => {
    mockApi.scanWorktreesByTask.mockReset().mockResolvedValue(createdTasks)
    mockApi.loadTaskEnvHealth.mockReset().mockResolvedValue({
      'TASK-NEW': {
        version: 4,
        status: 'failed',
        issueCount: 1,
        taskDir: '/wt/TASK-NEW',
        checkedAt: '2026-07-02T06:53:02.412Z',
        result: {
          summary: {
            status: 'failed',
            projectCount: 0,
            issueCount: 1,
            failedProjects: [],
            message: '任务目录下未找到项目',
          },
          projects: [],
          deps: {
            status: 'warning',
            message: '任务目录下未找到项目',
            fixes: [],
          },
          ports: {
            status: 'warning',
            message: '任务目录下未找到项目',
            fixes: [],
          },
          services: {
            status: 'warning',
            message: '任务目录下未找到项目',
            fixes: [],
          },
          git: {
            status: 'warning',
            message: '任务目录下未找到项目',
            fixes: [],
          },
        },
      },
    })

    renderApp()

    await waitFor(() => expect(screen.getByText('环境正常')).toBeTruthy())
    expect(screen.queryByText('1 个环境问题')).toBeNull()
    fireEvent.click(screen.getByText('环境正常'))
    await waitFor(() =>
      expect(screen.getByText('任务目录下未找到项目')).toBeTruthy()
    )
  })

  it('打开旧环境检查缓存时不展示 unknown 非前后端项目', async () => {
    mockApi.scanWorktreesByTask.mockReset().mockResolvedValue(createdTasks)
    mockApi.loadTaskEnvHealth.mockReset().mockResolvedValue({
      'TASK-NEW': {
        version: 4,
        status: 'failed',
        issueCount: 1,
        taskDir: '/wt/TASK-NEW',
        checkedAt: '2026-07-02T06:53:02.412Z',
        result: {
          summary: {
            status: 'failed',
            projectCount: 2,
            issueCount: 1,
            failedProjects: ['superpowers'],
            message: '1 个项目存在 1 个环境问题',
          },
          projects: [
            {
              name: 'projA',
              path: '/wt/TASK-NEW/projA',
              kind: 'frontend',
              kindLabel: '前端',
              status: 'ok',
              issueCount: 0,
              reasons: ['前端依赖 vite'],
              checks: {},
            },
            {
              name: 'superpowers',
              path: '/wt/TASK-NEW/superpowers',
              kind: 'unknown',
              kindLabel: '未知',
              status: 'failed',
              issueCount: 1,
              reasons: ['未命中常见前端/后端/小程序特征，仅执行通用检查'],
              checks: {
                deps: { status: 'error', message: '未安装依赖', fixes: [] },
              },
            },
          ],
        },
      },
    })

    renderApp()

    await waitFor(() => expect(screen.getByText('环境正常')).toBeTruthy())
    fireEvent.click(screen.getByText('环境正常'))

    await waitFor(() =>
      expect(screen.getByText('1 个项目环境正常')).toBeTruthy()
    )
    expect(screen.getByText('projA')).toBeTruthy()
    expect(screen.queryByText('superpowers')).toBeNull()
    expect(screen.queryByText('未安装依赖')).toBeNull()
  })

  it('旧环境检查缓存缺少版本时点击状态会重新检查并展示刷新结果', async () => {
    mockApi.scanWorktreesByTask.mockReset().mockResolvedValue(createdTasks)
    mockApi.loadTaskEnvHealth.mockReset().mockResolvedValue({
      'TASK-NEW': {
        status: 'warning',
        issueCount: 1,
        taskDir: '/wt/TASK-NEW',
        checkedAt: '2026-07-02T06:53:02.412Z',
        result: {
          summary: {
            status: 'warning',
            projectCount: 2,
            issueCount: 1,
            failedProjects: ['projA'],
            message: '1 个项目存在 1 个环境问题',
          },
          projects: [
            {
              name: 'projA',
              path: '/wt/TASK-NEW/projA',
              kind: 'frontend',
              kindLabel: '前端',
              status: 'warning',
              issueCount: 1,
              reasons: [],
              checks: {
                git: { status: 'warning', message: '旧 Git 问题', fixes: [] },
              },
            },
            {
              name: 'projB',
              path: '/wt/TASK-NEW/projB',
              kind: 'frontend',
              kindLabel: '前端',
              status: 'ok',
              issueCount: 0,
              reasons: [],
              checks: {},
            },
          ],
        },
      },
    })
    mockApi.checkEnvHealth.mockReset().mockResolvedValue({
      summary: {
        status: 'failed',
        projectCount: 3,
        issueCount: 1,
        failedProjects: ['logistics'],
        message: '1 个项目存在 1 个环境问题',
      },
      projects: [
        {
          name: 'projA',
          path: '/wt/TASK-NEW/projA',
          kind: 'frontend',
          kindLabel: '前端',
          status: 'ok',
          issueCount: 0,
          reasons: [],
          checks: {},
        },
        {
          name: 'projB',
          path: '/wt/TASK-NEW/projB',
          kind: 'frontend',
          kindLabel: '前端',
          status: 'ok',
          issueCount: 0,
          reasons: [],
          checks: {},
        },
        {
          name: 'logistics',
          path: '/wt/TASK-NEW/logistics',
          kind: 'backend_php',
          kindLabel: 'PHP 后端',
          status: 'failed',
          issueCount: 1,
          reasons: ['PHP 后端文件 composer.json'],
          checks: {
            deps: {
              status: 'error',
              message: '未安装 PHP 依赖（缺少 vendor）',
              fixes: [],
            },
          },
        },
      ],
      deps: {
        status: 'error',
        message: '未安装 PHP 依赖（缺少 vendor）',
        fixes: [],
      },
      ports: { status: 'ok', message: '未发现端口声明', fixes: [] },
      services: { status: 'ok', message: '无 .env，跳过服务检查', fixes: [] },
      git: { status: 'ok', message: '工作区干净', fixes: [] },
    })

    renderApp()

    await waitFor(() =>
      expect(mockApi.checkEnvHealth).toHaveBeenCalledWith('/wt/TASK-NEW')
    )
    await waitFor(() => expect(screen.getByText('1 个环境问题')).toBeTruthy())
    fireEvent.click(screen.getByText('1 个环境问题'))
    await waitFor(() => expect(screen.getByText('logistics')).toBeTruthy())
    expect(screen.getByText('PHP 后端')).toBeTruthy()
    expect(screen.getByText('未安装 PHP 依赖（缺少 vendor）')).toBeTruthy()
  })

  it('重新检查时保留旧结果并以覆盖层显示 loading，避免弹窗内容高度跳变', async () => {
    // resolveEnvHealth 存储手动结束重新检查 Promise 的回调，用于断言 loading 中间态。
    let resolveEnvHealth
    mockApi.scanWorktreesByTask.mockReset().mockResolvedValue(createdTasks)
    mockApi.loadTaskEnvHealth.mockReset().mockResolvedValue({
      'TASK-NEW': {
        version: 4,
        status: 'failed',
        issueCount: 1,
        taskDir: '/wt/TASK-NEW',
        checkedAt: '2026-07-02T06:53:02.412Z',
        result: {
          summary: {
            status: 'failed',
            projectCount: 1,
            issueCount: 1,
            failedProjects: ['logistics'],
            message: '1 个项目存在 1 个环境问题',
          },
          projects: [
            {
              name: 'logistics',
              path: '/wt/TASK-NEW/logistics',
              kind: 'backend_php',
              kindLabel: 'PHP 后端',
              status: 'failed',
              issueCount: 1,
              reasons: ['PHP 后端文件 composer.json'],
              checks: {
                deps: {
                  status: 'error',
                  message: '未安装 PHP 依赖（缺少 vendor）',
                  fixes: [],
                },
              },
            },
          ],
        },
      },
    })
    mockApi.checkEnvHealth.mockReset().mockReturnValue(
      new Promise((resolve) => {
        resolveEnvHealth = resolve
      })
    )

    renderApp()

    await waitFor(() => expect(screen.getByText('1 个环境问题')).toBeTruthy())
    fireEvent.click(screen.getByText('1 个环境问题'))
    await waitFor(() => expect(screen.getByText('logistics')).toBeTruthy())
    fireEvent.click(screen.getByText('重新检查'))

    await waitFor(() => expect(screen.getByText('检查中...')).toBeTruthy())
    expect(screen.getByText('logistics')).toBeTruthy()
    expect(document.querySelector('.env-health-refresh-overlay')).toBeTruthy()

    resolveEnvHealth({
      summary: {
        status: 'ok',
        projectCount: 1,
        issueCount: 0,
        failedProjects: [],
        message: '1 个项目环境正常',
      },
      projects: [],
      deps: {
        status: 'ok',
        message: '检测到 Docker 运行配置，跳过本机 PHP vendor 检查',
        fixes: [],
      },
      ports: { status: 'ok', message: 'ok', fixes: [] },
      services: { status: 'ok', message: 'ok', fixes: [] },
      git: { status: 'ok', message: '工作区干净', fixes: [] },
    })
    await waitFor(() =>
      expect(screen.getAllByText('环境正常').length).toBeGreaterThan(0)
    )
  })

  it('环境检查详情项目卡片每页只展示两个项目', async () => {
    mockApi.scanWorktreesByTask.mockReset().mockResolvedValue(createdTasks)
    mockApi.loadTaskEnvHealth.mockReset().mockResolvedValue({
      'TASK-NEW': {
        version: 4,
        status: 'ok',
        issueCount: 0,
        taskDir: '/wt/TASK-NEW',
        checkedAt: '2026-07-02T06:53:02.412Z',
        result: {
          summary: {
            status: 'ok',
            projectCount: 3,
            issueCount: 0,
            failedProjects: [],
            message: '3 个项目环境正常',
          },
          projects: ['projA', 'projB', 'projC'].map((name) => ({
            name,
            path: `/wt/TASK-NEW/${name}`,
            kind: 'frontend',
            kindLabel: '前端',
            status: 'ok',
            issueCount: 0,
            reasons: ['前端依赖 vite'],
            checks: {
              deps: { status: 'ok', message: `${name} 依赖完整`, fixes: [] },
              ports: {
                status: 'ok',
                message: '未在 scripts 中发现端口声明',
                fixes: [],
                skipped: true,
              },
              services: {
                status: 'ok',
                message: '无 .env，跳过服务检查',
                fixes: [],
                skipped: true,
              },
              git: { status: 'ok', message: '工作区干净', fixes: [] },
            },
          })),
        },
      },
    })

    renderApp()

    await waitFor(() => expect(screen.getByText('环境正常')).toBeTruthy())
    fireEvent.click(screen.getByText('环境正常'))

    await waitFor(() => expect(screen.getByText('projA')).toBeTruthy())
    expect(screen.getByText('projB')).toBeTruthy()
    expect(screen.queryByText('projC')).toBeNull()

    // pageTwo 存储分页器第 2 页按钮；点击后应只展示第三个项目卡片。
    const pageTwo = document.querySelector('.ant-pagination-item-2')
    expect(pageTwo).toBeTruthy()
    expect(
      pageTwo.compareDocumentPosition(screen.getByText('projA')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    fireEvent.click(pageTwo)

    await waitFor(() => expect(screen.getByText('projC')).toBeTruthy())
    expect(screen.queryByText('projA')).toBeNull()
    expect(screen.queryByText('projB')).toBeNull()
  })
})
