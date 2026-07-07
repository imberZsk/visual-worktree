import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import CreateWorktreeModal from '../../src/ui/components/CreateWorktreeModal.jsx';
import { TASK_LINK_NAME_PLACEHOLDER, TASK_LINK_PLACEHOLDER } from '../../src/ui/components/TaskLinksEditor.jsx';

// CreateWorktreeModal 表单校验测试（happy-dom 环境）：
// 该弹窗是功能「新建后只展开对应任务栏」的入口，提交的 task 值决定展开哪个面板，
// 故守住「必填校验拦截非法提交」「合法时回调拿到正确值」「路径预览」等表单契约。

afterEach(() => cleanup());

// PROJECTS 测试用源项目列表，含一个非 git 项用于验证被过滤
const PROJECTS = [
  { name: 'projA', path: '/src/projA', isGitRepo: true },
  { name: 'projB', path: '/src/projB', isGitRepo: true },
  { name: 'notGit', path: '/src/notGit', isGitRepo: false },
];

// baseProps 组装弹窗 props，open 默认 true 便于直接操作表单
function baseProps(overrides = {}) {
  return {
    open: true,
    projects: PROJECTS,
    worktreesPath: '/wt',
    onSubmit: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
    ...overrides,
  };
}

// getOkButton 取 Modal 底部「创建」确认按钮。
// 注意 antd 对恰好两个中文字的按钮会自动插入空格（渲染为「创 建」），故不能按精确文本匹配，
// 改用 Modal footer 里的 primary 按钮定位（确认按钮固定为 primary 样式）。
function getOkButton() {
  return document.querySelector('.ant-modal-footer .ant-btn-primary');
}

describe('CreateWorktreeModal 表单校验', () => {
  it('必填项为空时点击创建：阻止提交且不调用 onSubmit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CreateWorktreeModal {...baseProps({ onSubmit })} />);
    // 直接点创建，触发 validateFields 失败
    fireEvent.click(getOkButton());
    // 应出现必填校验错误提示
    await waitFor(() => {
      expect(screen.getByText('请输入任务名')).toBeTruthy();
      expect(screen.getByText('请输入分支名')).toBeTruthy();
    });
    // 校验未通过，onSubmit 不应被调用
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('仅填任务名且不选项目时允许提交，并自动带上同名分支', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CreateWorktreeModal {...baseProps({ onSubmit })} />);
    fireEvent.change(screen.getByPlaceholderText('PROJ-1234-需求简述'), { target: { value: 'TASK-X' } });
    fireEvent.click(getOkButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      task: 'TASK-X',
      branch: 'TASK-X',
    }));
    expect(onSubmit.mock.calls[0][0].projectPaths || []).toEqual([]);
    expect(onSubmit.mock.calls[0][0].links || []).toEqual([]);
  });

  it('默认一个需求链接行，可按需增加后提交多条带名称链接', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CreateWorktreeModal {...baseProps({ onSubmit })} />);

    fireEvent.change(screen.getByPlaceholderText('PROJ-1234-需求简述'), { target: { value: 'TASK-LINKS' } });
    // firstNameInput 存储默认展示的第一条链接名称输入框。
    const firstNameInput = screen.getByPlaceholderText(TASK_LINK_NAME_PLACEHOLDER);
    fireEvent.change(firstNameInput, { target: { value: 'Jira' } });
    // firstLinkInput 存储默认展示的第一条链接地址输入框。
    const firstLinkInput = screen.getByPlaceholderText(TASK_LINK_PLACEHOLDER);
    expect(screen.getAllByPlaceholderText(TASK_LINK_PLACEHOLDER).length).toBe(1);
    fireEvent.change(firstLinkInput, { target: { value: 'https://jira.example.com/TASK-LINKS' } });

    fireEvent.click(screen.getByText('添加链接'));
    // nameInputs 存储点击添加后的所有链接名称输入框。
    const nameInputs = screen.getAllByPlaceholderText(TASK_LINK_NAME_PLACEHOLDER);
    expect(nameInputs.length).toBe(2);
    fireEvent.change(nameInputs[1], { target: { value: '需求文档' } });
    // linkInputs 存储点击添加后的所有需求链接输入框。
    const linkInputs = screen.getAllByPlaceholderText(TASK_LINK_PLACEHOLDER);
    expect(linkInputs.length).toBe(2);
    fireEvent.change(linkInputs[1], { target: { value: 'https://larksuite.example.com/docx/abc' } });
    fireEvent.click(getOkButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].links).toEqual([
      { name: 'Jira', url: 'https://jira.example.com/TASK-LINKS' },
      { name: '需求文档', url: 'https://larksuite.example.com/docx/abc' },
    ]);
  });

  it('需求链接使用普通单行输入，不渲染成可搜索下拉或文本域', () => {
    render(<CreateWorktreeModal {...baseProps()} />);

    // nameInput 存储需求链接名称输入控件；默认是普通 input，用户可选择不填。
    const nameInput = screen.getByPlaceholderText(TASK_LINK_NAME_PLACEHOLDER);
    expect(nameInput.tagName.toLowerCase()).toBe('input');
    // linkInput 存储需求链接地址输入控件；默认是一个普通 input，用户可选择不填或继续添加。
    const linkInput = screen.getByPlaceholderText(TASK_LINK_PLACEHOLDER);
    expect(linkInput.tagName.toLowerCase()).toBe('input');
    // 项目选择仍保留唯一的 combobox，需求链接不再额外增加下拉输入。
    expect(screen.getAllByRole('combobox').length).toBe(1);
  });

  it('需求链接地址输入框使用 flex 占满紧凑行剩余宽度', () => {
    render(<CreateWorktreeModal {...baseProps()} />);

    // linkInput 存储需求链接地址输入控件，用于检查其宽度策略。
    const linkInput = screen.getByPlaceholderText(TASK_LINK_PLACEHOLDER);
    // compactRow 存储名称、地址与删除按钮所在的同一紧凑输入行。
    const compactRow = linkInput.closest('.ant-space-compact');

    expect(compactRow?.style.width).toBe('100%');
    expect(linkInput.style.flex).toBe('1 1 0%');
    expect(linkInput.style.minWidth).toBe('0');
  });

  it('填入任务名后展示路径预览 Alert', async () => {
    render(<CreateWorktreeModal {...baseProps()} />);
    // 初始无预览
    expect(screen.queryByText('将创建到')).toBeNull();
    // 输入任务名后应出现预览，含 worktreesPath 与任务名拼接路径
    fireEvent.change(screen.getByPlaceholderText('PROJ-1234-需求简述'), { target: { value: 'TASK-X' } });
    await waitFor(() => {
      expect(screen.getByText('将创建到')).toBeTruthy();
      // 未选择项目时预览描述应落到任务目录本身
      expect(screen.getByText(/\/wt\/TASK-X/)).toBeTruthy();
      expect(screen.getByText(/暂不创建项目 worktree/)).toBeTruthy();
    });
  });

  it('不再有 newBranch 复选框（已移除，改为自动检测分支）', () => {
    render(<CreateWorktreeModal {...baseProps()} />);
    // 复选框已移除，页面中不应存在任何 checkbox
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('非 git 项目不出现在可选项中', () => {
    render(<CreateWorktreeModal {...baseProps()} />);
    // 打开项目下拉
    const combo = screen.getAllByRole('combobox')[0];
    fireEvent.mouseDown(combo);
    // projA/projB 可选，notGit 被过滤
    expect(screen.getByTitle('projA')).toBeTruthy();
    expect(screen.getByTitle('projB')).toBeTruthy();
    expect(screen.queryByTitle('notGit')).toBeNull();
  });
});
