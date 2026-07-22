import { afterEach, describe, expect, it } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { makeTempRoot } from './helpers.js'
import {
  getCodexSessionsByTask,
  getCodexTasksSummary,
} from '../src/core/codexService.js'

describe('codexService', () => {
  // contexts 存储每个用例创建的临时目录，结束后统一清理。
  const contexts = []

  afterEach(() => {
    for (const context of contexts.splice(0)) context.cleanup()
  })

  it('读取 Codex 累计 Token，扣除缓存重复量并按任务汇总', () => {
    // context 存储本用例的临时用户目录。
    const context = makeTempRoot()
    contexts.push(context)
    // taskRoot 存储模拟的 Visual Worktree 任务目录。
    const taskRoot = join(context.root, 'worktrees', 'TASK-CODEX')
    // sessionDirectory 存储 Codex 日期分层会话目录。
    const sessionDirectory = join(context.root, '.codex', 'sessions', '2026', '07', '22')
    mkdirSync(sessionDirectory, { recursive: true })
    mkdirSync(taskRoot, { recursive: true })
    // sessionFile 存储模拟 Codex JSONL 会话文件路径。
    const sessionFile = join(sessionDirectory, 'rollout-test.jsonl')
    // records 存储会话元数据、模型与最终累计 Token 快照。
    const records = [
      { type: 'session_meta', payload: { id: 'session-1', cwd: join(taskRoot, 'web'), timestamp: '2026-07-22T01:00:00Z' } },
      { type: 'turn_context', payload: { model: 'gpt-test' } },
      { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 400, cache_write_input_tokens: 100, output_tokens: 200 } } } },
    ]
    writeFileSync(sessionFile, records.map((record) => JSON.stringify(record)).join('\n'))
    // tokenPricing 存储易于核算的自定义美元/百万 Token 单价。
    const tokenPricing = { enabled: true, input: 1, output: 2, cacheWrite: 3, cacheRead: 4, usdToCny: 8 }
    // deps 存储测试注入的用户目录和计价规则。
    const deps = { homedir: () => context.root, tokenPricing }

    const sessions = getCodexSessionsByTask('TASK-CODEX', join(context.root, 'worktrees'), deps)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].usage).toEqual({ input: 500, output: 200, cacheWrite: 100, cacheRead: 400 })
    expect(sessions[0].cost.usd).toBe(0.0028)

    const summary = getCodexTasksSummary(['TASK-CODEX', 'OTHER'], join(context.root, 'worktrees'), deps)
    expect(summary['TASK-CODEX'].usage).toEqual(sessions[0].usage)
    expect(summary['TASK-CODEX'].cost.cny).toBe(0.02)
    expect(summary.OTHER.sessionCount).toBe(0)
  })
})
