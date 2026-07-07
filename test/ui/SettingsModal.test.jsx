import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { App as AntApp } from 'antd';
import SettingsModal from '../../src/ui/components/SettingsModal.jsx';
import { useStore } from '../../src/ui/store/useStore.js';

// mockApi 模拟设置弹窗保存配置时用到的 Electron API。
const mockApi = vi.hoisted(() => ({
  saveConfig: vi.fn(),
  resetConfig: vi.fn(),
  selectDirectory: vi.fn(),
  scanProjects: vi.fn(),
}));

vi.mock('../../src/ui/api.js', () => ({
  api: {
    saveConfig: mockApi.saveConfig,
    resetConfig: mockApi.resetConfig,
    selectDirectory: mockApi.selectDirectory,
    scanProjects: mockApi.scanProjects,
  },
}));

// initialState 保存 Zustand 初始状态，确保每个用例互不污染。
const initialState = useStore.getState();

/**
 * 用 AntApp 包裹组件，提供 antd message/modal 上下文。
 * @param {React.ReactNode} ui - 要渲染的组件
 * @returns {ReturnType<typeof render>} 渲染结果
 */
function renderWithApp(ui) {
  return render(<AntApp>{ui}</AntApp>);
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
      { key: 'review', label: '审查很长很长的需求方案标题', command: 'node ./scripts/review.js --task {task} --path {path}' },
    ],
    workDocumentTemplates: [
      { type: 'directory', path: 'docs', content: '' },
      { type: 'file', path: '.ai/summary.md', content: '# Summary\n' },
    ],
    taskTitleBadges: {
      projectCount: true,
      taskStatus: true,
      taskLinks: true,
      envHealth: true,
      claudeUsage: true,
    },
    cicdLinks: {},
    envCheckRoles: [],
  };
}

describe('SettingsModal 流程配置布局', () => {
  beforeEach(() => {
    // 重置全局 store，避免项目列表等状态串扰。
    useStore.setState(initialState, true);
    mockApi.saveConfig.mockReset();
    mockApi.resetConfig.mockReset();
    mockApi.selectDirectory.mockReset();
    mockApi.scanProjects.mockReset().mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  afterEach(() => cleanup());

  it('流程步骤主列表只展示紧凑项，点击后用弹层编辑详情', async () => {
    renderWithApp(<SettingsModal open config={makeConfig()} onClose={() => {}} onSaved={() => {}} />);

    // 打开流程 Tab，查看步骤编辑区。
    fireEvent.click(screen.getByText('流程'));

    await waitFor(() => {
      expect(screen.getByTestId('workflow-step-row-0')).toBeTruthy();
    });

    // row 为紧凑流程步骤项，主列表只展示摘要，不展开所有编辑字段。
    const row = screen.getByTestId('workflow-step-row-0');
    expect(within(row).getByText('审查很长很长的需求方案标题')).toBeTruthy();
    expect(within(row).getByText('已配置命令')).toBeTruthy();
    expect(row.style.boxSizing).toBe('border-box');
    expect(screen.queryByTestId('workflow-step-list')).toBeNull();
    expect(screen.queryByPlaceholderText(/执行命令/)).toBeNull();

    fireEvent.click(row);

    await waitFor(() => {
      expect(screen.getByText('编辑流程步骤')).toBeTruthy();
    });

    // commandTextarea 为弹层内执行命令多行输入框，长命令在详情层里完整编辑。
    const dialog = screen.getByText('编辑流程步骤').closest('[role="dialog"]');
    expect(dialog).toBeTruthy();
    const commandTextarea = within(dialog).getByPlaceholderText(/执行命令/);

    expect(within(dialog).getByPlaceholderText(/步骤名称/)).toBeTruthy();
    expect(commandTextarea.tagName).toBe('TEXTAREA');
  });

  it('弹层编辑后的流程步骤保存回 workflowSteps 数组', async () => {
    mockApi.saveConfig.mockResolvedValueOnce(makeConfig());
    renderWithApp(<SettingsModal open config={makeConfig()} onClose={() => {}} onSaved={() => {}} />);

    // 打开流程 Tab 并进入第一条流程步骤的详情弹层。
    fireEvent.click(screen.getByText('流程'));
    await waitFor(() => {
      expect(screen.getByTestId('workflow-step-row-0')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('workflow-step-row-0'));

    // dialog 为当前流程步骤详情弹层，避免和外层设置抽屉混淆。
    const dialog = screen.getByText('编辑流程步骤').closest('[role="dialog"]');
    // nameInput 为流程步骤名称输入框。
    const nameInput = within(dialog).getByPlaceholderText(/步骤名称/);
    // commandTextarea 为流程步骤命令输入框。
    const commandTextarea = within(dialog).getByPlaceholderText(/执行命令/);

    fireEvent.change(nameInput, { target: { value: '重新审查需求' } });
    fireEvent.change(commandTextarea, { target: { value: 'pnpm test --filter {task}' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /完\s*成/ }));
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      expect(mockApi.saveConfig).toHaveBeenCalledTimes(1);
    });

    // savedConfig 为提交给主进程持久化的配置对象，workflowSteps 必须保持一维步骤数组。
    const savedConfig = mockApi.saveConfig.mock.calls[0][0];
    expect(savedConfig.workflowSteps).toEqual([
      { key: 'review', label: '重新审查需求', command: 'pnpm test --filter {task}', autoCheckOnSuccess: true, stopOnFailure: true, taskArgMode: 'auto' },
    ]);
    expect(savedConfig.workflowSteps.workflowSteps).toBeUndefined();
  });

  it('流程步骤弹层可配置成功自动勾选、失败停止和任务目录参数模式', async () => {
    renderWithApp(<SettingsModal open config={makeConfig()} onClose={() => {}} onSaved={() => {}} />);

    fireEvent.click(screen.getByText('流程'));
    await waitFor(() => {
      expect(screen.getByTestId('workflow-step-row-0')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('workflow-step-row-0'));

    expect(screen.getByText('成功后自动勾选')).toBeTruthy();
    expect(screen.getByText('失败后停止后续步骤')).toBeTruthy();
    expect(screen.getByText('任务目录参数')).toBeTruthy();
  });

  it('流程步骤支持上移下移并按新顺序保存', async () => {
    // config 存储本用例专属配置：两条流程步骤便于验证排序变化。
    const config = makeConfig();
    config.workflowSteps = [
      { key: 'first-step-key', label: '第一步', command: 'npm test' },
      { key: 'second-step-key', label: '第二步', command: 'npm run build' },
    ];
    mockApi.saveConfig.mockResolvedValueOnce(config);
    renderWithApp(<SettingsModal open config={config} onClose={() => {}} onSaved={() => {}} />);

    fireEvent.click(screen.getByText('流程'));
    await waitFor(() => {
      expect(screen.getByTestId('workflow-step-row-1')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('workflow-step-move-up-1'));
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => expect(mockApi.saveConfig).toHaveBeenCalled());
    // savedConfig 存储提交给主进程的配置对象，workflowSteps 顺序应反映用户上移操作。
    const savedConfig = mockApi.saveConfig.mock.calls.at(-1)[0];
    expect(savedConfig.workflowSteps.map((s) => s.key)).toEqual(['second-step-key', 'first-step-key']);
  });

  it('不再展示环境检查配置 Tab，环境类型由系统自动识别', async () => {
    renderWithApp(<SettingsModal open config={makeConfig()} onClose={() => {}} onSaved={() => {}} />);

    await waitFor(() => expect(mockApi.scanProjects).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('环境检查')).toBeNull();
  });

  it('展示 Tab 用卡片网格承载任务标题徽标开关', async () => {
    renderWithApp(<SettingsModal open config={makeConfig()} onClose={() => {}} onSaved={() => {}} />);

    fireEvent.click(screen.getByText('展示'));

    await waitFor(() => {
      expect(screen.getByTestId('display-settings-panel')).toBeTruthy();
    });

    // panel 存储展示偏好页整体容器，用于验证顶部说明与布局结构。
    const panel = screen.getByTestId('display-settings-panel');
    // grid 存储展示项卡片网格，避免页面退回到左侧单列堆叠。
    const grid = screen.getByTestId('display-badge-grid');
    // envCard 存储环境状态展示项卡片，用于验证说明文案和开关被组织在同一张卡片里。
    const envCard = screen.getByTestId('display-badge-card-envHealth');

    expect(within(panel).getByText('任务标题展示偏好')).toBeTruthy();
    expect(within(panel).getByText('按需选择任务标题旁显示哪些辅助信息，让任务列表保持清爽但不丢关键状态。')).toBeTruthy();
    expect(grid.style.gridTemplateColumns).toContain('minmax(220px, 1fr)');
    expect(within(envCard).getByText('展示自动环境检查结果，快速发现依赖、端口或服务问题。')).toBeTruthy();
    expect(within(envCard).getByRole('switch')).toBeTruthy();
  });

  it('展示 Tab 可关闭任务标题旁的环境状态和 Token 消耗徽标并保存', async () => {
    mockApi.saveConfig.mockResolvedValueOnce(makeConfig());
    renderWithApp(<SettingsModal open config={makeConfig()} onClose={() => {}} onSaved={() => {}} />);

    fireEvent.click(screen.getByText('展示'));

    await waitFor(() => {
      expect(screen.getByTestId('display-settings-panel')).toBeTruthy();
    });

    // envCard 存储“环境状态”开关所在卡片，用于只点击这一项的 switch。
    const envCard = screen.getByTestId('display-badge-card-envHealth');
    // tokenCard 存储“Token 消耗”开关所在卡片，用于只点击这一项的 switch。
    const tokenCard = screen.getByTestId('display-badge-card-claudeUsage');
    fireEvent.click(within(envCard).getByRole('switch'));
    fireEvent.click(within(tokenCard).getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => expect(mockApi.saveConfig).toHaveBeenCalledTimes(1));

    // savedConfig 存储提交给主进程的设置对象，应保留其他展示项默认开启。
    const savedConfig = mockApi.saveConfig.mock.calls[0][0];
    expect(savedConfig.taskTitleBadges).toEqual({
      projectCount: true,
      taskStatus: true,
      taskLinks: true,
      envHealth: false,
      claudeUsage: false,
    });
  });

  it('未打开流程 Tab 保存其它设置时保留已有流程步骤', async () => {
    mockApi.saveConfig.mockResolvedValueOnce(makeConfig());
    renderWithApp(<SettingsModal open config={makeConfig()} onClose={() => {}} onSaved={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => expect(mockApi.saveConfig).toHaveBeenCalledTimes(1));

    // savedConfig 存储提交给主进程的配置对象；即使流程 Tab 未挂载，也不能把 workflowSteps 写成空数组。
    const savedConfig = mockApi.saveConfig.mock.calls[0][0];
    expect(savedConfig.workflowSteps).toEqual([
      { key: 'review', label: '审查很长很长的需求方案标题', command: 'node ./scripts/review.js --task {task} --path {path}', autoCheckOnSuccess: true, stopOnFailure: true, taskArgMode: 'auto' },
    ]);
  });

  it('路径输入支持点击选择目录并写回表单', async () => {
    mockApi.selectDirectory.mockResolvedValueOnce({ canceled: false, path: '/picked/source' });
    renderWithApp(<SettingsModal open config={makeConfig()} onClose={() => {}} onSaved={() => {}} />);

    // sourceInput 存储源项目根目录输入框，用于验证选择目录前后的值变化。
    const sourceInput = screen.getByPlaceholderText('/Users/you/work/projects');
    fireEvent.click(screen.getByRole('button', { name: /选择源项目根目录/ }));

    await waitFor(() => expect(sourceInput.value).toBe('/picked/source'));
    expect(mockApi.selectDirectory).toHaveBeenCalledWith({ defaultPath: '/src' });
  });

  it('取消目录选择时保留原路径', async () => {
    mockApi.selectDirectory.mockResolvedValueOnce({ canceled: true });
    renderWithApp(<SettingsModal open config={makeConfig()} onClose={() => {}} onSaved={() => {}} />);

    // worktreeInput 存储 Worktree 根目录输入框，取消选择后应保持配置原值。
    const worktreeInput = screen.getByPlaceholderText('/Users/you/work/worktrees');
    fireEvent.click(screen.getByRole('button', { name: /选择 Worktree 根目录/ }));

    await waitFor(() => expect(mockApi.selectDirectory).toHaveBeenCalledWith({ defaultPath: '/wt' }));
    expect(worktreeInput.value).toBe('/wt');
  });

  it('确认恢复默认设置后调用 resetConfig 并用返回配置刷新外层状态', async () => {
    // defaultConfig 存储模拟主进程返回的默认配置。
    const defaultConfig = { ...makeConfig(), sourceProjectsPath: '/default/source', worktreesPath: '/default/worktrees' };
    // onSaved 存储保存成功回调，用于验证设置页把默认配置同步给外层状态。
    const onSaved = vi.fn();
    // onClose 存储关闭回调，用于验证恢复默认后关闭抽屉。
    const onClose = vi.fn();
    mockApi.resetConfig.mockResolvedValueOnce(defaultConfig);
    renderWithApp(<SettingsModal open config={makeConfig()} onClose={onClose} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole('button', { name: /恢复默认设置/ }));

    await waitFor(() => {
      // confirmTitles 存储 AntD 确认框渲染出的标题节点；confirm 会同时生成可访问标题和展示标题。
      const confirmTitles = screen.getAllByText('确认恢复默认设置？');
      expect(confirmTitles.length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole('button', { name: /确认恢复/ }));

    await waitFor(() => expect(mockApi.resetConfig).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledWith(defaultConfig);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('工作文档 Tab 可编辑文件模板并保存 workDocumentTemplates', async () => {
    mockApi.saveConfig.mockResolvedValueOnce(makeConfig());
    renderWithApp(<SettingsModal open config={makeConfig()} onClose={() => {}} onSaved={() => {}} />);

    // 打开工作文档 Tab，确认默认目录和文件模板都展示为紧凑项。
    fireEvent.click(screen.getByText('工作文档'));
    await waitFor(() => {
      expect(screen.getByTestId('work-document-row-1')).toBeTruthy();
    });

    expect(within(screen.getByTestId('work-document-row-0')).getByText('docs')).toBeTruthy();
    expect(within(screen.getByTestId('work-document-row-0')).getByText('目录')).toBeTruthy();
    expect(within(screen.getByTestId('work-document-row-1')).getByText('.ai/summary.md')).toBeTruthy();
    expect(within(screen.getByTestId('work-document-row-1')).getByText('文件')).toBeTruthy();

    fireEvent.click(screen.getByTestId('work-document-row-1'));

    // dialog 为工作文档详情弹层，文件类型可编辑路径和内容。
    const dialog = screen.getByText('编辑工作文档').closest('[role="dialog"]');
    const pathInput = within(dialog).getByPlaceholderText('相对路径，如 docs 或 .ai/summary.md');
    const contentTextarea = within(dialog).getByPlaceholderText('文件默认内容');
    fireEvent.change(pathInput, { target: { value: '.ai/report.md' } });
    fireEvent.change(contentTextarea, { target: { value: '# Report\n' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /完\s*成/ }));
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => expect(mockApi.saveConfig).toHaveBeenCalledTimes(1));
    // savedConfig 存储提交给主进程的设置对象，必须包含工作文档模板数组。
    const savedConfig = mockApi.saveConfig.mock.calls[0][0];
    expect(savedConfig.workDocumentTemplates).toEqual([
      { type: 'directory', path: 'docs', content: '' },
      { type: 'file', path: '.ai/report.md', content: '# Report\n' },
    ]);
  });

  it('工作文档 Tab 可新增目录模板', async () => {
    mockApi.saveConfig.mockResolvedValueOnce(makeConfig());
    renderWithApp(<SettingsModal open config={makeConfig()} onClose={() => {}} onSaved={() => {}} />);

    fireEvent.click(screen.getByText('工作文档'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /添加工作文档/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /添加工作文档/ }));

    await waitFor(() => {
      expect(screen.getByText('编辑工作文档')).toBeTruthy();
    });

    // dialog 为新增模板详情弹层，默认新增目录类型，用户填写路径后保存。
    const dialog = screen.getByText('编辑工作文档').closest('[role="dialog"]');
    fireEvent.change(within(dialog).getByPlaceholderText('相对路径，如 docs 或 .ai/summary.md'), { target: { value: 'records' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /完\s*成/ }));
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => expect(mockApi.saveConfig).toHaveBeenCalledTimes(1));
    // savedConfig 存储提交给主进程的设置对象，应包含新增的目录模板。
    const savedConfig = mockApi.saveConfig.mock.calls[0][0];
    expect(savedConfig.workDocumentTemplates).toContainEqual({ type: 'directory', path: 'records', content: '' });
  });

  it('CI/CD Tab 在项目列表尚未加载时会补扫并展示项目下拉选项', async () => {
    // projects 存储主进程扫描到的源项目列表，用于验证设置页能在项目视图未加载时补齐下拉选项。
    const projects = [
      { name: 'web-app', path: '/src/web-app' },
      { name: 'api-service', path: '/src/api-service' },
    ];
    mockApi.scanProjects.mockResolvedValueOnce(projects);
    renderWithApp(<SettingsModal open config={makeConfig()} onClose={() => {}} onSaved={() => {}} />);

    fireEvent.click(screen.getByText('CI/CD'));

    await waitFor(() => expect(mockApi.scanProjects).toHaveBeenCalledTimes(1));
    expect(mockApi.scanProjects).toHaveBeenCalledWith({ fetch: false });
    fireEvent.click(screen.getByRole('button', { name: /添加项目 CI\/CD 地址/ }));

    // select 存储 CI/CD 行内项目选择框，打开后应出现扫描得到的项目名。
    const select = screen.getByText('选择项目').closest('.ant-select');
    fireEvent.mouseDown(select.querySelector('.ant-select-selector'));

    await waitFor(() => {
      expect(screen.getAllByText('web-app').length).toBeGreaterThan(0);
      expect(screen.getAllByText('api-service').length).toBeGreaterThan(0);
    });
  });
});
