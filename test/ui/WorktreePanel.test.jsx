import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
  waitFor,
} from '@testing-library/react'
import WorktreePanel from '../../src/ui/components/WorktreePanel.tsx'
import {
  TASK_LINK_NAME_PLACEHOLDER,
  TASK_LINK_PLACEHOLDER,
} from '../../src/ui/components/TaskLinksEditor.tsx'

// WorktreePanel 组件测试：跑在 happy-dom 环境（见 vitest.config.js environmentMatchGlobs）。
// 重点验证「新建后只展开对应任务栏」的受控展开行为，以及终端/复制路径新按钮的接线。

// 每个用例后清理 DOM，避免多次 render 互相干扰
afterEach(() => cleanup())

// makeTasks 构造两个任务的测试数据，每任务含一个正常 worktree
function makeTasks() {
  return [
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
      task: 'TASK-B',
      path: '/wt/TASK-B',
      worktrees: [
        {
          project: 'projB',
          projectPath: '/src/projB',
          path: '/wt/TASK-B/projB',
          branch: 'feat-b',
          prunable: false,
          missing: false,
          hasUncommittedChanges: false,
          ahead: 0,
          behind: 0,
        },
      ],
    },
  ]
}

// noop 占位回调，避免未传 handler 报错
const noop = () => {}

// baseProps 组装组件所需的全部回调，单测里按需覆盖
function baseProps(overrides = {}) {
  return {
    tasks: makeTasks(),
    loading: false,
    activeKeys: undefined,
    onActiveKeysChange: noop,
    onOpenFinder: noop,
    onOpenVscode: noop,
    onOpenTerminal: noop,
    onCopyPath: noop,
    onRemove: noop,
    onRemoveTask: noop,
    onPrune: noop,
    // 默认提供零会话预加载数据，避免与 Claude 请求无关的同步用例在结束后残留异步状态更新。
    claudeUsageMap: {
      'TASK-A': { sessionCount: 0, usage: {}, cost: {} },
      'TASK-B': { sessionCount: 0, usage: {}, cost: {} },
    },
    // 大多数 WorktreePanel 用例不验证 Claude 请求，默认关闭徽标以避免动态任务名触发无关异步加载。
    taskTitleBadges: { claudeUsage: false },
    ...overrides,
  }
}

describe('WorktreePanel 受控展开', () => {
  it('activeKeys 为 undefined 时回退为全部收起（无面板处于 active）', () => {
    const { container } = render(
      <WorktreePanel {...baseProps({ activeKeys: undefined })} />
    )
    // 新行为：默认全部收起，active 面板数应为 0
    const active = container.querySelectorAll('.ant-collapse-item-active')
    expect(active.length).toBe(0)
  })

  it('activeKeys=[TASK-A] 时只展开 TASK-A 面板', () => {
    const { container } = render(
      <WorktreePanel {...baseProps({ activeKeys: ['TASK-A'] })} />
    )
    // active 为展开态面板，受控后应只剩一个
    const active = container.querySelectorAll('.ant-collapse-item-active')
    expect(active.length).toBe(1)
    // 该展开面板的标题应包含 TASK-A
    expect(active[0].textContent).toContain('TASK-A')
  })

  it('activeKeys=[] 时全部收起', () => {
    const { container } = render(
      <WorktreePanel {...baseProps({ activeKeys: [] })} />
    )
    expect(container.querySelectorAll('.ant-collapse-item-active').length).toBe(
      0
    )
  })

  it('用户手动展开/收起会通过 onActiveKeysChange 写回', () => {
    // onChange 间谍函数，捕获用户点击面板头触发的回调
    const onChange = vi.fn()
    render(
      <WorktreePanel
        {...baseProps({ activeKeys: ['TASK-A'], onActiveKeysChange: onChange })}
      />
    )
    // 点击 TASK-B 的面板头，应触发受控变更回调
    fireEvent.click(screen.getByText('TASK-B'))
    expect(onChange).toHaveBeenCalled()
  })
})

describe('WorktreePanel 终端与复制路径按钮', () => {
  it('任务级渲染复制路径与终端图标按钮，点击各自回调并传任务目录路径', () => {
    // onCopyPath / onOpenTerminal 间谍，验证传入路径
    const onCopyPath = vi.fn()
    const onOpenTerminal = vi.fn()
    const { container } = render(
      <WorktreePanel
        {...baseProps({ activeKeys: ['TASK-A'], onCopyPath, onOpenTerminal })}
      />
    )
    // 任务级按钮已改为纯图标，定位到 extra 区域（面板头右侧）的复制/终端图标按钮
    const extraArea = container.querySelector(
      '.ant-collapse-item-active .ant-collapse-extra'
    )
    const copyBtn = extraArea.querySelector('button .anticon-copy')
    const termBtn = extraArea.querySelector('button .anticon-console-sql')
    expect(copyBtn).toBeTruthy()
    expect(termBtn).toBeTruthy()
    fireEvent.click(copyBtn.closest('button'))
    expect(onCopyPath).toHaveBeenCalledWith('/wt/TASK-A')
    fireEvent.click(termBtn.closest('button'))
    expect(onOpenTerminal).toHaveBeenCalledWith('/wt/TASK-A')
  })

  it('任务级渲染 VSCode 打开图标按钮，点击回调并传任务目录路径', () => {
    // onOpenVscode 间谍，验证传入路径
    const onOpenVscode = vi.fn()
    const { container } = render(
      <WorktreePanel {...baseProps({ activeKeys: ['TASK-A'], onOpenVscode })} />
    )
    // 定位到 extra 区域的 VSCode 图标按钮
    const extraArea = container.querySelector(
      '.ant-collapse-item-active .ant-collapse-extra'
    )
    const vscodeBtn = extraArea.querySelector('button .anticon-vscode')
    expect(vscodeBtn).toBeTruthy()
    fireEvent.click(vscodeBtn.closest('button'))
    expect(onOpenVscode).toHaveBeenCalledWith('/wt/TASK-A')
  })

  it('任务级 GitLab 图标紧跟 VSCode 后面，单项目时点击打开该项目 GitLab', () => {
    // gitlabUrl 存储 TASK-A 下 projA 对应的 GitLab 网页地址。
    const gitlabUrl = 'https://gitlab.example.com/team/projA'
    // onOpenUrl 间谍，验证任务级 GitLab 按钮打开的是项目仓库地址。
    const onOpenUrl = vi.fn()
    // tasks 存储带 GitLab 地址的单项目任务，避免多项目下拉影响直开断言。
    const tasks = [
      {
        task: 'TASK-A',
        path: '/wt/TASK-A',
        worktrees: [
          {
            project: 'projA',
            projectPath: '/src/projA',
            path: '/wt/TASK-A/projA',
            branch: 'feat-a',
            gitlabUrl,
            prunable: false,
            missing: false,
            hasUncommittedChanges: false,
            ahead: 0,
            behind: 0,
          },
        ],
      },
    ]
    // container 存储渲染后的 DOM 根节点，用于检查任务头 extra 区域的按钮顺序。
    const { container } = render(
      <WorktreePanel
        {...baseProps({ activeKeys: ['TASK-A'], tasks, onOpenUrl })}
      />
    )
    // extraArea 存储任务头右侧操作区，GitLab 图标应插在 VSCode 后面。
    const extraArea = container.querySelector(
      '.ant-collapse-item-active .ant-collapse-extra'
    )
    // buttons 存储任务级全部图标按钮，便于用下标断言相邻顺序。
    const buttons = [...extraArea.querySelectorAll('button')]
    // vscodeButtonIndex 存储 VSCode 按钮在任务级按钮列表中的位置。
    const vscodeButtonIndex = buttons.findIndex((button) =>
      button.querySelector('.anticon-vscode')
    )
    // gitlabButtonIndex 存储 GitLab 按钮在任务级按钮列表中的位置。
    const gitlabButtonIndex = buttons.findIndex((button) =>
      button.querySelector('.anticon-gitlab')
    )

    expect(gitlabButtonIndex).toBe(vscodeButtonIndex + 1)
    fireEvent.click(buttons[gitlabButtonIndex])
    expect(onOpenUrl).toHaveBeenCalledWith(gitlabUrl)
  })

  it('worktree 级（展开后）渲染 Finder/VSCode 图标按钮，点击传 worktree 路径', () => {
    // onOpenFinder 间谍捕获 worktree 行的 Finder 点击路径
    const onOpenFinder = vi.fn()
    // onOpenVscode 间谍捕获 worktree 行的 VSCode 点击路径
    const onOpenVscode = vi.fn()
    // container 存储渲染后的 DOM 根节点，用于限定查询展开内容区
    const { container } = render(
      <WorktreePanel
        {...baseProps({ activeKeys: ['TASK-A'], onOpenFinder, onOpenVscode })}
      />
    )
    // content 存储展开面板内容区，避免误选面板头部的任务级按钮
    const content = container.querySelector('.ant-collapse-body')
    // finderBtn 存储 worktree 行的 Finder 图标按钮
    const finderBtn = content.querySelector('button .anticon-folder-open')
    // vscodeBtn 存储 worktree 行的 VSCode 图标按钮
    const vscodeBtn = content.querySelector('button .anticon-vscode')
    expect(finderBtn).toBeTruthy()
    expect(vscodeBtn).toBeTruthy()
    fireEvent.click(finderBtn.closest('button'))
    expect(onOpenFinder).toHaveBeenCalledWith('/wt/TASK-A/projA')
    fireEvent.click(vscodeBtn.closest('button'))
    expect(onOpenVscode).toHaveBeenCalledWith('/wt/TASK-A/projA')
  })

  it('worktree 级 GitLab 图标紧跟 VSCode 后面，点击打开该项目 GitLab', () => {
    // gitlabUrl 存储 projA 对应的 GitLab 网页地址。
    const gitlabUrl = 'https://gitlab.example.com/team/projA'
    // onOpenUrl 间谍，验证项目行 GitLab 按钮打开项目仓库地址。
    const onOpenUrl = vi.fn()
    // tasks 存储带 GitLab 地址的展开任务数据。
    const tasks = [
      {
        task: 'TASK-A',
        path: '/wt/TASK-A',
        worktrees: [
          {
            project: 'projA',
            projectPath: '/src/projA',
            path: '/wt/TASK-A/projA',
            branch: 'feat-a',
            gitlabUrl,
            prunable: false,
            missing: false,
            hasUncommittedChanges: false,
            ahead: 0,
            behind: 0,
          },
        ],
      },
    ]
    // container 存储渲染后的 DOM 根节点，用于限定到展开内容区检查项目行按钮。
    const { container } = render(
      <WorktreePanel
        {...baseProps({ activeKeys: ['TASK-A'], tasks, onOpenUrl })}
      />
    )
    // content 存储展开面板内容区，排除任务级按钮对顺序断言的干扰。
    const content = container.querySelector('.ant-collapse-body')
    // buttons 存储项目行全部图标按钮，便于验证 GitLab 紧跟 VSCode。
    const buttons = [...content.querySelectorAll('button')]
    // vscodeButtonIndex 存储项目行 VSCode 按钮位置。
    const vscodeButtonIndex = buttons.findIndex((button) =>
      button.querySelector('.anticon-vscode')
    )
    // gitlabButtonIndex 存储项目行 GitLab 按钮位置。
    const gitlabButtonIndex = buttons.findIndex((button) =>
      button.querySelector('.anticon-gitlab')
    )

    expect(gitlabButtonIndex).toBe(vscodeButtonIndex + 1)
    fireEvent.click(buttons[gitlabButtonIndex])
    expect(onOpenUrl).toHaveBeenCalledWith(gitlabUrl)
  })

  it('worktree 级（展开后）渲染复制路径/终端图标按钮，点击传 worktree 路径', () => {
    // 间谍捕获 worktree 行的复制/终端点击
    const onCopyPath = vi.fn()
    const onOpenTerminal = vi.fn()
    const { container } = render(
      <WorktreePanel
        {...baseProps({ activeKeys: ['TASK-A'], onCopyPath, onOpenTerminal })}
      />
    )
    // 展开的 TASK-A 面板内容区，worktree 路径 /wt/TASK-A/projA 应可见
    expect(within(container).getByText('/wt/TASK-A/projA')).toBeTruthy()
    // 限定到 Collapse 内容区查询：任务级按钮在面板头(extra)，worktree 级按钮在内容区(.ant-collapse-content)，
    // 二者图标相同，必须按区域区分，否则会误选到任务级按钮
    const content = container.querySelector('.ant-collapse-body')
    const copyBtn = content.querySelector('button .anticon-copy')
    const termBtn = content.querySelector('button .anticon-console-sql')
    expect(copyBtn).toBeTruthy()
    expect(termBtn).toBeTruthy()
    fireEvent.click(copyBtn.closest('button'))
    expect(onCopyPath).toHaveBeenCalledWith('/wt/TASK-A/projA')
    fireEvent.click(termBtn.closest('button'))
    expect(onOpenTerminal).toHaveBeenCalledWith('/wt/TASK-A/projA')
  })

  it('任务名、分支和路径使用单行 Tooltip 文本，避免长内容撑高面板行', () => {
    // longTaskName 存储较长任务名，用于验证任务标题单行省略。
    const longTaskName = 'PROJ-1001-关联物料费用金额非必填'
    // longBranch 存储较长分支名，用于验证 worktree 行分支单行省略。
    const longBranch = 'bob/feature/PROJ-1001-关联物料费用金额非必填'
    // longPath 存储较长 worktree 路径，用于验证路径行单行省略。
    const longPath = `/wt/${longTaskName}/hybrid-mobile`
    render(
      <WorktreePanel
        {...baseProps({
          activeKeys: [longTaskName],
          tasks: [
            {
              task: longTaskName,
              path: `/wt/${longTaskName}`,
              worktrees: [
                {
                  project: 'hybrid-mobile',
                  projectPath: '/src/hybrid-mobile',
                  path: longPath,
                  branch: longBranch,
                  prunable: false,
                  missing: false,
                  hasUncommittedChanges: false,
                  ahead: 0,
                  behind: 0,
                },
              ],
            },
          ],
        })}
      />
    )

    // clippedTexts 存储 Worktree 面板中启用单行省略的文本节点。
    const clippedTexts = document.querySelectorAll('.single-line-tooltip-text')
    expect([...clippedTexts].map((node) => node.textContent)).toEqual(
      expect.arrayContaining([longTaskName, longBranch, longPath])
    )
  })

  it('任务标题只让状态徽标区域横向滚动', () => {
    const { container } = render(<WorktreePanel {...baseProps()} />)
    // collapseTitle 存储 Ant Design 6 为标题分配剩余宽度的 flex 项。
    const collapseTitle = container.querySelector('.ant-collapse-title')
    // extraArea 存储与标题同级的右侧流程和操作区域。
    const extraArea = container.querySelector('.ant-collapse-extra')
    // titleContainer 存储固定任务名和徽标滚动区的标题容器。
    const titleContainer = container.querySelector('.worktree-task-title')
    // badgesScroll 存储状态、链接、环境和 Token 徽标的独立横向滚动区。
    const badgesScroll = container.querySelector('.worktree-task-badges-scroll')
    expect(collapseTitle).toBeTruthy()
    expect(extraArea).toBeTruthy()
    expect(titleContainer).toBeTruthy()
    expect(badgesScroll).toBeTruthy()
    expect(collapseTitle.contains(titleContainer)).toBe(true)
    expect(collapseTitle.parentElement).toBe(extraArea.parentElement)
    expect(titleContainer.contains(badgesScroll)).toBe(true)
    expect(container.querySelector('.worktree-task-collapse')).toBeTruthy()
  })

  it('徽标溢出时普通鼠标滚轮转换为横向滚动', () => {
    const { container } = render(<WorktreePanel {...baseProps()} />)
    // badgesScroll 存储待验证普通滚轮交互的徽标区域。
    const badgesScroll = container.querySelector('.worktree-task-badges-scroll')
    Object.defineProperties(badgesScroll, {
      clientWidth: { configurable: true, value: 180 },
      scrollWidth: { configurable: true, value: 480 },
    })
    badgesScroll.scrollLeft = 0
    fireEvent.wheel(badgesScroll, { deltaY: 72, deltaX: 0 })
    expect(badgesScroll.scrollLeft).toBe(72)
  })

  it('徽标未溢出时不劫持普通鼠标滚轮', () => {
    const { container } = render(<WorktreePanel {...baseProps()} />)
    // badgesScroll 存储内容未溢出的徽标区域。
    const badgesScroll = container.querySelector('.worktree-task-badges-scroll')
    Object.defineProperties(badgesScroll, {
      clientWidth: { configurable: true, value: 480 },
      scrollWidth: { configurable: true, value: 180 },
    })
    badgesScroll.scrollLeft = 0
    fireEvent.wheel(badgesScroll, { deltaY: 72, deltaX: 0 })
    expect(badgesScroll.scrollLeft).toBe(0)
  })
})

describe('WorktreePanel 隐藏置顶与标题徽标展示', () => {
  it('任务头渲染隐藏和置顶图标按钮，点击时回调任务名与目标状态', () => {
    // onTaskHiddenChange / onTaskPinnedChange 间谍，验证任务级偏好按钮的接线。
    const onTaskHiddenChange = vi.fn()
    const onTaskPinnedChange = vi.fn()
    render(
      <WorktreePanel
        {...baseProps({ onTaskHiddenChange, onTaskPinnedChange })}
      />
    )

    // hideButton 存储可见任务的隐藏按钮；图标表达当前状态，所以可见任务应显示普通眼睛。
    const hideButton = screen.getByLabelText('隐藏任务 TASK-A')
    expect(hideButton.querySelector('.anticon-eye')).toBeTruthy()
    expect(hideButton.querySelector('.anticon-eye-invisible')).toBeNull()
    fireEvent.click(hideButton)
    fireEvent.click(screen.getByLabelText('置顶任务 TASK-A'))

    expect(onTaskHiddenChange).toHaveBeenCalledWith('TASK-A', true)
    expect(onTaskPinnedChange).toHaveBeenCalledWith('TASK-A', true)
  })

  it('隐藏任务在显示隐藏项模式下提供恢复显示按钮', () => {
    // onTaskHiddenChange 间谍，验证隐藏任务行可以恢复显示。
    const onTaskHiddenChange = vi.fn()
    render(
      <WorktreePanel
        {...baseProps({
          hiddenTaskKeys: ['TASK-A'],
          showHiddenTasks: true,
          onTaskHiddenChange,
        })}
      />
    )

    expect(screen.getByText('已隐藏')).toBeTruthy()
    // restoreButton 存储已隐藏任务的恢复按钮；图标表达当前状态，所以隐藏任务应显示斜杠眼睛。
    const restoreButton = screen.getByLabelText('恢复显示任务 TASK-A')
    expect(restoreButton.querySelector('.anticon-eye-invisible')).toBeTruthy()
    fireEvent.click(restoreButton)

    expect(onTaskHiddenChange).toHaveBeenCalledWith('TASK-A', false)
  })

  it('正在隐藏的任务面板带退出动画 class', () => {
    const { container } = render(
      <WorktreePanel
        {...baseProps({
          hidingTaskKeys: ['TASK-A'],
        })}
      />
    )

    // hidingItem 存储进入退出动画的任务面板，隐藏前应短暂保留在列表中播放动画。
    const hidingItem = container.querySelector('.worktree-task-hiding')
    expect(hidingItem).toBeTruthy()
    expect(hidingItem.textContent).toContain('TASK-A')
    expect(container.querySelectorAll('.worktree-task-hiding').length).toBe(1)
  })

  it('按 taskTitleBadges 配置隐藏任务标题旁的项目数、环境状态和 Token 消耗', () => {
    // tasks 模拟一个包含两个项目的任务，默认会显示项目数量徽标。
    const tasks = [
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
          {
            project: 'projB',
            projectPath: '/src/projB',
            path: '/wt/TASK-A/projB',
            branch: 'feat-a',
            prunable: false,
            missing: false,
            hasUncommittedChanges: false,
            ahead: 0,
            behind: 0,
          },
        ],
      },
    ]
    // claudeUsageMap 模拟 token 用量，envHealthMap 模拟环境问题；本用例会通过配置关闭它们。
    const claudeUsageMap = {
      'TASK-A': {
        sessionCount: 1,
        usage: { input: 1000, output: 500, cacheWrite: 0, cacheRead: 0 },
        cost: { usd: 0.02, cny: 0.14 },
      },
    }
    const envHealthMap = { 'TASK-A': { status: 'warning', issueCount: 2 } }

    const { container } = render(
      <WorktreePanel
        {...baseProps({
          tasks,
          envHealthMap,
          claudeUsageMap,
          onEnvCheck: noop,
          taskTitleBadges: {
            projectCount: false,
            taskStatus: true,
            taskLinks: true,
            envHealth: false,
            claudeUsage: false,
          },
        })}
      />
    )

    // header 存储 TASK-A 标题区域，关闭的徽标不应继续出现在任务标题旁。
    const header = [...container.querySelectorAll('.ant-collapse-header')].find(
      (node) => node.textContent.includes('TASK-A')
    )
    expect(within(header).queryByText('2 项目')).toBeNull()
    expect(within(header).queryByText('2 个环境问题')).toBeNull()
    expect(within(header).queryByText('1.5K · $0.020')).toBeNull()
  })
})

describe('WorktreePanel 任务链接', () => {
  it('任务标题按项目数、状态、链接、环境、token 用量顺序展示，并使用空心方形项目数', () => {
    // tasks 模拟一个包含两个项目的任务，便于项目数量徽标展示为 2。
    const tasks = [
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
          {
            project: 'projB',
            projectPath: '/src/projB',
            path: '/wt/TASK-A/projB',
            branch: 'feat-a',
            prunable: false,
            missing: false,
            hasUncommittedChanges: false,
            ahead: 0,
            behind: 0,
          },
        ],
      },
    ]
    // claudeUsageMap 模拟已预加载的 Claude token 用量，避免组件在测试里异步请求 API。
    const claudeUsageMap = {
      'TASK-A': {
        sessionCount: 1,
        usage: { input: 1000, output: 500, cacheWrite: 0, cacheRead: 0 },
        cost: { usd: 0.02, cny: 0.14 },
      },
    }
    // taskLinkMap 模拟任务旁已绑定一条需求链接。
    const taskLinkMap = {
      'TASK-A': [
        { name: 'Jira', url: 'https://jira.example.com/browse/TASK-A' },
      ],
    }
    // envHealthMap 模拟环境检查已有问题，标题中应排在链接之后、token 之前。
    const envHealthMap = { 'TASK-A': { status: 'warning', issueCount: 2 } }
    // noopEnvCheck 占位环境检查点击回调，传入后才会渲染环境状态标签。
    const noopEnvCheck = () => {}
    const { container } = render(
      <WorktreePanel
        {...baseProps({
          tasks,
          taskStatusMap: { 'TASK-A': 'developing' },
          taskLinkMap,
          envHealthMap,
          claudeUsageMap,
          onEnvCheck: noopEnvCheck,
          taskTitleBadges: { claudeUsage: true },
        })}
      />
    )

    // header 存储 TASK-A 的标题区域，用于限定顺序断言范围。
    const header = [...container.querySelectorAll('.ant-collapse-header')].find(
      (node) => node.textContent.includes('TASK-A')
    )
    // headerText 存储标题纯文本；移除空白后更稳定地比较相邻标签顺序。
    const headerText = header.textContent.replace(/\s/g, '')
    expect(headerText.indexOf('2项目')).toBeLessThan(
      headerText.indexOf('开发中')
    )
    expect(headerText.indexOf('开发中')).toBeLessThan(
      headerText.indexOf('Jira')
    )
    expect(headerText.indexOf('Jira')).toBeLessThan(
      headerText.indexOf('2个环境问题')
    )
    expect(headerText.indexOf('2个环境问题')).toBeLessThan(
      headerText.indexOf('1.5K·$0.020')
    )

    // projectCountTag 存储项目数徽标节点；应是镂空方形 Tag，而不是 Badge 的圆点。
    const projectCountTag = within(header).getByLabelText('项目数量 2')
    expect(projectCountTag.className).toContain('ant-tag')
    expect(projectCountTag.getAttribute('style')).toContain(
      'background: transparent'
    )
    expect(projectCountTag.getAttribute('style')).toContain(
      'border-radius: 4px'
    )
  })

  it('任务绑定多条带名称链接时在任务名旁边逐条展示名称，并可打开指定链接', () => {
    // links 模拟同一任务绑定 Jira、飞书需求文档等多条命名需求链接。
    const links = [
      { name: 'Jira', url: 'https://jira.example.com/browse/TASK-A' },
      { name: '需求文档', url: 'https://larksuite.example.com/docx/abc' },
    ]
    // onOpenUrl 间谍，验证用户选择的是哪条链接。
    const onOpenUrl = vi.fn()
    const { container } = render(
      <WorktreePanel
        {...baseProps({
          taskLinkMap: { 'TASK-A': links },
          onOpenUrl,
        })}
      />
    )

    // header 存储 TASK-A 的任务标题区域；链接应直接出现在这里，而不是只藏在一个汇总图标后面。
    const header = [...container.querySelectorAll('.ant-collapse-header')].find(
      (node) => node.textContent.includes('TASK-A')
    )

    expect(within(header).getByText('Jira')).toBeTruthy()
    expect(within(header).getByText('需求文档')).toBeTruthy()

    fireEvent.click(within(header).getByText('需求文档'))
    expect(onOpenUrl).toHaveBeenCalledWith(
      'https://larksuite.example.com/docx/abc'
    )
  })

  it('任务绑定旧版纯 URL 链接时在任务名旁边展示 URL', () => {
    // onOpenUrl 间谍，验证旧版链接点击后仍打开原始 URL。
    const onOpenUrl = vi.fn()
    // oldUrl 模拟历史 task-links.json 中只保存 URL 字符串的链接。
    const oldUrl = 'https://jira.example.com/browse/TASK-A'
    const { container } = render(
      <WorktreePanel
        {...baseProps({
          taskLinkMap: { 'TASK-A': [oldUrl] },
          onOpenUrl,
        })}
      />
    )

    // header 存储 TASK-A 的任务标题区域；未命名链接应回退显示 URL。
    const header = [...container.querySelectorAll('.ant-collapse-header')].find(
      (node) => node.textContent.includes('TASK-A')
    )

    expect(within(header).getByText(oldUrl)).toBeTruthy()
    fireEvent.click(within(header).getByText(oldUrl))
    expect(onOpenUrl).toHaveBeenCalledWith(oldUrl)
  })

  it('管理需求链接时默认一行名称和链接输入，可增加输入框并保存多条命名链接', async () => {
    // onTaskLinkChange 间谍，验证保存时上层拿到清洗后的链接数组用于持久化。
    const onTaskLinkChange = vi.fn()
    const { container } = render(
      <WorktreePanel
        {...baseProps({
          taskLinkMap: {
            'TASK-A': [
              { name: '旧 Jira', url: 'https://jira.example.com/old' },
            ],
          },
          onTaskLinkChange,
        })}
      />
    )

    // manageButton 存储任务头右侧的链接管理按钮，区别于标题里的快捷打开图标。
    const taskHeader = [
      ...container.querySelectorAll('.ant-collapse-header'),
    ].find((node) => node.textContent.includes('TASK-A'))
    const manageButton = taskHeader
      .querySelector('.ant-collapse-extra button .anticon-link')
      .closest('button')
    fireEvent.click(manageButton)

    // firstNameInput 存储默认展示的第一条链接名称输入框；已有名称会回填到这一行。
    const firstNameInput = await screen.findByPlaceholderText(
      TASK_LINK_NAME_PLACEHOLDER
    )
    expect(firstNameInput.tagName.toLowerCase()).toBe('input')
    expect(firstNameInput.value).toBe('旧 Jira')
    fireEvent.change(firstNameInput, { target: { value: 'Jira' } })
    // firstLinkInput 存储默认展示的第一条链接地址输入框；已有链接会回填到这一行。
    const firstLinkInput = await screen.findByPlaceholderText(
      TASK_LINK_PLACEHOLDER
    )
    expect(firstLinkInput.tagName.toLowerCase()).toBe('input')
    expect(firstLinkInput.value).toBe('https://jira.example.com/old')
    fireEvent.change(firstLinkInput, {
      target: { value: 'https://jira.example.com/TASK-A' },
    })

    fireEvent.click(screen.getByText('添加链接'))
    // nameInputs 存储点击添加后的全部链接名称输入框。
    const nameInputs = screen.getAllByPlaceholderText(
      TASK_LINK_NAME_PLACEHOLDER
    )
    expect(nameInputs.length).toBe(2)
    fireEvent.change(nameInputs[1], { target: { value: '需求文档' } })
    // linkInputs 存储点击添加后的全部链接输入框。
    const linkInputs = screen.getAllByPlaceholderText(TASK_LINK_PLACEHOLDER)
    expect(linkInputs.length).toBe(2)
    fireEvent.change(linkInputs[1], {
      target: { value: 'https://larksuite.example.com/docx/abc' },
    })
    // saveButton 存储链接弹层的保存按钮；antd 会给两个中文字按钮插入空格，需归一化后匹配。
    const saveButton = [
      ...document.querySelectorAll('.ant-popover button'),
    ].find((button) => button.textContent.replace(/\s/g, '') === '保存')
    expect(saveButton).toBeTruthy()
    fireEvent.click(saveButton)

    expect(onTaskLinkChange).toHaveBeenCalledWith('TASK-A', [
      { name: 'Jira', url: 'https://jira.example.com/TASK-A' },
      { name: '需求文档', url: 'https://larksuite.example.com/docx/abc' },
    ])
  })
})

describe('WorktreePanel 环境检查状态', () => {
  it('任务行项目数量显示在人工状态和环境检查前面', () => {
    // container 存储渲染结果根节点，用于限定到第一个任务头部断言 DOM 顺序
    const { container } = render(
      <WorktreePanel
        {...baseProps({
          onEnvCheck: noop,
          envHealthMap: {
            'TASK-A': { status: 'ok', issueCount: 0 },
          },
        })}
      />
    )
    // taskHeader 存储 TASK-A 所在的折叠面板头部，避免 TASK-B 的默认状态干扰顺序断言
    const taskHeader = [
      ...container.querySelectorAll('.ant-collapse-header'),
    ].find((header) => header.textContent.includes('TASK-A'))
    // headerText 存储该任务标题完整文本：预期顺序为「任务名 → 项目数 → 人工状态 → 环境检查」
    const headerText = taskHeader.textContent

    expect(headerText.indexOf('1')).toBeLessThan(headerText.indexOf('未开始'))
    expect(headerText.indexOf('1')).toBeLessThan(headerText.indexOf('环境正常'))
  })

  it('任务行显示环境检查中、正常、异常状态', () => {
    render(
      <WorktreePanel
        {...baseProps({
          onEnvCheck: noop,
          envHealthMap: {
            'TASK-A': { status: 'checking' },
            'TASK-B': { status: 'failed', issueCount: 2 },
          },
        })}
      />
    )

    expect(screen.getByText('环境检查中')).toBeTruthy()
    expect(screen.getByText('2 个环境问题')).toBeTruthy()
  })

  it('环境检查标签保留固定占位，避免 loading 状态撑动标题行', () => {
    // container 存储渲染结果根节点，用于查询环境状态 Tag 的样式占位。
    const { container } = render(
      <WorktreePanel
        {...baseProps({
          onEnvCheck: noop,
          envHealthMap: {
            'TASK-A': { status: 'checking' },
            'TASK-B': { status: 'failed', issueCount: 12 },
          },
        })}
      />
    )
    // envTags 存储环境检查标签节点；检查中与异常态都应使用同一稳定最小宽度。
    const envTags = [...container.querySelectorAll('.env-health-status-tag')]
    // minWidths 存储标签最小宽度样式，用于证明不同状态不会把任务标题行横向撑动。
    const minWidths = envTags.map((tag) => tag.style.minWidth)

    expect(envTags).toHaveLength(2)
    expect(new Set(minWidths).size).toBe(1)
    expect(minWidths[0]).toBeTruthy()
  })

  it('任务行用黄色展示 warning 级环境问题', () => {
    // container 存储渲染结果根节点，用于断言 warning 标签类名。
    const { container } = render(
      <WorktreePanel
        {...baseProps({
          onEnvCheck: noop,
          envHealthMap: {
            'TASK-A': {
              status: 'warning',
              issueCount: 1,
              result: {
                summary: {
                  status: 'warning',
                  issueCount: 1,
                  message: 'Git 有 1 个未提交改动',
                },
              },
            },
          },
        })}
      />
    )

    // warningTag 存储显示“1 个环境问题”的环境标签，它应该是 warning 色而不是 error 色。
    const warningTag = [...container.querySelectorAll('.ant-tag')].find((tag) =>
      tag.textContent.includes('1 个环境问题')
    )

    expect(warningTag).toBeTruthy()
    expect(warningTag.className).toContain('ant-tag-warning')
    expect(warningTag.className).not.toContain('ant-tag-error')
  })

  it('点击环境状态回调当前任务，用于打开详情或重新检查', () => {
    // onEnvCheck 间谍，验证点击状态不会折叠面板，而是打开环境详情
    const onEnvCheck = vi.fn()
    render(
      <WorktreePanel
        {...baseProps({
          onEnvCheck,
          envHealthMap: {
            'TASK-A': { status: 'ok', issueCount: 0 },
          },
        })}
      />
    )

    fireEvent.click(screen.getByText('环境正常'))

    expect(onEnvCheck).toHaveBeenCalledTimes(1)
    expect(onEnvCheck.mock.calls[0][0].task).toBe('TASK-A')
  })
})

describe('WorktreePanel 需求流程入口', () => {
  // steps 为测试用工作流步骤：所有步骤都可勾选；最后一个额外配了执行命令（有「执行」按钮）
  const steps = [
    { key: 'start', label: '开始', command: '' },
    { key: 'review-plan', label: '审查需求方案', command: '' },
    {
      key: 'branch-to-jira',
      label: '自动提取分支到 Jira',
      command: './jira.sh {branch}',
    },
  ]

  it('任务级渲染「流程」入口按钮', () => {
    render(<WorktreePanel {...baseProps({ workflowSteps: steps })} />)
    // 折叠态下流程入口按钮也应可见（在 extra 区域），两个任务各一个
    expect(screen.getAllByText('流程').length).toBe(2)
  })

  it('点击流程按钮弹出 Modal 并列出全部步骤', () => {
    render(<WorktreePanel {...baseProps({ workflowSteps: steps })} />)
    // 点击第一个任务的流程入口
    fireEvent.click(screen.getAllByText('流程')[0])
    // Modal 标题与各步骤名应出现；标题带任务名，避免多任务时上下文不清。
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('需求流程 - TASK-A')).toBeTruthy()
    expect(screen.getByText('开始')).toBeTruthy()
    expect(screen.getByText('审查需求方案')).toBeTruthy()
    expect(screen.getByText('自动提取分支到 Jira')).toBeTruthy()
    expect(document.querySelector('.ant-popover')).toBeNull()
  })

  it('勾选 checkbox 步骤回调 onToggleStep(任务名, 步骤key, true)', () => {
    // onToggleStep 间谍，捕获勾选事件
    const onToggleStep = vi.fn()
    render(
      <WorktreePanel {...baseProps({ workflowSteps: steps, onToggleStep })} />
    )
    fireEvent.click(screen.getAllByText('流程')[0])
    // Modal 内容渲染在 portal（document.body）：直接定位「开始」label 的复选框 input 点击。
    // 经由文字节点向上找到 antd Checkbox 容器，再取其内的真实 input 触发 change。
    const startLabel = screen.getByText('开始')
    const checkboxWrap = startLabel.closest('.ant-checkbox-wrapper')
    fireEvent.click(checkboxWrap.querySelector('input'))
    expect(onToggleStep).toHaveBeenCalledWith('TASK-A', 'start', true)
  })

  it('已勾选的步骤复选框呈选中态', () => {
    render(
      <WorktreePanel
        {...baseProps({
          workflowSteps: steps,
          workflowMap: { 'TASK-A': ['start'] },
        })}
      />
    )
    fireEvent.click(screen.getAllByText('流程')[0])
    // Modal 内容在 portal，须从 document 查询：选中态复选框带 ant-checkbox-checked 类
    const checked = document.querySelectorAll('.ant-checkbox-checked')
    expect(checked.length).toBe(1)
  })

  it('配了执行命令的步骤渲染「执行」按钮，点击回调 onRunStepAction(task, step)', () => {
    // onRunStepAction 间谍，捕获执行触发
    const onRunStepAction = vi.fn()
    render(
      <WorktreePanel
        {...baseProps({ workflowSteps: steps, onRunStepAction })}
      />
    )
    fireEvent.click(screen.getAllByText('流程')[0])
    // 仅配了 command 的步骤（branch-to-jira）渲染「执行」按钮，点击触发回调
    fireEvent.click(screen.getByText('执行'))
    expect(onRunStepAction).toHaveBeenCalledTimes(1)
    // 第一个参数为任务对象（task 名 TASK-A），第二个为步骤定义
    const [taskArg, stepArg] = onRunStepAction.mock.calls[0]
    expect(taskArg.task).toBe('TASK-A')
    expect(stepArg.key).toBe('branch-to-jira')
  })

  it('每个步骤都可勾选，且配了命令的步骤打勾与执行并存', () => {
    render(<WorktreePanel {...baseProps({ workflowSteps: steps })} />)
    fireEvent.click(screen.getAllByText('流程')[0])
    // 三个步骤都应渲染勾选框（所有步骤都可勾选）
    const checkboxes = document.querySelectorAll('.ant-checkbox-wrapper')
    expect(checkboxes.length).toBe(3)
    // 配了命令的步骤额外有一个「执行」按钮（与勾选框并存）
    expect(screen.getAllByText('执行').length).toBe(1)
  })

  it('未配置命令的步骤不渲染「执行」按钮', () => {
    // 全部步骤 command 为空时，流程弹层内不应出现任何「执行」按钮
    const noCmdSteps = [
      { key: 'a', label: 'A', command: '' },
      { key: 'b', label: 'B', command: '' },
    ]
    render(<WorktreePanel {...baseProps({ workflowSteps: noCmdSteps })} />)
    fireEvent.click(screen.getAllByText('流程')[0])
    expect(screen.queryByText('执行')).toBeNull()
  })

  it('步骤数超过 5 时进度用紧凑 N/M 文字展示（不撑长）', () => {
    // 7 个步骤、已勾选 2 个：应出现紧凑的 2/7 文字（圆点模式只在 ≤5 步时启用）
    const manySteps = Array.from({ length: 7 }).map((_, i) => ({
      key: `s${i}`,
      label: `步骤${i}`,
      command: '',
    }))
    render(
      <WorktreePanel
        {...baseProps({
          workflowSteps: manySteps,
          workflowMap: { 'TASK-A': ['s0', 's1'] },
        })}
      />
    )
    // 进度文字 2/7 直接渲染在按钮上（折叠态可见），断言其存在
    expect(screen.getByText('2/7')).toBeTruthy()
  })

  it('点击流程入口不触发面板展开/折叠（onActiveKeysChange 不被调用）', () => {
    // onActiveKeysChange 间谍：点流程入口若冒泡到 Collapse 头部会被调用，断言其未触发
    const onActiveKeysChange = vi.fn()
    render(
      <WorktreePanel
        {...baseProps({ workflowSteps: steps, onActiveKeysChange })}
      />
    )
    fireEvent.click(screen.getAllByText('流程')[0])
    expect(onActiveKeysChange).not.toHaveBeenCalled()
  })

  it('未配置任何步骤时不渲染流程入口', () => {
    render(<WorktreePanel {...baseProps({ workflowSteps: [] })} />)
    expect(screen.queryByText('流程')).toBeNull()
  })

  it('runningSteps 命中时该步骤「执行」按钮显示 loading 并禁用', () => {
    // runningSteps 以 stepRunKey(任务名,步骤key) 为键标记执行中：TASK-A 的 branch-to-jira 步骤执行中
    render(
      <WorktreePanel
        {...baseProps({
          workflowSteps: steps,
          runningSteps: { 'TASK-A::branch-to-jira': true },
        })}
      />
    )
    fireEvent.click(screen.getAllByText('流程')[0])
    // 执行中：按钮带 loading（antd 注入 ant-btn-loading 类）且禁用，避免重复点击
    // loadingBtn 为步骤级「执行中」按钮；页面上任务级「运行全部」也会 loading，不能用首个 .ant-btn-loading 误选。
    const loadingBtn = [...document.querySelectorAll('.ant-btn-loading')].find(
      (btn) => btn.textContent.includes('执行中')
    )
    expect(loadingBtn).toBeTruthy()
    expect(loadingBtn.disabled).toBe(true)
    // 文案变为「执行中…」（用文本内容匹配，避免被 loading 图标拆分节点影响）
    expect(loadingBtn.textContent).toContain('执行中')
  })

  it('其他任务执行中不影响本任务按钮（按钮级 loading 隔离）', () => {
    // 仅 TASK-B 的步骤执行中，打开 TASK-A 的流程时其「执行」按钮仍为常态可点
    const onRunStepAction = vi.fn()
    render(
      <WorktreePanel
        {...baseProps({
          workflowSteps: steps,
          onRunStepAction,
          runningSteps: { 'TASK-B::branch-to-jira': true },
        })}
      />
    )
    // 点开第一个任务（TASK-A）的流程入口
    fireEvent.click(screen.getAllByText('流程')[0])
    // TASK-A 的执行按钮应为常态「执行」可点击
    const btn = screen.getByText('执行')
    expect(btn).toBeTruthy()
    fireEvent.click(btn)
    expect(onRunStepAction).toHaveBeenCalledTimes(1)
  })

  it('流程 Modal 提供运行全部按钮并只在有命令步骤时可用', () => {
    // onRunWorkflowSteps 间谍，验证任务级批量运行入口把当前任务传给上层。
    const onRunWorkflowSteps = vi.fn()
    render(
      <WorktreePanel
        {...baseProps({ workflowSteps: steps, onRunWorkflowSteps })}
      />
    )
    fireEvent.click(screen.getAllByText('流程')[0])

    fireEvent.click(screen.getByText('运行全部'))

    expect(onRunWorkflowSteps).toHaveBeenCalledTimes(1)
    expect(onRunWorkflowSteps.mock.calls[0][0].task).toBe('TASK-A')
    expect(onRunWorkflowSteps.mock.calls[0][1]).toBeUndefined()
  })

  it('失败步骤显示未通过状态、重试和查看输出', () => {
    // onRunStepAction/onViewLastOutput 间谍，验证失败态提供恢复操作。
    const onRunStepAction = vi.fn()
    const onViewLastOutput = vi.fn()
    render(
      <WorktreePanel
        {...baseProps({
          workflowSteps: steps,
          onRunStepAction,
          onViewLastOutput,
          lastStepOutputs: {
            'TASK-A::branch-to-jira': {
              status: 'error',
              label: '自动提取分支到 Jira',
              content: 'boom',
            },
          },
        })}
      />
    )
    fireEvent.click(screen.getAllByText('流程')[0])

    expect(screen.getByText('未通过')).toBeTruthy()
    fireEvent.click(screen.getByText('重试'))
    expect(onRunStepAction).toHaveBeenCalledTimes(1)
    fireEvent.click(
      document.querySelector('.anticon-file-text').closest('button')
    )
    expect(onViewLastOutput).toHaveBeenCalledTimes(1)
  })

  it('失败步骤被用户手动勾选后保持勾选态并显示已完成', () => {
    render(
      <WorktreePanel
        {...baseProps({
          workflowSteps: steps,
          workflowMap: { 'TASK-A': ['branch-to-jira'] },
          lastStepOutputs: {
            'TASK-A::branch-to-jira': {
              status: 'error',
              label: '自动提取分支到 Jira',
              content: 'unit failed',
            },
          },
        })}
      />
    )
    fireEvent.click(screen.getAllByText('流程')[0])

    expect(screen.getByText('已完成')).toBeTruthy()
    expect(screen.queryByText('未通过')).toBeNull()
    // checkboxWrap 存储失败步骤的复选框包裹层；用户手动勾选后应优先展示完成态。
    const checkboxWrap = screen
      .getByText('自动提取分支到 Jira')
      .closest('.ant-checkbox-wrapper')
    expect(checkboxWrap.querySelector('input').checked).toBe(true)
  })

  it('完成态命令步骤的操作按钮与步骤首行顶部对齐', () => {
    // unitTestSteps 模拟用户在流程里新增的单测检查步骤：已完成态会在名称下方展示状态标签。
    const unitTestSteps = [
      {
        key: 'unit-test',
        label: '检查单测',
        command: 'bash check-unit-test.sh',
      },
    ]
    render(
      <WorktreePanel
        {...baseProps({
          workflowSteps: unitTestSteps,
          workflowMap: { 'TASK-A': ['unit-test'] },
        })}
      />
    )
    fireEvent.click(screen.getAllByText('流程')[0])

    // row 存储流程步骤整行容器；有状态标签时必须顶部对齐，避免右侧按钮被第二行状态标签拉到中间。
    const row = screen.getByTestId('workflow-step-row-unit-test')
    // actions 存储步骤右侧操作区；允许在窄宽度内换行，但起点应始终贴齐步骤首行。
    const actions = screen.getByTestId('workflow-step-actions-unit-test')
    // titleLine 存储步骤标题行；完成状态应与步骤名同处一行，避免 Modal 内出现多余第二行。
    const titleLine = screen.getByTestId('workflow-step-title-line-unit-test')
    // statusTag 存储完成态标签；它必须被标题行直接容纳，而不是渲染到标题下方。
    const statusTag = screen.getByText('已完成').closest('.ant-tag')

    expect(row.style.alignItems).toBe('flex-start')
    expect(actions.style.alignSelf).toBe('flex-start')
    expect(actions.style.flexWrap).toBe('wrap')
    expect(titleLine.contains(statusTag)).toBe(true)
    expect(titleLine.style.alignItems).toBe('center')
  })

  it('命令步骤提供从此处运行入口', () => {
    // onRunWorkflowSteps 间谍，验证单个步骤可作为批量运行起点。
    const onRunWorkflowSteps = vi.fn()
    render(
      <WorktreePanel
        {...baseProps({ workflowSteps: steps, onRunWorkflowSteps })}
      />
    )
    fireEvent.click(screen.getAllByText('流程')[0])

    fireEvent.click(screen.getByText('从此处运行'))

    expect(onRunWorkflowSteps).toHaveBeenCalledTimes(1)
    expect(onRunWorkflowSteps.mock.calls[0][1]).toBe('branch-to-jira')
  })
})

describe('WorktreePanel 空态', () => {
  it('无任务且非加载时显示空状态提示', () => {
    render(<WorktreePanel {...baseProps({ tasks: [], loading: false })} />)
    // 空态文案来自组件 Empty description
    expect(screen.getByText(/暂无 worktree/)).toBeTruthy()
  })

  it('任务没有项目 worktree 时展开内容显示添加项目入口', () => {
    // emptyTask 模拟只创建了任务目录但尚未选择项目的任务。
    const emptyTask = {
      task: 'TASK-EMPTY',
      path: '/wt/TASK-EMPTY',
      worktrees: [],
    }
    // onAddWorktree 间谍，验证空态按钮复用任务栏加号的追加项目行为。
    const onAddWorktree = vi.fn()
    render(
      <WorktreePanel
        {...baseProps({
          tasks: [emptyTask],
          activeKeys: ['TASK-EMPTY'],
          onAddWorktree,
        })}
      />
    )

    expect(screen.getByText('还没有项目 worktree')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /添加项目/ }))

    expect(onAddWorktree).toHaveBeenCalledTimes(1)
    expect(onAddWorktree).toHaveBeenCalledWith(emptyTask)
  })
})

describe('WorktreePanel 任务状态标记', () => {
  it('未设置状态时任务标题默认显示「未开始」', () => {
    render(<WorktreePanel {...baseProps()} />)
    // 两个任务各默认一个「未开始」标签
    expect(screen.getAllByText('未开始').length).toBe(2)
  })

  it('已设置状态时显示对应中文状态名', () => {
    render(
      <WorktreePanel
        {...baseProps({ taskStatusMap: { 'TASK-A': 'released' } })}
      />
    )
    // TASK-A 显示「已发布」，TASK-B 仍为默认「未开始」
    expect(screen.getByText('已发布')).toBeTruthy()
    expect(screen.getAllByText('未开始').length).toBe(1)
  })

  it('点击状态标签选择状态会回调 onTaskStatusChange(任务名, 状态key)', async () => {
    // onTaskStatusChange 间谍，捕获下拉选择
    const onTaskStatusChange = vi.fn()
    render(<WorktreePanel {...baseProps({ onTaskStatusChange })} />)
    // 点击 TASK-A 的默认「未开始」标签展开下拉
    fireEvent.click(screen.getAllByText('未开始')[0])
    await waitFor(() => expect(screen.getByText('待发布')).toBeTruthy())
    // 下拉菜单项「待发布」出现后点击
    fireEvent.click(screen.getByText('待发布'))
    await waitFor(() =>
      expect(onTaskStatusChange).toHaveBeenCalledWith(
        'TASK-A',
        'pending-release'
      )
    )
  })

  it('点击状态标签不应触发面板展开/折叠（onActiveKeysChange 不被调用）', async () => {
    // onActiveKeysChange 间谍：点状态标签时若冒泡到 Collapse 头部会被调用，断言其未触发
    const onActiveKeysChange = vi.fn()
    render(
      <WorktreePanel
        {...baseProps({ activeKeys: ['TASK-A'], onActiveKeysChange })}
      />
    )
    // 点击 TASK-A 的状态标签（默认「未开始」），仅应展开下拉、不应折叠面板
    fireEvent.click(screen.getAllByText('未开始')[0])
    await waitFor(() => expect(screen.getByText('待发布')).toBeTruthy())
    expect(onActiveKeysChange).not.toHaveBeenCalled()
  })
})
