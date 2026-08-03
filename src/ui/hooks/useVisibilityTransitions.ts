import { useEffect, useRef, useState } from 'react'

// HIDE_ANIMATION_MS 存储隐藏项退出动画时长。
const HIDE_ANIMATION_MS = 180

/**
 * 管理任务和项目的临时显示隐藏状态及退出动画。
 * @param {object} options - 可见性动作依赖。
 * @param {(taskName:string,hidden:boolean) => void} options.setTaskHidden - 持久化任务隐藏状态的动作。
 * @param {(projectPath:string,hidden:boolean) => void} options.setProjectHidden - 持久化项目隐藏状态的动作。
 * @param {(updater:Function) => void} options.setActiveTaskKeys - 更新展开任务集合的 setter。
 * @param {(projectPath:string) => void} options.onProjectHiding - 项目开始隐藏时的页面回调。
 * @returns {object} 可见性状态与切换操作。
 */
export default function useVisibilityTransitions({
  setTaskHidden,
  setProjectHidden,
  setActiveTaskKeys,
  onProjectHiding,
}) {
  // showHiddenTasks 控制任务视图是否临时展示隐藏项。
  const [showHiddenTasks, setShowHiddenTasks] = useState(false)
  // showHiddenProjects 控制项目视图是否临时展示隐藏项。
  const [showHiddenProjects, setShowHiddenProjects] = useState(false)
  // hidingTaskKeys 存储正在播放退出动画的任务名。
  const [hidingTaskKeys, setHidingTaskKeys] = useState([])
  // hidingProjectKeys 存储正在播放退出动画的项目路径。
  const [hidingProjectKeys, setHidingProjectKeys] = useState([])
  // taskTimers 存储每个任务待完成的隐藏动画定时器。
  const taskTimers = useRef(new Map())
  // projectTimers 存储每个项目待完成的隐藏动画定时器。
  const projectTimers = useRef(new Map())

  useEffect(
    () => () => {
      taskTimers.current.forEach((timerId) => globalThis.clearTimeout(timerId))
      projectTimers.current.forEach((timerId) =>
        globalThis.clearTimeout(timerId)
      )
      taskTimers.current.clear()
      projectTimers.current.clear()
    },
    []
  )

  /**
   * 隐藏或恢复任务，隐藏时等待退出动画结束后再持久化。
   * @param {string} taskName - 目标任务名。
   * @param {boolean} hidden - 是否隐藏。
   */
  const changeTaskHidden = (taskName, hidden) => {
    if (!taskName) return
    // existingTimer 存储该任务尚未完成的隐藏动画定时器。
    const existingTimer = taskTimers.current.get(taskName)
    if (existingTimer) globalThis.clearTimeout(existingTimer)
    taskTimers.current.delete(taskName)
    if (!hidden) {
      setHidingTaskKeys((keys) => keys.filter((key) => key !== taskName))
      setTaskHidden(taskName, false)
      return
    }
    setHidingTaskKeys((keys) =>
      keys.includes(taskName) ? keys : [...keys, taskName]
    )
    setActiveTaskKeys((keys) => keys.filter((key) => key !== taskName))
    // timerId 存储退出动画结束后的持久化定时器。
    const timerId = globalThis.setTimeout(() => {
      setTaskHidden(taskName, true)
      setHidingTaskKeys((keys) => keys.filter((key) => key !== taskName))
      taskTimers.current.delete(taskName)
    }, HIDE_ANIMATION_MS)
    taskTimers.current.set(taskName, timerId)
  }

  /**
   * 隐藏或恢复项目，隐藏时等待退出动画结束后再持久化。
   * @param {string} projectPath - 目标项目路径。
   * @param {boolean} hidden - 是否隐藏。
   */
  const changeProjectHidden = (projectPath, hidden) => {
    if (!projectPath) return
    // existingTimer 存储该项目尚未完成的隐藏动画定时器。
    const existingTimer = projectTimers.current.get(projectPath)
    if (existingTimer) globalThis.clearTimeout(existingTimer)
    projectTimers.current.delete(projectPath)
    if (!hidden) {
      setHidingProjectKeys((keys) => keys.filter((key) => key !== projectPath))
      setProjectHidden(projectPath, false)
      return
    }
    setHidingProjectKeys((keys) =>
      keys.includes(projectPath) ? keys : [...keys, projectPath]
    )
    onProjectHiding(projectPath)
    // timerId 存储退出动画结束后的持久化定时器。
    const timerId = globalThis.setTimeout(() => {
      setProjectHidden(projectPath, true)
      setHidingProjectKeys((keys) => keys.filter((key) => key !== projectPath))
      projectTimers.current.delete(projectPath)
    }, HIDE_ANIMATION_MS)
    projectTimers.current.set(projectPath, timerId)
  }

  return {
    showHiddenTasks,
    showHiddenProjects,
    hidingTaskKeys,
    hidingProjectKeys,
    toggleShowHiddenTasks: () => setShowHiddenTasks((value) => !value),
    toggleShowHiddenProjects: () => setShowHiddenProjects((value) => !value),
    changeTaskHidden,
    changeProjectHidden,
  }
}
