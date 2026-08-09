import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.ts'

/**
 * 加载可见任务的 AI 用量，并计算工具栏总计。
 * @param {object} options - 用量查询依赖。
 * @param {Array<object>} options.tasks - 当前可见任务列表。
 * @param {string[]} options.usageTools - 当前选择的用量统计工具。
 * @param {object} options.tokenPricing - 当前 Token 计价配置。
 * @returns {{usageMap:Record<string,object>,total:{tokens:number,usd:number,cny:number}}} 任务用量映射与总计。
 */
export default function useAiUsageSummary({ tasks, usageTools, tokenPricing }) {
  // usageMap 存储任务名到 AI 用量汇总的映射。
  const [usageMap, setUsageMap] = useState({})

  useEffect(() => {
    if (tasks.length === 0) {
      setUsageMap({})
      return undefined
    }
    // cancelled 标记 hook 卸载或依赖变化后不再写入旧请求结果。
    let cancelled = false
    // taskNames 存储本次需要查询用量的可见任务名。
    const taskNames = tasks.map((task) => task.task)
    api
      .getClaudeTasksSummary(taskNames)
      .then((summary) => {
        if (!cancelled) setUsageMap(summary || {})
      })
      .catch(() => {
        if (!cancelled) setUsageMap({})
      })
    return () => {
      cancelled = true
    }
  }, [tasks, usageTools, tokenPricing])

  // total 存储所有可见任务的 Token 和费用总计。
  const total = useMemo(() => {
    // combinedTotal 存储所有可见任务的 Token、费用及按工具拆分合计。
    const combinedTotal = Object.values(usageMap).reduce(
      (summary, taskUsage) => {
        // usage 存储当前任务的各类 Token 用量。
        const usage = taskUsage?.usage || {}
        // tokens 存储当前任务四类 Token 的合计。
        const tokens =
          (usage.input || 0) +
          (usage.output || 0) +
          (usage.cacheWrite || 0) +
          (usage.cacheRead || 0)
        // byTool 存储累加当前任务后各统计工具的费用与 Token 合计。
        const byTool = { ...summary.byTool }
        for (const [toolId, toolSummary] of Object.entries(
          taskUsage?.tools || {}
        )) {
          // toolUsage 存储当前任务指定工具的四类 Token 用量。
          const toolUsage = toolSummary?.usage || {}
          // previousToolTotal 存储该工具已经累加的其他任务数据。
          const previousToolTotal = byTool[toolId] || {
            tokens: 0,
            usd: 0,
            cny: 0,
          }
          byTool[toolId] = {
            tokens:
              previousToolTotal.tokens +
              (toolUsage.input || 0) +
              (toolUsage.output || 0) +
              (toolUsage.cacheWrite || 0) +
              (toolUsage.cacheRead || 0),
            usd: previousToolTotal.usd + (toolSummary?.cost?.usd || 0),
            cny: previousToolTotal.cny + (toolSummary?.cost?.cny || 0),
          }
        }
        return {
          tokens: summary.tokens + tokens,
          usd: summary.usd + (taskUsage?.cost?.usd || 0),
          cny: summary.cny + (taskUsage?.cost?.cny || 0),
          byTool,
        }
      },
      { tokens: 0, usd: 0, cny: 0, byTool: {} }
    )
    return combinedTotal
  }, [usageMap])

  return { usageMap, total }
}
