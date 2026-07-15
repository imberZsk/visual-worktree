import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import KanbanView from '../../src/ui/components/KanbanView.tsx'

// KanbanView 组件测试：跑在 happy-dom 环境。
// 验证按「人工状态」分三列（不是工作流进度）、任务名渲染、卡点编辑/展示、点击跳转。

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
    // saved 记录卡点保存回调收到的参数
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
    // 已有卡点应展示出来
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
    // 添加入口点击后进入卡点编辑态。
    fireEvent.click(screen.getAllByText('添加卡点')[0])
    // editor 为卡点编辑区域，应包住 textarea 与底部操作区。
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

  it('shows 添加卡点 entry when task has no blocker', () => {
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
    // 三个任务都没卡点，应各有一个「添加卡点」入口
    expect(screen.getAllByText('添加卡点').length).toBe(3)
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
