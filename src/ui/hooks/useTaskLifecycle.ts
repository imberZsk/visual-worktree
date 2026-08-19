import { useEffect, useRef, useState } from 'react'
import { api } from '../api.ts'
import {
  computeActiveKeysAfterCreate,
  normalizeTaskLinkItems,
} from '../worktreeLogic.ts'
import { withConfirmDefaults } from '../modalDefaults.ts'

/**
 * 管理任务创建、归档删除和创建弹窗状态。
 * @param {object} options - 任务生命周期依赖。
 * @param {object|null} options.config - 当前应用配置。
 * @param {Array<object>} options.projects - 当前项目列表。
 * @param {Record<string,string>} options.taskStatusMap - 任务状态映射。
 * @param {Record<string,unknown>} options.taskLinkMap - 任务链接映射。
 * @param {object} options.message - Ant Design message API。
 * @param {object} options.modal - Ant Design modal API。
 * @param {() => Promise<void>} options.scanProjects - 刷新项目列表的动作。
 * @param {() => Promise<void>} options.scanWorktrees - 刷新 Worktree 列表的动作。
 * @param {(taskName:string,links:Array<object>) => void} options.setTaskLink - 写入任务链接的动作。
 * @param {(keys:Array<string>) => void} options.setActiveKeys - 更新展开任务的动作。
 * @returns {object} 创建弹窗状态及任务生命周期操作。
 */
export default function useTaskLifecycle({
  config,
  projects,
  taskStatusMap,
  taskLinkMap,
  message,
  modal,
  scanProjects,
  scanWorktrees,
  setTaskLink,
  setActiveKeys,
}) {
  // createOpen 控制创建 Worktree 弹窗是否展示。
  const [createOpen, setCreateOpen] = useState(false)
  // createDefaultTask 存储从任务行创建时预填的任务名。
  const [createDefaultTask, setCreateDefaultTask] = useState(null)
  // createProgress 存储当前 Worktree 创建进度；null 表示没有创建任务正在执行。
  const [createProgress, setCreateProgress] = useState(null)
  // createProgressUnsubscribeRef 存储创建进度事件的取消订阅函数，供完成或卸载时释放。
  const createProgressUnsubscribeRef = useRef(null)

  useEffect(
    () => () => {
      createProgressUnsubscribeRef.current?.()
      createProgressUnsubscribeRef.current = null
    },
    []
  )

  /**
   * 删除任务前归档工作文档，归档失败时阻止删除。
   * @param {object} task - 待删除任务。
   * @returns {Promise<{success:boolean,docsPath?:string}>} 归档结果。
   */
  const archiveBeforeRemove = async (task) => {
    // archiveResult 存储主进程返回的文档归档结果。
    const archiveResult = await api.archiveTaskDocs(task?.path, task?.task)
    if (!archiveResult?.success) {
      message.error(`归档工作记录失败：${archiveResult?.error || '未知错误'}`)
      return { success: false }
    }
    return { success: true, docsPath: archiveResult.docsPath || '' }
  }

  /**
   * 删除任务目录并将任务信息写入当前工作区历史记录。
   * @param {object} task - 待删除任务。
   * @param {string} docsPath - 已归档工作文档目录。
   * @returns {Promise<boolean>} 是否完成删除收尾。
   */
  const finalizeRemove = async (task, docsPath = '') => {
    // removeResult 存储任务目录删除结果。
    const removeResult = await api.removeTaskFolder(task?.path)
    if (removeResult && !removeResult.success) {
      message.error(`删除任务目录失败：${removeResult.error || '未知错误'}`)
      return false
    }
    // historyEntry 存储待写入历史文件的任务快照。
    const historyEntry = {
      task: task?.task,
      link: normalizeTaskLinkItems(taskLinkMap?.[task?.task]),
      status: taskStatusMap?.[task?.task] || '',
      docsPath,
    }
    await api.appendTaskHistory(historyEntry, config?.activePathProfileId || '')
    return true
  }

  /**
   * 归档并删除不含有效 Worktree 的任务。
   * @param {object} task - 待删除任务。
   */
  const removeEmptyTask = async (task) => {
    // archiveResult 存储删除前的工作文档归档结果。
    const archiveResult = await archiveBeforeRemove(task)
    if (!archiveResult.success) return
    // removed 标记任务目录与历史记录是否处理完成。
    const removed = await finalizeRemove(task, archiveResult.docsPath)
    if (!removed) return
    message.success(`已删除任务「${task.task}」`)
    scanWorktrees()
  }

  /**
   * 强制删除安全删除阶段被未提交变更阻止的 Worktree，并完成任务删除。
   * @param {object} task - 待删除任务。
   * @param {Array<object>} blockedWorktrees - 需要强制删除的 Worktree。
   * @param {string} docsPath - 已归档工作文档目录。
   */
  const forceRemoveBlockedWorktrees = async (
    task,
    blockedWorktrees,
    docsPath
  ) => {
    for (const worktree of blockedWorktrees) {
      await api.removeWorktree(worktree.projectPath, worktree.path, {
        force: true,
      })
    }
    // projectPaths 存储需要清理失效引用的去重项目路径。
    const projectPaths = [
      ...new Set(blockedWorktrees.map((worktree) => worktree.projectPath)),
    ]
    await Promise.all(projectPaths.map((path) => api.pruneWorktrees(path)))
    // removed 标记任务目录与历史记录是否处理完成。
    const removed = await finalizeRemove(task, docsPath)
    if (!removed) return
    message.success(`已删除任务「${task.task}」`)
    scanWorktrees()
  }

  /**
   * 确认后删除任务下全部 Worktree、任务目录并记录历史。
   * @param {object} task - 待删除任务。
   */
  const removeTask = (task) => {
    if (!task?.task || !task?.path) return
    // worktrees 存储该任务下的全部 Worktree。
    const worktrees = Array.isArray(task.worktrees) ? task.worktrees : []
    if (worktrees.length === 0) {
      modal.confirm(
        withConfirmDefaults({
          title: `删除任务「${task.task}」`,
          content: `该任务下没有 worktree，将直接删除任务目录「${task.task}」。是否继续？`,
          okType: 'danger',
          okText: '删除',
          onOk: () => removeEmptyTask(task),
        })
      )
      return
    }
    modal.confirm(
      withConfirmDefaults({
        title: `删除任务「${task.task}」`,
        content: `将删除该任务下全部 ${worktrees.length} 个 worktree 并删除任务目录「${task.task}」。此操作不可撤销，是否继续？`,
        okType: 'danger',
        okText: '删除',
        onOk: async () => {
          // archiveResult 存储删除 Worktree 前的工作文档归档结果。
          const archiveResult = await archiveBeforeRemove(task)
          if (!archiveResult.success) return
          // removableWorktrees 存储仍然有效、需要执行安全删除的 Worktree。
          const removableWorktrees = worktrees.filter(
            (worktree) => !(worktree.prunable || worktree.missing)
          )
          // blockedWorktrees 累积因未提交变更而安全删除失败的 Worktree。
          const blockedWorktrees = []
          // failedWorktrees 累积非未提交变更导致的删除失败，必须展示真实错误且禁止误导性强删。
          const failedWorktrees = []
          for (const worktree of removableWorktrees) {
            // removeResult 存储当前 Worktree 的安全删除结果。
            const removeResult = await api.removeWorktree(
              worktree.projectPath,
              worktree.path,
              {}
            )
            if (!removeResult?.success) {
              if (removeResult?.reason === 'dirty') {
                blockedWorktrees.push(worktree)
              } else {
                failedWorktrees.push({
                  worktree,
                  error: removeResult?.error || '未知错误',
                })
              }
            }
          }
          // projectPaths 存储需要 prune 的全部去重项目路径，包括失效项。
          const projectPaths = [
            ...new Set(worktrees.map((worktree) => worktree.projectPath)),
          ]
          await Promise.all(
            projectPaths.map((path) => api.pruneWorktrees(path))
          )
          if (failedWorktrees.length > 0) {
            // firstFailure 存储第一个真实删除错误，避免把权限、锁定等故障误报为未提交变更。
            const firstFailure = failedWorktrees[0]
            message.error(
              `删除 ${firstFailure.worktree.project} 失败：${firstFailure.error}`
            )
            scanWorktrees()
            return
          }
          if (blockedWorktrees.length === 0) {
            // removed 标记任务目录与历史记录是否处理完成。
            const removed = await finalizeRemove(task, archiveResult.docsPath)
            if (!removed) return
            message.success(`已删除任务「${task.task}」`)
            scanWorktrees()
            return
          }
          modal.confirm(
            withConfirmDefaults({
              title: `${blockedWorktrees.length} 个 worktree 有未提交变更`,
              content: '强制删除将丢弃这些未提交的改动，是否继续？',
              okType: 'danger',
              okText: '强制删除',
              onOk: () =>
                forceRemoveBlockedWorktrees(
                  task,
                  blockedWorktrees,
                  archiveResult.docsPath
                ),
              onCancel: () => {
                message.info(
                  `已删除 ${removableWorktrees.length - blockedWorktrees.length} 个，保留 ${blockedWorktrees.length} 个有变更的`
                )
                scanWorktrees()
              },
            })
          )
        },
      })
    )
  }

  /**
   * 批量创建任务 Worktree，并刷新任务状态。
   * @param {object} values - 创建表单值。
   */
  const createWorktrees = async (values) => {
    // projectPaths 存储本次待创建 Worktree 的项目路径。
    const projectPaths = Array.isArray(values?.projectPaths)
      ? values.projectPaths
      : []
    // 创建开始后关闭表单弹层，避免两个弹层叠放；独立进度弹层接管等待反馈。
    setCreateOpen(false)
    setCreateDefaultTask(null)
    setCreateProgress({
      done: 0,
      total: projectPaths.length,
      current:
        projectPaths.length > 0 ? '正在准备创建...' : '正在创建任务目录...',
    })
    createProgressUnsubscribeRef.current?.()
    createProgressUnsubscribeRef.current = api.onBatchProgress((progress) => {
      if (progress) setCreateProgress(progress)
    })
    // results 存储各项目创建结果。
    let results
    try {
      results = await api.batchAddWorktree(values)
    } catch (error) {
      message.error(`创建 Worktree 失败：${error?.message || '未知错误'}`)
      return
    } finally {
      createProgressUnsubscribeRef.current?.()
      createProgressUnsubscribeRef.current = null
      setCreateProgress(null)
    }
    // successCount 存储成功创建或复用的项目数量。
    const successCount = results.filter((result) => result.success).length
    // failureCount 存储创建失败的项目数量。
    const failureCount = results.length - successCount
    // linkedCount 存储成功复用 node_modules 的项目数量。
    const linkedCount = results.filter(
      (result) => result.success && result.nodeModulesLinked
    ).length
    // linkedTip 存储成功提示中的依赖复用说明。
    const linkedTip =
      linkedCount > 0 ? `，其中 ${linkedCount} 个已软链接 node_modules` : ''
    // links 存储用户本次提交的规范化任务链接。
    const links = normalizeTaskLinkItems(values?.links)
    if (links.length > 0) setTaskLink(values.task, links)
    if (failureCount === 0) {
      if ((values?.projectPaths || []).length === 0) {
        message.success('已创建任务目录')
      } else {
        message.success(`已为 ${successCount} 个项目创建 worktree${linkedTip}`)
      }
    } else {
      // failureDetails 存储失败项目与原因的提示文本。
      const failureDetails = results
        .filter((result) => !result.success)
        .map((result) => `${result.project}：${result.error || '未知错误'}`)
        .join('；')
      message.warning(
        `成功 ${successCount}，失败 ${failureCount}（${failureDetails}）${linkedTip}`,
        8
      )
    }
    scanWorktrees()
    setActiveKeys(computeActiveKeysAfterCreate(values.task))
  }

  /**
   * 打开创建弹窗，并在项目选项尚未加载时补扫项目。
   * @param {string|null} defaultTask - 需要预填的任务名。
   */
  const openCreate = (defaultTask = null) => {
    setCreateDefaultTask(defaultTask)
    setCreateOpen(true)
    if (projects.length === 0) scanProjects()
  }

  /**
   * 从任务行打开创建弹窗并预填当前任务名。
   * @param {object} task - 当前任务。
   */
  const addWorktreeToTask = (task) => {
    openCreate(task?.task || null)
  }

  return {
    createOpen,
    createDefaultTask,
    createProgress,
    closeCreate: () => {
      setCreateOpen(false)
      setCreateDefaultTask(null)
    },
    openCreate,
    addWorktreeToTask,
    createWorktrees,
    removeTask,
  }
}
