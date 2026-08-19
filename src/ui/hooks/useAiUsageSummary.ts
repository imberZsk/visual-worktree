import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.ts'

// USAGE_SCAN_DEBOUNCE_MS 存储首屏与配置变化后的统计等待时间，让窗口渲染和 Git 扫描先完成。
const USAGE_SCAN_DEBOUNCE_MS = 1500

/**
 * 加载可见任务的 AI 用量，并计算工具栏总计。
 * @param {object} options - 用量查询依赖。
 * @param {Array<object>} options.tasks - 当前可见任务列表。
 * @param {string[]} options.usageTools - 当前选择的用量统计工具。
 * @param {object} options.pricingConfig - 当前全部 Token 计价配置。
 * @param {boolean} [options.enabled] - 是否在当前页面启动用量扫描。
 * @returns {{usageMap:Record<string,object>,loading:boolean,total:{tokens:number,usd:number,cny:number}}} 任务用量映射、加载状态与总计。
 */
export default function useAiUsageSummary({
  tasks,
  usageTools,
  pricingConfig,
  enabled = true,
}) {
  // usageMap 存储任务名到 AI 用量汇总的映射。
  const [usageMap, setUsageMap] = useState({})
  // taskNamesKey 存储稳定的任务名签名，避免仅数组引用变化时重复扫描本地会话。
  const taskNamesKey = (tasks || [])
    .map((task) => task?.task || '')
    .filter(Boolean)
    .join('\u0000')
  // usageToolsKey 存储统计工具签名，用于真正切换工具时刷新。
  const usageToolsKey = (usageTools || []).join('\u0000')
  // pricingConfigKey 存储完整价格签名，任一模型单价变化后刷新统计。
  const pricingConfigKey = JSON.stringify(pricingConfig || {})
  // loading 标记批量用量扫描是否正在等待或执行，供任务标签统一展示计算中状态。
  const [loading, setLoading] = useState(Boolean(enabled && taskNamesKey))

  useEffect(() => {
    if (!enabled || !taskNamesKey) {
      setUsageMap({})
      setLoading(false)
      return undefined
    }
    setLoading(true)
    // cancelled 标记 hook 卸载或依赖变化后不再写入旧请求结果。
    let cancelled = false
    // taskNames 存储本次需要查询用量的可见任务名。
    const taskNames = taskNamesKey.split('\u0000')
    // scanTimer 延迟启动磁盘密集型会话扫描；依赖连续变化时 cleanup 会取消旧任务，避免并发 Worker 抢占启动资源。
    const scanTimer = window.setTimeout(() => {
      api
        .getClaudeTasksSummary(taskNames)
        .then((summary) => {
          if (!cancelled) {
            setUsageMap(summary || {})
            setLoading(false)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setUsageMap({})
            setLoading(false)
          }
        })
    }, USAGE_SCAN_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(scanTimer)
    }
  }, [enabled, taskNamesKey, usageToolsKey, pricingConfigKey])

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

  return { usageMap, loading, total }
}
