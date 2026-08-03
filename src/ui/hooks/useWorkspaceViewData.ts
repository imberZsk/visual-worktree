import { useMemo, useState } from 'react'
import { filterProjects, summarize } from '../projectLogic.ts'
import { getTaskStatusSortOrder } from '../worktreeLogic.ts'
import {
  filterVisibleItems,
  hasVisibilityKey,
  normalizeTaskTitleBadges,
  prepareVisibleItems,
} from '../visibilityLogic.ts'

/**
 * 计算项目和任务视图需要的过滤、排序、统计与可见性数据。
 * @param {object} options - 原始 Store 数据与界面筛选条件。
 * @returns {object} 可直接传给页面组件的派生视图数据。
 */
export default function useWorkspaceViewData({
  projects,
  worktreeTasks,
  projectVisibility,
  taskVisibility,
  taskStatusMap,
  taskStatuses,
  selectedPaths,
  filter,
  keyword,
  worktreeKeyword,
  taskTitleBadges,
  showHiddenProjects,
  showHiddenTasks,
}) {
  // taskSortOrder 存储任务列表当前排序方式。
  const [taskSortOrder, setTaskSortOrder] = useState('status')
  // normalizedTaskTitleBadges 存储兼容旧配置后的任务标题徽标配置。
  const normalizedTaskTitleBadges = useMemo(
    () => normalizeTaskTitleBadges(taskTitleBadges),
    [taskTitleBadges]
  )
  // visibleProjects 存储排除隐藏项后参与统计的项目列表。
  const visibleProjects = useMemo(
    () =>
      filterVisibleItems(
        projects,
        projectVisibility,
        (project) => project.path,
        false
      ),
    [projects, projectVisibility]
  )
  // displayProjects 存储应用隐藏展示策略和置顶排序后的项目列表。
  const displayProjects = useMemo(
    () =>
      prepareVisibleItems(
        projects,
        projectVisibility,
        (project) => project.path,
        showHiddenProjects,
        (firstProject, secondProject) =>
          firstProject.name.localeCompare(secondProject.name)
      ),
    [projects, projectVisibility, showHiddenProjects]
  )
  // filteredProjects 存储继续应用状态筛选与关键词后的项目列表。
  const filteredProjects = useMemo(
    () => filterProjects(displayProjects, filter, keyword),
    [displayProjects, filter, keyword]
  )
  // projectStats 存储可见项目的状态汇总。
  const projectStats = useMemo(
    () => summarize(visibleProjects),
    [visibleProjects]
  )
  // visibleSelectedPaths 存储排除隐藏项目后的有效勾选路径。
  const visibleSelectedPaths = useMemo(
    () =>
      selectedPaths.filter(
        (path) => !hasVisibilityKey(projectVisibility, 'hidden', path)
      ),
    [selectedPaths, projectVisibility]
  )
  // taskStatusSortOrder 存储当前工作区动态状态顺序对应的任务排序权重。
  const taskStatusSortOrder = useMemo(
    () => getTaskStatusSortOrder(taskStatuses),
    [taskStatuses]
  )
  // taskCompare 存储任务列表当前使用的二级排序函数。
  const taskCompare = useMemo(
    () =>
      taskSortOrder === 'status'
        ? (firstTask, secondTask) => {
            // firstStatusOrder 存储第一个任务状态的排序权重。
            const firstStatusOrder =
              taskStatusSortOrder[taskStatusMap[firstTask.task]] ?? 0
            // secondStatusOrder 存储第二个任务状态的排序权重。
            const secondStatusOrder =
              taskStatusSortOrder[taskStatusMap[secondTask.task]] ?? 0
            return (
              firstStatusOrder - secondStatusOrder ||
              firstTask.task.localeCompare(secondTask.task)
            )
          }
        : (firstTask, secondTask) =>
            firstTask.task.localeCompare(secondTask.task),
    [taskSortOrder, taskStatusMap, taskStatusSortOrder]
  )
  // sortedTasks 存储包含当前隐藏展示策略的排序后任务列表。
  const sortedTasks = useMemo(
    () =>
      prepareVisibleItems(
        worktreeTasks,
        taskVisibility,
        (task) => task.task,
        showHiddenTasks,
        taskCompare
      ),
    [worktreeTasks, taskVisibility, showHiddenTasks, taskCompare]
  )
  // filteredTasks 存储继续按任务名或所属项目名应用搜索后的 Worktree 任务列表。
  const filteredTasks = useMemo(() => {
    // normalizedWorktreeKeyword 存储去除首尾空白并统一小写的 Worktree 搜索词。
    const normalizedWorktreeKeyword = String(worktreeKeyword || '')
      .trim()
      .toLowerCase()
    if (!normalizedWorktreeKeyword) return sortedTasks
    return sortedTasks.filter((task) => {
      // taskName 存储当前任务名的小写形式，兼容异常空值。
      const taskName = String(task?.task || '').toLowerCase()
      if (taskName.includes(normalizedWorktreeKeyword)) return true
      // taskWorktrees 存储当前任务下可用的 Worktree 项目列表。
      const taskWorktrees = Array.isArray(task?.worktrees) ? task.worktrees : []
      return taskWorktrees.some((worktree) =>
        String(worktree?.project || '')
          .toLowerCase()
          .includes(normalizedWorktreeKeyword)
      )
    })
  }, [sortedTasks, worktreeKeyword])
  // visibleTasks 存储始终排除隐藏项的任务列表，供看板与后台统计使用。
  const visibleTasks = useMemo(
    () =>
      prepareVisibleItems(
        worktreeTasks,
        taskVisibility,
        (task) => task.task,
        false,
        taskCompare
      ),
    [worktreeTasks, taskVisibility, taskCompare]
  )
  // hasHiddenTasks 标记当前是否存在隐藏任务。
  const hasHiddenTasks =
    Array.isArray(taskVisibility?.hidden) && taskVisibility.hidden.length > 0
  // hasHiddenProjects 标记当前是否存在隐藏项目。
  const hasHiddenProjects =
    Array.isArray(projectVisibility?.hidden) &&
    projectVisibility.hidden.length > 0

  return {
    taskSortOrder,
    setTaskSortOrder,
    taskTitleBadges: normalizedTaskTitleBadges,
    filteredProjects,
    projectStats,
    visibleSelectedPaths,
    sortedTasks,
    filteredTasks,
    visibleTasks,
    hasHiddenTasks,
    hasHiddenProjects,
  }
}
