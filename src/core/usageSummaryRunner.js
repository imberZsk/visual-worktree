import { Worker } from 'worker_threads'

// activeSummaryRequests 存储正在执行的相同用量请求，避免启动阶段重复创建扫描 Worker。
const activeSummaryRequests = new Map()
// COMPLETED_SUMMARY_CACHE_TTL_MS 存储已完成扫描结果的短时复用窗口，覆盖刷新后的重复读取。
const COMPLETED_SUMMARY_CACHE_TTL_MS = 10_000
// completedSummaryRequests 存储短时间内可直接复用的已完成扫描结果。
const completedSummaryRequests = new Map()

/**
 * 为用量扫描请求生成稳定键，用于合并参数完全一致的并发调用。
 * @param {object} request - 任务名、工作目录及计价配置
 * @returns {string} 可用于 Map 的稳定请求键
 */
function getUsageSummaryRequestKey(request) {
  return JSON.stringify(request || {})
}

/**
 * 创建单个用量扫描 Worker，并将执行结果转换为 Promise。
 * @param {object} request - 任务名、worktree 根目录及各工具价格配置
 * @returns {Promise<Record<string,object>>} 工具标识到任务汇总的映射
 */
function createUsageSummaryWorker(request) {
  return new Promise((resolve, reject) => {
    // settled 标记本次扫描是否已经返回，避免 message/error/exit 事件重复结束 Promise。
    let settled = false
    // worker 存储本次短生命周期会话扫描线程。
    const worker = new Worker(
      new URL('./usageSummaryWorker.js', import.meta.url),
      { workerData: request }
    )
    worker.once('message', (summary) => {
      settled = true
      resolve(summary)
    })
    worker.once('error', (error) => {
      settled = true
      reject(error)
    })
    worker.once('exit', (code) => {
      // Worker 正常发送结果后 code 为 0；非零退出且未触发 error 时补充明确异常。
      if (!settled && code !== 0) {
        settled = true
        reject(new Error(`AI 用量扫描线程异常退出：${code}`))
      }
    })
  })
}

/**
 * 在线程池外执行本地 AI 会话扫描，避免同步文件解析阻塞 Electron 主进程。
 * @param {object} request - 任务名、worktree 根目录及各工具价格配置
 * @returns {Promise<Record<string,object>>} 工具标识到任务汇总的映射
 */
export function runUsageSummaryWorker(request) {
  // requestKey 标识本次扫描的全部输入，相同输入可以安全共享同一个结果。
  const requestKey = getUsageSummaryRequestKey(request)
  // cachedRequest 存储尚未过期的最近一次结果，避免 command+r 立即再次扫描磁盘。
  const cachedRequest = completedSummaryRequests.get(requestKey)
  if (cachedRequest && cachedRequest.expiresAt > Date.now()) {
    return Promise.resolve(cachedRequest.summary)
  }
  if (cachedRequest) completedSummaryRequests.delete(requestKey)
  // activeRequest 存储已经运行中的相同请求，存在时直接复用，避免磁盘重复扫描。
  const activeRequest = activeSummaryRequests.get(requestKey)
  if (activeRequest) return activeRequest
  // summaryRequest 存储新建 Worker 的 Promise，完成后必须移除以允许后续会话变化时重新统计。
  const summaryRequest = createUsageSummaryWorker(request)
    .then((summary) => {
      completedSummaryRequests.set(requestKey, {
        summary,
        expiresAt: Date.now() + COMPLETED_SUMMARY_CACHE_TTL_MS,
      })
      return summary
    })
    .finally(() => {
      activeSummaryRequests.delete(requestKey)
    })
  activeSummaryRequests.set(requestKey, summaryRequest)
  return summaryRequest
}
