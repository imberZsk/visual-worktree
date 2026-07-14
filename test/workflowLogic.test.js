import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DEFAULT_WORKFLOW_STEPS,
  normalizeWorkflowSteps,
  getTaskDoneSteps,
  isStepDone,
  setStepDoneInMap,
  computeWorkflowProgress,
  loadTaskWorkflowMap,
  saveTaskWorkflowMap,
  TASK_WORKFLOW_STORAGE_KEY,
} from '../src/ui/workflowLogic.ts'

// 任务工作流（需求流程）纯逻辑测试：步骤规范化、勾选态读写、进度计算、localStorage 持久化。
// 模型说明：每个步骤为 {key,label,command}——所有步骤都可勾选，command 非空时额外可执行。

describe('DEFAULT_WORKFLOW_STEPS', () => {
  it('每个默认步骤都有合法的 key/label，且 command 为字符串', () => {
    for (const s of DEFAULT_WORKFLOW_STEPS) {
      expect(typeof s.key).toBe('string')
      expect(s.key.length).toBeGreaterThan(0)
      expect(typeof s.label).toBe('string')
      expect(s.label.length).toBeGreaterThan(0)
      // command 为可选执行命令，默认空串（仅可勾选、无执行按钮）
      expect(typeof s.command).toBe('string')
    }
  })

  it('默认步骤 key 互不重复', () => {
    // keys 为全部默认步骤的 key，用 Set 去重后长度应不变
    const keys = DEFAULT_WORKFLOW_STEPS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('normalizeWorkflowSteps', () => {
  it('非数组输入回退默认清单（深拷贝，非同一引用）', () => {
    const out = normalizeWorkflowSteps(undefined)
    expect(out).toEqual(DEFAULT_WORKFLOW_STEPS)
    // 必须是新对象，避免外部修改污染默认常量
    expect(out[0]).not.toBe(DEFAULT_WORKFLOW_STEPS[0])
  })

  it('丢弃 label 为空/纯空白的步骤', () => {
    const out = normalizeWorkflowSteps([
      { label: '审查方案' },
      { label: '   ' },
      { label: '' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].label).toBe('审查方案')
  })

  it('command 去首尾空白后保留；缺失/非字符串收敛为空串', () => {
    const out = normalizeWorkflowSteps([
      { label: '部署', command: '  ./deploy.sh {path}  ' },
      { label: '仅勾选' },
      { label: '非法命令', command: 123 },
    ])
    // command 去空白后保留
    expect(out[0].command).toBe('./deploy.sh {path}')
    // 未配置 command 的步骤补为空串
    expect(out[1].command).toBe('')
    // 非字符串 command 收敛为空串
    expect(out[2].command).toBe('')
  })

  it('缺失 key 时由 label 派生非空 key', () => {
    const out = normalizeWorkflowSteps([{ label: 'Review Plan' }])
    expect(out[0].key).toBeTruthy()
  })

  it('保留传入的 key（改名沿用旧 key 以保住勾选态）', () => {
    const out = normalizeWorkflowSteps([
      { key: 'start', label: '已改名的开始' },
    ])
    expect(out[0].key).toBe('start')
    expect(out[0].label).toBe('已改名的开始')
  })

  it('key 冲突时追加序号去重', () => {
    const out = normalizeWorkflowSteps([
      { key: 'dup', label: 'A' },
      { key: 'dup', label: 'B' },
      { key: 'dup', label: 'C' },
    ])
    // 三个同 key 步骤应被去重为 dup / dup-2 / dup-3，保证唯一
    expect(new Set(out.map((s) => s.key)).size).toBe(3)
    expect(out.map((s) => s.key)).toEqual(['dup', 'dup-2', 'dup-3'])
  })

  it('两个空 key 但同名步骤派生后也能去重', () => {
    const out = normalizeWorkflowSteps([{ label: '单测' }, { label: '单测' }])
    expect(new Set(out.map((s) => s.key)).size).toBe(2)
  })

  it('保留运行策略字段并为旧配置补默认值', () => {
    // out 存储规范化后的步骤，第一步模拟旧配置缺字段，第二步模拟用户显式关闭策略。
    const out = normalizeWorkflowSteps([
      { key: 'a', label: 'A', command: 'npm test' },
      {
        key: 'b',
        label: 'B',
        command: 'npm run build',
        autoCheckOnSuccess: false,
        stopOnFailure: false,
      },
    ])

    expect(out[0].autoCheckOnSuccess).toBe(true)
    expect(out[0].stopOnFailure).toBe(true)
    expect(out[1].autoCheckOnSuccess).toBe(false)
    expect(out[1].stopOnFailure).toBe(false)
  })

  it('保留任务目录参数模式，并为旧配置补 auto 默认值', () => {
    // out 存储规范化后的步骤，覆盖旧配置缺字段与用户显式选择两类场景。
    const out = normalizeWorkflowSteps([
      { key: 'a', label: 'A', command: 'bash check-unit-test.sh' },
      { key: 'b', label: 'B', command: 'npm test', taskArgMode: 'none' },
      { key: 'c', label: 'C', command: 'npm test', taskArgMode: 'appendPath' },
      { key: 'd', label: 'D', command: 'npm test', taskArgMode: 'bad-value' },
    ])

    expect(out.map((step) => step.taskArgMode)).toEqual([
      'auto',
      'none',
      'appendPath',
      'auto',
    ])
  })
})

describe('getTaskDoneSteps / isStepDone', () => {
  it('任务无记录时返回空数组', () => {
    expect(getTaskDoneSteps({}, 'T1')).toEqual([])
    expect(getTaskDoneSteps(undefined, 'T1')).toEqual([])
  })

  it('值非数组（损坏）时回退空数组', () => {
    expect(getTaskDoneSteps({ T1: 'oops' }, 'T1')).toEqual([])
  })

  it('isStepDone 正确判断勾选态', () => {
    const map = { T1: ['start', 'unit-test'] }
    expect(isStepDone(map, 'T1', 'start')).toBe(true)
    expect(isStepDone(map, 'T1', 'review-plan')).toBe(false)
    expect(isStepDone(map, 'T2', 'start')).toBe(false)
  })
})

describe('setStepDoneInMap', () => {
  it('勾选某步骤而不修改入参', () => {
    const orig = {}
    const next = setStepDoneInMap(orig, 'T1', 'start', true)
    expect(next).toEqual({ T1: ['start'] })
    expect(orig).toEqual({})
  })

  it('取消勾选后清空则删除该任务键', () => {
    const next = setStepDoneInMap({ T1: ['start'] }, 'T1', 'start', false)
    expect(next).toEqual({})
  })

  it('取消其中一个步骤保留其余', () => {
    const next = setStepDoneInMap(
      { T1: ['start', 'unit-test'] },
      'T1',
      'start',
      false
    )
    expect(next.T1).toEqual(['unit-test'])
  })

  it('重复勾选同一步骤不产生重复项', () => {
    const next = setStepDoneInMap({ T1: ['start'] }, 'T1', 'start', true)
    expect(next.T1).toEqual(['start'])
  })

  it('任务名或步骤 key 缺失时原样返回拷贝', () => {
    expect(setStepDoneInMap({ T1: ['start'] }, '', 'start', true)).toEqual({
      T1: ['start'],
    })
    expect(setStepDoneInMap({ T1: ['start'] }, 'T1', '', true)).toEqual({
      T1: ['start'],
    })
  })

  it('容忍 null/undefined 映射', () => {
    expect(setStepDoneInMap(undefined, 'T1', 'start', true)).toEqual({
      T1: ['start'],
    })
  })
})

describe('computeWorkflowProgress', () => {
  // steps 为 5 个步骤清单：所有步骤都可勾选，部分配了执行命令（command 不影响进度统计）
  const steps = [
    { key: 'a', label: 'A', command: '' },
    { key: 'b', label: 'B', command: '' },
    { key: 'c', label: 'C', command: '' },
    { key: 'x', label: 'X', command: './x.sh' },
    { key: 'y', label: 'Y', command: './y.sh' },
  ]

  it('total 统计全部步骤（不再区分类型，所有步骤都可勾选）', () => {
    const p = computeWorkflowProgress(steps, {}, 'T1')
    expect(p).toEqual({ done: 0, total: 5 })
  })

  it('done 统计已勾选的步骤', () => {
    const p = computeWorkflowProgress(steps, { T1: ['a', 'b'] }, 'T1')
    expect(p).toEqual({ done: 2, total: 5 })
  })

  it('配了执行命令的步骤同样可勾选、计入 done', () => {
    // command 步骤也能打勾，勾选后计入完成数（与无命令步骤一视同仁）
    const p = computeWorkflowProgress(steps, { T1: ['x'] }, 'T1')
    expect(p).toEqual({ done: 1, total: 5 })
  })

  it('已勾选但步骤已从清单删除的不计入 done', () => {
    // 历史遗留勾选（步骤已被删）不应虚增完成数
    const p = computeWorkflowProgress(
      steps,
      { T1: ['a', 'deleted-step'] },
      'T1'
    )
    expect(p).toEqual({ done: 1, total: 5 })
  })

  it('空步骤清单返回 0/0', () => {
    expect(computeWorkflowProgress([], { T1: ['a'] }, 'T1')).toEqual({
      done: 0,
      total: 0,
    })
  })
})

describe('loadTaskWorkflowMap / saveTaskWorkflowMap', () => {
  beforeEach(() => {
    // store 模拟 localStorage 的底层存储
    const store = {}
    vi.stubGlobal('localStorage', {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v)
      },
      removeItem: (k) => {
        delete store[k]
      },
    })
  })

  it('往返一个工作流映射', () => {
    saveTaskWorkflowMap({ T1: ['start', 'unit-test'] })
    expect(localStorage.getItem(TASK_WORKFLOW_STORAGE_KEY)).toBe(
      '{"T1":["start","unit-test"]}'
    )
    expect(loadTaskWorkflowMap()).toEqual({ T1: ['start', 'unit-test'] })
  })

  it('未存储时返回空对象', () => {
    expect(loadTaskWorkflowMap()).toEqual({})
  })

  it('JSON 损坏时回退空对象', () => {
    localStorage.setItem(TASK_WORKFLOW_STORAGE_KEY, '{not json')
    expect(loadTaskWorkflowMap()).toEqual({})
  })

  it('存储为数组/标量时视为无效回退空对象', () => {
    localStorage.setItem(TASK_WORKFLOW_STORAGE_KEY, '[1,2]')
    expect(loadTaskWorkflowMap()).toEqual({})
    localStorage.setItem(TASK_WORKFLOW_STORAGE_KEY, '42')
    expect(loadTaskWorkflowMap()).toEqual({})
  })
})
