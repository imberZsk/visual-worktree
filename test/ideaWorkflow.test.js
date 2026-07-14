import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// 测试前先劫持 homedir，让 ideaWorkflowService 写入临时目录而非真实 ~/.visualWorktree
// WHY：用环境变量 + 动态 import 或直接 mock os.homedir 均可，此处用 vi.mock 最简洁

import { vi } from 'vitest'

/** 临时目录路径，每个测试套件独立 */
let tmpHome

// mock os 模块的 homedir，使服务写入临时目录
vi.mock('os', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    // homedir 返回测试专用临时目录
    homedir: () => tmpHome ?? original.homedir(),
  }
})

// mock 必须在 import 被测模块之前生效，故用动态 import
const { loadIdeaWorkflows, saveIdeaWorkflows, loadIdeaRuns, appendIdeaRun } =
  await import('../src/core/ideaWorkflowService.js')

import { buildStepCommand } from '../src/core/commandRunner.js'

describe('ideaWorkflowService', () => {
  beforeEach(() => {
    // 每个测试前创建独立临时目录，避免测试间状态污染
    tmpHome = mkdtempSync(join(tmpdir(), 'vwt-test-'))
  })

  afterEach(() => {
    // 清理临时目录
    rmSync(tmpHome, { recursive: true, force: true })
    tmpHome = undefined
  })

  it('loadIdeaWorkflows：文件不存在时返回内置默认（有2条）', () => {
    // result 为未创建任何文件时的默认返回值
    const result = loadIdeaWorkflows()
    expect(result).toHaveLength(2)
    // 验证两条内置定义的名称
    expect(result.map((w) => w.name)).toEqual(['快速实现', '完整流程'])
  })

  it('saveIdeaWorkflows + loadIdeaWorkflows：保存后能读回', () => {
    // defs 为自定义定义列表
    const defs = [
      { id: 'test-1', name: '测试流程', description: '测试用', steps: [] },
    ]
    saveIdeaWorkflows(defs)
    // loaded 为从文件读回的定义列表
    const loaded = loadIdeaWorkflows()
    expect(loaded).toEqual(defs)
  })

  it('loadIdeaRuns：文件不存在时返回空数组', () => {
    // result 为未创建任何文件时的运行历史
    const result = loadIdeaRuns()
    expect(result).toEqual([])
  })

  it('appendIdeaRun：插入头部', () => {
    // run1、run2 为两条测试运行记录
    const run1 = {
      id: 'r1',
      workflowId: 'w1',
      workflowName: 'W1',
      idea: '想法1',
      targetDir: '/tmp',
      startedAt: '2026-01-01',
      finishedAt: null,
      status: 'running',
      steps: [],
    }
    const run2 = {
      id: 'r2',
      workflowId: 'w1',
      workflowName: 'W1',
      idea: '想法2',
      targetDir: '/tmp',
      startedAt: '2026-01-02',
      finishedAt: null,
      status: 'running',
      steps: [],
    }
    appendIdeaRun(run1)
    appendIdeaRun(run2)
    // runs 为追加两条后的运行历史
    const runs = loadIdeaRuns()
    // 最新插入的记录应在头部
    expect(runs[0].id).toBe('r2')
    expect(runs[1].id).toBe('r1')
  })

  it('appendIdeaRun：超50条截断到50条', () => {
    // 先插入50条
    for (let i = 0; i < 50; i++) {
      appendIdeaRun({
        id: `r${i}`,
        workflowId: 'w',
        workflowName: 'W',
        idea: `idea${i}`,
        targetDir: '/tmp',
        startedAt: '',
        finishedAt: null,
        status: 'success',
        steps: [],
      })
    }
    // 再插入第51条
    appendIdeaRun({
      id: 'r_new',
      workflowId: 'w',
      workflowName: 'W',
      idea: 'new',
      targetDir: '/tmp',
      startedAt: '',
      finishedAt: null,
      status: 'success',
      steps: [],
    })
    // runs 为截断后的运行历史
    const runs = loadIdeaRuns()
    expect(runs).toHaveLength(50)
    // 最新记录在头部，最老的第50条被丢弃
    expect(runs[0].id).toBe('r_new')
  })
})

describe('buildStepCommand {idea} 占位符', () => {
  it('{idea} 占位符替换正常', () => {
    // cmd 为替换后的最终命令
    const cmd = buildStepCommand('git checkout -b idea/{idea}', {
      idea: '用户登录优化',
    })
    expect(cmd).toBe("git checkout -b idea/'用户登录优化'")
  })

  it('{idea} 为空时替换为空单引号', () => {
    // cmd 为 idea 未提供时的替换结果
    const cmd = buildStepCommand('echo {idea}', {})
    expect(cmd).toBe("echo ''")
  })
})
