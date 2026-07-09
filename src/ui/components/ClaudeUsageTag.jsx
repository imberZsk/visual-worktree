import React, { useState, useEffect } from 'react';
import { Tag, Tooltip, Spin } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { api } from '../api.js';

// Claude Code 用量标签：显示任务关联的 token 用量和费用
// 用于在 WorktreePanel 的任务标题栏快速展示 AI 成本

/**
 * Claude Code 用量标签
 * @param {object} props - 组件属性
 * @param {string} props.taskName - 任务名
 * @param {object} [props.summary] - 用量汇总数据（预加载时传入，避免重复请求）
 * @returns {JSX.Element|null} 用量标签（无数据时返回 null）
 */
export default function ClaudeUsageTag({ taskName, summary }) {
  // loading 标记是否正在加载用量数据
  const [loading, setLoading] = useState(!summary);
  // usage 存储该任务的用量汇总：{ sessionCount, usage, cost }
  const [usage, setUsage] = useState(summary);

  // 加载该任务的用量数据（仅在未预加载时请求）
  useEffect(() => {
    if (summary) {
      setUsage(summary);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    // 通过 getClaudeSessionsByTask 获取会话列表，然后手动累加
    // （更轻量级，避免为单个任务调用 getClaudeTasksSummary）
    api.getClaudeSessionsByTask(taskName).then((sessions) => {
      if (cancelled) return;

      // 累加所有会话的 token 用量
      const totalUsage = sessions.reduce(
        (acc, session) => ({
          input: acc.input + (session.usage?.input || 0),
          output: acc.output + (session.usage?.output || 0),
          cacheWrite: acc.cacheWrite + (session.usage?.cacheWrite || 0),
          cacheRead: acc.cacheRead + (session.usage?.cacheRead || 0),
        }),
        { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }
      );

      // 累加费用
      const totalCostUsd = sessions.reduce((sum, s) => sum + (s.cost?.usd || 0), 0);
      const totalCostCny = sessions.reduce((sum, s) => sum + (s.cost?.cny || 0), 0);

      setUsage({
        sessionCount: sessions.length,
        usage: totalUsage,
        cost: { usd: totalCostUsd, cny: totalCostCny },
      });
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [taskName, summary]);

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
    );
  }

  // 无用量数据时不显示标签
  if (!usage || usage.sessionCount === 0) return null;

  // totalTokens 总 token 数（input + output + cacheWrite + cacheRead）
  const totalTokens = (usage.usage?.input || 0) +
    (usage.usage?.output || 0) +
    (usage.usage?.cacheWrite || 0) +
    (usage.usage?.cacheRead || 0);

  // 格式化 token 数（大于 1000 时显示为 K）
  const formatTokens = (n) => {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  // 格式化费用（美元，保留 3 位小数）
  const costUsd = usage.cost?.usd || 0;
  const costText = costUsd >= 0.01 ? `$${costUsd.toFixed(3)}` : `$${costUsd.toFixed(4)}`;

  // row 渲染一行「标签 — 值」，标签与值左右对齐，使多行指标整齐易读
  const row = (label, value) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );

  // Tooltip 详细信息：每个指标独占一行、标签与值左右对齐
  const tooltipContent = (
    <div style={{ fontSize: 12, minWidth: 180, lineHeight: 1.8 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Claude Code 用量统计</div>
      {row('会话数', usage.sessionCount)}
      {row('Input tokens', formatTokens(usage.usage?.input || 0))}
      {row('Output tokens', formatTokens(usage.usage?.output || 0))}
      {row('Cache write', formatTokens(usage.usage?.cacheWrite || 0))}
      {row('Cache read', formatTokens(usage.usage?.cacheRead || 0))}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginTop: 4, fontWeight: 600 }}>
        <span>总费用</span>
        <span>{costText} (¥{(usage.cost?.cny || 0).toFixed(2)})</span>
      </div>
    </div>
  );

  return (
    <Tooltip title={tooltipContent}>
      <Tag
        className="worktree-title-tag claude-usage-tag"
        icon={<ThunderboltOutlined />}
        color="purple"
        style={{ minWidth: 72 }}
      >
        {formatTokens(totalTokens)} · {costText}
      </Tag>
    </Tooltip>
  );
}
