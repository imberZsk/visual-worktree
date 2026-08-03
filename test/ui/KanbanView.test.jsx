import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import KanbanView from '../../src/ui/components/KanbanView.tsx'
import { DEFAULT_TASK_STATUSES } from '../../src/core/taskStatuses.js'

// KanbanView 组件测试：跑在 happy-dom 环境。
// 验证按「人工状态」分三列（不是工作流进度）、任务名渲染、备注编辑/展示、点击跳转。

afterEach(() => cleanup())

// steps 全局工作流步骤清单（仅作进度条辅助信息，非分组依据）
const steps = [
  { key: 's1', label: '开始' },
  { key: 's2', label: '单测' },
  { key: 's3', label: 'Jira评论' },
]

// makeTasks 构造三个任务，分别对应「待启动/进行中/已完成」三种人工状态
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
  // TASK-PENDING 不设置，应回退「未开始」入待启动列
}

describe('KanbanView', () => {
  it('首次加载且还没有任务数据时只显示内容区 loading', () => {
    // container 存储渲染结果，用于确认只保留 Ant Design Spin 而不显示加载文案。
    const { container } = render(<KanbanView tasks={[]} loading />)

    expect(screen.getByRole('status', { name: '看板加载状态' })).toBeTruthy()
    expect(container.querySelector('.ant-spin')).toBeTruthy()
    expect(screen.queryByText('正在加载看板...')).toBeNull()
    expect(screen.queryByText('待启动')).toBeNull()
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

    // pendingCard 存储待启动列的任务卡片，用于找到对应列容器。
    const pendingCard = screen.getByText('TASK-PENDING').closest('.ant-card')
    // pendingColumn 存储待启动列，标题和内容必须共享同一水平边界。
    const pendingColumn = pendingCard?.closest('.kanban-column')
    // columnContent 存储卡片列表容器，不应再用固定右内边距缩窄任务卡片。
    const columnContent = pendingColumn?.querySelector('.kanban-column-content')
    expect(pendingColumn?.querySelector('.kanban-column-header')).toBeTruthy()
    expect(columnContent?.style.paddingRight).toBe('')
  })

  it('groups tasks by manual status, not workflow progress', () => {
    // 即便完全没勾选任何工作流步骤（taskWorkflowMap 为空），
    // 已发布任务也应进「已完成」、开发中进「进行中」——验证分组依据是人工状态。
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
    expect(screen.getByText('待启动')).toBeTruthy()
    expect(screen.getByText('进行中')).toBeTruthy()
    expect(screen.getByText('已完成')).toBeTruthy()
    // 三列的任务名应分别落位：用 DOM 顺序断言列计数标签为 1/1/1
    const counts = Array.from(container.querySelectorAll('.ant-tag')).map(
      (el) => el.textContent
    )
    // 三列各 1 个任务
    expect(counts.filter((t) => t === '1').length).toBeGreaterThanOrEqual(3)
  })

  it('shows workspace-specific labels without changing kanban grouping', () => {
    render(
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

    // developingCard 存储使用自定义“处理中”标签的任务卡片。
    const developingCard = screen.getByText('处理中').closest('.ant-card')
    // releasedCard 存储使用自定义“已上线”标签的任务卡片。
    const releasedCard = screen.getByText('已上线').closest('.ant-card')
    expect(developingCard?.parentElement?.parentElement?.textContent).toContain(
      '进行中'
    )
    expect(releasedCard?.parentElement?.parentElement?.textContent).toContain(
      '已完成'
    )
  })

  it('uses a custom status kanban group', () => {
    // taskStatuses 存储新增“已验收”并明确归入已完成列的动态状态配置。
    const taskStatuses = [
      ...DEFAULT_TASK_STATUSES,
      {
        key: 'accepted',
        label: '已验收',
        color: 'blue',
        kanbanColumn: 'completed',
      },
    ]
    render(
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

    // customStatusCard 存储使用自定义完成态的任务卡片。
    const customStatusCard = screen.getByText('已验收').closest('.ant-card')
    expect(
      customStatusCard?.parentElement?.parentElement?.textContent
    ).toContain('已完成')
  })

  it('all tasks fall into 待启动 when no status set', () => {
    // 不传 statusMap：全部回退「未开始」→ 全进待启动。这本是用户报告的「全在待启动」场景，
    // 此时确实应全在待启动（因为都没标状态），符合预期。
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
    // 进行中/已完成两列应都为空态
    expect(screen.getAllByText('无任务').length).toBe(2)
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
    expect(screen.getAllByText('无任务').length).toBe(3)
  })
})
