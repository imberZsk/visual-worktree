import { parentPort, workerData } from 'worker_threads'
import { getTasksSummary } from './claudeService.js'
import { getCodexTasksSummary } from './codexService.js'

// request 存储主进程传入的一次批量统计请求。
const request = workerData || {}
// summariesByTool 存储每个统计工具独立计算的任务汇总。
const summariesByTool = {}

for (const toolRequest of request.tools || []) {
  // summaryOptions 存储当前工具的全局与任务级计价规则。
  const summaryOptions = {
    tokenPricing: toolRequest.tokenPricing,
    tokenPricingByTask: toolRequest.tokenPricingByTask,
  }
  summariesByTool[toolRequest.toolId] =
    toolRequest.toolId === 'codex'
      ? getCodexTasksSummary(
          request.taskNames,
          request.worktreesPath,
          summaryOptions
        )
      : getTasksSummary(
          request.taskNames,
          request.worktreesPath,
          summaryOptions
        )
}

parentPort?.postMessage(summariesByTool)
