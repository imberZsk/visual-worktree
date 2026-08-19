import React, { useState, useEffect } from 'react'
import { Tag, Tooltip, Spin } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import { api } from '../api.ts'

// USAGE_TOOL_LABELS 存储统计工具在费用明细中的紧凑显示名称。
const USAGE_TOOL_LABELS = {
  'claude-code': 'Claude',
  codex: 'Codex',
}
// DIRECT_CNY_COST_PRECISION 存储中转账单直接人民币显示时保留的小数位数。
const DIRECT_CNY_COST_PRECISION = 6

/**
 * 按当前币种模式格式化费用，小额费用保留更多小数避免显示为零。
 * @param {object} cost - 包含 usd/cny 的费用对象
 * @param {boolean} directCnyDisplay - 是否直接显示人民币
 * @returns {string} 带货币符号的费用文本
 */
function formatCost(cost, directCnyDisplay) {
  // costValue 存储当前展示模式使用的费用数值。
  const costValue = directCnyDisplay ? cost?.cny || 0 : cost?.usd || 0
  // costSymbol 存储当前展示模式使用的货币符号。
  const costSymbol = directCnyDisplay ? '¥' : '$'
  // costPrecision 存储当前金额展示所需的小数位数，直接人民币模式需与中转账单一致。
  const costPrecision = directCnyDisplay
    ? DIRECT_CNY_COST_PRECISION
    : costValue >= 0.01
      ? 3
      : 4
  return `${costSymbol}${costValue.toFixed(costPrecision)}`
}

// Claude Code 用量标签：显示任务关联的 token 用量和费用
// 用于在 WorktreePanel 的任务标题栏快速展示 AI 成本

/**
 * Claude Code 用量标签
 * @param {object} props - 组件属性
 * @param {string} props.taskName - 任务名
 * @param {object} [props.summary] - 用量汇总数据（预加载时传入，避免重复请求）
 * @param {boolean} [props.summaryLoading] - 外部批量汇总是否仍在计算
 * @param {boolean} [props.fetchWhenSummaryMissing] - 缺少汇总时是否允许单任务兜底查询
 * @param {Array<'claude-code'|'codex'>} [props.usageTools] - 当前统计工具
 * @param {boolean} [props.directCnyDisplay] - 是否按人民币 1:1 单币种展示费用
 * @returns {JSX.Element|null} 用量标签（无数据时返回 null）
 */
export default function ClaudeUsageTag({
  taskName,
  summary,
  summaryLoading = false,
  fetchWhenSummaryMissing = true,
  usageTools = ['claude-code'],
  directCnyDisplay = false,
}) {
  // loading 标记是否正在加载用量数据
  const [loading, setLoading] = useState(!summary)
  // usage 存储该任务的用量汇总：{ sessionCount, usage, cost }
  const [usage, setUsage] = useState(summary)
  // usageToolsKey 存储工具列表的稳定依赖键，避免数组引用变化重复请求。
  const usageToolsKey = usageTools.join('|')

  // 加载该任务的用量数据（仅在未预加载时请求）
  useEffect(() => {
    if (summary) {
      setUsage(summary)
      setLoading(false)
      return
    }

    // Worktree 页面由一次批量 Worker 扫描提供所有任务价格；禁止每个标签再次同步扫描主进程，避免首屏重复读盘卡顿。
    if (!fetchWhenSummaryMissing) {
      setUsage(undefined)
      setLoading(summaryLoading)
      return undefined
    }

    let cancelled = false
    setLoading(true)

    // 通过 getClaudeSessionsByTask 获取会话列表，然后手动累加
    // （更轻量级，避免为单个任务调用 getClaudeTasksSummary）
    api
      .getClaudeSessionsByTask(taskName)
      .then((sessions) => {
        if (cancelled) return

        // 累加所有会话的 token 用量
        const totalUsage = sessions.reduce(
          (acc, session) => ({
            input: acc.input + (session.usage?.input || 0),
            output: acc.output + (session.usage?.output || 0),
            cacheWrite: acc.cacheWrite + (session.usage?.cacheWrite || 0),
            cacheRead: acc.cacheRead + (session.usage?.cacheRead || 0),
          }),
          { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }
        )

        // 累加费用
        const totalCostUsd = sessions.reduce(
          (sum, s) => sum + (s.cost?.usd || 0),
          0
        )
        const totalCostCny = sessions.reduce(
          (sum, s) => sum + (s.cost?.cny || 0),
          0
        )
        // fallbackToolId 存储旧版会话响应缺少来源时采用的首个已选工具。
        const fallbackToolId = usageToolsKey.split('|')[0] || 'claude-code'
        // tools 存储临时会话结果按来源工具拆分的用量和费用。
        const tools = sessions.reduce((toolSummaryMap, session) => {
          // toolId 存储主进程标注的会话来源，旧响应回退当前首个工具。
          const toolId = session?.usageTool || fallbackToolId
          // previousToolSummary 存储该工具已累计的其他会话数据。
          const previousToolSummary = toolSummaryMap[toolId] || {
            sessionCount: 0,
            usage: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
            cost: { usd: 0, cny: 0 },
          }
          toolSummaryMap[toolId] = {
            sessionCount: previousToolSummary.sessionCount + 1,
            usage: {
              input:
                previousToolSummary.usage.input + (session.usage?.input || 0),
              output:
                previousToolSummary.usage.output + (session.usage?.output || 0),
              cacheWrite:
                previousToolSummary.usage.cacheWrite +
                (session.usage?.cacheWrite || 0),
              cacheRead:
                previousToolSummary.usage.cacheRead +
                (session.usage?.cacheRead || 0),
            },
            cost: {
              usd: previousToolSummary.cost.usd + (session.cost?.usd || 0),
              cny: previousToolSummary.cost.cny + (session.cost?.cny || 0),
            },
          }
          return toolSummaryMap
        }, {})

        setUsage({
          sessionCount: sessions.length,
          usage: totalUsage,
          cost: { usd: totalCostUsd, cny: totalCostCny },
          tools,
        })
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    taskName,
    summary,
    summaryLoading,
    fetchWhenSummaryMissing,
    usageToolsKey,
  ])

  // 加载中显示 loading 状态
  // minWidth 固定标签宽度：loading 态与有数据态共用同一最小宽度，避免三态（loading→null→数据）切换时标题行内其他徽标横向跳动（CLS）
  if (loading) {
    return (
      <Tag
        className="worktree-title-tag claude-usage-tag"
        icon={<Spin size="small" />}
        color="default"
        style={{ minWidth: 72 }}
      >
        AI 用量
      </Tag>
    )
  }

  // 无用量数据时不显示标签
  if (!usage || usage.sessionCount === 0) return null

  // 格式化 token 数（大于 1000 时显示为 K）
  const formatTokens = (n) => {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
    return n.toString()
  }

  // costText 存储全部已选工具的合计费用文本。
  const costText = formatCost(usage.cost, directCnyDisplay)
  // selectedUsageTools 存储去重后的工具列表，异常空值回退 Claude Code。
  const selectedUsageTools = [
    ...new Set(
      Array.isArray(usageTools) && usageTools.length > 0
        ? usageTools
        : ['claude-code']
    ),
  ]
  // toolCostParts 存储双选时各工具独立的 Token 用量和费用文本。
  const toolCostParts = selectedUsageTools.map((toolId) => ({
    toolId,
    label: USAGE_TOOL_LABELS[toolId] || toolId,
    usage: usage.tools?.[toolId]?.usage || {},
    costText: formatCost(usage.tools?.[toolId]?.cost, directCnyDisplay),
  }))
  // showToolBreakdown 标记是否需要同时展示两个工具及合计。
  const showToolBreakdown = selectedUsageTools.length > 1

  // row 渲染一行「标签 — 值」，标签与值左右对齐，使多行指标整齐易读
  const row = (label, value, key) => (
    <div
      key={key}
      style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )

  // Tooltip 详细信息：每个指标独占一行、标签与值左右对齐
  const tooltipContent = (
    <div style={{ fontSize: 12, minWidth: 180, lineHeight: 1.8 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>AI 用量统计</div>
      {row('会话数', usage.sessionCount)}
      {showToolBreakdown ? (
        toolCostParts.map((toolPart) => (
          <React.Fragment key={toolPart.toolId}>
            <div style={{ fontWeight: 600, marginTop: 4 }}>
              {toolPart.label}
            </div>
            {row(
              'Input tokens',
              formatTokens(toolPart.usage.input || 0),
              `${toolPart.toolId}-input`
            )}
            {row(
              'Output tokens',
              formatTokens(toolPart.usage.output || 0),
              `${toolPart.toolId}-output`
            )}
            {row(
              'Cache write',
              formatTokens(toolPart.usage.cacheWrite || 0),
              `${toolPart.toolId}-cache-write`
            )}
            {row(
              'Cache read',
              formatTokens(toolPart.usage.cacheRead || 0),
              `${toolPart.toolId}-cache-read`
            )}
            {row('费用', toolPart.costText, `${toolPart.toolId}-cost`)}
          </React.Fragment>
        ))
      ) : (
        <>
          {row('Input tokens', formatTokens(usage.usage?.input || 0))}
          {row('Output tokens', formatTokens(usage.usage?.output || 0))}
          {row('Cache write', formatTokens(usage.usage?.cacheWrite || 0))}
          {row('Cache read', formatTokens(usage.usage?.cacheRead || 0))}
        </>
      )}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
          marginTop: 4,
          fontWeight: 600,
        }}
      >
        <span>总费用</span>
        <span>
          {directCnyDisplay
            ? costText
            : `${costText} (¥${(usage.cost?.cny || 0).toFixed(2)})`}
        </span>
      </div>
    </div>
  )

  return (
    <Tooltip title={tooltipContent}>
      <Tag
        className="worktree-title-tag claude-usage-tag"
        icon={<ThunderboltOutlined />}
        color="purple"
        style={{ minWidth: 72 }}
      >
        {costText}
      </Tag>
    </Tooltip>
  )
}
