import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App as AntApp } from 'antd';

// mockApi 模拟 App 启动与显隐工具栏测试所需的 Electron API。
const mockApi = vi.hoisted(() => ({
  loadConfig: vi.fn(),
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
}));

vi.mock('../../src/ui/api.js', () => ({
  api: {
    loadConfig: mockApi.loadConfig,
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
}));

const { default: App } = await import('../../src/ui/App.jsx');
const { useStore } = await import('../../src/ui/store/useStore.js');

// initialState 保存 Zustand 初始状态，用于每个用例前还原。
const initialState = useStore.getState();

// worktreeTasks 测试用 worktree 任务列表，包含一个可见任务和一个隐藏任务。
const worktreeTasks = [
  {
    task: 'TASK-A',
    path: '/wt/TASK-A',
    worktrees: [
      { project: 'projA', projectPath: '/src/projA', path: '/wt/TASK-A/projA', branch: 'feat-a', prunable: false, missing: false, hasUncommittedChanges: false, ahead: 0, behind: 0 },
    ],
  },
  {
    task: 'TASK-HIDDEN',
    path: '/wt/TASK-HIDDEN',
    worktrees: [
      { project: 'projB', projectPath: '/src/projB', path: '/wt/TASK-HIDDEN/projB', branch: 'feat-hidden', prunable: false, missing: false, hasUncommittedChanges: false, ahead: 0, behind: 0 },
    ],
  },
];

// projects 测试用项目列表，包含一个可见项目和一个隐藏项目。
const projects = [
  { name: 'alpha', path: '/repo/alpha', isGitRepo: true, isMainBranch: true, hasUncommittedChanges: false, hasUnpushedCommits: false, canPull: false, ahead: 0, behind: 0 },
  { name: 'beta', path: '/repo/beta', isGitRepo: true, isMainBranch: true, hasUncommittedChanges: false, hasUnpushedCommits: false, canPull: false, ahead: 0, behind: 0 },
];

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
  };
}

/**
 * 渲染 App 并注入 antd App 上下文。
 * @returns {ReturnType<typeof render>} 渲染结果
 */
function renderApp() {
  return render(<AntApp><App /></AntApp>);
}

/**
 * 断言工具栏显隐按钮不展示眼睛图标。
 * @param {HTMLElement} button - 待检查按钮
 */
function expectNoEyeIcon(button) {
  expect(button.querySelector('.anticon-eye')).toBeNull();
  expect(button.querySelector('.anticon-eye-invisible')).toBeNull();
}

describe('App 显示隐藏项工具栏', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState(initialState, true);
    mockApi.loadConfig.mockReset().mockResolvedValue(makeConfig());
    mockApi.scanWorktreesByTask.mockReset().mockResolvedValue(worktreeTasks);
    mockApi.scanProjects.mockReset().mockResolvedValue(projects);
    mockApi.loadTaskStatus.mockReset().mockResolvedValue({});
    mockApi.loadTaskLinks.mockReset().mockResolvedValue({});
    mockApi.loadTaskVisibility.mockReset().mockResolvedValue({ hidden: ['TASK-HIDDEN'], pinned: [] });
    mockApi.loadProjectVisibility.mockReset().mockResolvedValue({ hidden: ['/repo/beta'], pinned: [] });
    mockApi.loadTaskWorkflow.mockReset().mockResolvedValue({});
    mockApi.loadTaskBlockers.mockReset().mockResolvedValue({});
    mockApi.loadTaskEnvHealth.mockReset().mockResolvedValue({});
    mockApi.getClaudeTasksSummary.mockReset().mockResolvedValue({});
    mockApi.getClaudeSessionsByTask.mockReset().mockResolvedValue([]);
    mockApi.checkEnvHealth.mockReset().mockResolvedValue({});
    mockApi.saveTaskEnvHealth.mockReset().mockResolvedValue(true);
    mockApi.onStepOutput.mockReset().mockReturnValue(() => {});
    mockApi.onBatchProgress.mockReset().mockReturnValue(() => {});
  });

  afterEach(() => cleanup());

  it('Worktree 工具栏显隐入口只展示文案，并与排序控件保持清晰间距', async () => {
    localStorage.setItem('vw-active-view', 'worktrees');
    renderApp();

    // showButton 存储默认状态的显隐入口；顶部工具栏只保留文案，避免和行级状态眼睛混淆。
    const showButton = await screen.findByRole('button', { name: /显示隐藏任务/ });
    await waitFor(() => expect(showButton.disabled).toBe(false));
    expectNoEyeIcon(showButton);
    expect(showButton.closest('.ant-space').style.columnGap).toBe('12px');

    fireEvent.click(showButton);

    // hideButton 存储显示隐藏项后的入口；收起状态同样只展示文案。
    const hideButton = await screen.findByRole('button', { name: /收起隐藏任务/ });
    expectNoEyeIcon(hideButton);
  });

  it('项目工具栏显隐入口只展示文案', async () => {
    localStorage.setItem('vw-active-view', 'projects');
    renderApp();

    // showButton 存储默认状态的显隐入口；顶部工具栏只保留文案，避免和行级状态眼睛混淆。
    const showButton = await screen.findByRole('button', { name: /显示隐藏项目/ });
    await waitFor(() => expect(showButton.disabled).toBe(false));
    expectNoEyeIcon(showButton);

    fireEvent.click(showButton);

    // hideButton 存储显示隐藏项后的入口；收起状态同样只展示文案。
    const hideButton = await screen.findByRole('button', { name: /收起隐藏项目/ });
    expectNoEyeIcon(hideButton);
  });
});
