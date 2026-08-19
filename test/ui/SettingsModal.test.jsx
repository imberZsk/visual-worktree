import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  within,
} from '@testing-library/react'
import { App as AntApp } from 'antd'
import SettingsModal from '../../src/ui/components/SettingsModal.tsx'
import { useStore } from '../../src/ui/store/useStore.ts'
import { DEFAULT_TASK_STATUSES } from '../../src/core/taskStatuses.js'

// mockApi 模拟设置弹窗保存配置时用到的 Electron API。
const mockApi = vi.hoisted(() => ({
  saveConfig: vi.fn(),
  resetConfig: vi.fn(),
  selectDirectory: vi.fn(),
  scanProjects: vi.fn(),
  loadAiModelSettings: vi.fn(),
  saveAiModelSettings: vi.fn(),
}))

vi.mock('../../src/ui/api.ts', () => ({
  api: {
    saveConfig: mockApi.saveConfig,
    resetConfig: mockApi.resetConfig,
    selectDirectory: mockApi.selectDirectory,
    scanProjects: mockApi.scanProjects,
    loadAiModelSettings: mockApi.loadAiModelSettings,
    saveAiModelSettings: mockApi.saveAiModelSettings,
  },
}))

// initialState 保存 Zustand 初始状态，确保每个用例互不污染。
const initialState = useStore.getState()

/**
 * 用 AntApp 包裹组件，提供 antd message/modal 上下文。
 * @param {React.ReactNode} ui - 要渲染的组件
 * @returns {ReturnType<typeof render>} 渲染结果
 */
function renderWithApp(ui) {
  return render(<AntApp>{ui}</AntApp>)
}

/**
 * 构造设置弹窗测试用配置。
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
    workflowSteps: [
      {
        key: 'review',
        label: '审查很长很长的需求方案标题',
        command: 'node ./scripts/review.js --task {task} --path {path}',
      },
    ],
    workDocumentTemplates: [
      { type: 'directory', path: 'docs', content: '' },
      { type: 'file', path: '.ai/summary.md', content: '# Summary\n' },
    ],
    taskTitleBadges: {
      taskTag: true,
      projectCount: true,
      taskStatus: true,
      taskLinks: true,
      claudeUsage: true,
    },
    taskStatuses: DEFAULT_TASK_STATUSES.map((status) => ({ ...status })),
    kanbanSettings: {
      hiddenStatusKeys: [],
    },
    tokenPricing: {
      enabled: true,
      input: 1,
      output: 2,
      cacheWrite: 3,
      cacheRead: 4,
      multiplier: 1,
      models: [],
      usdToCny: 8,
      directCnyDisplay: false,
    },
    tokenPricingByTool: {
      'claude-code': {
        enabled: false,
        input: 3,
        output: 15,
        cacheWrite: 3.75,
        cacheRead: 0.3,
        multiplier: 1,
        models: [],
        usdToCny: 7.2,
        directCnyDisplay: false,
      },
      codex: {
        enabled: true,
        input: 1,
        output: 2,
        cacheWrite: 3,
        cacheRead: 4,
        multiplier: 1,
        models: [
          {
            model: 'gpt-5.6-sol',
            input: 5,
            output: 30,
            cacheWrite: 0,
            cacheRead: 0.5,
            multiplier: 0.3,
          },
        ],
        usdToCny: 8,
        directCnyDisplay: false,
      },
    },
    aiUsageTool: 'codex',
    aiUsageTools: ['codex'],
    cicdLinks: {},
    envCheckRoles: [],
  }
}

/**
 * 断言指定容器内的 Ant Design 表单标题带问号说明。
 * @param {string} labelText - 要检查的表单标题文案
 * @param {HTMLElement} [container] - 限定查找范围，弹层或重复行字段使用对应容器
 * @returns {HTMLElement} 问号 Tooltip 触发节点
 */
function expectFormLabelHasHelp(labelText, container = document.body) {
  // labelTextNodes 存储所有同名表单标题；模型专属价格可能与默认价格复用标题。
  const labelTextNodes = within(container).getAllByText(labelText, {
    exact: true,
  })
  // formLabel 存储带问号提示的同名标题容器，避免模型明细中的紧凑标题干扰断言。
  const formLabel = labelTextNodes
    .map((labelTextNode) => labelTextNode.closest('.ant-form-item-label'))
    .find((label) => label?.querySelector('.ant-form-item-tooltip'))
  expect(formLabel).toBeTruthy()
  // helpTrigger 存储 Ant Design Form.Item tooltip 生成的问号节点。
  const helpTrigger = formLabel.querySelector('.ant-form-item-tooltip')
  expect(helpTrigger).toBeTruthy()
  return helpTrigger
}

/**
 * 按 Ant Design 弹层标题定位对应 dialog。
 * @param {string} title - 弹层标题文案
 * @returns {Promise<HTMLElement>} 标题所属的 dialog 节点
 */
async function findDialogByTitle(title) {
  // titleNode 存储 Ant Design Modal 的标题节点，避免依赖测试环境缺失的 aria 名称关联。
  const titleNode = await screen.findByText(title, {
    selector: '.ant-modal-title',
  })
  return titleNode.closest('[role="dialog"]')
}

describe('SettingsModal 流程配置布局', () => {
  beforeEach(() => {
    // 重置全局 store，避免项目列表等状态串扰。
    useStore.setState(initialState, true)
    mockApi.saveConfig.mockReset()
    mockApi.resetConfig.mockReset()
    mockApi.selectDirectory.mockReset()
    mockApi.loadAiModelSettings.mockReset().mockResolvedValue({
      success: true,
      settings: {
        model: 'gpt-5.6-sol',
        baseUrl: '',
        apiKeyConfigured: true,
        apiKeyHint: '••••••••-key',
      },
    })
    mockApi.saveAiModelSettings.mockReset().mockResolvedValue({
      success: true,
      settings: {
        model: 'gpt-5.6-sol',
        baseUrl: '',
        apiKeyConfigured: true,
        apiKeyHint: '••••••••-key',
      },
    })
    // 大多数用例只需验证设置 UI，默认保持扫描未完成，避免无关的 Store 异步更新越过 act 边界。
    mockApi.scanProjects
      .mockReset()
      .mockImplementation(() => new Promise(() => {}))
  })

  afterEach(() => cleanup())

  it('AI 助手设置展示已保存 Key 的安全掩码', async () => {
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: 'AI 助手' }))
    expect(await screen.findByText('••••••••-key')).toBeTruthy()
  })

  it('AI 后端离线时仍保存普通配置并关闭设置页', async () => {
    // savedConfig 存储主进程完成普通设置持久化后返回的新配置。
    const savedConfig = makeConfig()
    // onSaved 存储设置页成功回调，用于验证离线警告不阻断外层状态更新。
    const onSaved = vi.fn()
    // onClose 存储关闭回调，用于验证保存流程正常结束。
    const onClose = vi.fn()
    mockApi.saveConfig.mockResolvedValueOnce(savedConfig)
    mockApi.saveAiModelSettings.mockResolvedValueOnce({
      success: true,
      settings: {
        model: 'gpt-5.6-sol',
        baseUrl: '',
        apiKeyConfigured: true,
        apiKeyHint: '••••••••-key',
      },
      backendSynchronized: false,
      warning: '配置已保存；AI 后端未连接，模型设置将在使用时同步',
    })

    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={onClose}
        onSaved={onSaved}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => expect(mockApi.saveConfig).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByText(
        '配置已保存；AI 后端未连接，模型设置将在使用时同步'
      )
    ).toBeTruthy()
    expect(onSaved).toHaveBeenCalledWith(savedConfig)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('设置各 Tab 的字段和分组小标题均提供问号说明', async () => {
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    // pathLabels 存储路径 Tab 所有配置标题，防止后续字段遗漏说明入口。
    const pathLabels = [
      '当前路径组合',
      '主分支名（可多个）',
      '忽略的项目目录',
      '扫描时自动 fetch 远程（较慢，但能计算落后提交数）',
    ]
    pathLabels.forEach((label) => expectFormLabelHasHelp(label))
    // currentPathHelp 存储当前路径组合问号节点，用于验证 Tooltip 不只是占位图标。
    const currentPathHelp = expectFormLabelHasHelp('当前路径组合')
    fireEvent.mouseEnter(currentPathHelp)
    await waitFor(() => {
      expect(
        screen.getByText('切换项目和 Worktree 使用的路径组合。')
      ).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: /管理路径组合/ }))
    // pathProfileDialog 存储路径组合详情弹层，用于限定内部字段标题的检查范围。
    const pathProfileDialog = await findDialogByTitle('管理路径组合')
    expect(
      within(pathProfileDialog).getByLabelText('路径组合 1说明')
    ).toBeTruthy()
    ;['组合名称', '源项目根目录', 'Worktree 根目录'].forEach((label) =>
      expectFormLabelHasHelp(label, pathProfileDialog)
    )
    fireEvent.click(
      within(pathProfileDialog).getByRole('button', { name: /完\s*成/ })
    )

    fireEvent.click(screen.getByRole('tab', { name: '工具' }))
    ;['编辑器打开命令', '终端应用'].forEach((label) =>
      expectFormLabelHasHelp(label)
    )

    fireEvent.click(screen.getByRole('tab', { name: '工作文档' }))
    expectFormLabelHasHelp('工作文档模板')
    fireEvent.click(await screen.findByTestId('work-document-row-1'))
    // workDocumentDialog 存储文件模板详情弹层，文件类型会展示三个可配置标题。
    const workDocumentDialog = await findDialogByTitle('编辑工作文档')
    ;['类型', '路径', '文件默认内容'].forEach((label) =>
      expectFormLabelHasHelp(label, workDocumentDialog)
    )
    fireEvent.click(
      within(workDocumentDialog).getByRole('button', { name: /完\s*成/ })
    )

    fireEvent.click(screen.getByRole('tab', { name: '流程' }))
    expectFormLabelHasHelp('需求流程步骤')
    fireEvent.click(await screen.findByTestId('workflow-step-row-0'))
    // workflowDialog 存储流程步骤详情弹层，覆盖名称、命令和执行策略标题。
    const workflowDialog = await findDialogByTitle('编辑流程步骤')
    ;[
      '步骤名称',
      '执行命令（选填）',
      '任务目录参数',
      '成功后自动勾选',
      '失败后停止后续步骤',
    ].forEach((label) => expectFormLabelHasHelp(label, workflowDialog))
    fireEvent.click(
      within(workflowDialog).getByRole('button', { name: /完\s*成/ })
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Token 费用' }))
    ;['统计工具', '美元兑人民币汇率'].forEach((label) =>
      expectFormLabelHasHelp(label)
    )
    fireEvent.click(screen.getByRole('button', { name: /价格配置/ }))
    // pricingDialog 存储 Codex 模型价格管理弹层，用于校验价格字段说明均在弹层内。
    const pricingDialog = await findDialogByTitle('Codex 价格配置')
    ;[
      'Input 单价',
      'Output 单价',
      'Cache write 单价',
      'Cache read 单价',
      '计费倍率',
    ].forEach((label) => expectFormLabelHasHelp(label, pricingDialog))
    expect(within(pricingDialog).getByLabelText('自定义计价说明')).toBeTruthy()
    fireEvent.click(
      within(pricingDialog).getByRole('button', { name: /完\s*成/ })
    )

    fireEvent.click(screen.getByRole('tab', { name: '展示' }))
    ;[
      '任务标题展示偏好',
      '项目数量',
      '任务状态',
      '需求链接',
      'Token 消耗',
    ].forEach((label) =>
      expect(screen.getByLabelText(`${label}说明`)).toBeTruthy()
    )
    expect(
      screen.queryByText('展示任务包含的项目数量，快速判断影响范围。')
    ).toBeNull()
    fireEvent.mouseEnter(screen.getByLabelText('项目数量说明'))
    expect(await screen.findByText('任务包含的项目数。')).toBeTruthy()
    expect(screen.queryByTestId('task-status-settings')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '配置任务状态' }))
    // statusSettings 存储弹层中的状态配置区，用于确认界面不再显示无意义的行序号。
    const statusSettings = await screen.findByTestId('task-status-settings')
    expect(screen.getByText('任务状态（7/20）')).toBeTruthy()
    expect(within(statusSettings).queryByText('状态 2')).toBeNull()
    // defaultStatusRow 存储默认状态配置行，用于验证状态名称不再重复展示问号。
    const defaultStatusRow = screen.getByTestId('task-status-row-not-started')
    // statusNameLabel 存储状态名称的表单标题容器，用于检查其问号已移除。
    const statusNameLabel = within(defaultStatusRow)
      .getByText('状态名称', { exact: true })
      .closest('.ant-form-item-label')
    expect(statusNameLabel?.querySelector('.ant-form-item-tooltip')).toBeNull()
    expect(within(defaultStatusRow).queryByText('看板归类')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'CI/CD' }))
    expectFormLabelHasHelp('CI/CD 流水线地址（按项目配置，选填）')
  })

  it('路径与列表型设置移除重复说明并保留统一结构', async () => {
    // config 存储包含 CI/CD 条目的设置，便于同时验证列表行与新增操作。
    const config = makeConfig()
    config.cicdLinks = {
      'visual-worktree': 'https://ci.example.com/visual-worktree',
    }

    renderWithApp(
      <SettingsModal
        open
        config={config}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    await waitFor(() => expect(mockApi.scanProjects).toHaveBeenCalledTimes(1))

    expect(screen.queryByText('可用于切换工作和个人项目工作路径。')).toBeNull()

    fireEvent.click(screen.getByText('工作文档'))
    expect(
      screen.queryByText(
        /\u9ed8\u8ba4\u5de5\u4f5c\u6587\u6863\u4e3a\u4efb\u52a1\u76ee\u5f55\u4e0b的 docs 目录/
      )
    ).toBeNull()
    // addDocumentButton 存储工作文档新增入口，用于确认列表容器仍保留统一结构。
    const addDocumentButton = screen.getByRole('button', {
      name: /添加工作文档/,
    })
    expect(addDocumentButton.closest('.settings-list-content')).toBeTruthy()

    fireEvent.click(screen.getByText('流程'))
    expect(
      screen.queryByText(
        /\u6bcf\u4e2a\u6b65\u9aa4\u90fd\u4f1a\u663e\u793a在 Worktree/
      )
    ).toBeNull()
    // addWorkflowButton 存储流程新增入口，用于确认移除说明后列表布局未变化。
    const addWorkflowButton = screen.getByRole('button', {
      name: /添加流程步骤/,
    })
    expect(addWorkflowButton.closest('.settings-list-content')).toBeTruthy()

    fireEvent.click(screen.getByText('CI/CD'))
    // cicdPanel 存储 CI/CD 列表内容，列表与新增按钮的节奏必须与其他列表型设置一致。
    const addCicdButton = screen.getByRole('button', {
      name: /添加项目 CI\/CD 地址/,
    })
    const cicdPanel = addCicdButton.closest('.settings-list-content')
    expect(cicdPanel).toBeTruthy()
    expect(addCicdButton.classList.contains('settings-add-list-button')).toBe(
      true
    )
  })

  it('CI/CD 空列表不保留会重复产生间距的滚动容器', async () => {
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    await waitFor(() => expect(mockApi.scanProjects).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByText('CI/CD'))

    // addCicdButton 存储空态唯一可见控件，按钮应直接承接 Form 标签的默认 8px 间距。
    const addCicdButton = screen.getByRole('button', {
      name: /添加项目 CI\/CD 地址/,
    })
    // cicdPanel 存储 CI/CD 列表内容容器，用于确认空态没有不可见 sibling 参与 gap 计算。
    const cicdPanel = addCicdButton.closest('.settings-list-content')
    expect(cicdPanel).toBeTruthy()
    expect(cicdPanel.querySelector('.settings-list-scroll')).toBeNull()

    fireEvent.click(addCicdButton)
    expect(cicdPanel.querySelector('.settings-list-scroll')).toBeTruthy()
  })

  it('流程步骤主列表只展示紧凑项，点击后用弹层编辑详情', async () => {
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    // 打开流程 Tab，查看步骤编辑区。
    fireEvent.click(screen.getByText('流程'))

    await waitFor(() => {
      expect(screen.getByTestId('workflow-step-row-0')).toBeTruthy()
    })

    // row 为紧凑流程步骤项，主列表只展示摘要，不展开所有编辑字段。
    const row = screen.getByTestId('workflow-step-row-0')
    expect(within(row).getByText('审查很长很长的需求方案标题')).toBeTruthy()
    expect(within(row).getByText('已配置命令')).toBeTruthy()
    expect(row.classList.contains('settings-list-row')).toBe(true)
    expect(screen.queryByTestId('workflow-step-list')).toBeNull()
    expect(screen.queryByPlaceholderText(/执行命令/)).toBeNull()

    fireEvent.click(row)

    await waitFor(() => {
      expect(screen.getByText('编辑流程步骤')).toBeTruthy()
    })

    // commandTextarea 为弹层内执行命令多行输入框，长命令在详情层里完整编辑。
    const dialog = screen.getByText('编辑流程步骤').closest('[role="dialog"]')
    expect(dialog).toBeTruthy()
    const commandTextarea = within(dialog).getByPlaceholderText(/执行命令/)

    expect(within(dialog).getByPlaceholderText(/步骤名称/)).toBeTruthy()
    expect(commandTextarea.tagName).toBe('TEXTAREA')
  })

  it('弹层编辑后的流程步骤保存回 workflowSteps 数组', async () => {
    mockApi.saveConfig.mockResolvedValueOnce(makeConfig())
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    // 打开流程 Tab 并进入第一条流程步骤的详情弹层。
    fireEvent.click(screen.getByText('流程'))
    await waitFor(() => {
      expect(screen.getByTestId('workflow-step-row-0')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('workflow-step-row-0'))

    // dialog 为当前流程步骤详情弹层，避免和外层设置抽屉混淆。
    const dialog = screen.getByText('编辑流程步骤').closest('[role="dialog"]')
    // nameInput 为流程步骤名称输入框。
    const nameInput = within(dialog).getByPlaceholderText(/步骤名称/)
    // commandTextarea 为流程步骤命令输入框。
    const commandTextarea = within(dialog).getByPlaceholderText(/执行命令/)

    fireEvent.change(nameInput, { target: { value: '重新审查需求' } })
    fireEvent.change(commandTextarea, {
      target: { value: 'pnpm test --filter {task}' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: /完\s*成/ }))
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => {
      expect(mockApi.saveConfig).toHaveBeenCalledTimes(1)
    })

    // savedConfig 为提交给主进程持久化的配置对象，workflowSteps 必须保持一维步骤数组。
    const savedConfig = mockApi.saveConfig.mock.calls[0][0]
    expect(savedConfig.workflowSteps).toEqual([
      {
        key: 'review',
        label: '重新审查需求',
        command: 'pnpm test --filter {task}',
        autoCheckOnSuccess: true,
        stopOnFailure: true,
        taskArgMode: 'auto',
      },
    ])
    expect(savedConfig.workflowSteps.workflowSteps).toBeUndefined()
  })

  it('流程步骤弹层可配置成功自动勾选、失败停止和任务目录参数模式', async () => {
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    fireEvent.click(screen.getByText('流程'))
    await waitFor(() => {
      expect(screen.getByTestId('workflow-step-row-0')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('workflow-step-row-0'))

    expect(screen.getByText('成功后自动勾选')).toBeTruthy()
    expect(screen.getByText('失败后停止后续步骤')).toBeTruthy()
    expect(screen.getByText('任务目录参数')).toBeTruthy()
  })

  it('流程步骤支持上移下移并按新顺序保存', async () => {
    // config 存储本用例专属配置：两条流程步骤便于验证排序变化。
    const config = makeConfig()
    config.workflowSteps = [
      { key: 'first-step-key', label: '第一步', command: 'npm test' },
      { key: 'second-step-key', label: '第二步', command: 'npm run build' },
    ]
    mockApi.saveConfig.mockResolvedValueOnce(config)
    renderWithApp(
      <SettingsModal
        open
        config={config}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    fireEvent.click(screen.getByText('流程'))
    await waitFor(() => {
      expect(screen.getByTestId('workflow-step-row-1')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('workflow-step-move-up-1'))
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => expect(mockApi.saveConfig).toHaveBeenCalled())
    // savedConfig 存储提交给主进程的配置对象，workflowSteps 顺序应反映用户上移操作。
    const savedConfig = mockApi.saveConfig.mock.calls.at(-1)[0]
    expect(savedConfig.workflowSteps.map((s) => s.key)).toEqual([
      'second-step-key',
      'first-step-key',
    ])
  })

  it('不再展示环境检查配置 Tab，环境类型由系统自动识别', async () => {
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    await waitFor(() => expect(mockApi.scanProjects).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('环境检查')).toBeNull()
  })

  it('展示 Tab 用卡片网格承载任务标题徽标开关', async () => {
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    fireEvent.click(screen.getByText('展示'))

    await waitFor(() => {
      expect(screen.getByTestId('display-settings-panel')).toBeTruthy()
    })

    // panel 存储展示偏好页整体容器，用于验证标题与布局结构。
    const panel = screen.getByTestId('display-settings-panel')
    // grid 存储展示项卡片网格，避免页面退回到左侧单列堆叠。
    const grid = screen.getByTestId('display-badge-grid')
    // tokenCard 存储 Token 展示项卡片，用于验证问号和开关被组织在同一张卡片里。
    const tokenCard = screen.getByTestId('display-badge-card-claudeUsage')

    expect(within(panel).getByText('任务标题展示偏好')).toBeTruthy()
    expect(
      within(panel).queryByText(
        '按需选择任务标题旁显示哪些辅助信息，让任务列表保持清爽但不丢关键状态。'
      )
    ).toBeNull()
    expect(grid.classList.contains('settings-display-grid')).toBe(true)
    expect(within(tokenCard).queryByText('展示任务 Token 与费用。')).toBeNull()
    expect(within(tokenCard).getByLabelText('Token 消耗说明')).toBeTruthy()
    expect(within(tokenCard).getByRole('switch')).toBeTruthy()
  })

  it('展示 Tab 可关闭任务标题旁的 Token 消耗徽标并保存', async () => {
    mockApi.saveConfig.mockResolvedValueOnce(makeConfig())
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    fireEvent.click(screen.getByText('展示'))

    await waitFor(() => {
      expect(screen.getByTestId('display-settings-panel')).toBeTruthy()
    })

    // tokenCard 存储“Token 消耗”开关所在卡片，用于只点击这一项的 switch。
    const tokenCard = screen.getByTestId('display-badge-card-claudeUsage')
    fireEvent.click(within(tokenCard).getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => expect(mockApi.saveConfig).toHaveBeenCalledTimes(1))

    // savedConfig 存储提交给主进程的设置对象，应保留其他展示项默认开启。
    const savedConfig = mockApi.saveConfig.mock.calls[0][0]
    expect(savedConfig.taskTitleBadges).toEqual({
      taskTag: true,
      projectCount: true,
      taskStatus: true,
      taskLinks: true,
      claudeUsage: false,
    })
  })

  it('展示 Tab 可编辑并保存完整的任务状态标签配置', async () => {
    mockApi.saveConfig.mockResolvedValueOnce(makeConfig())
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    fireEvent.click(screen.getByText('展示'))
    fireEvent.click(screen.getByRole('button', { name: '配置任务状态' }))
    // statusSettings 存储任务状态标签设置弹层，用于限定状态编辑操作。
    const statusSettings = await screen.findByTestId('task-status-settings')
    // developingRow 存储“开发中”稳定状态所在行，避免依赖可变的列表序号。
    const developingRow = within(statusSettings).getByTestId(
      'task-status-row-developing'
    )
    // developingInput 存储“开发中”稳定状态对应的可编辑名称输入框。
    const developingInput = within(developingRow).getByRole('textbox', {
      name: '状态名称',
    })
    expect(developingInput.value).toBe('开发中')
    fireEvent.change(developingInput, { target: { value: '处理中' } })
    fireEvent.click(
      within(statusSettings).getByRole('checkbox', {
        name: '看板展示 待提测',
      })
    )
    fireEvent.click(screen.getByRole('button', { name: /完\s*成/ }))
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => expect(mockApi.saveConfig).toHaveBeenCalledTimes(1))
    // savedConfig 存储提交给主进程的完整动态状态列表。
    const savedConfig = mockApi.saveConfig.mock.calls[0][0]
    expect(savedConfig.taskStatuses).toHaveLength(DEFAULT_TASK_STATUSES.length)
    expect(
      savedConfig.taskStatuses.find((status) => status.key === 'developing')
        ?.label
    ).toBe('处理中')
    expect(savedConfig.kanbanSettings).toEqual({
      hiddenStatusKeys: ['pending-test'],
    })
  })

  it('任务状态标签重复时阻止保存并在对应字段展示错误', async () => {
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    fireEvent.click(screen.getByText('展示'))
    fireEvent.click(screen.getByRole('button', { name: '配置任务状态' }))
    // developingRow 存储待改成重复文案的“开发中”状态行。
    const developingRow = await screen.findByTestId(
      'task-status-row-developing'
    )
    // developingInput 存储待改成重复文案的“开发中”名称输入框。
    const developingInput = within(developingRow).getByRole('textbox', {
      name: '状态名称',
    })
    fireEvent.change(developingInput, { target: { value: '未开始' } })
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    expect(await screen.findAllByText('状态标签不能重复')).not.toHaveLength(0)
    expect(mockApi.saveConfig).not.toHaveBeenCalled()
  })

  it('任务状态支持新增、删除并实时更新数量', async () => {
    mockApi.saveConfig.mockResolvedValueOnce(makeConfig())
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    fireEvent.click(screen.getByText('展示'))
    fireEvent.click(screen.getByRole('button', { name: '配置任务状态' }))
    // statusSettings 存储弹层中的动态状态设置区，用于限定新增和删除操作的查询范围。
    const statusSettings = await screen.findByTestId('task-status-settings')
    expect(screen.getByText('任务状态（7/20）')).toBeTruthy()
    fireEvent.click(
      within(statusSettings).getByRole('button', { name: '添加任务状态' })
    )
    expect(screen.getByText('任务状态（8/20）')).toBeTruthy()
    // customStatusRow 存储新增在列表末尾的状态行。
    const customStatusRow = within(statusSettings)
      .getAllByTestId(/^task-status-row-/)
      .at(-1)
    // customStatusInput 存储新增状态的名称输入框。
    const customStatusInput = within(customStatusRow).getByRole('textbox', {
      name: '状态名称',
    })
    fireEvent.change(customStatusInput, { target: { value: '联调中' } })
    // selfTestingRow 存储内置“自测中”状态行，删除后不应继续持久化该 key。
    const selfTestingRow = within(statusSettings).getByTestId(
      'task-status-row-self-testing'
    )
    fireEvent.click(
      within(selfTestingRow).getByRole('button', { name: '删除状态' })
    )
    expect(screen.getByText('任务状态（7/20）')).toBeTruthy()
    fireEvent.click(
      within(customStatusRow).getByRole('button', { name: '上移状态' })
    )
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => expect(mockApi.saveConfig).toHaveBeenCalledTimes(1))
    // savedStatuses 存储提交给主进程的最终列表，应保留新增项并移除指定内置项。
    const savedStatuses = mockApi.saveConfig.mock.calls[0][0].taskStatuses
    expect(savedStatuses.some((status) => status.key === 'self-testing')).toBe(
      false
    )
    expect(savedStatuses.some((status) => status.label === '联调中')).toBe(true)
    expect(
      savedStatuses.findIndex((status) => status.label === '联调中')
    ).toBeLessThan(
      savedStatuses.findIndex((status) => status.key === 'released')
    )
  })

  it('未打开流程 Tab 保存其它设置时保留已有流程步骤', async () => {
    mockApi.saveConfig.mockResolvedValueOnce(makeConfig())
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => expect(mockApi.saveConfig).toHaveBeenCalledTimes(1))

    // savedConfig 存储提交给主进程的配置对象；即使流程 Tab 未挂载，也不能把 workflowSteps 写成空数组。
    const savedConfig = mockApi.saveConfig.mock.calls[0][0]
    expect(savedConfig.workflowSteps).toEqual([
      {
        key: 'review',
        label: '审查很长很长的需求方案标题',
        command: 'node ./scripts/review.js --task {task} --path {path}',
        autoCheckOnSuccess: true,
        stopOnFailure: true,
        taskArgMode: 'auto',
      },
    ])
  })

  it('路径 Tab 主体只展示当前组合和问号，路径组合详情收进弹层', async () => {
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    expect(screen.queryByText('可用于切换工作和个人项目工作路径。')).toBeNull()
    expectFormLabelHasHelp('当前路径组合')
    expect(screen.queryByText(/保存后当前组合会用于扫描项目/)).toBeNull()
    expect(screen.getByRole('button', { name: /管理路径组合/ })).toBeTruthy()
    expect(
      screen.queryByPlaceholderText('/Users/you/Desktop/work/projects')
    ).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /管理路径组合/ }))

    await waitFor(() =>
      expect(document.querySelector('.ant-modal-title')?.textContent).toBe(
        '管理路径组合'
      )
    )
    expect(
      screen.getByPlaceholderText('/Users/you/Desktop/work/projects')
    ).toBeTruthy()
  })

  it('路径输入支持点击选择目录并写回表单', async () => {
    mockApi.selectDirectory.mockResolvedValueOnce({
      canceled: false,
      path: '/picked/source',
    })
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /管理路径组合/ }))

    // sourceInput 存储源项目根目录输入框，用于验证选择目录前后的值变化。
    const sourceInput = await screen.findByPlaceholderText(
      '/Users/you/Desktop/work/projects'
    )
    fireEvent.click(screen.getByRole('button', { name: /选择源项目根目录/ }))

    await waitFor(() => expect(sourceInput.value).toBe('/picked/source'))
    expect(mockApi.selectDirectory).toHaveBeenCalledWith({
      defaultPath: '/src',
    })
  })

  it('取消目录选择时保留原路径', async () => {
    mockApi.selectDirectory.mockResolvedValueOnce({ canceled: true })
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /管理路径组合/ }))

    // worktreeInput 存储 Worktree 根目录输入框，取消选择后应保持配置原值。
    const worktreeInput = await screen.findByPlaceholderText(
      '/Users/you/Desktop/work/worktrees'
    )
    fireEvent.click(
      screen.getByRole('button', { name: /选择 Worktree 根目录/ })
    )

    await waitFor(() =>
      expect(mockApi.selectDirectory).toHaveBeenCalledWith({
        defaultPath: '/wt',
      })
    )
    expect(worktreeInput.value).toBe('/wt')
  })

  it('路径 Tab 可切换当前路径组合并按当前组合保存顶层路径', async () => {
    // config 存储本用例的两套路径组合配置。
    const config = makeConfig()
    config.activePathProfileId = 'work'
    config.sourceProjectsPath = '/work/source'
    config.worktreesPath = '/work/worktrees'
    config.pathProfiles = [
      {
        id: 'work',
        name: '工作',
        sourceProjectsPath: '/work/source',
        worktreesPath: '/work/worktrees',
      },
      {
        id: 'personal',
        name: '个人',
        sourceProjectsPath: '/personal/source',
        worktreesPath: '/personal/worktrees',
      },
    ]
    mockApi.saveConfig.mockImplementationOnce(
      async (savedConfig) => savedConfig
    )
    renderWithApp(
      <SettingsModal
        open
        config={config}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    // selector 存储当前路径组合下拉选择器。
    const selector = within(
      screen.getByTestId('active-path-profile-select')
    ).getByRole('combobox')
    fireEvent.mouseDown(selector)
    // personalOption 存储下拉浮层中的个人路径组合选项。
    const personalOption = await screen.findByText('个人')
    fireEvent.mouseDown(personalOption)
    fireEvent.click(personalOption)
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => expect(mockApi.saveConfig).toHaveBeenCalledTimes(1))
    // savedConfig 存储提交给主进程的配置，应把当前组合路径同步到顶层字段。
    const savedConfig = mockApi.saveConfig.mock.calls[0][0]
    expect(savedConfig.onboardingCompleted).toBe(true)
    expect(savedConfig.activePathProfileId).toBe('personal')
    expect(savedConfig.sourceProjectsPath).toBe('/personal/source')
    expect(savedConfig.worktreesPath).toBe('/personal/worktrees')
    expect(savedConfig.pathProfiles).toHaveLength(2)
  })

  it('再次打开设置页时回显已持久化的当前路径组合', async () => {
    // config 存储已持久化为个人路径组合的配置，用于模拟应用重开设置页。
    const config = makeConfig()
    config.activePathProfileId = 'personal'
    config.sourceProjectsPath = '/personal/source'
    config.worktreesPath = '/personal/worktrees'
    config.pathProfiles = [
      {
        id: 'work',
        name: '工作',
        sourceProjectsPath: '/work/source',
        worktreesPath: '/work/worktrees',
      },
      {
        id: 'personal',
        name: '个人',
        sourceProjectsPath: '/personal/source',
        worktreesPath: '/personal/worktrees',
      },
    ]
    // view 存储渲染控制器，用于模拟设置页关闭后再次打开。
    const view = renderWithApp(
      <SettingsModal
        open={false}
        config={config}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    view.rerender(
      <SettingsModal
        open
        config={config}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    await waitFor(() => {
      // selector 存储再次打开后的当前路径组合下拉框，应渲染持久化组合名称。
      const selector = screen.getByTestId('active-path-profile-select')
      expect(within(selector).getByText('个人')).toBeTruthy()
    })
  })

  it('路径组合名称支持手动输入并持久化', async () => {
    mockApi.saveConfig.mockImplementationOnce(
      async (savedConfig) => savedConfig
    )
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /管理路径组合/ }))

    // nameInput 存储路径组合名称输入框，用户可手动改成任意名称。
    const nameInput = await screen.findByPlaceholderText('例如：工作 / 个人')
    fireEvent.change(nameInput, { target: { value: '路径组合666' } })
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => expect(mockApi.saveConfig).toHaveBeenCalledTimes(1))
    // savedConfig 存储提交给主进程的配置对象，用于验证名称进入 pathProfiles 并可持久化。
    const savedConfig = mockApi.saveConfig.mock.calls[0][0]
    expect(savedConfig.pathProfiles[0].name).toBe('路径组合666')
  })

  it('新增路径组合默认留空并走必填校验', async () => {
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /管理路径组合/ }))
    // addProfileButton 存储统一样式的路径组合新增按钮，尺寸由设置页专用 CSS 统一控制。
    const addProfileButton = screen.getByRole('button', {
      name: /添加路径组合/,
    })
    expect(
      addProfileButton.classList.contains('settings-add-list-button')
    ).toBe(true)
    fireEvent.click(addProfileButton)

    // newRow 存储新增的第二个路径组合行，用于确认新增内容不会继承上一组路径。
    const newRow = await screen.findByTestId('path-profile-row-1')
    expect(within(newRow).getByPlaceholderText('例如：工作 / 个人').value).toBe(
      ''
    )
    expect(
      within(newRow).getByPlaceholderText('/Users/you/Desktop/work/projects')
        .value
    ).toBe('')
    expect(
      within(newRow).getByPlaceholderText('/Users/you/Desktop/work/worktrees')
        .value
    ).toBe('')

    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => expect(screen.getByText('请输入组合名称')).toBeTruthy())
    expect(mockApi.saveConfig).not.toHaveBeenCalled()
  })

  it('确认恢复默认设置后调用 resetConfig 并用返回配置刷新外层状态', async () => {
    // defaultConfig 存储模拟主进程返回的默认配置。
    const defaultConfig = {
      ...makeConfig(),
      sourceProjectsPath: '/default/source',
      worktreesPath: '/default/worktrees',
    }
    // onSaved 存储保存成功回调，用于验证设置页把默认配置同步给外层状态。
    const onSaved = vi.fn()
    // onClose 存储关闭回调，用于验证恢复默认后关闭抽屉。
    const onClose = vi.fn()
    mockApi.resetConfig.mockResolvedValueOnce(defaultConfig)
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={onClose}
        onSaved={onSaved}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /恢复默认设置/ }))

    await waitFor(() => {
      // confirmTitles 存储 AntD 确认框渲染出的标题节点；confirm 会同时生成可访问标题和展示标题。
      const confirmTitles = screen.getAllByText('确认恢复默认设置？')
      expect(confirmTitles.length).toBeGreaterThan(0)
    })
    fireEvent.click(screen.getByRole('button', { name: /确认恢复/ }))

    await waitFor(() => expect(mockApi.resetConfig).toHaveBeenCalledTimes(1))
    expect(onSaved).toHaveBeenCalledWith(defaultConfig)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('工作文档 Tab 可编辑文件模板并保存 workDocumentTemplates', async () => {
    mockApi.saveConfig.mockResolvedValueOnce(makeConfig())
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    // 打开工作文档 Tab，确认默认目录和文件模板都展示为紧凑项。
    fireEvent.click(screen.getByText('工作文档'))
    await waitFor(() => {
      expect(screen.getByTestId('work-document-row-1')).toBeTruthy()
    })

    expect(
      within(screen.getByTestId('work-document-row-0')).getByText('docs')
    ).toBeTruthy()
    expect(
      within(screen.getByTestId('work-document-row-0')).getByText('目录')
    ).toBeTruthy()
    expect(
      within(screen.getByTestId('work-document-row-1')).getByText(
        '.ai/summary.md'
      )
    ).toBeTruthy()
    expect(
      within(screen.getByTestId('work-document-row-1')).getByText('文件')
    ).toBeTruthy()

    fireEvent.click(screen.getByTestId('work-document-row-1'))

    // dialog 为工作文档详情弹层，文件类型可编辑路径和内容。
    const dialog = screen.getByText('编辑工作文档').closest('[role="dialog"]')
    const pathInput = within(dialog).getByPlaceholderText(
      '相对路径，如 docs 或 .ai/summary.md'
    )
    const contentTextarea = within(dialog).getByPlaceholderText('文件默认内容')
    fireEvent.change(pathInput, { target: { value: '.ai/report.md' } })
    fireEvent.change(contentTextarea, { target: { value: '# Report\n' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /完\s*成/ }))
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => expect(mockApi.saveConfig).toHaveBeenCalledTimes(1))
    // savedConfig 存储提交给主进程的设置对象，必须包含工作文档模板数组。
    const savedConfig = mockApi.saveConfig.mock.calls[0][0]
    expect(savedConfig.workDocumentTemplates).toEqual([
      { type: 'directory', path: 'docs', content: '' },
      { type: 'file', path: '.ai/report.md', content: '# Report\n' },
    ])
  })

  it('工作文档 Tab 可新增目录模板', async () => {
    mockApi.saveConfig.mockResolvedValueOnce(makeConfig())
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    fireEvent.click(screen.getByText('工作文档'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /添加工作文档/ })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /添加工作文档/ }))

    await waitFor(() => {
      expect(screen.getByText('编辑工作文档')).toBeTruthy()
    })

    // dialog 为新增模板详情弹层，默认新增目录类型，用户填写路径后保存。
    const dialog = screen.getByText('编辑工作文档').closest('[role="dialog"]')
    fireEvent.change(
      within(dialog).getByPlaceholderText(
        '相对路径，如 docs 或 .ai/summary.md'
      ),
      { target: { value: 'records' } }
    )
    fireEvent.click(within(dialog).getByRole('button', { name: /完\s*成/ }))
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => expect(mockApi.saveConfig).toHaveBeenCalledTimes(1))
    // savedConfig 存储提交给主进程的设置对象，应包含新增的目录模板。
    const savedConfig = mockApi.saveConfig.mock.calls[0][0]
    expect(savedConfig.workDocumentTemplates).toContainEqual({
      type: 'directory',
      path: 'records',
      content: '',
    })
  })

  it('CI/CD Tab 在项目列表尚未加载时会补扫并展示项目下拉选项', async () => {
    // projects 存储主进程扫描到的源项目列表，用于验证设置页能在项目视图未加载时补齐下拉选项。
    const projects = [
      { name: 'web-app', path: '/src/web-app' },
      { name: 'api-service', path: '/src/api-service' },
    ]
    mockApi.scanProjects.mockResolvedValueOnce(projects)
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )

    fireEvent.click(screen.getByText('CI/CD'))

    await waitFor(() => expect(mockApi.scanProjects).toHaveBeenCalledTimes(1))
    expect(mockApi.scanProjects).toHaveBeenCalledWith({ fetch: false })
    fireEvent.click(
      screen.getByRole('button', { name: /添加项目 CI\/CD 地址/ })
    )

    // select 存储 CI/CD 行内项目选择框，打开后应出现扫描得到的项目名。
    const selects = document.querySelectorAll('.ant-select')
    // select 存储新增 CI/CD 行中的最后一个项目选择框。
    const select = selects[selects.length - 1]
    fireEvent.mouseDown(select)

    await waitFor(() => {
      expect(screen.getAllByText('web-app').length).toBeGreaterThan(0)
      expect(screen.getAllByText('api-service').length).toBeGreaterThan(0)
    })
  })

  it('保存时持久化自定义 Token 费用规则', async () => {
    mockApi.saveConfig.mockImplementation(async (savedConfig) => savedConfig)
    renderWithApp(
      <SettingsModal
        open
        config={makeConfig()}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )
    fireEvent.click(screen.getByText('Token 费用'))
    // pricingPanel 存储 Token 费用设置容器，不应再叠加额外 flex gap。
    const pricingPanel = screen.getByTestId('token-pricing-settings-panel')
    expect(pricingPanel.style.gap).toBe('')
    expect(pricingPanel.querySelector('.token-pricing-tool-row')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /价格配置/ }))
    // pricingDialog 存储当前 Codex 价格弹层，价格字段不再占用主设置页空间。
    const pricingDialog = await findDialogByTitle('Codex 价格配置')
    expect(
      Number(within(pricingDialog).getAllByLabelText('Input 单价')[0].value)
    ).toBe(1)
    expect(
      within(pricingDialog).getByText('GPT-5.6 Sol', { exact: true })
    ).toBeTruthy()
    fireEvent.click(
      within(pricingDialog).getByRole('button', { name: /完\s*成/ })
    )
    fireEvent.click(screen.getByRole('switch', { name: '直接人民币显示' }))
    await waitFor(() =>
      expect(screen.getByLabelText('美元兑人民币汇率').disabled).toBe(true)
    )
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    await waitFor(() => expect(mockApi.saveConfig).toHaveBeenCalledTimes(1))
    // savedConfig 存储设置页提交给主进程的完整配置。
    const savedConfig = mockApi.saveConfig.mock.calls[0][0]
    expect(savedConfig.tokenPricing).toEqual({
      ...makeConfig().tokenPricing,
      directCnyDisplay: true,
    })
    expect(savedConfig.tokenPricingByTool).toEqual(
      makeConfig().tokenPricingByTool
    )
    expect(savedConfig.aiUsageTool).toBe('codex')
    expect(savedConfig.aiUsageTools).toEqual(['codex'])
  })
})
