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

/**
 * 渲染 Worktree 视图的历史、清理、用量、显隐和排序操作。
 * @param {object} props - 组件属性
 * @param {{tokens:number,usd:number,cny:number}} props.aiUsageTotal - 全部任务 AI 用量汇总
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
                <div className="worktree-toolbar__usage-row">
                  <span>美元</span>
                  <span>${aiUsageTotal.usd.toFixed(3)}</span>
                </div>
                <div className="worktree-toolbar__usage-row">
                  <span>人民币</span>
                  <span>¥{aiUsageTotal.cny.toFixed(2)}</span>
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
              · ${aiUsageTotal.usd.toFixed(3)}
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
