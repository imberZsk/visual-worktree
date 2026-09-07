import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.ts'

// USAGE_SCAN_DEBOUNCE_MS 存储首屏与配置变化后的统计等待时间，让窗口渲染和 Git 扫描先完成。
const USAGE_SCAN_DEBOUNCE_MS = 1500
// INITIAL_USAGE_REFRESH_VERSION 存储非手动刷新时的默认版本；此时允许复用 Command+R 的短时结果缓存。
const INITIAL_USAGE_REFRESH_VERSION = 0

/**
 * 加载可见任务的 AI 用量，并计算工具栏总计。
 * @param {object} options - 用量查询依赖。
 * @param {Array<object>} options.tasks - 当前可见任务列表。
 * @param {string[]} options.usageTools - 当前选择的用量统计工具。
 * @param {object} options.pricingConfig - 当前全部 Token 计价配置。
 * @param {boolean} [options.enabled] - 是否在当前页面启动用量扫描。
 * @param {number} [options.refreshVersion] - 用户手动刷新 Worktree 后递增的统计版本。
 * @returns {{usageMap:Record<string,object>,loading:boolean,total:{tokens:number,usd:number,cny:number}}} 任务用量映射、加载状态与总计。
 */
export default function useAiUsageSummary({
  tasks,
  usageTools,
  pricingConfig,
  enabled = true,
  refreshVersion = INITIAL_USAGE_REFRESH_VERSION,
}) {
  // usageMap 存储任务名到 AI 用量汇总的映射。
  const [usageMap, setUsageMap] = useState({})
  // taskNamesKey 存储稳定的任务名签名，避免仅数组引用变化时重复扫描本地会话。
  const taskNamesKey = (tasks || [])
    .map((task) => task?.task || '')
    .filter(Boolean)
    .sort()
    .join('\u0000')
  // usageToolsKey 存储统计工具签名，用于真正切换工具时刷新。
  const usageToolsKey = (usageTools || []).join('\u0000')
  // pricingConfigKey 存储完整价格签名，任一模型单价变化后刷新统计。
  const pricingConfigKey = JSON.stringify(pricingConfig || {})
  // loading 标记批量用量扫描是否正在等待或执行，供任务标签统一展示计算中状态。
  const [loading, setLoading] = useState(Boolean(enabled && taskNamesKey))
  // previousTaskNamesRef 存储上次完成依赖处理的任务集合，用于识别只删除任务的轻量变化。
  const previousTaskNamesRef = useRef([])
  // previousScanInputsRef 存储上次统计配置，用于区分任务展示变化与真正需要重新计价的变化。
  const previousScanInputsRef = useRef({
    usageToolsKey: '',
    pricingConfigKey: '',
    refreshVersion,
  })

  useEffect(() => {
    if (!enabled || !taskNamesKey) {
      setUsageMap({})
      setLoading(false)
      previousTaskNamesRef.current = []
      previousScanInputsRef.current = {
        usageToolsKey,
        pricingConfigKey,
        refreshVersion,
      }
      return undefined
    }
    // taskNames 存储当前需要展示价格的任务名。
    const taskNames = taskNamesKey.split('\u0000')
    // previousTaskNames 存储上次任务名；当前集合是其真子集时说明仅发生删除。
    const previousTaskNames = previousTaskNamesRef.current
    // previousScanInputs 存储上次工具、价格和刷新版本。
    const previousScanInputs = previousScanInputsRef.current
    // scanInputsChanged 标记是否发生必须重新读取会话并计价的配置变化。
    const scanInputsChanged =
      previousScanInputs.usageToolsKey !== usageToolsKey ||
      previousScanInputs.pricingConfigKey !== pricingConfigKey ||
      previousScanInputs.refreshVersion !== refreshVersion
    const onlyRemovedTasks =
      previousTaskNames.length > taskNames.length &&
      taskNames.every((taskName) => previousTaskNames.includes(taskName))
    previousTaskNamesRef.current = taskNames
    previousScanInputsRef.current = {
      usageToolsKey,
      pricingConfigKey,
      refreshVersion,
    }
    // hasAllCachedTasks 标记当前任务是否都已有统计结果，恢复隐藏任务时可直接复用。
    const hasAllCachedTasks = taskNames.every((taskName) =>
      Object.prototype.hasOwnProperty.call(usageMap, taskName)
    )
    if (!scanInputsChanged && (onlyRemovedTasks || hasAllCachedTasks)) {
      // 删除或隐藏任务不会改变其它任务费用，保留缓存并仅由总计过滤当前任务，重新显示时也无需扫描。
      setLoading(false)
      return undefined
    }
    // missingTaskNames 存储尚未缓存用量的新增任务，普通新建时只扫描这些任务。
    const missingTaskNames = taskNames.filter(
      (taskName) => !Object.prototype.hasOwnProperty.call(usageMap, taskName)
    )
    // queryTaskNames 存储本次实际扫描的任务；配置或手动刷新变化时才全量重算。
    const queryTaskNames = scanInputsChanged ? taskNames : missingTaskNames
    // shouldMergeSummary 标记新增任务的结果需合并到旧缓存，保留已有任务的价格。
    const shouldMergeSummary = !scanInputsChanged
    setLoading(true)
    // cancelled 标记 hook 卸载或依赖变化后不再写入旧请求结果。
    let cancelled = false
    // isManualRefresh 标记是否由顶部刷新按钮触发；该请求需要绕过短时结果缓存读取最新会话。
    const isManualRefresh = refreshVersion > INITIAL_USAGE_REFRESH_VERSION
    // scanTimer 延迟启动磁盘密集型会话扫描；依赖连续变化时 cleanup 会取消旧任务，避免并发 Worker 抢占启动资源。
    const scanTimer = window.setTimeout(() => {
      // summaryRequest 存储本次统计请求；仅手动刷新附带版本，Command+R 继续复用已有快速缓存。
      const summaryRequest = isManualRefresh
        ? api.getClaudeTasksSummary(queryTaskNames, { refreshVersion })
        : api.getClaudeTasksSummary(queryTaskNames)
      summaryRequest
        .then((summary) => {
          if (!cancelled) {
            setUsageMap((currentUsageMap) =>
              shouldMergeSummary
                ? { ...currentUsageMap, ...(summary || {}) }
                : summary || {}
            )
            setLoading(false)
          }
        })
        .catch(() => {
          if (!cancelled) {
            if (!shouldMergeSummary) setUsageMap({})
            setLoading(false)
          }
        })
    }, USAGE_SCAN_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(scanTimer)
    }
  }, [enabled, taskNamesKey, usageToolsKey, pricingConfigKey, refreshVersion])

  // total 存储所有可见任务的 Token 和费用总计。
  const total = useMemo(() => {
    // combinedTotal 存储所有可见任务的 Token、费用及按工具拆分合计。
    // visibleTaskNames 存储当前应计入工具栏总计的任务集合。
    const visibleTaskNames = new Set(
      taskNamesKey ? taskNamesKey.split('\u0000') : []
    )
    const combinedTotal = Object.entries(usageMap).reduce(
      (summary, [taskName, taskUsage]) => {
        if (!visibleTaskNames.has(taskName)) return summary
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
  }, [taskNamesKey, usageMap])

  return { usageMap, loading, total }
}
