import React from 'react'
import { Button, Input, Segmented, Space, Tag, Tooltip } from 'antd'
import {
  DeleteOutlined,
  HistoryOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import './WorktreeToolbar.css'

// WORKTREE_SORT_OPTIONS 存储 Worktree 任务排序方式。
const WORKTREE_SORT_OPTIONS = [
  { label: '状态', value: 'status' },
  { label: '名称', value: 'name' },
]
// USAGE_TOOL_LABELS 存储顶部费用总计使用的工具名称。
const USAGE_TOOL_LABELS = {
  'claude-code': 'Claude',
  codex: 'Codex',
}

/**
 * 按当前币种模式格式化工具栏费用。
 * @param {{usd?:number,cny?:number}} cost - 美元与人民币费用
 * @param {boolean} directCnyDisplay - 是否只显示人民币
 * @returns {string} 格式化后的费用文本
 */
function formatToolbarCost(cost, directCnyDisplay) {
  if (directCnyDisplay) return `¥${(cost?.cny || 0).toFixed(3)}`
  return `$${(cost?.usd || 0).toFixed(3)} / ¥${(cost?.cny || 0).toFixed(2)}`
}

/**
 * 渲染 Worktree 视图的历史、清理、用量、显隐和排序操作。
 * @param {object} props - 组件属性
 * @param {{tokens:number,usd:number,cny:number}} props.aiUsageTotal - 全部任务 AI 用量汇总
 * @param {Array<'claude-code'|'codex'>} props.aiUsageTools - 当前参与统计的工具
 * @param {boolean} props.directCnyDisplay - 是否按人民币 1:1 单币种展示费用
 * @param {boolean} props.hasHiddenTasks - 是否存在隐藏任务
 * @param {boolean} props.showHiddenTasks - 是否正在显示隐藏任务
 * @param {string} props.sortOrder - 当前任务排序方式
 * @param {string} props.keyword - 当前任务或项目搜索词
 * @param {() => void} props.onOpenHistory - 打开历史任务回调
 * @param {() => void} props.onOpenCleanup - 打开清理建议回调
 * @param {() => void} props.onToggleHiddenTasks - 切换隐藏任务展示回调
 * @param {(sortOrder:string) => void} props.onSortOrderChange - 排序方式修改回调
 * @param {(keyword:string) => void} props.onKeywordChange - 搜索词修改回调
 * @returns {JSX.Element} Worktree 视图工具栏
 */
export default function WorktreeToolbar({
  aiUsageTotal,
  aiUsageTools = ['claude-code'],
  directCnyDisplay = false,
  hasHiddenTasks,
  showHiddenTasks,
  sortOrder,
  keyword,
  onOpenHistory,
  onOpenCleanup,
  onToggleHiddenTasks,
  onSortOrderChange,
  onKeywordChange,
}) {
  // selectedUsageTools 存储去重后的统计工具列表。
  const selectedUsageTools = [...new Set(aiUsageTools)]
  // showToolBreakdown 标记是否在顶部同时展示各工具与合计。
  const showToolBreakdown = selectedUsageTools.length > 1
  // toolCostParts 存储各统计工具的累计费用文本。
  const toolCostParts = selectedUsageTools.map((toolId) => ({
    toolId,
    label: USAGE_TOOL_LABELS[toolId] || toolId,
    costText: formatToolbarCost(
      aiUsageTotal.byTool?.[toolId],
      directCnyDisplay
    ),
    primaryCostText: directCnyDisplay
      ? `¥${(aiUsageTotal.byTool?.[toolId]?.cny || 0).toFixed(3)}`
      : `$${(aiUsageTotal.byTool?.[toolId]?.usd || 0).toFixed(3)}`,
  }))
  // combinedCostText 存储全部统计工具费用合计文本。
  const combinedCostText = formatToolbarCost(aiUsageTotal, directCnyDisplay)
  // combinedPrimaryCostText 存储顶部标签使用的紧凑合计费用。
  const combinedPrimaryCostText = directCnyDisplay
    ? `¥${aiUsageTotal.cny.toFixed(3)}`
    : `$${aiUsageTotal.usd.toFixed(3)}`
  return (
    <div className="worktree-toolbar">
      <Space className="worktree-toolbar__primary-actions" size={8} wrap>
        <Button size="small" icon={<HistoryOutlined />} onClick={onOpenHistory}>
          历史任务
        </Button>
        <Button size="small" icon={<DeleteOutlined />} onClick={onOpenCleanup}>
          清理建议
        </Button>
        {aiUsageTotal.tokens > 0 && (
          <Tooltip
            title={
              <div className="worktree-toolbar__usage-tooltip">
                <div className="worktree-toolbar__usage-title">
                  所有任务累计
                </div>
                <div className="worktree-toolbar__usage-row">
                  <span>Token</span>
                  <span>{aiUsageTotal.tokens.toLocaleString()}</span>
                </div>
                {showToolBreakdown &&
                  toolCostParts.map((toolPart) => (
                    <div
                      className="worktree-toolbar__usage-row"
                      key={toolPart.toolId}
                    >
                      <span>{toolPart.label}</span>
                      <span>{toolPart.costText}</span>
                    </div>
                  ))}
                {!showToolBreakdown && !directCnyDisplay && (
                  <div className="worktree-toolbar__usage-row">
                    <span>美元</span>
                    <span>${aiUsageTotal.usd.toFixed(3)}</span>
                  </div>
                )}
                <div className="worktree-toolbar__usage-row">
                  <span>{showToolBreakdown ? '合计' : '人民币'}</span>
                  <span>
                    {showToolBreakdown
                      ? combinedCostText
                      : `¥${aiUsageTotal.cny.toFixed(2)}`}
                  </span>
                </div>
              </div>
            }
          >
            <Tag
              icon={<ThunderboltOutlined />}
              color="purple"
              className="worktree-toolbar__usage-tag"
            >
              总计{' '}
              {aiUsageTotal.tokens >= 1000
                ? `${(aiUsageTotal.tokens / 1000).toFixed(1)}K`
                : aiUsageTotal.tokens}{' '}
              ·{' '}
              {showToolBreakdown
                ? `${toolCostParts
                    .map(
                      (toolPart) =>
                        `${toolPart.label} ${toolPart.primaryCostText}`
                    )
                    .join(' · ')} · 合计 ${combinedPrimaryCostText}`
                : directCnyDisplay
                  ? `¥${aiUsageTotal.cny.toFixed(3)}`
                  : `$${aiUsageTotal.usd.toFixed(3)}`}
            </Tag>
          </Tooltip>
        )}
      </Space>
      <Space className="worktree-toolbar__secondary-actions" size={12} wrap>
        <Input.Search
          className="worktree-toolbar__search"
          placeholder="搜索任务或项目"
          allowClear
          value={keyword}
          onChange={(event) => onKeywordChange(event.target.value)}
        />
        <Button
          size="small"
          disabled={!hasHiddenTasks && !showHiddenTasks}
          onClick={onToggleHiddenTasks}
        >
          {showHiddenTasks ? '收起隐藏任务' : '显示隐藏任务'}
        </Button>
        <Space size={4}>
          <span className="worktree-toolbar__sort-label">排序：</span>
          <Segmented
            className="worktree-sort-segmented"
            size="small"
            value={sortOrder}
            onChange={onSortOrderChange}
            options={WORKTREE_SORT_OPTIONS}
          />
        </Space>
      </Space>
    </div>
  )
}
