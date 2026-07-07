import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App as AntApp } from 'antd';
import CleanupSuggestionsModal from '../../src/ui/components/CleanupSuggestionsModal.jsx';

// CleanupSuggestionsModal 组件测试：验证清理建议的安全删除与长文本单行展示。

/**
 * 构造清理建议弹窗测试用 worktree 项。
 * @param {object} overrides - 覆盖字段
 * @returns {object} worktree 清理建议项
 */
function makeSuggestion(overrides = {}) {
  // baseSuggestion 存储一条已合并且无改动的默认清理建议。
  const baseSuggestion = {
    taskName: 'PROJ-1001-关联物料费用金额非必填',
    projectName: 'hybrid-mobile',
    projectPath: '/src/hybrid-mobile',
    path: '/wt/PROJ-1001-关联物料费用金额非必填/hybrid-mobile',
    branch: 'bob/feature/PROJ-1001-关联物料费用金额非必填',
    sizeBytes: 1048576,
    lastModified: Date.UTC(2026, 6, 6, 7, 36),
  };
  return { ...baseSuggestion, ...overrides };
}

/**
 * 渲染带 antd App 上下文的清理建议弹窗。
 * @param {object} props - 组件属性覆盖
 * @returns {ReturnType<typeof render>} 渲染结果
 */
function renderModal(props = {}) {
  return render(
    <AntApp>
      <CleanupSuggestionsModal open onClose={() => {}} onDeleted={() => {}} {...props} />
    </AntApp>,
  );
}

describe('CleanupSuggestionsModal', () => {
  beforeEach(() => {
    // window.api 存储 Electron preload 暴露给弹窗的 API，本组用例用 mock 控制扫描和删除结果。
    window.api = {
      getSafeToRemoveWorktrees: vi.fn(),
      removeWorktree: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete window.api;
  });

  it('删除前重新扫描，候选项已消失时不继续强制删除', async () => {
    // suggestion 存储第一次扫描返回的可清理 worktree；第二次扫描返回空表示删除前已不再安全。
    const suggestion = makeSuggestion();
    window.api.getSafeToRemoveWorktrees
      .mockResolvedValueOnce([suggestion])
      .mockResolvedValueOnce([]);
    window.api.removeWorktree.mockResolvedValue({ success: true });

    renderModal();
    await screen.findByText(suggestion.taskName);
    fireEvent.click(document.querySelector('.ant-table-row .ant-checkbox-input'));
    fireEvent.click(screen.getByText('删除选中'));
    fireEvent.click(await screen.findByText('确定删除'));

    await waitFor(() => expect(window.api.getSafeToRemoveWorktrees).toHaveBeenCalledTimes(2));
    expect(window.api.removeWorktree).not.toHaveBeenCalled();
  });

  it('任务名、项目名和分支使用单行 Tooltip 文本，避免表格行被撑高', async () => {
    // suggestion 存储包含长任务名/项目名/分支名的数据，用于验证单行省略组件被应用到对应列。
    const suggestion = makeSuggestion();
    window.api.getSafeToRemoveWorktrees.mockResolvedValue([suggestion]);

    renderModal();
    await screen.findByText(suggestion.taskName);

    // clippedTexts 存储表格内用于单行省略的文本节点；三列都应使用统一 class。
    const clippedTexts = document.querySelectorAll('.ant-table-row .single-line-tooltip-text');
    expect(clippedTexts.length).toBeGreaterThanOrEqual(3);
    expect([...clippedTexts].map((node) => node.textContent)).toEqual(
      expect.arrayContaining([suggestion.taskName, suggestion.projectName, suggestion.branch]),
    );
  });

  it('在标题旁说明清理建议的统计口径', async () => {
    window.api.getSafeToRemoveWorktrees.mockResolvedValue([]);

    renderModal();
    await waitFor(() => expect(window.api.getSafeToRemoveWorktrees).toHaveBeenCalledTimes(1));

    expect(screen.getByText('Worktree 清理建议')).toBeTruthy();
    expect(screen.getByText('当前扫描结果：仅统计已合并到主分支且无未提交改动的 worktree，删除前会重新检查。')).toBeTruthy();
  });
});
