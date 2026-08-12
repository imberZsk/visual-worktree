import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import KanbanView from '../../src/ui/components/KanbanView.tsx'
import { DEFAULT_TASK_STATUSES } from '../../src/core/taskStatuses.js'
import { DEFAULT_TASK_TAGS } from '../../src/core/taskTags.js'

// KanbanView 组件测试：跑在 happy-dom 环境。
// 验证每个动态人工状态直接对应看板列、列偏好、任务名渲染、备注编辑/展示和点击跳转。

afterEach(() => cleanup())

// steps 全局工作流步骤清单（仅作进度条辅助信息，非分组依据）
const steps = [
  { key: 's1', label: '开始' },
  { key: 's2', label: '单测' },
  { key: 's3', label: 'Jira评论' },
]

// makeTasks 构造三个任务，分别对应未开始、开发中和已发布状态。
function makeTasks() {
  return [
    {
      task: 'TASK-PENDING',
      path: '/wt/TASK-PENDING',
      worktrees: [{ project: 'a', path: '/wt/TASK-PENDING/a', branch: 'f1' }],
    },
    {
      task: 'TASK-DOING',
      path: '/wt/TASK-DOING',
      worktrees: [
        {
          project: 'b',
          path: '/wt/TASK-DOING/b',
          branch: 'f2',
          hasUncommittedChanges: true,
        },
      ],
    },
    {
      task: 'TASK-DONE',
      path: '/wt/TASK-DONE',
      worktrees: [{ project: 'c', path: '/wt/TASK-DONE/c', branch: 'f3' }],
    },
  ]
}

// statusMap 人工状态：PENDING 未开始 / DOING 开发中 / DONE 已发布
const statusMap = {
  'TASK-DOING': 'developing',
  'TASK-DONE': 'released',
  // TASK-PENDING 不设置，应回退“未开始”状态列。
}

describe('KanbanView', () => {
  it('展示偏好关闭时隐藏看板任务分类标签', () => {
    render(
      <KanbanView
        tasks={[makeTasks()[0]]}
        taskTagMap={{ 'TASK-PENDING': 'bug' }}
        taskTags={DEFAULT_TASK_TAGS}
        showTaskTags={false}
      />
    )
    expect(screen.queryByText('BUG')).toBeNull()
  })
  it('首次加载且还没有任务数据时只显示内容区 loading', () => {
    // container 存储渲染结果，用于确认只保留 Ant Design Spin 而不显示加载文案。
    const { container } = render(<KanbanView tasks={[]} loading />)

    expect(screen.getByRole('status', { name: '看板加载状态' })).toBeTruthy()
    expect(container.querySelector('.ant-spin')).toBeTruthy()
    expect(screen.queryByText('正在加载看板...')).toBeNull()
    expect(screen.queryByText('未开始')).toBeNull()
  })

  it('renders task names (uses task.task, not task.taskName)', () => {
    render(
      <KanbanView
        tasks={makeTasks()}
        workflowSteps={steps}
        taskWorkflowMap={{}}
        taskStatusMap={statusMap}
        taskBlockerMap={{}}
        onBlockerChange={() => {}}
        onTaskClick={() => {}}
      />
    )
    expect(screen.getByText('TASK-PENDING')).toBeTruthy()
    expect(screen.getByText('TASK-DOING')).toBeTruthy()
    expect(screen.getByText('TASK-DONE')).toBeTruthy()
  })

  it('aligns task cards with their column header', () => {
    render(
      <KanbanView
        tasks={makeTasks()}
        workflowSteps={steps}
        taskWorkflowMap={{}}
        taskStatusMap={statusMap}
        taskBlockerMap={{}}
        onBlockerChange={() => {}}
        onTaskClick={() => {}}
      />
    )

    // pendingCard 存储“未开始”列的任务卡片，用于找到对应列容器。
    const pendingCard = screen.getByText('TASK-PENDING').closest('.ant-card')
    // pendingColumn 存储“未开始”列，标题和内容必须共享同一水平边界。
    const pendingColumn = pendingCard?.closest('.kanban-column')
    // columnContent 存储卡片列表容器，不应再用固定右内边距缩窄任务卡片。
    const columnContent = pendingColumn?.querySelector('.kanban-column-content')
    expect(pendingColumn?.querySelector('.kanban-column-header')).toBeTruthy()
    expect(columnContent?.style.paddingRight).toBe('')
  })

  it('按动态人工状态直接分列而不使用旧三组看板归类', () => {
    // 即便完全没勾选任何工作流步骤，已发布与开发中任务也应进入各自人工状态列。
    const { container } = render(
      <KanbanView
        tasks={makeTasks()}
        workflowSteps={steps}
        taskWorkflowMap={{}}
        taskStatusMap={statusMap}
        taskBlockerMap={{}}
        onBlockerChange={() => {}}
        onTaskClick={() => {}}
      />
    )
    expect(
      container.querySelector('[data-status-key="not-started"]')
    ).toBeTruthy()
    expect(
      container.querySelector('[data-status-key="developing"]')
    ).toBeTruthy()
    expect(container.querySelector('[data-status-key="released"]')).toBeTruthy()
    // 三个有任务状态列的计数均为 1。
    const counts = Array.from(container.querySelectorAll('.ant-tag')).map(
      (el) => el.textContent
    )
    // 三个有任务的状态列各有一个计数标签 1。
    expect(counts.filter((t) => t === '1').length).toBeGreaterThanOrEqual(3)
  })

  it('状态重命名后同步更新对应看板列标题', () => {
    const { container } = render(
      <KanbanView
        tasks={makeTasks()}
        workflowSteps={steps}
        taskWorkflowMap={{}}
        taskStatusMap={statusMap}
        taskStatuses={DEFAULT_TASK_STATUSES.map((status) => {
          if (status.key === 'developing') {
            return { ...status, label: '处理中' }
          }
          if (status.key === 'released') {
            return { ...status, label: '已上线' }
          }
          return { ...status }
        })}
        taskBlockerMap={{}}
        onBlockerChange={() => {}}
        onTaskClick={() => {}}
      />
    )

    expect(
      container.querySelector('[data-status-key="developing"]')?.textContent
    ).toContain('处理中')
    expect(
      container.querySelector('[data-status-key="released"]')?.textContent
    ).toContain('已上线')
  })

  it('新增任务状态后直接生成独立看板列', () => {
    // taskStatuses 存储新增“已验收”状态的动态配置。
    const taskStatuses = [
      ...DEFAULT_TASK_STATUSES,
      {
        key: 'accepted',
        label: '已验收',
        color: 'blue',
        kanbanColumn: 'completed',
      },
    ]
    const { container } = render(
      <KanbanView
        tasks={[makeTasks()[0]]}
        workflowSteps={steps}
        taskWorkflowMap={{}}
        taskStatusMap={{ 'TASK-PENDING': 'accepted' }}
        taskStatuses={taskStatuses}
        taskBlockerMap={{}}
        onBlockerChange={() => {}}
        onTaskClick={() => {}}
      />
    )

    // acceptedColumn 存储自定义状态生成的独立看板列。
    const acceptedColumn = container.querySelector(
      '[data-status-key="accepted"]'
    )
    expect(acceptedColumn?.textContent).toContain('已验收')
    expect(acceptedColumn?.textContent).toContain('TASK-PENDING')
  })

  it('未设置状态的任务全部进入未开始列', () => {
    render(
      <KanbanView
        tasks={makeTasks()}
        workflowSteps={steps}
        taskWorkflowMap={{}}
        taskStatusMap={{}}
        taskBlockerMap={{}}
        onBlockerChange={() => {}}
        onTaskClick={() => {}}
      />
    )
    // 七个默认状态中只有“未开始”有任务，其余六列显示空态。
    expect(screen.getAllByText('无任务').length).toBe(6)
  })

  it('按设置中的隐藏状态过滤看板列且不再展示顶部设置工具栏', () => {
    // hiddenSettings 存储由设置页持久化的隐藏列偏好。
    const hiddenSettings = {
      hiddenStatusKeys: ['developing'],
    }
    const { container } = render(
      <KanbanView
        tasks={makeTasks()}
        workflowSteps={steps}
        taskStatusMap={statusMap}
        taskStatuses={DEFAULT_TASK_STATUSES}
        kanbanSettings={hiddenSettings}
      />
    )

    expect(container.querySelector('[data-status-key="developing"]')).toBeNull()
    expect(screen.queryByText('TASK-DOING')).toBeNull()
    expect(screen.queryByRole('button', { name: '设置看板列' })).toBeNull()
  })

  it('列内置顶任务排在前面并可取消置顶', () => {
    // sameStatusTasks 存储两个同状态任务，用于验证列内置顶排序。
    const sameStatusTasks = [
      { task: 'TASK-NORMAL', worktrees: [] },
      { task: 'TASK-PINNED', worktrees: [] },
    ]
    // pinnedChanges 存储置顶按钮触发的任务名和目标状态。
    const pinnedChanges = []
    const { container } = render(
      <KanbanView
        tasks={sameStatusTasks}
        taskStatusMap={{
          'TASK-NORMAL': 'developing',
          'TASK-PINNED': 'developing',
        }}
        taskStatuses={DEFAULT_TASK_STATUSES}
        pinnedTaskKeys={['TASK-PINNED']}
        onTaskPinnedChange={(taskName, pinned) => {
          pinnedChanges.push({ taskName, pinned })
        }}
      />
    )

    // developingCards 存储开发中列的任务卡片，置顶任务应排在第一张。
    const developingCards = container.querySelectorAll(
      '[data-status-key="developing"] .kanban-task-card'
    )
    expect(developingCards.item(0).textContent).toContain('TASK-PINNED')
    fireEvent.click(
      screen.getByRole('button', { name: '取消置顶任务 TASK-PINNED' })
    )
    expect(pinnedChanges).toEqual([{ taskName: 'TASK-PINNED', pinned: false }])
  })

  it('任务卡片支持用 VSCode 打开任务目录', () => {
    // openedPaths 存储 VSCode 打开回调收到的任务目录。
    const openedPaths = []
    render(
      <KanbanView
        tasks={[makeTasks()[0]]}
        onOpenVscode={(taskPath) => openedPaths.push(taskPath)}
      />
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: '在 VSCode 中打开任务 TASK-PENDING',
      })
    )
    expect(openedPaths).toEqual(['/wt/TASK-PENDING'])
  })

  it('shows existing blocker note and allows editing', () => {
    // saved 记录备注保存回调收到的参数
    let saved = null
    render(
      <KanbanView
        tasks={makeTasks()}
        workflowSteps={steps}
        taskWorkflowMap={{}}
        taskStatusMap={statusMap}
        taskBlockerMap={{ 'TASK-DOING': '等待后端联调' }}
        onBlockerChange={(name, text) => {
          saved = { name, text }
        }}
        onTaskClick={() => {}}
      />
    )
    // 已有备注应展示出来
    expect(screen.getByText('等待后端联调')).toBeTruthy()
    // 点击进入编辑态，修改后保存
    fireEvent.click(screen.getByText('等待后端联调'))
    const textarea = screen.getByDisplayValue('等待后端联调')
    fireEvent.change(textarea, { target: { value: '后端已就绪，待自测' } })
    // antd 会在两个中文字符间插空格（保→保 存），用 role + 正则匹配避免精确文本不命中
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    expect(saved).toEqual({ name: 'TASK-DOING', text: '后端已就绪，待自测' })
  })

  it('uses a full-width blocker editor with actions below the textarea', () => {
    render(
      <KanbanView
        tasks={makeTasks()}
        workflowSteps={steps}
        taskWorkflowMap={{}}
        taskStatusMap={statusMap}
        taskBlockerMap={{}}
        onBlockerChange={() => {}}
        onTaskClick={() => {}}
      />
    )
    // 添加入口点击后进入备注编辑态。
    fireEvent.click(screen.getAllByText('添加备注')[0])
    // editor 为备注编辑区域，应包住 textarea 与底部操作区。
    const editor = screen.getByTestId('kanban-blocker-editor')
    // textarea 为完整宽度输入区，避免和保存按钮横向挤在同一行。
    const textarea = editor.querySelector('textarea')
    // actions 为底部操作区，用于放置取消/保存按钮。
    const actions = screen.getByTestId('kanban-blocker-actions')

    expect(textarea).toBeTruthy()
    expect(textarea.style.width).toBe('100%')
    expect(
      actions.compareDocumentPosition(textarea) &
        Node.DOCUMENT_POSITION_PRECEDING
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: /取\s*消/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /保\s*存/ })).toBeTruthy()
  })

  it('shows 添加备注 entry when task has no blocker', () => {
    render(
      <KanbanView
        tasks={makeTasks()}
        workflowSteps={steps}
        taskWorkflowMap={{}}
        taskStatusMap={statusMap}
        taskBlockerMap={{}}
        onBlockerChange={() => {}}
        onTaskClick={() => {}}
      />
    )
    // 三个任务都没备注，应各有一个「添加备注」入口
    expect(screen.getAllByText('添加备注').length).toBe(3)
  })

  it('calls onTaskClick with task name when title is clicked', () => {
    // clicked 记录点击回调收到的任务名
    let clicked = null
    render(
      <KanbanView
        tasks={makeTasks()}
        workflowSteps={steps}
        taskWorkflowMap={{}}
        taskStatusMap={statusMap}
        taskBlockerMap={{}}
        onBlockerChange={() => {}}
        onTaskClick={(name) => {
          clicked = name
        }}
      />
    )
    fireEvent.click(screen.getByText('TASK-DOING'))
    expect(clicked).toBe('TASK-DOING')
  })

  it('renders empty gracefully with no tasks', () => {
    render(
      <KanbanView
        tasks={[]}
        workflowSteps={steps}
        taskWorkflowMap={{}}
        taskStatusMap={{}}
        taskBlockerMap={{}}
        onBlockerChange={() => {}}
        onTaskClick={() => {}}
      />
    )
    expect(screen.getAllByText('无任务').length).toBe(
      DEFAULT_TASK_STATUSES.length
    )
  })
})
