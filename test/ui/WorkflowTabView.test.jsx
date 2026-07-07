import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { App as AntApp } from 'antd';
import WorkflowTabView from '../../src/ui/components/WorkflowTabView.jsx';

// WorkflowTabView 组件测试：跑在 happy-dom 环境。
// 验证工作流列表渲染、新建弹窗、选中后运行区出现、idea 输入可用。
// 组件用 AntApp.useApp() 取 message/modal，故 render 时需用 antd <App> 包裹提供上下文。

// renderWithApp 用 antd App 包裹组件渲染，提供 message/modal 上下文
function renderWithApp(ui) {
  return render(<AntApp>{ui}</AntApp>);
}

// mockWorkflows 两条工作流定义，模拟 api.loadIdeaWorkflows 返回
const mockWorkflows = [
  { id: 'wf-1', name: '快速实现', description: '快速落地', steps: [{ key: 's1', label: '建分支', command: 'git checkout -b x' }] },
  { id: 'wf-2', name: '完整流程', description: '完整研发', steps: [{ key: 's1', label: '建分支', command: 'git checkout -b x' }, { key: 's2', label: '测试', command: 'npm test' }] },
];

// 每个用例前重置 window.api 为受控 mock
beforeEach(() => {
  window.api = {
    loadIdeaWorkflows: vi.fn().mockResolvedValue(mockWorkflows),
    loadIdeaRuns: vi.fn().mockResolvedValue([]),
    saveIdeaWorkflows: vi.fn().mockResolvedValue(true),
    appendIdeaRun: vi.fn().mockResolvedValue(true),
    runWorkflowStep: vi.fn().mockResolvedValue({ success: true, code: 0, stdout: 'ok', stderr: '' }),
    onStepOutput: vi.fn().mockReturnValue(() => {}),
  };
});

afterEach(() => { cleanup(); delete window.api; });

describe('WorkflowTabView', () => {
  it('渲染时显示「新建工作流」按钮', async () => {
    renderWithApp(<WorkflowTabView />);
    expect(screen.getByText(/新建工作流/)).toBeTruthy();
  });

  it('加载并渲染工作流列表（2 条）', async () => {
    renderWithApp(<WorkflowTabView />);
    // 等待异步加载完成后两条工作流名出现
    await waitFor(() => {
      expect(screen.getByText('快速实现')).toBeTruthy();
      expect(screen.getByText('完整流程')).toBeTruthy();
    });
  });

  it('点「新建工作流」弹出编辑弹窗', async () => {
    renderWithApp(<WorkflowTabView />);
    // 按钮文案含「新建工作流」，点击后出现弹窗标题「新建工作流」与名称输入
    fireEvent.click(screen.getByText(/新建工作流/));
    await waitFor(() => {
      expect(screen.getByText('工作流名称')).toBeTruthy();
    });
  });

  it('选中工作流后右侧出现运行按钮', async () => {
    renderWithApp(<WorkflowTabView />);
    await waitFor(() => expect(screen.getByText('快速实现')).toBeTruthy());
    // 点击列表中的工作流名选中它
    fireEvent.click(screen.getByText('快速实现'));
    // 选中后运行按钮文案含工作流名
    await waitFor(() => {
      expect(screen.getByText(/运行「快速实现」/)).toBeTruthy();
    });
  });

  it('idea 输入框可输入文字', async () => {
    renderWithApp(<WorkflowTabView />);
    // textarea 通过 placeholder 定位
    const textarea = screen.getByPlaceholderText(/输入你的想法/);
    fireEvent.change(textarea, { target: { value: '加个搜索框' } });
    expect(textarea.value).toBe('加个搜索框');
  });
});
