import { isStepDone } from './workflowLogic.ts'
import { stepRunKey } from '../core/stepOutputLog.js'

/**
 * 判断工作流步骤是否配置了可执行命令。
 * @param {{command?:string}} step - 工作流步骤定义
 * @returns {boolean} 是否存在非空命令
 */
export function hasWorkflowCommand(step) {
  // commandText 存储步骤命令的字符串形式，用于统一处理 null/undefined。
  const commandText = String(step?.command || '').trim()
  return commandText.length > 0
}

/**
 * 推导某任务某步骤的运行展示状态。
 * @param {{key:string}} step - 工作流步骤定义
 * @param {string} taskName - 任务名
 * @param {Record<string,string[]>} workflowMap - 任务名到已勾选步骤 key 的映射
 * @param {Record<string,boolean>} runningSteps - 正在执行的步骤映射
 * @param {Record<string,{status?:string}>} lastStepOutputs - 最近一次步骤输出快照映射
 * @returns {'idle'|'running'|'success'|'failed'} 该步骤当前展示状态
 */
export function getWorkflowStepRunStatus(
  step,
  taskName,
  workflowMap = {},
  runningSteps = {},
  lastStepOutputs = {}
) {
  // runKey 存储任务名和步骤 key 拼出的唯一执行标识。
  const runKey = stepRunKey(taskName, step?.key)
  if (runningSteps?.[runKey]) return 'running'
  // 用户手动勾选代表已确认完成；失败执行会在上层撤销勾选，所以这里尊重之后的人工覆盖。
  if (isStepDone(workflowMap, taskName, step?.key)) return 'success'
  // output 存储最近一次执行输出；仅在未被手动勾选时展示失败，避免挡住用户手动确认。
  const output = lastStepOutputs?.[runKey]
  if (output?.status === 'error' || output?.status === 'failed') return 'failed'
  return 'idle'
}

/**
 * 汇总某任务整组流程的运行状态，用于任务行入口徽标。
 * @param {Array<{key:string,label:string}>} steps - 当前流程步骤清单
 * @param {string} taskName - 任务名
 * @param {Record<string,string[]>} workflowMap - 任务名到已勾选步骤 key 的映射
 * @param {Record<string,boolean>} runningSteps - 正在执行的步骤映射
 * @param {Record<string,{status?:string,label?:string}>} lastStepOutputs - 最近一次步骤输出快照映射
 * @returns {{hasRunning:boolean,hasFailed:boolean,failedCount:number,runningCount:number,lastFailedStepLabel:string}} 任务级运行摘要
 */
export function getWorkflowTaskRunSummary(
  steps = [],
  taskName,
  workflowMap = {},
  runningSteps = {},
  lastStepOutputs = {}
) {
  // summary 存储逐步扫描后得到的任务级状态聚合。
  const summary = {
    hasRunning: false,
    hasFailed: false,
    failedCount: 0,
    runningCount: 0,
    lastFailedStepLabel: '',
  }
  for (const step of Array.isArray(steps) ? steps : []) {
    // status 存储当前步骤的展示状态。
    const status = getWorkflowStepRunStatus(
      step,
      taskName,
      workflowMap,
      runningSteps,
      lastStepOutputs
    )
    if (status === 'running') {
      summary.hasRunning = true
      summary.runningCount += 1
    }
    if (status === 'failed') {
      summary.hasFailed = true
      summary.failedCount += 1
      summary.lastFailedStepLabel =
        step?.label ||
        lastStepOutputs?.[stepRunKey(taskName, step?.key)]?.label ||
        ''
    }
  }
  return summary
}

/**
 * 取可执行步骤列表，并支持从指定步骤开始。
 * @param {Array<{key:string,command?:string}>} steps - 当前流程步骤清单
 * @param {string} [startKey] - 起始步骤 key；缺失或找不到时从第一个可执行步骤开始
 * @returns {Array<object>} 可执行步骤数组
 */
export function getRunnableWorkflowSteps(steps = [], startKey = '') {
  // list 存储有效步骤数组，容错非数组配置。
  const list = Array.isArray(steps) ? steps : []
  // foundIndex 存储起始步骤在完整清单里的下标；找不到时用 -1 表示回退。
  const foundIndex = startKey
    ? list.findIndex((step) => step?.key === startKey)
    : -1
  // startIndex 存储最终起始下标；找不到时回退到 0，符合「运行全部」语义。
  const startIndex = foundIndex >= 0 ? foundIndex : 0
  return list.slice(startIndex).filter(hasWorkflowCommand)
}

/**
 * 生成输出预览文本，避免过长输出撑爆 UI。
 * @param {string} output - 原始输出文本
 * @param {number} [limit=4000] - 最大展示字符数
 * @returns {{text:string,truncated:boolean}} 截断后的文本与是否截断
 */
export function getWorkflowOutputPreview(output, limit = 4000) {
  // text 存储输出字符串形式，避免 null/undefined 进入渲染。
  const text = String(output || '')
  // safeLimit 存储合法展示长度，调用方传非法值时回退默认长度。
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 4000
  if (text.length <= safeLimit) return { text, truncated: false }
  return { text: text.slice(0, safeLimit), truncated: true }
}
