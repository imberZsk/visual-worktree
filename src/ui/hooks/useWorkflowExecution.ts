import { useEffect, useRef, useState } from 'react'
import { api } from '../api.ts'
import { normalizeWorkflowSteps } from '../workflowLogic.ts'
import { getRunnableWorkflowSteps } from '../workflowRunLogic.ts'
import {
  appendStepChunk,
  isStepEventFor,
  stepRunKey,
} from '../../core/stepOutputLog.js'

/**
 * 管理任务工作流的命令执行、实时输出和最近输出缓存。
 * @param {object} options - 工作流执行依赖。
 * @param {Array<object>} options.workflowSteps - 当前生效的工作流步骤。
 * @param {() => Promise<object>} options.loadConfig - 重新读取最新配置的动作。
 * @param {(taskName:string,stepKey:string,done:boolean) => void} options.toggleWorkflowStep - 更新步骤完成状态的动作。
 * @param {(taskName:string,stepKey:string) => void} options.startRunningStep - 标记步骤开始执行的动作。
 * @param {(taskName:string,stepKey:string) => void} options.finishRunningStep - 标记步骤结束执行的动作。
 * @param {object} options.message - Ant Design message API。
 * @returns {object} 工作流输出状态与执行、查看操作。
 */
export default function useWorkflowExecution({
  workflowSteps,
  loadConfig,
  toggleWorkflowStep,
  startRunningStep,
  finishRunningStep,
  message,
}) {
  // stepOutput 存储当前 Modal 展示的步骤输出；为空表示 Modal 关闭。
  const [stepOutput, setStepOutput] = useState(null)
  // lastStepOutputs 保存每个步骤最近一次的执行输出，key 为任务名与步骤 key 的组合。
  const lastStepOutputs = useRef({})
  // runningOutputs 保存执行中步骤的完整实时输出，确保关闭 Modal 后仍能继续累积。
  const runningOutputs = useRef({})
  // lastOutputVersion 在最近输出变化后递增，用于驱动依赖 ref 的步骤视图刷新。
  const [lastOutputVersion, setLastOutputVersion] = useState(0)

  useEffect(() => {
    // cancelled 标记 hook 卸载后不再写入输出缓存。
    let cancelled = false
    Promise.resolve(api.loadTaskWorkflowOutput?.() ?? {})
      .then((rawOutputMap) => {
        if (cancelled) return
        // outputMap 存储校验后的磁盘输出缓存；损坏数据回退为空对象。
        const outputMap =
          rawOutputMap &&
          typeof rawOutputMap === 'object' &&
          !Array.isArray(rawOutputMap)
            ? rawOutputMap
            : {}
        // 当前会话结果优先于较晚返回的磁盘旧缓存，避免覆盖刚执行的输出。
        lastStepOutputs.current = { ...outputMap, ...lastStepOutputs.current }
        setLastOutputVersion((version) => version + 1)
      })
      .catch(() => {
        // 输出缓存仅用于恢复查看入口，读取失败不阻断工作流主功能。
      })
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * 执行前读取最新流程配置，避免继续使用启动时缓存的旧命令。
   * @param {{key:string}} step - 当前界面中的步骤定义。
   * @returns {Promise<object>} 合并最新配置后的步骤定义。
   */
  const resolveLatestWorkflowStep = async (step) => {
    try {
      // latestConfig 存储磁盘上的最新配置。
      const latestConfig = await loadConfig()
      // rawLatestSteps 存储当前步骤所属范围在磁盘上的最新配置。
      const rawLatestSteps = step?.projectPath
        ? latestConfig?.projectWorkflowSteps?.[step.projectPath]
        : latestConfig?.workflowSteps
      // latestSteps 存储规范化后的最新流程步骤。
      const latestSteps = normalizeWorkflowSteps(
        Array.isArray(rawLatestSteps) ? rawLatestSteps : []
      )
      // latestStep 存储与当前步骤 key 匹配的最新定义。
      const latestStep = latestSteps.find(
        (item) => item.key === (step?.privateKey || step?.key)
      )
      return latestStep ? { ...step, ...latestStep, key: step.key } : step
    } catch {
      // 临时读盘失败时沿用界面中的步骤，避免阻断已有流程。
      return step
    }
  }

  /**
   * 执行一个任务的单个工作流步骤，并维护流式输出与完成状态。
   * @param {object} task - 包含任务名、目录和 worktree 信息的任务。
   * @param {{key:string,label:string,command?:string}} step - 待执行步骤。
   * @returns {Promise<{success:boolean,code:number|null,error?:string}>} 执行结果。
   */
  const runWorkflowStepForTask = async (task, step) => {
    // effectiveStep 存储执行前刷新后的步骤配置。
    const effectiveStep = await resolveLatestWorkflowStep(step)
    if (!effectiveStep?.command || !String(effectiveStep.command).trim()) {
      message.info(
        `「${effectiveStep?.label || step?.label || '当前步骤'}」未配置执行命令，请在「设置 → 流程」中填写`
      )
      return { success: false, code: null, error: '未配置执行命令' }
    }
    // branch 存储任务首个 worktree 的分支名，供命令占位符使用。
    const branch = task?.worktrees?.[0]?.branch || ''
    // taskName 存储本次执行所属的任务名。
    const taskName = task?.task || ''
    // stepKey 存储本次执行所属的步骤 key。
    const stepKey = effectiveStep.key
    // runKey 存储任务与步骤组合出的输出路由标识。
    const runKey = stepRunKey(taskName, stepKey)
    startRunningStep(taskName, stepKey)
    runningOutputs.current[runKey] = {
      taskName,
      stepKey,
      label: effectiveStep.label,
      content: '',
      status: 'running',
      code: null,
    }
    setStepOutput({ ...runningOutputs.current[runKey] })
    // unsubscribe 存储本次执行的输出事件取消订阅函数。
    const unsubscribe = api.onStepOutput((event) => {
      if (!isStepEventFor(event, taskName, stepKey)) return
      // outputSlot 存储本步骤当前累积的输出。
      const outputSlot = runningOutputs.current[runKey]
      if (outputSlot) {
        outputSlot.content = appendStepChunk(outputSlot.content, event.chunk)
      }
      setStepOutput((previousOutput) => {
        if (
          !previousOutput ||
          previousOutput.taskName !== taskName ||
          previousOutput.stepKey !== stepKey
        ) {
          return previousOutput
        }
        return {
          ...previousOutput,
          content: outputSlot
            ? outputSlot.content
            : appendStepChunk(previousOutput.content, event.chunk),
        }
      })
    })
    try {
      // taskArgMode 存储主进程向命令追加任务目录参数的模式。
      const taskArgMode = effectiveStep.taskArgMode || 'auto'
      // result 存储主进程返回的命令执行结果。
      const result = await api.runWorkflowStep({
        command: effectiveStep.command,
        cwd: task?.path,
        task: taskName,
        branch,
        taskName,
        stepKey,
        taskArgMode,
      })
      // finalStatus 存储供输出 Modal 展示的最终状态。
      const finalStatus = result?.success ? 'success' : 'error'
      // finalCode 存储命令退出码；缺失时使用 null。
      const finalCode = result?.code ?? null
      // summary 存储主进程完整输出，作为流式事件缺失时的兜底。
      const summary = [result?.stdout, result?.stderr]
        .filter((text) => text && text.trim())
        .join('\n')
      // outputSlot 存储当前步骤已通过事件累积的输出。
      const outputSlot = runningOutputs.current[runKey]
      // finalContent 优先使用实时累积内容，否则使用主进程汇总结果。
      const finalContent = outputSlot?.content?.trim()
        ? outputSlot.content
        : summary || outputSlot?.content || ''
      runningOutputs.current[runKey] = {
        taskName,
        stepKey,
        label: effectiveStep.label,
        content: finalContent,
        status: finalStatus,
        code: finalCode,
      }
      setStepOutput((previousOutput) => {
        if (
          !previousOutput ||
          previousOutput.taskName !== taskName ||
          previousOutput.stepKey !== stepKey
        ) {
          return previousOutput
        }
        return {
          ...previousOutput,
          content: finalContent,
          status: finalStatus,
          code: finalCode,
        }
      })
      if (result?.success) {
        // autoCheckOnSuccess 存储步骤成功后是否自动标记完成，旧配置默认开启。
        const autoCheckOnSuccess = effectiveStep.autoCheckOnSuccess !== false
        if (autoCheckOnSuccess) toggleWorkflowStep(taskName, stepKey, true)
        message.success(`「${effectiveStep.label}」执行成功`)
      } else {
        toggleWorkflowStep(taskName, stepKey, false)
        message.error(
          `「${effectiveStep.label}」未通过${result?.code != null ? `（退出码 ${result.code}）` : ''}`
        )
      }
      return {
        success: Boolean(result?.success),
        code: finalCode,
        error: result?.error,
      }
    } catch (error) {
      // outputSlot 存储异常发生前已累积的输出。
      const outputSlot = runningOutputs.current[runKey]
      // errorMessage 存储可安全展示的异常文本。
      const errorMessage = error?.message || String(error)
      if (outputSlot) {
        outputSlot.status = 'error'
        outputSlot.content = appendStepChunk(
          outputSlot.content,
          `\n[执行异常] ${errorMessage}\n`
        )
      }
      setStepOutput((previousOutput) => {
        if (
          !previousOutput ||
          previousOutput.taskName !== taskName ||
          previousOutput.stepKey !== stepKey
        ) {
          return previousOutput
        }
        return {
          ...previousOutput,
          status: 'error',
          content: outputSlot
            ? outputSlot.content
            : appendStepChunk(
                previousOutput.content,
                `\n[执行异常] ${errorMessage}\n`
              ),
        }
      })
      toggleWorkflowStep(taskName, stepKey, false)
      message.error(`「${effectiveStep.label}」未通过：${errorMessage}`)
      return { success: false, code: null, error: errorMessage }
    } finally {
      unsubscribe?.()
      finishRunningStep(taskName, stepKey)
      // outputSlot 存储本次执行完成后的最终输出快照。
      const outputSlot = runningOutputs.current[runKey]
      if (outputSlot) {
        // nextOutputs 存储即将写入内存和磁盘的完整最近输出映射。
        const nextOutputs = {
          ...lastStepOutputs.current,
          [runKey]: { ...outputSlot },
        }
        lastStepOutputs.current = nextOutputs
        api.saveTaskWorkflowOutput?.(nextOutputs)?.catch?.(() => {})
        delete runningOutputs.current[runKey]
        setLastOutputVersion((version) => version + 1)
      }
    }
  }

  /**
   * 执行用户点击的单个工作流步骤。
   * @param {object} task - 当前任务。
   * @param {object} step - 当前步骤。
   */
  const runStep = async (task, step) => {
    await runWorkflowStepForTask(task, step)
  }

  /**
   * 从指定步骤开始串行执行所有可执行步骤，并按配置在失败后停止。
   * @param {object} task - 当前任务。
   * @param {string} [startKey] - 可选的起始步骤 key。
   */
  const runSteps = async (task, startKey, taskWorkflowSteps) => {
    // effectiveWorkflowSteps 存储当前任务合并通用与项目私有流程后的实际步骤。
    const effectiveWorkflowSteps = Array.isArray(taskWorkflowSteps)
      ? taskWorkflowSteps
      : workflowSteps
    // runnableSteps 存储本次需要串行执行的步骤队列。
    const runnableSteps = getRunnableWorkflowSteps(
      effectiveWorkflowSteps,
      startKey
    )
    if (!runnableSteps.length) {
      message.info('当前流程没有可执行命令')
      return
    }
    for (const step of runnableSteps) {
      // result 存储当前步骤结果，用于判断是否停止后续步骤。
      const result = await runWorkflowStepForTask(task, step)
      if (!result.success && step.stopOnFailure !== false) {
        message.warning(`已在「${step.label}」失败后停止后续步骤`)
        break
      }
    }
  }

  /**
   * 重新打开指定步骤当前正在累积的实时输出。
   * @param {object} task - 当前任务。
   * @param {object} step - 当前步骤。
   */
  const viewCurrentOutput = (task, step) => {
    // outputSlot 存储指定任务步骤当前执行中的输出。
    const outputSlot = runningOutputs.current[stepRunKey(task?.task, step?.key)]
    if (outputSlot) setStepOutput({ ...outputSlot })
  }

  /**
   * 重新打开指定步骤最近一次保存的输出。
   * @param {object} task - 当前任务。
   * @param {object} step - 当前步骤。
   */
  const viewLastOutput = (task, step) => {
    // savedOutput 存储指定任务步骤最近一次的输出快照。
    const savedOutput =
      lastStepOutputs.current[stepRunKey(task?.task, step?.key)]
    if (savedOutput) setStepOutput({ ...savedOutput })
  }

  return {
    stepOutput,
    closeOutput: () => setStepOutput(null),
    lastStepOutputs: lastStepOutputs.current,
    lastOutputVersion,
    runStep,
    runSteps,
    viewCurrentOutput,
    viewLastOutput,
  }
}
