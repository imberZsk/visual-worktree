import {
  Card,
  Progress,
  Tag,
  Space,
  Typography,
  Empty,
  Badge,
  Input,
  Button,
  Spin,
  Tooltip,
  theme,
} from 'antd'
import {
  EditOutlined,
  WarningOutlined,
  CloseOutlined,
  CheckOutlined,
  PushpinOutlined,
  PushpinFilled,
} from '@ant-design/icons'
import { useState } from 'react'
import { computeWorkflowProgress } from '../workflowLogic.ts'
import {
  getTaskStatusMeta,
  getTaskStatuses,
  DEFAULT_TASK_STATUS,
} from '../worktreeLogic.ts'
import { normalizeKanbanSettings } from '../../core/kanbanSettings.js'
import { VscodeIcon } from '../icons.tsx'
import './KanbanView.css'
import TaskTagControl from './TaskTagControl.tsx'

const { Text } = Typography

/**
 * 任务进度看板视图：按当前工作区的动态人工状态逐列展示任务。
 * 工作流勾选进度作为卡片上的辅助信息（进度条），不再用于分组。
 * @param {Array<{task:string, worktrees:Array}>} tasks - 任务分组列表（每项含 task 任务名、worktrees 列表）
 * @param {Array<{key:string,label:string}>} workflowSteps - 全局工作流步骤清单（进度条的分母）
 * @param {Record<string,string[]>} taskWorkflowMap - 任务名 → 已勾选步骤 key 数组
 * @param {Record<string,string>} taskStatusMap - 任务名 → 人工状态 key（分组依据）
 * @param {Array<object>} taskStatuses - 当前工作区动态任务状态定义列表
 * @param {Record<string,string>} taskTagMap - 任务名到分类 key 的映射。
 * @param {Array<object>} taskTags - 当前工作区任务分类定义。
 * @param {boolean} showTaskTags - 是否在看板任务卡片展示分类标签。
 * @param {{hiddenStatusKeys?:string[]}} kanbanSettings - 当前工作区看板列显示偏好
 * @param {string[]} pinnedTaskKeys - 已置顶任务名列表
 * @param {Record<string,string>} taskBlockerMap - 任务名 → 备注文本（属性名沿用历史 blocker 标识）
 * @param {boolean} loading - 是否正在首次加载看板任务数据
 * @param {(taskName:string, text:string) => void} onBlockerChange - 保存备注回调
 * @param {(taskName:string) => void} onTaskClick - 点击任务卡片回调（跳转到 worktree 视图）
 * @param {(taskName:string,pinned:boolean) => void} onTaskPinnedChange - 置顶或取消置顶任务回调
 * @param {(path:string) => void} onOpenVscode - 使用 VSCode 打开任务目录回调
 * @param {(taskName:string,tagKey:string)=>void} onTaskTagChange - 修改任务分类回调。
 */
export default function KanbanView({
  tasks = [],
  workflowSteps = [],
  taskWorkflowMap = {},
  taskStatusMap = {},
  taskStatuses = [],
  taskTagMap = {},
  taskTags = [],
  showTaskTags = true,
  kanbanSettings = {},
  pinnedTaskKeys = [],
  taskBlockerMap = {},
  loading = false,
  onBlockerChange,
  onTaskClick,
  onTaskPinnedChange,
  onOpenVscode,
  onTaskTagChange,
}) {
  // 取主题 token，替换写死颜色以适配明暗主题
  const { token } = theme.useToken()
  // editingTask 当前正在编辑备注的任务名；null 表示无
  const [editingTask, setEditingTask] = useState(null)
  // editingText 备注编辑框的当前输入值
  const [editingText, setEditingText] = useState('')

  if (loading && tasks.length === 0) {
    return (
      <div className="task-view-state" role="status" aria-label="看板加载状态">
        <Spin size="small" />
      </div>
    )
  }

  /**
   * 进入某任务的备注编辑态，预填已有内容
   * @param {string} taskName - 任务名
   */
  const startEditBlocker = (taskName) => {
    setEditingTask(taskName)
    setEditingText(taskBlockerMap[taskName] || '')
  }

  /**
   * 保存当前编辑的备注并退出编辑态
   */
  const saveBlocker = () => {
    if (editingTask != null) onBlockerChange?.(editingTask, editingText)
    setEditingTask(null)
    setEditingText('')
  }

  /**
   * 取消当前备注编辑并丢弃未保存输入
   */
  const cancelBlocker = () => {
    setEditingTask(null)
    setEditingText('')
  }

  /**
   * 汇总某任务下所有 worktree 的状态计数（变更/落后/失效），用于卡片底部提示
   * @param {object} task - 任务分组项
   * @returns {{dirty:number, behind:number, prunable:number}} 各状态的 worktree 数量
   */
  const getWorktreeStats = (task) => {
    // stats 累计该任务下处于各异常状态的 worktree 数量
    const stats = { dirty: 0, behind: 0, prunable: 0 }
    for (const wt of task.worktrees || []) {
      if (wt.hasUncommittedChanges) stats.dirty += 1
      if (wt.behind > 0) stats.behind += 1
      if (wt.prunable || wt.missing) stats.prunable += 1
    }
    return stats
  }

  // normalizedTaskStatuses 存储按设置顺序清洗后的动态状态，每个状态直接对应一列。
  const normalizedTaskStatuses = getTaskStatuses(taskStatuses)
  // normalizedKanbanSettings 存储清理失效状态后的当前列偏好。
  const normalizedKanbanSettings = normalizeKanbanSettings(
    kanbanSettings,
    normalizedTaskStatuses
  )
  // hiddenStatusKeySet 存储当前不在看板展示的状态 key，供列派生快速判断。
  const hiddenStatusKeySet = new Set(normalizedKanbanSettings.hiddenStatusKeys)
  // visibleTaskStatuses 存储设置顺序下实际展示的看板状态列。
  const visibleTaskStatuses = normalizedTaskStatuses.filter(
    (status) => !hiddenStatusKeySet.has(status.key)
  )
  // pinnedTaskKeySet 存储已置顶任务名，用于列内排序和卡片按钮状态判断。
  const pinnedTaskKeySet = new Set(pinnedTaskKeys)
  // groupedTasks 存储状态 key 到任务列表的映射，状态被隐藏时其任务也随对应列隐藏。
  const groupedTasks = Object.fromEntries(
    normalizedTaskStatuses.map((status) => [status.key, []])
  )
  for (const task of tasks) {
    // statusKey 该任务的人工状态 key，未设置时回退默认「未开始」
    const statusKey = taskStatusMap[task.task] || DEFAULT_TASK_STATUS
    // statusMeta 存储当前状态的动态配置；未知状态安全回退当前工作区默认状态。
    const statusMeta = getTaskStatusMeta(statusKey, taskStatuses)
    groupedTasks[statusMeta.key]?.push(task)
  }

  /**
   * 渲染单个任务卡片
   * @param {object} task - 任务分组项
   * @returns {JSX.Element} 卡片元素
   */
  const renderCard = (task) => {
    // progress 工作流进度 {done,total}，作为卡片辅助信息
    const progress = computeWorkflowProgress(
      workflowSteps,
      taskWorkflowMap,
      task.task
    )
    // percent 完成百分比（total 为 0 时按 0 处理，避免除零得 NaN）
    const percent =
      progress.total > 0
        ? Math.round((progress.done / progress.total) * 100)
        : 0
    // statusMeta 人工状态展示信息（label/color）
    const statusMeta = getTaskStatusMeta(taskStatusMap[task.task], taskStatuses)
    // stats 该任务下 worktree 的异常状态计数
    const stats = getWorktreeStats(task)
    // blocker 该任务的备注文本（变量名沿用历史存储概念，内容可能为空）
    const blocker = taskBlockerMap[task.task]
    // isEditing 当前卡片是否处于备注编辑态
    const isEditing = editingTask === task.task
    // taskPinned 标记当前任务是否已置顶，状态与 Worktree Tab 共用同一份持久化偏好。
    const taskPinned = pinnedTaskKeySet.has(task.task)
    // taskPath 存储任务目录路径；缺失时禁用 VSCode 操作。
    const taskPath = typeof task.path === 'string' ? task.path : ''

    return (
      <Card
        key={task.task}
        className="kanban-task-card"
        size="small"
        hoverable
        style={{ marginBottom: 12 }}
      >
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          {/* 标题行：任务名（点击跳转）+ 人工状态标签 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Text
              strong
              style={{
                fontSize: 14,
                wordBreak: 'break-all',
                cursor: 'pointer',
                flex: 1,
                minWidth: 0,
              }}
              onClick={() => onTaskClick?.(task.task)}
            >
              {task.task}
            </Text>
            <Space size={4} style={{ flexShrink: 0 }}>
              {showTaskTags && (
                <TaskTagControl
                  taskName={task.task}
                  tagKey={taskTagMap[task.task]}
                  taskTags={taskTags}
                  onChange={onTaskTagChange}
                />
              )}
              <Tag
                color={statusMeta.color}
                style={{ marginInlineEnd: 0, flexShrink: 0 }}
              >
                {statusMeta.label}
              </Tag>
              <Tooltip title={taskPinned ? '取消置顶任务' : '置顶任务'}>
                <Button
                  type="text"
                  size="small"
                  aria-label={`${taskPinned ? '取消置顶任务' : '置顶任务'} ${task.task}`}
                  icon={taskPinned ? <PushpinFilled /> : <PushpinOutlined />}
                  onClick={() => onTaskPinnedChange?.(task.task, !taskPinned)}
                />
              </Tooltip>
              <Tooltip title={taskPath ? '在 VSCode 中打开' : '任务目录不可用'}>
                <span>
                  <Button
                    type="text"
                    size="small"
                    disabled={!taskPath}
                    aria-label={`在 VSCode 中打开任务 ${task.task}`}
                    icon={<VscodeIcon />}
                    onClick={() => onOpenVscode?.(taskPath)}
                  />
                </span>
              </Tooltip>
            </Space>
          </div>
          {/* 工作流进度条 + N/M 文字（辅助信息，非分组依据） */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Progress
              percent={percent}
              size="small"
              style={{ flex: 1, marginBottom: 0 }}
            />
            <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>
              {progress.done}/{progress.total}
            </Text>
          </div>
          {/* 备注区：编辑态显示输入框，否则显示已有备注/添加入口 */}
          {isEditing ? (
            <div
              data-testid="kanban-blocker-editor"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: 8,
                background: token.colorFillQuaternary,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: token.borderRadius,
                width: '100%',
              }}
            >
              <Input.TextArea
                value={editingText}
                onChange={(e) => setEditingText(e.target.value)}
                placeholder="记录任务备注，如：等待后端联调、设计稿待确认…"
                autoSize={{ minRows: 2, maxRows: 4 }}
                autoFocus
                style={{ width: '100%' }}
              />
              <div
                data-testid="kanban-blocker-actions"
                style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}
              >
                <Button
                  icon={<CloseOutlined />}
                  size="small"
                  onClick={cancelBlocker}
                >
                  取消
                </Button>
                <Button
                  icon={<CheckOutlined />}
                  type="primary"
                  size="small"
                  onClick={saveBlocker}
                >
                  保存
                </Button>
              </div>
            </div>
          ) : blocker ? (
            // 已有备注：提示框展示，点击进入编辑
            <div
              onClick={() => startEditBlocker(task.task)}
              style={{
                display: 'flex',
                gap: 8,
                padding: '8px 10px',
                background: token.colorWarningBg,
                border: `1px solid ${token.colorWarningBorder}`,
                borderRadius: token.borderRadius,
                cursor: 'pointer',
                alignItems: 'flex-start',
              }}
            >
              <WarningOutlined
                style={{
                  color: token.colorWarning,
                  marginTop: 2,
                  flexShrink: 0,
                }}
              />
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  minWidth: 0,
                  flex: 1,
                }}
              >
                <Text
                  type="secondary"
                  style={{ fontSize: 11, lineHeight: '16px' }}
                >
                  备注
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                    lineHeight: '18px',
                  }}
                >
                  {blocker}
                </Text>
              </div>
            </div>
          ) : (
            // 无备注：整行虚线入口与卡片内容宽度对齐，避免文字按钮悬空显得不齐。
            <Button
              block
              type="dashed"
              size="small"
              icon={<EditOutlined />}
              onClick={() => startEditBlocker(task.task)}
              style={{ color: token.colorTextTertiary, fontSize: 12 }}
            >
              添加备注
            </Button>
          )}
          {/* 底部：worktree 数量 + 异常状态计数 */}
          <Space size={6} wrap>
            <Badge
              count={task.worktrees?.length || 0}
              showZero
              color={token.colorPrimary}
            />
            {stats.dirty > 0 && (
              <Tag color="red" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                有变更 {stats.dirty}
              </Tag>
            )}
            {stats.behind > 0 && (
              <Tag color="gold" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                落后 {stats.behind}
              </Tag>
            )}
            {stats.prunable > 0 && (
              <Tag color="default" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                失效 {stats.prunable}
              </Tag>
            )}
          </Space>
        </Space>
      </Card>
    )
  }

  /**
   * 渲染单列
   * @param {{key:string,label:string,color:string}} status - 当前列对应的任务状态
   * @param {Array} list - 该列的任务列表
   * @returns {JSX.Element} 列元素
   */
  const renderColumn = (status, list) => {
    // sortedList 存储列内任务顺序：置顶任务在前，其余任务保持原扫描顺序。
    const sortedList = [...list].sort((firstTask, secondTask) => {
      // firstPinned 标记第一项是否已置顶。
      const firstPinned = pinnedTaskKeySet.has(firstTask.task)
      // secondPinned 标记第二项是否已置顶。
      const secondPinned = pinnedTaskKeySet.has(secondTask.task)
      if (firstPinned === secondPinned) return 0
      return firstPinned ? -1 : 1
    })
    return (
      <div
        key={status.key}
        className="kanban-column"
        data-status-key={status.key}
      >
        <div className="kanban-column-header">
          <Space>
            <Tag color={status.color} className="kanban-column-status-tag">
              {status.label}
            </Tag>
            <Tag className="kanban-column-count-tag">{list.length}</Tag>
          </Space>
        </div>
        <div className="kanban-column-content">
          {list.length === 0 ? (
            <Empty description="无任务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            sortedList.map(renderCard)
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="kanban-view">
      <div className="kanban-board-scroll">
        <div className="kanban-board">
          {visibleTaskStatuses.map((status) =>
            renderColumn(status, groupedTasks[status.key] || [])
          )}
        </div>
      </div>
    </div>
  )
}
