import { Card, Progress, Tag, Space, Typography, Empty, Badge, Input, Button, theme } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, PauseCircleOutlined, EditOutlined, WarningOutlined, CloseOutlined, CheckOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { computeWorkflowProgress } from '../workflowLogic.js';
import { getTaskStatusMeta, DEFAULT_TASK_STATUS } from '../worktreeLogic.js';

const { Text } = Typography;

// 人工状态 key → 看板列的映射：决定每个任务落在哪一列。
// 「未开始」入「待启动」；「已发布」入「已完成」；其余研发阶段入「进行中」。
const STATUS_TO_COLUMN = {
  'not-started': 'pending',
  developing: 'inProgress',
  'self-testing': 'inProgress',
  'pending-test': 'inProgress',
  testing: 'inProgress',
  'pending-release': 'inProgress',
  released: 'completed',
};

/**
 * 任务进度看板视图：按人工状态分三列展示任务（待启动/进行中/已完成）。
 * 工作流勾选进度作为卡片上的辅助信息（进度条），不再用于分组。
 * @param {Array<{task:string, worktrees:Array}>} tasks - 任务分组列表（每项含 task 任务名、worktrees 列表）
 * @param {Array<{key:string,label:string}>} workflowSteps - 全局工作流步骤清单（进度条的分母）
 * @param {Record<string,string[]>} taskWorkflowMap - 任务名 → 已勾选步骤 key 数组
 * @param {Record<string,string>} taskStatusMap - 任务名 → 人工状态 key（分组依据）
 * @param {Record<string,string>} taskBlockerMap - 任务名 → 卡点备注文本
 * @param {(taskName:string, text:string) => void} onBlockerChange - 保存卡点备注回调
 * @param {(taskName:string) => void} onTaskClick - 点击任务卡片回调（跳转到 worktree 视图）
 */
export default function KanbanView({ tasks = [], workflowSteps = [], taskWorkflowMap = {}, taskStatusMap = {}, taskBlockerMap = {}, onBlockerChange, onTaskClick }) {
  // 取主题 token，替换写死颜色以适配明暗主题
  const { token } = theme.useToken();
  // editingTask 当前正在编辑卡点的任务名；null 表示无
  const [editingTask, setEditingTask] = useState(null);
  // editingText 卡点编辑框的当前输入值
  const [editingText, setEditingText] = useState('');

  /**
   * 进入某任务的卡点编辑态，预填已有备注
   * @param {string} taskName - 任务名
   */
  const startEditBlocker = (taskName) => {
    setEditingTask(taskName);
    setEditingText(taskBlockerMap[taskName] || '');
  };

  /**
   * 保存当前编辑的卡点备注并退出编辑态
   */
  const saveBlocker = () => {
    if (editingTask != null) onBlockerChange?.(editingTask, editingText);
    setEditingTask(null);
    setEditingText('');
  };

  /**
   * 取消当前卡点编辑并丢弃未保存输入
   */
  const cancelBlocker = () => {
    setEditingTask(null);
    setEditingText('');
  };

  /**
   * 汇总某任务下所有 worktree 的状态计数（变更/落后/失效），用于卡片底部提示
   * @param {object} task - 任务分组项
   * @returns {{dirty:number, behind:number, prunable:number}} 各状态的 worktree 数量
   */
  const getWorktreeStats = (task) => {
    // stats 累计该任务下处于各异常状态的 worktree 数量
    const stats = { dirty: 0, behind: 0, prunable: 0 };
    for (const wt of task.worktrees || []) {
      if (wt.hasUncommittedChanges) stats.dirty += 1;
      if (wt.behind > 0) stats.behind += 1;
      if (wt.prunable || wt.missing) stats.prunable += 1;
    }
    return stats;
  };

  // 按人工状态分组：依据 taskStatusMap 查 STATUS_TO_COLUMN，未设置/未知状态归入「待启动」
  const grouped = { pending: [], inProgress: [], completed: [] };
  for (const task of tasks) {
    // statusKey 该任务的人工状态 key，未设置时回退默认「未开始」
    const statusKey = taskStatusMap[task.task] || DEFAULT_TASK_STATUS;
    // column 该状态对应的列，未知状态兜底到待启动
    const column = STATUS_TO_COLUMN[statusKey] || 'pending';
    grouped[column].push(task);
  }

  /**
   * 渲染单个任务卡片
   * @param {object} task - 任务分组项
   * @returns {JSX.Element} 卡片元素
   */
  const renderCard = (task) => {
    // progress 工作流进度 {done,total}，作为卡片辅助信息
    const progress = computeWorkflowProgress(workflowSteps, taskWorkflowMap, task.task);
    // percent 完成百分比（total 为 0 时按 0 处理，避免除零得 NaN）
    const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
    // statusMeta 人工状态展示信息（label/color）
    const statusMeta = getTaskStatusMeta(taskStatusMap[task.task]);
    // stats 该任务下 worktree 的异常状态计数
    const stats = getWorktreeStats(task);
    // blocker 该任务的卡点备注文本（可能为空）
    const blocker = taskBlockerMap[task.task];
    // isEditing 当前卡片是否处于卡点编辑态
    const isEditing = editingTask === task.task;

    return (
      <Card key={task.task} size="small" hoverable style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {/* 标题行：任务名（点击跳转）+ 人工状态标签 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Text strong style={{ fontSize: 14, wordBreak: 'break-all', cursor: 'pointer' }} onClick={() => onTaskClick?.(task.task)}>{task.task}</Text>
            <Tag color={statusMeta.color} style={{ marginInlineEnd: 0, flexShrink: 0 }}>{statusMeta.label}</Tag>
          </div>
          {/* 工作流进度条 + N/M 文字（辅助信息，非分组依据） */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Progress percent={percent} size="small" style={{ flex: 1, marginBottom: 0 }} />
            <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>{progress.done}/{progress.total}</Text>
          </div>
          {/* 卡点备注区：编辑态显示输入框，否则显示已有备注/添加入口 */}
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
                placeholder="记录当前卡点/阻塞点，如：等待后端联调、设计稿未定…"
                autoSize={{ minRows: 2, maxRows: 4 }}
                autoFocus
                style={{ width: '100%' }}
              />
              <div data-testid="kanban-blocker-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button icon={<CloseOutlined />} size="small" onClick={cancelBlocker}>取消</Button>
                <Button icon={<CheckOutlined />} type="primary" size="small" onClick={saveBlocker}>保存</Button>
              </div>
            </div>
          ) : blocker ? (
            // 已有卡点：黄色警示框展示，点击进入编辑
            <div
              onClick={() => startEditBlocker(task.task)}
              style={{ display: 'flex', gap: 8, padding: '8px 10px', background: token.colorWarningBg, border: `1px solid ${token.colorWarningBorder}`, borderRadius: token.borderRadius, cursor: 'pointer', alignItems: 'flex-start' }}
            >
              <WarningOutlined style={{ color: token.colorWarning, marginTop: 2, flexShrink: 0 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                <Text type="secondary" style={{ fontSize: 11, lineHeight: '16px' }}>卡点</Text>
                <Text style={{ fontSize: 12, whiteSpace: 'pre-wrap', lineHeight: '18px' }}>{blocker}</Text>
              </div>
            </div>
          ) : (
            // 无卡点：整行虚线入口与卡片内容宽度对齐，避免文字按钮悬空显得不齐。
            <Button block type="dashed" size="small" icon={<EditOutlined />} onClick={() => startEditBlocker(task.task)} style={{ color: token.colorTextTertiary, fontSize: 12 }}>
              添加卡点
            </Button>
          )}
          {/* 底部：worktree 数量 + 异常状态计数 */}
          <Space size={6} wrap>
            <Badge count={task.worktrees?.length || 0} showZero color={token.colorPrimary} />
            {stats.dirty > 0 && <Tag color="red" style={{ marginInlineEnd: 0, fontSize: 11 }}>有变更 {stats.dirty}</Tag>}
            {stats.behind > 0 && <Tag color="gold" style={{ marginInlineEnd: 0, fontSize: 11 }}>落后 {stats.behind}</Tag>}
            {stats.prunable > 0 && <Tag color="default" style={{ marginInlineEnd: 0, fontSize: 11 }}>失效 {stats.prunable}</Tag>}
          </Space>
        </Space>
      </Card>
    );
  };

  /**
   * 渲染单列
   * @param {string} title - 列标题
   * @param {Array} list - 该列的任务列表
   * @param {JSX.Element} icon - 列图标
   * @param {string} headerBg - 列头背景色（用 theme token 适配明暗主题）
   * @returns {JSX.Element} 列元素
   */
  const renderColumn = (title, list, icon, headerBg) => (
    <div style={{ flex: 1, minWidth: 280 }}>
      {/* 列头：用 token 颜色 + 边框，适配暗黑模式（原硬编码 #f0f0f0 等在暗黑下看不清） */}
      <div style={{ padding: '8px 12px', background: headerBg, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadius, marginBottom: 12 }}>
        <Space>
          {icon}
          <Text strong>{title}</Text>
          <Tag style={{ marginInlineEnd: 0 }}>{list.length}</Tag>
        </Space>
      </div>
      <div style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto', paddingRight: 8 }}>
        {list.length === 0 ? (
          <Empty description="无任务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          list.map(renderCard)
        )}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', gap: 16, padding: '8px 0' }}>
      {/* 三列背景用 token 派生色，明暗主题下都有恰当对比度 */}
      {renderColumn('待启动', grouped.pending, <PauseCircleOutlined style={{ color: token.colorTextSecondary }} />, token.colorFillQuaternary)}
      {renderColumn('进行中', grouped.inProgress, <ClockCircleOutlined style={{ color: token.colorPrimary }} />, token.colorPrimaryBg)}
      {renderColumn('已完成', grouped.completed, <CheckCircleOutlined style={{ color: token.colorSuccess }} />, token.colorSuccessBg)}
    </div>
  );
}
