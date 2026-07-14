import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import ProjectTable from '../../src/ui/components/ProjectTable.tsx'

// ProjectTable 组件测试：验证项目 Tab 的隐藏/置顶操作接线与隐藏项展示标识。

afterEach(() => cleanup())

/**
 * 构造项目表格测试数据。
 * @returns {Array<object>} 项目列表
 */
function makeProjects() {
  return [
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
      isMainBranch: false,
      hasUncommittedChanges: true,
      hasUnpushedCommits: false,
      canPull: false,
      ahead: 0,
      behind: 0,
    },
  ]
}

/**
 * 组装 ProjectTable 所需的基础属性。
 * @param {object} overrides - 覆盖属性
 * @returns {object} 组件属性
 */
function baseProps(overrides = {}) {
  // noop 存储默认空回调，避免组件调用未定义函数。
  const noop = () => {}
  return {
    data: makeProjects(),
    loading: false,
    selectedPaths: [],
    onSelectChange: noop,
    onDetail: noop,
    onCheckoutMain: noop,
    onPull: noop,
    onSyncUpdates: noop,
    onOpenFinder: noop,
    onOpenVscode: noop,
    onOpenTerminal: noop,
    onCopyPath: noop,
    ...overrides,
  }
}

describe('ProjectTable visibility actions', () => {
  it('在拉取按钮后展示同步更新按钮并回调当前项目', () => {
    // onSyncUpdates 存储同步更新点击回调，用于验证按钮接线与项目参数。
    const onSyncUpdates = vi.fn()
    render(
      <ProjectTable
        {...baseProps({
          data: [{ ...makeProjects()[0], canPull: true }],
          onSyncUpdates,
        })}
      />
    )

    // syncButton 存储右侧固定操作列内的同步更新按钮；antd 固定列会生成表格行副本，因此由按钮反查目标行。
    const syncButton = screen.getByRole('button', { name: '同步更新' })
    // pullButton 存储拉取按钮，用 DOM 顺序校验同步更新紧随其后；固定列副本不会影响两个按钮的相对位置。
    const pullButton = screen.getByRole('button', { name: /拉\s*取/ })
    expect(
      pullButton.compareDocumentPosition(syncButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    fireEvent.click(syncButton)
    expect(onSyncUpdates).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/repo/alpha' })
    )
  })

  it('渲染隐藏和置顶项目按钮，点击时回调项目路径与目标状态', () => {
    // onProjectHiddenChange / onProjectPinnedChange 间谍，验证表格行按钮接线。
    const onProjectHiddenChange = vi.fn()
    const onProjectPinnedChange = vi.fn()
    render(
      <ProjectTable
        {...baseProps({ onProjectHiddenChange, onProjectPinnedChange })}
      />
    )

    // hideButton 存储可见项目的隐藏按钮；图标表达当前状态，所以可见项目应显示普通眼睛。
    const hideButton = screen.getByLabelText('隐藏项目 alpha')
    expect(hideButton.querySelector('.anticon-eye')).toBeTruthy()
    expect(hideButton.querySelector('.anticon-eye-invisible')).toBeNull()
    fireEvent.click(hideButton)
    fireEvent.click(screen.getByLabelText('置顶项目 alpha'))

    expect(onProjectHiddenChange).toHaveBeenCalledWith('/repo/alpha', true)
    expect(onProjectPinnedChange).toHaveBeenCalledWith('/repo/alpha', true)
  })

  it('隐藏项目在显示隐藏项模式下展示已隐藏标识和恢复按钮', () => {
    // onProjectHiddenChange 间谍，验证恢复显示按钮会写回 false。
    const onProjectHiddenChange = vi.fn()
    render(
      <ProjectTable
        {...baseProps({
          hiddenProjectKeys: ['/repo/alpha'],
          showHiddenProjects: true,
          onProjectHiddenChange,
        })}
      />
    )

    // row 存储 alpha 所在行，避免 beta 行影响断言。
    const row = screen.getByText('alpha').closest('tr')
    expect(within(row).getByText('已隐藏')).toBeTruthy()

    // restoreButton 存储已隐藏项目的恢复按钮；图标表达当前状态，所以隐藏项目应显示斜杠眼睛。
    const restoreButton = screen.getByLabelText('恢复显示项目 alpha')
    expect(restoreButton.querySelector('.anticon-eye-invisible')).toBeTruthy()
    fireEvent.click(restoreButton)

    expect(onProjectHiddenChange).toHaveBeenCalledWith('/repo/alpha', false)
  })

  it('正在隐藏的项目行带退出动画 class', () => {
    const { container } = render(
      <ProjectTable
        {...baseProps({
          hidingProjectKeys: ['/repo/alpha'],
        })}
      />
    )

    // row 存储 alpha 所在行，用于断言退出动画态只落在目标项目上。
    const row = screen.getByText('alpha').closest('tr')
    expect(row.className).toContain('project-row-hiding')
    expect(container.querySelectorAll('.project-row-hiding').length).toBe(1)
  })

  it('项目名和分支使用单行 Tooltip 文本，避免长内容撑高表格行', () => {
    // longBranch 存储较长分支名，用于验证表格单元格不会换行撑高。
    const longBranch =
      'feature/PROJ-1001-关联物料费用金额非必填-with-extra-suffix'
    render(
      <ProjectTable
        {...baseProps({
          data: [
            {
              ...makeProjects()[0],
              name: 'hybrid-mobile-super-long-name',
              currentBranch: longBranch,
            },
          ],
        })}
      />
    )

    // clippedTexts 存储项目表格中启用单行省略的文本节点。
    const clippedTexts = document.querySelectorAll(
      '.ant-table-row .single-line-tooltip-text'
    )
    expect([...clippedTexts].map((node) => node.textContent)).toEqual(
      expect.arrayContaining(['hybrid-mobile-super-long-name', longBranch])
    )
  })

  it('GitLab 图标紧跟 VSCode 后面，点击打开项目 GitLab', () => {
    // gitlabUrl 存储 alpha 项目的 GitLab 网页地址。
    const gitlabUrl = 'https://gitlab.example.com/team/alpha'
    // onOpenUrl 间谍，验证项目 Tab 的 GitLab 按钮打开项目仓库地址。
    const onOpenUrl = vi.fn()
    // container 存储渲染后的 DOM 根节点，用于限定到项目行检查按钮顺序。
    const { container } = render(
      <ProjectTable
        {...baseProps({
          data: [{ ...makeProjects()[0], gitlabUrl }],
          onOpenUrl,
        })}
      />
    )
    // row 存储 alpha 所在表格行。
    const row = screen.getByText('alpha').closest('tr')
    // buttons 存储该行全部操作按钮，便于断言 GitLab 紧跟 VSCode。
    const buttons = [...row.querySelectorAll('button')]
    // vscodeButtonIndex 存储项目行 VSCode 按钮位置。
    const vscodeButtonIndex = buttons.findIndex((button) =>
      button.querySelector('.anticon-vscode')
    )
    // gitlabButtonIndex 存储项目行 GitLab 按钮位置。
    const gitlabButtonIndex = buttons.findIndex((button) =>
      button.querySelector('.anticon-gitlab')
    )

    expect(container.querySelector('.ant-table')).toBeTruthy()
    expect(gitlabButtonIndex).toBe(vscodeButtonIndex + 1)
    fireEvent.click(buttons[gitlabButtonIndex])
    expect(onOpenUrl).toHaveBeenCalledWith(gitlabUrl)
  })
})
