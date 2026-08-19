import { describe, expect, it } from 'vitest'
import { runUsageSummaryWorker } from '../src/core/usageSummaryRunner.js'

describe('usageSummaryRunner', () => {
  it('相同参数的并发调用复用同一个 Worker 请求', async () => {
    // request 存储无需读取会话文件的最小扫描参数，用于验证并发合并逻辑。
    const request = { taskNames: [], worktreesPath: '', tools: [] }
    // firstRequest 存储第一次扫描返回的 Promise。
    const firstRequest = runUsageSummaryWorker(request)
    // secondRequest 存储参数相同的并发扫描 Promise，应与第一次完全相同。
    const secondRequest = runUsageSummaryWorker(request)

    expect(secondRequest).toBe(firstRequest)
    await expect(firstRequest).resolves.toEqual({})
  })

  it('短时间内重复调用复用已完成结果，避免刷新重复扫描', async () => {
    // request 存储与上次一致的扫描参数，模拟 command+r 后的重复请求。
    const request = { taskNames: [], worktreesPath: '', tools: [] }
    await expect(runUsageSummaryWorker(request)).resolves.toEqual({})

    // cachedRequest 存储第二次调用返回的缓存 Promise，结果不需要重新创建 Worker。
    const cachedRequest = runUsageSummaryWorker(request)
    await expect(cachedRequest).resolves.toEqual({})
  })
})
