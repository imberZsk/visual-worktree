import { describe, expect, it } from 'vitest'
import {
  ENV_HEALTH_CACHE_VERSION,
  buildTaskDir,
  makeEnvHealthEntry,
  normalizeEnvHealthMapForDisplay,
  normalizeEnvHealthResultForDisplay,
} from '../src/ui/envHealthDisplayLogic.ts'

/**
 * 构造带项目级结果的环境检查数据。
 * @param {Array<object>} projects - 项目检查结果
 * @returns {object} 环境检查结果
 */
function makeResult(projects) {
  return {
    projects,
    summary: {
      status: 'failed',
      projectCount: projects.length,
      issueCount: 1,
      message: '旧摘要',
    },
  }
}

describe('envHealthDisplayLogic', () => {
  it('过滤任务根级工作文档与 unknown 目录并修正 Git-only warning', () => {
    // result 存储包含真实项目、工作文档和未知目录的旧检查结果。
    const result = makeResult([
      {
        name: 'web-app',
        path: '/tasks/demo/web-app',
        status: 'warning',
        issueCount: 1,
        checks: { git: { status: 'warning' } },
      },
      { name: 'docs', path: '/tasks/demo/docs', kind: 'docs' },
      { name: 'tmp', path: '/tasks/demo/tmp', kind: 'unknown' },
    ])

    // normalized 存储展示层归一化后的检查结果。
    const normalized = normalizeEnvHealthResultForDisplay(result, '/tasks/demo')
    expect(normalized.projects).toHaveLength(1)
    expect(normalized.projects[0]).toMatchObject({
      name: 'web-app',
      status: 'ok',
      issueCount: 0,
    })
  })

  it('将旧版本缓存标记为 stale 并清空结果', () => {
    // normalizedMap 存储旧缓存归一化后的任务映射。
    const normalizedMap = normalizeEnvHealthMapForDisplay(
      {
        demo: {
          version: ENV_HEALTH_CACHE_VERSION - 1,
          status: 'failed',
          result: { error: '旧错误' },
        },
      },
      [{ task: 'demo', path: '/tasks/demo' }]
    )
    expect(normalizedMap.demo).toMatchObject({
      status: 'idle',
      issueCount: 0,
      result: null,
      stale: true,
      taskDir: '/tasks/demo',
    })
  })

  it('构造当前版本缓存条目并安全拼接任务路径', () => {
    // task 存储待生成缓存的任务信息。
    const task = { task: 'demo', path: '/tasks/demo' }
    // result 存储环境正常的项目检查结果。
    const result = makeResult([
      {
        name: 'web-app',
        path: '/tasks/demo/web-app',
        checks: { deps: { status: 'ok' } },
      },
    ])
    expect(makeEnvHealthEntry(task, result)).toMatchObject({
      version: ENV_HEALTH_CACHE_VERSION,
      status: 'ok',
      issueCount: 0,
      taskDir: '/tasks/demo',
    })
    expect(buildTaskDir('/tasks/', '/demo')).toBe('/tasks/demo')
    expect(buildTaskDir('', 'demo')).toBe('')
  })
})
