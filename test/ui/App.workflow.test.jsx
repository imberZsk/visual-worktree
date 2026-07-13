import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { App as AntApp } from 'antd';

// mockApi 模拟 App 经 preload 调用的 Electron API。
const mockApi = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  scanWorktreesByTask: vi.fn(),
  scanProjects: vi.fn(),
  loadTaskStatus: vi.fn(),
  loadTaskLinks: vi.fn(),
  loadTaskWorkflow: vi.fn(),
  loadTaskWorkflowOutput: vi.fn(),
  loadTaskBlockers: vi.fn(),
  loadTaskEnvHealth: vi.fn(),
  getClaudeTasksSummary: vi.fn(),
  getClaudeSessionsByTask: vi.fn(),
  checkEnvHealth: vi.fn(),
  runWorkflowStep: vi.fn(),
  onStepOutput: vi.fn(),
  saveTaskWorkflow: vi.fn(),
  saveTaskWorkflowOutput: vi.fn(),
  saveTaskEnvHealth: vi.fn(),
  openInFinder: vi.fn(),
  openInVscode: vi.fn(),
  copyText: vi.fn(),
  loadTaskHistory: vi.fn(),
  removeTaskHistory: vi.fn(),
  archiveTaskDocs: vi.fn(),
  removeWorktree: vi.fn(),
  pruneWorktrees: vi.fn(),
  removeTaskFolder: vi.fn(),
  appendTaskHistory: vi.fn(),
}));

vi.mock('../../src/ui/api.js', () => ({
  api: {
    loadConfig: mockApi.loadConfig,
    scanWorktreesByTask: mockApi.scanWorktreesByTask,
    scanProjects: mockApi.scanProjects,
    loadTaskStatus: mockApi.loadTaskStatus,
    loadTaskLinks: mockApi.loadTaskLinks,
    loadTaskWorkflow: mockApi.loadTaskWorkflow,
    loadTaskWorkflowOutput: mockApi.loadTaskWorkflowOutput,
    loadTaskBlockers: mockApi.loadTaskBlockers,
    loadTaskEnvHealth: mockApi.loadTaskEnvHealth,
    getClaudeTasksSummary: mockApi.getClaudeTasksSummary,
    getClaudeSessionsByTask: mockApi.getClaudeSessionsByTask,
    checkEnvHealth: mockApi.checkEnvHealth,
    runWorkflowStep: mockApi.runWorkflowStep,
    onStepOutput: mockApi.onStepOutput,
    saveTaskWorkflow: mockApi.saveTaskWorkflow,
    saveTaskWorkflowOutput: mockApi.saveTaskWorkflowOutput,
    saveTaskEnvHealth: mockApi.saveTaskEnvHealth,
    openInFinder: mockApi.openInFinder,
    openInVscode: mockApi.openInVscode,
    openInTerminal: vi.fn(),
    copyText: mockApi.copyText,
    loadTaskHistory: mockApi.loadTaskHistory,
    removeTaskHistory: mockApi.removeTaskHistory,
    archiveTaskDocs: mockApi.archiveTaskDocs,
    removeWorktree: mockApi.removeWorktree,
    pruneWorktrees: mockApi.pruneWorktrees,
    removeTaskFolder: mockApi.removeTaskFolder,
    appendTaskHistory: mockApi.appendTaskHistory,
  },
}));

const { default: App } = await import('../../src/ui/App.jsx');
const { useStore } = await import('../../src/ui/store/useStore.js');

// initialState 保存 Zustand 初始状态，用于每个用例前还原。
const initialState = useStore.getState();

// workflowSteps 测试用需求流程步骤，其中 run 步骤配置执行命令。
const workflowSteps = [
  { key: 'plan', label: '审查方案', command: '' },
  { key: 'run', label: '执行脚本', command: './run.sh {task}' },
];

/**
 * 临时模拟历史任务列表的容器高度、列表项高度和 ResizeObserver，便于验证动态分页。
 * @param {{shellHeight?:number,itemHeight?:number}} options - shellHeight 为弹层内历史列表可用高度，itemHeight 为单条历史记录高度
 * @returns {() => void} 恢复原始 DOM 尺寸 getter 与 ResizeObserver 的函数
 */
function mockHistoryListPaginationLayout({ shellHeight = 224, itemHeight = 56 } = {}) {
  // originalClientHeight 存储 HTMLElement 原始 clientHeight 描述符，用于用例结束后恢复。
  const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  // originalOffsetHeight 存储 HTMLElement 原始 offsetHeight 描述符，用于用例结束后恢复。
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  // originalResizeObserver 存储测试前的 ResizeObserver 构造器，用于用例结束后恢复。
  const originalResizeObserver = globalThis.ResizeObserver;

  class ImmediateResizeObserver {
    /**
     * 创建立即触发的 ResizeObserver mock。
     * @param {ResizeObserverCallback} callback - 组件注册的尺寸变化回调
     */
    constructor(callback) {
      // callback 存储组件传入的尺寸变化处理函数。
      this.callback = callback;
    }

    /**
     * 监听元素尺寸变化；测试环境中立即触发一次，模拟弹层完成布局。
     */
    observe() {
      this.callback();
    }

    /**
     * 断开监听；测试 mock 无需清理内部资源。
     */
    disconnect() {}
  }

  globalThis.ResizeObserver = ImmediateResizeObserver;
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      // className 存储当前元素类名，用于只给历史任务分页容器返回可用高度。
      const className = String(this.className || '');
      if (className.includes('history-task-list-shell')) return shellHeight;
      return originalClientHeight?.get ? originalClientHeight.get.call(this) : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      // className 存储当前元素类名，用于只给历史任务列表项返回单条高度。
      const className = String(this.className || '');
      if (className.includes('history-task-list-item')) return itemHeight;
      return originalOffsetHeight?.get ? originalOffsetHeight.get.call(this) : 0;
    },
  });

  /**
   * 恢复测试前的 DOM 尺寸 getter 与 ResizeObserver，避免影响后续用例。
   */
  return () => {
    if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    else delete HTMLElement.prototype.clientHeight;
    if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
    else delete HTMLElement.prototype.offsetHeight;
    globalThis.ResizeObserver = originalResizeObserver;
  };
}

// worktreeTasks 测试用 worktree 任务列表，模拟 Worktree Tab 的任务数据。
const worktreeTasks = [
  {
    task: 'TASK-A',
    path: '/wt/TASK-A',
    worktrees: [
      { project: 'projA', projectPath: '/src/projA', path: '/wt/TASK-A/projA', branch: 'feat-a', prunable: false, missing: false, hasUncommittedChanges: false, ahead: 0, behind: 0 },
    ],
  },
];

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
    workflowSteps,
    cicdLinks: {},
    envCheckRoles: [],
  };
}

/**
 * 渲染 App 并提供 antd App 上下文。
 * @returns {ReturnType<typeof render>} 渲染结果
 */
function renderApp() {
  return render(<AntApp><App /></AntApp>);
}

describe('App worktree 流程执行', () => {
  beforeEach(() => {
    // activeView 固定为 worktrees，确保首屏就是 Worktree Tab。
    localStorage.setItem('vw-active-view', 'worktrees');
    // 重置全局 store，避免上一个用例留下任务/勾选状态。
    useStore.setState(initialState, true);
    mockApi.loadConfig.mockReset().mockResolvedValue(makeConfig());
    mockApi.scanWorktreesByTask.mockReset().mockResolvedValue(worktreeTasks);
    mockApi.scanProjects.mockReset().mockResolvedValue([]);
    mockApi.loadTaskStatus.mockReset().mockResolvedValue({});
    mockApi.loadTaskLinks.mockReset().mockResolvedValue({});
    mockApi.loadTaskWorkflow.mockReset().mockResolvedValue({});
    mockApi.loadTaskWorkflowOutput.mockReset().mockResolvedValue({});
    mockApi.loadTaskBlockers.mockReset().mockResolvedValue({});
    mockApi.loadTaskEnvHealth.mockReset().mockResolvedValue({
      'TASK-A': {
        version: 2,
        status: 'ok',
        issueCount: 0,
        taskDir: '/wt/TASK-A',
        result: {
          summary: { status: 'ok', projectCount: 1, issueCount: 0, failedProjects: [], message: '1 个项目环境正常' },
          projects: [],
        },
      },
    });
    mockApi.getClaudeTasksSummary.mockReset().mockResolvedValue({});
    mockApi.getClaudeSessionsByTask.mockReset().mockResolvedValue([]);
    mockApi.checkEnvHealth.mockReset().mockResolvedValue({
      summary: { status: 'ok', projectCount: 1, issueCount: 0, failedProjects: [], message: '1 个项目环境正常' },
      projects: [],
    });
    mockApi.runWorkflowStep.mockReset().mockResolvedValue({ success: true, code: 0, stdout: 'ok', stderr: '' });
    mockApi.onStepOutput.mockReset().mockReturnValue(() => {});
    mockApi.saveTaskWorkflow.mockReset().mockResolvedValue(true);
    mockApi.saveTaskWorkflowOutput.mockReset().mockResolvedValue(true);
    mockApi.saveTaskEnvHealth.mockReset().mockResolvedValue(true);
    mockApi.openInFinder.mockReset().mockResolvedValue({ success: true });
    mockApi.openInVscode.mockReset().mockResolvedValue({ success: true });
    mockApi.copyText.mockReset().mockResolvedValue(true);
    mockApi.loadTaskHistory.mockReset().mockResolvedValue([]);
    mockApi.removeTaskHistory.mockReset().mockResolvedValue(true);
    mockApi.archiveTaskDocs.mockReset().mockResolvedValue({ success: true, docsPath: '/tmp/.visualWorktree/task-docs/TASK-A' });
    mockApi.removeWorktree.mockReset().mockResolvedValue({ success: true });
    mockApi.pruneWorktrees.mockReset().mockResolvedValue({ success: true });
    mockApi.removeTaskFolder.mockReset().mockResolvedValue({ success: true });
    mockApi.appendTaskHistory.mockReset().mockResolvedValue(true);
  });

  afterEach(() => cleanup());

  it('流程步骤执行成功后自动勾选该步骤', async () => {
    renderApp();

    await waitFor(() => expect(screen.getByText('TASK-A')).toBeTruthy());
    fireEvent.click(screen.getByText('流程'));
    fireEvent.click(screen.getByText('执行'));

    await waitFor(() => {
      expect(useStore.getState().taskWorkflowMap['TASK-A'] || []).toContain('run');
    });
  });

  it('流程步骤执行结束后持久化最近一次输出缓存', async () => {
    renderApp();

    await waitFor(() => expect(screen.getByText('TASK-A')).toBeTruthy());
    fireEvent.click(screen.getByText('流程'));
    fireEvent.click(screen.getByText('执行'));

    await waitFor(() => expect(mockApi.saveTaskWorkflowOutput).toHaveBeenCalledTimes(1));
    // savedMap 存储渲染进程提交给主进程的最近一次流程输出缓存。
    const savedMap = mockApi.saveTaskWorkflowOutput.mock.calls[0][0];
    expect(savedMap['TASK-A::run']).toMatchObject({
      taskName: 'TASK-A',
      stepKey: 'run',
      label: '执行脚本',
      status: 'success',
      code: 0,
      content: 'ok',
    });
  });

  it('启动时恢复流程步骤最近一次失败输出缓存', async () => {
    // cachedOutputs 存储上次 App 会话写入磁盘的步骤输出快照。
    const cachedOutputs = {
      'TASK-A::run': {
        taskName: 'TASK-A',
        stepKey: 'run',
        label: '执行脚本',
        status: 'error',
        code: 1,
        content: 'unit failed',
      },
    };
    mockApi.loadTaskWorkflowOutput.mockResolvedValue(cachedOutputs);
    renderApp();

    await waitFor(() => expect(screen.getByText('TASK-A')).toBeTruthy());
    await waitFor(() => expect(mockApi.loadTaskWorkflowOutput).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('流程'));

    expect(screen.getByText('未通过')).toBeTruthy();
    expect(document.querySelector('.anticon-file-text').closest('button')).toBeTruthy();
  });

  it('流程步骤执行失败后取消已完成勾选并显示未通过', async () => {
    // 先把 run 步骤加载为已完成，模拟上一次单测通过后用户再次执行检查。
    mockApi.loadTaskWorkflow.mockResolvedValue({ 'TASK-A': ['run'] });
    // 本次执行返回失败：应撤销完成态，避免单测不通过时仍显示已完成。
    mockApi.runWorkflowStep.mockResolvedValue({ success: false, code: 1, stdout: '', stderr: 'unit failed' });
    renderApp();

    await waitFor(() => expect(screen.getByText('TASK-A')).toBeTruthy());
    fireEvent.click(screen.getByText('流程'));
    fireEvent.click(screen.getByText('执行'));

    await waitFor(() => {
      expect(useStore.getState().taskWorkflowMap['TASK-A'] || []).not.toContain('run');
    });
    expect(screen.getByText('未通过')).toBeTruthy();
  });

  it('流程执行输出弹窗层级高于流程弹层', async () => {
    renderApp();

    await waitFor(() => expect(screen.getByText('TASK-A')).toBeTruthy());
    fireEvent.click(screen.getByText('流程'));
    fireEvent.click(screen.getByText('执行'));

    // outputTitle 存储实时输出 Modal 的标题节点；流程 Modal 也在页面上，不能用第一个 ant-modal-wrap 泛选。
    const outputTitle = await screen.findByText(/「执行脚本」执行/);
    // modalWrap 为实时输出 Modal 的包裹层，z-index 应显式高于流程弹层与常规浮层。
    const modalWrap = outputTitle.closest('.ant-modal-wrap');

    expect(modalWrap).toBeTruthy();
    expect(Number(modalWrap.style.zIndex)).toBeGreaterThan(1030);
  });

  it('执行流程步骤时把任务目录参数模式和任务上下文传给主进程', async () => {
    // nextConfig 存储本用例专属配置：单测脚本选择强制追加任务目录。
    const nextConfig = makeConfig();
    nextConfig.workflowSteps = [
      { key: 'unit', label: '单测', command: 'bash check-unit-test.sh', taskArgMode: 'appendPath' },
    ];
    mockApi.loadConfig.mockResolvedValue(nextConfig);
    renderApp();

    await waitFor(() => expect(screen.getByText('TASK-A')).toBeTruthy());
    fireEvent.click(screen.getByText('流程'));
    fireEvent.click(screen.getByText('执行'));

    await waitFor(() => expect(mockApi.runWorkflowStep).toHaveBeenCalledTimes(1));
    // payload 存储渲染进程发给主进程的执行上下文。
    const payload = mockApi.runWorkflowStep.mock.calls[0][0];
    expect(payload).toMatchObject({
      command: 'bash check-unit-test.sh',
      cwd: '/wt/TASK-A',
      task: 'TASK-A',
      taskName: 'TASK-A',
      branch: 'feat-a',
      stepKey: 'unit',
      taskArgMode: 'appendPath',
    });
  });

  it('执行流程步骤前重新读取最新配置，避免运行中配置变更后继续使用旧命令', async () => {
    // staleConfig 存储 App 启动时加载到内存里的旧流程配置。
    const staleConfig = makeConfig();
    staleConfig.workflowSteps = [
      { key: 'jira', label: 'JIRA评论项目名:分支', command: '/scripts/comment-jira.sh', taskArgMode: 'auto' },
    ];
    // latestConfig 存储用户在运行期间修改后的最新配置，执行前应以它覆盖同 key 步骤命令。
    const latestConfig = makeConfig();
    latestConfig.workflowSteps = [
      { key: 'jira', label: 'JIRA评论项目名:分支', command: '/scripts/comment-branch-jira.sh', taskArgMode: 'appendPath' },
    ];
    mockApi.loadConfig
      .mockResolvedValueOnce(staleConfig)
      .mockResolvedValue(latestConfig);
    renderApp();

    await waitFor(() => expect(screen.getByText('TASK-A')).toBeTruthy());
    fireEvent.click(screen.getByText('流程'));
    fireEvent.click(screen.getByText('执行'));

    await waitFor(() => expect(mockApi.runWorkflowStep).toHaveBeenCalledTimes(1));
    // payload 存储渲染进程发给主进程的执行上下文；命令应来自最新配置而非启动时旧配置。
    const payload = mockApi.runWorkflowStep.mock.calls[0][0];
    expect(payload.command).toBe('/scripts/comment-branch-jira.sh');
    expect(payload.taskArgMode).toBe('appendPath');
  });

  it('运行全部按顺序执行所有有命令步骤并成功后自动勾选', async () => {
    mockApi.runWorkflowStep.mockResolvedValue({ success: true, code: 0, stdout: 'ok', stderr: '' });
    renderApp();

    await waitFor(() => expect(screen.getByText('TASK-A')).toBeTruthy());
    fireEvent.click(screen.getByText('流程'));
    fireEvent.click(screen.getByText('运行全部'));

    await waitFor(() => expect(mockApi.runWorkflowStep).toHaveBeenCalledTimes(1));
    expect(useStore.getState().taskWorkflowMap['TASK-A']).toContain('run');
  });

  it('运行全部遇到失败后停止并保留后续步骤未执行', async () => {
    // nextConfig 存储本用例专属配置：两个连续可执行步骤，用于验证失败停止。
    const nextConfig = makeConfig();
    nextConfig.workflowSteps = [
      { key: 'first', label: '第一步', command: './first.sh' },
      { key: 'second', label: '第二步', command: './second.sh' },
    ];
    mockApi.loadConfig.mockResolvedValue(nextConfig);
    mockApi.runWorkflowStep.mockResolvedValueOnce({ success: false, code: 1, stdout: '', stderr: 'fail' });
    renderApp();

    await waitFor(() => expect(screen.getByText('TASK-A')).toBeTruthy());
    fireEvent.click(screen.getByText('流程'));
    fireEvent.click(screen.getByText('运行全部'));

    await waitFor(() => expect(mockApi.runWorkflowStep).toHaveBeenCalledTimes(1));
    expect(mockApi.runWorkflowStep.mock.calls[0][0].command).toBe('./first.sh');
    expect(useStore.getState().taskWorkflowMap['TASK-A'] || []).not.toContain('second');
  });

  it('历史任务可打开归档 docs 的 Finder 和 VSCode', async () => {
    // docsPath 存储已删除任务归档后的工作记录目录。
    const docsPath = '/tmp/.visualWorktree/task-docs/TASK-A';
    mockApi.loadTaskHistory.mockResolvedValue([
      { task: 'TASK-A', link: '', status: '', docsPath, deletedAt: '2026-07-01T00:00:00.000Z' },
    ]);
    renderApp();

    await waitFor(() => expect(screen.getByText('TASK-A')).toBeTruthy());
    fireEvent.click(screen.getByText('历史任务'));

    await waitFor(() => expect(screen.getAllByText('TASK-A').length).toBeGreaterThan(1));
    fireEvent.click(screen.getByTitle('在 Finder 显示工作记录'));
    fireEvent.click(screen.getByTitle('用 VSCode 打开工作记录'));

    expect(mockApi.openInFinder).toHaveBeenCalledWith(docsPath);
    expect(mockApi.openInVscode).toHaveBeenCalledWith(docsPath);
  });

  it('历史任务没有归档 docs 时保留 Finder 和 VSCode 禁用占位', async () => {
    mockApi.loadTaskHistory.mockResolvedValue([
      { task: 'LONG-TASK', link: '', status: '', deletedAt: '2026-07-01T00:00:00.000Z' },
    ]);
    renderApp();

    await waitFor(() => expect(screen.getByText('TASK-A')).toBeTruthy());
    fireEvent.click(screen.getByText('历史任务'));

    await waitFor(() => expect(screen.getByText('LONG-TASK')).toBeTruthy());
    // finderButton 存储无归档 docs 时的 Finder 占位按钮，应禁用但仍保留位置。
    const finderButton = screen.getByTitle('暂无工作记录归档，无法在 Finder 显示');
    // vscodeButton 存储无归档 docs 时的 VSCode 占位按钮，应禁用但仍保留位置。
    const vscodeButton = screen.getByTitle('暂无工作记录归档，无法用 VSCode 打开');
    expect(finderButton.disabled).toBe(true);
    expect(vscodeButton.disabled).toBe(true);
  });

  it('历史任务弹层按容器高度调整 antd List 每页条数', async () => {
    // restoreLayoutMock 存储 DOM 尺寸与 ResizeObserver mock 的恢复函数。
    const restoreLayoutMock = mockHistoryListPaginationLayout({ shellHeight: 224, itemHeight: 56 });
    // historyEntries 存储 8 条历史任务；224/56 应得到每页 4 条。
    const historyEntries = Array.from({ length: 8 }, (_, index) => ({
      task: `HISTORY-${index + 1}`,
      link: '',
      status: '',
      deletedAt: '2026-07-01T00:00:00.000Z',
    }));
    mockApi.loadTaskHistory.mockResolvedValue(historyEntries);

    try {
      renderApp();

      await waitFor(() => expect(screen.getByText('TASK-A')).toBeTruthy());
      fireEvent.click(screen.getByText('历史任务'));

      await waitFor(() => expect(screen.getByText('HISTORY-4')).toBeTruthy());
      await waitFor(() => expect(screen.queryByText('HISTORY-5')).toBeNull());
      // pageTwo 存储 antd Pagination 的第二页按钮，用于验证仍由 antd 控制翻页。
      const pageTwo = document.querySelector('.ant-pagination-item-2');
      expect(pageTwo).toBeTruthy();
      fireEvent.click(pageTwo);

      await waitFor(() => expect(screen.getByText('HISTORY-5')).toBeTruthy());
    } finally {
      restoreLayoutMock();
    }
  });

  it('历史任务第二页删除时按完整历史列表下标删除', async () => {
    // restoreLayoutMock 存储 DOM 尺寸与 ResizeObserver mock 的恢复函数。
    const restoreLayoutMock = mockHistoryListPaginationLayout({ shellHeight: 224, itemHeight: 56 });
    // historyEntries 存储 8 条历史任务；第二页第一条在完整列表中的下标应为 4。
    const historyEntries = Array.from({ length: 8 }, (_, index) => ({
      task: `REMOVE-${index + 1}`,
      link: '',
      status: '',
      deletedAt: '2026-07-01T00:00:00.000Z',
    }));
    mockApi.loadTaskHistory.mockResolvedValue(historyEntries);

    try {
      renderApp();

      await waitFor(() => expect(screen.getByText('TASK-A')).toBeTruthy());
      fireEvent.click(screen.getByText('历史任务'));

      await waitFor(() => expect(document.querySelector('.ant-pagination-item-2')).toBeTruthy());
      fireEvent.click(document.querySelector('.ant-pagination-item-2'));
      await waitFor(() => expect(screen.getByText('REMOVE-5')).toBeTruthy());
      fireEvent.click(screen.getAllByTitle('从历史中移除')[0]);

      expect(mockApi.removeTaskHistory).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.getAllByText('移除历史任务「REMOVE-5」？').length).toBeGreaterThan(0));
      // confirmButton 存储历史任务二次确认框中的危险操作按钮。
      const confirmButton = document.querySelector('.ant-modal-confirm .ant-btn-dangerous');
      fireEvent.click(confirmButton);

      await waitFor(() => expect(mockApi.removeTaskHistory).toHaveBeenCalledWith(4));
    } finally {
      restoreLayoutMock();
    }
  });

  it('历史任务任务名和链接使用统一单行 Tooltip 文本', async () => {
    // taskName 存储较长的历史任务名，用于验证列表一行省略后仍可复制完整文本。
    const taskName = 'alice/bugfix/PROJ-5001-订单批量导入页面异常';
    // linkUrl 存储较长的历史任务链接，用于验证链接 Tooltip 中复制的是完整 URL。
    const linkUrl = 'https://issues.example.com/browse/PROJ-5001';
    mockApi.loadTaskHistory.mockResolvedValue([
      { task: taskName, link: linkUrl, status: 'released', deletedAt: '2026-07-01T00:00:00.000Z' },
    ]);

    renderApp();

    await waitFor(() => expect(screen.getByText('TASK-A')).toBeTruthy());
    fireEvent.click(screen.getByText('历史任务'));

    await waitFor(() => expect(screen.getByText(taskName)).toBeTruthy());
    // clippedTexts 存储历史任务弹层内统一单行 Tooltip 文本节点。
    const clippedTexts = document.querySelectorAll('.history-task-list .single-line-tooltip-text');
    expect([...clippedTexts].map((node) => node.textContent)).toEqual(
      expect.arrayContaining([taskName, linkUrl]),
    );
  });

  it('删除任务前先归档 docs 并把 docsPath 写入历史记录', async () => {
    // docsPath 存储归档 IPC 返回的历史工作记录路径。
    const docsPath = '/tmp/.visualWorktree/task-docs/TASK-A';
    renderApp();

    await waitFor(() => expect(screen.getByText('TASK-A')).toBeTruthy());
    fireEvent.click(screen.getByTitle('删除任务'));
    await waitFor(() => expect(screen.getAllByText('删除任务「TASK-A」').length).toBeGreaterThan(0));
    // confirmButton 存储 antd Confirm 的危险确认按钮；按钮可访问名会被中文字符间距影响，因此按样式类定位。
    const confirmButton = document.querySelector('.ant-modal-confirm .ant-btn-dangerous');
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mockApi.appendTaskHistory).toHaveBeenCalled());
    expect(mockApi.archiveTaskDocs).toHaveBeenCalledWith('/wt/TASK-A', 'TASK-A');
    expect(mockApi.removeWorktree).toHaveBeenCalledWith('/src/projA', '/wt/TASK-A/projA', {});
    expect(mockApi.removeTaskFolder).toHaveBeenCalledWith('/wt/TASK-A');
    expect(mockApi.appendTaskHistory).toHaveBeenCalledWith(expect.objectContaining({
      task: 'TASK-A',
      docsPath,
    }));
    expect(mockApi.archiveTaskDocs.mock.invocationCallOrder[0]).toBeLessThan(mockApi.removeWorktree.mock.invocationCallOrder[0]);
  });
});
