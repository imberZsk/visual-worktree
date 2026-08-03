import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.ts'
import { useStore } from '../store/useStore.ts'
import {
  ENV_HEALTH_CACHE_VERSION,
  getEnvAutoCheckKey,
  makeEnvHealthEntry,
  makeEnvHealthErrorEntry,
  normalizeEnvHealthMapForDisplay,
  normalizeEnvHealthResultForDisplay,
} from '../envHealthDisplayLogic.ts'

/**
 * 管理任务环境检查缓存、自动检查和详情弹窗状态。
 * @param {object} options - 环境检查依赖。
 * @param {Record<string,object>} options.taskEnvHealthMap - Store 中的原始环境检查缓存。
 * @param {Array<object>} options.tasks - 当前可见任务列表。
 * @param {object|null} options.config - 当前应用配置。
 * @param {(map:Record<string,object>) => void} options.setTaskEnvHealthMap - 写入环境检查缓存的动作。
 * @param {() => Promise<void>} options.loadTaskEnvHealth - 从磁盘加载环境检查缓存的动作。
 * @returns {object} 归一化状态、弹窗状态与检查操作。
 */
export default function useEnvHealthCheck({
  taskEnvHealthMap,
  tasks,
  config,
  setTaskEnvHealthMap,
  loadTaskEnvHealth,
}) {
  // loaded 标记磁盘缓存是否加载完成，避免旧缓存覆盖自动检查结果。
  const [loaded, setLoaded] = useState(false)
  // open 控制环境检查详情弹窗是否展示。
  const [open, setOpen] = useState(false)
  // result 存储详情弹窗当前展示的检查结果。
  const [result, setResult] = useState(null)
  // loading 标记详情弹窗对应的检查是否正在执行。
  const [loading, setLoading] = useState(false)
  // taskName 存储详情弹窗当前任务名。
  const [taskName, setTaskName] = useState(null)
  // taskDir 存储详情弹窗当前任务目录。
  const [taskDir, setTaskDir] = useState(null)
  // checkedTaskKeys 记录本次会话触发过检查的任务，防止 effect 重复执行。
  const checkedTaskKeys = useRef(new Set())
  // healthMap 存储供界面展示的规范化环境检查缓存。
  const healthMap = useMemo(
    () =>
      normalizeEnvHealthMapForDisplay(
        taskEnvHealthMap || {},
        tasks,
        config?.workDocumentTemplates
      ),
    [taskEnvHealthMap, tasks, config?.workDocumentTemplates]
  )

  useEffect(() => {
    // cancelled 标记 hook 卸载后不再更新加载状态。
    let cancelled = false
    loadTaskEnvHealth().finally(() => {
      if (!cancelled) setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [loadTaskEnvHealth])

  /**
   * 执行指定任务的环境健康检查，并同步缓存与详情状态。
   * @param {object} task - 包含任务名和目录的任务。
   * @param {{open?:boolean}} [options] - 是否同时打开详情弹窗。
   */
  const runCheck = async (task, options = {}) => {
    if (!task?.task || !task?.path) return
    checkedTaskKeys.current.add(getEnvAutoCheckKey(task))
    // shouldOpen 标记本次检查是否需要同步详情弹窗。
    const shouldOpen = Boolean(options.open)
    // checkingEntry 存储任务行立即展示的检查中状态。
    const checkingEntry = {
      version: ENV_HEALTH_CACHE_VERSION,
      status: 'checking',
      issueCount: 0,
      taskDir: task.path,
      startedAt: new Date().toISOString(),
    }
    setTaskEnvHealthMap({
      ...useStore.getState().taskEnvHealthMap,
      [task.task]: checkingEntry,
    })
    if (shouldOpen) {
      setTaskName(task.task)
      setTaskDir(task.path)
      setOpen(true)
      setLoading(true)
      setResult((currentResult) =>
        taskName === task.task && taskDir === task.path ? currentResult : null
      )
    }

    try {
      // checkResult 存储核心层返回的完整环境检查结果。
      const checkResult = await api.checkEnvHealth(task.path)
      // cacheEntry 存储规范化后写入任务行的检查结果。
      const cacheEntry = makeEnvHealthEntry(
        task,
        checkResult,
        config?.workDocumentTemplates
      )
      setTaskEnvHealthMap({
        ...useStore.getState().taskEnvHealthMap,
        [task.task]: cacheEntry,
      })
      if (shouldOpen) setResult(cacheEntry.result)
    } catch (error) {
      // cacheEntry 存储检查链路异常时的失败结果。
      const cacheEntry = makeEnvHealthErrorEntry(task, error)
      setTaskEnvHealthMap({
        ...useStore.getState().taskEnvHealthMap,
        [task.task]: cacheEntry,
      })
      if (shouldOpen) setResult(cacheEntry.result)
    } finally {
      if (shouldOpen) setLoading(false)
    }
  }

  /**
   * 打开任务环境检查详情，有有效缓存时直接展示，否则执行检查。
   * @param {object} task - 包含任务名和目录的任务。
   */
  const showDetails = async (task) => {
    if (!task?.task || !task?.path) return
    // cacheEntry 存储当前任务已有的展示层缓存。
    const cacheEntry = healthMap[task.task]
    setTaskName(task.task)
    setTaskDir(task.path)
    setOpen(true)
    if (cacheEntry?.result && cacheEntry.status !== 'checking') {
      // normalizedResult 存储过滤旧缓存无效检查项后的详情结果。
      const normalizedResult = normalizeEnvHealthResultForDisplay(
        cacheEntry.result,
        task.path,
        config?.workDocumentTemplates
      )
      setLoading(false)
      setResult(normalizedResult)
      return
    }
    await runCheck(task, { open: true })
  }

  useEffect(() => {
    if (!loaded || !config || tasks.length === 0) return
    // pendingTasks 存储当前会话尚未检查且没有有效缓存的任务。
    const pendingTasks = tasks.filter((task) => {
      // autoKey 存储任务路径相关的会话去重标识。
      const autoKey = getEnvAutoCheckKey(task)
      if (checkedTaskKeys.current.has(autoKey)) return false
      // cacheEntry 存储该任务当前展示层检查状态。
      const cacheEntry = healthMap[task.task]
      if (cacheEntry?.status === 'checking') return false
      return !cacheEntry?.result
    })
    for (const task of pendingTasks) void runCheck(task, { open: false })
    // runCheck 会更新 healthMap，加入依赖会让每次结果写入重新触发自动检查。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, loaded, config, healthMap])

  return {
    healthMap,
    runCheck,
    showDetails,
    modal: {
      open,
      result,
      loading,
      taskName,
      taskDir,
      close: () => setOpen(false),
    },
  }
}
