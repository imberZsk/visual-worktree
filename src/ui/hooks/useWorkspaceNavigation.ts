import { useEffect, useRef, useState } from 'react'

// ACTIVE_VIEW_STORAGE_KEY 存储主视图在 localStorage 中使用的键。
const ACTIVE_VIEW_STORAGE_KEY = 'vw-active-view'
// DEFAULT_ACTIVE_VIEW 存储首次打开应用时的默认主视图。
const DEFAULT_ACTIVE_VIEW = 'worktrees'

/**
 * 管理主视图切换、首次数据加载、按需扫描与手动刷新。
 * @param {object} options - 页面导航和数据加载依赖。
 * @param {() => void} [options.onWorktreesRefreshed] - Worktree 手动刷新完成后的通知回调。
 * @returns {object} 当前视图、加载状态及导航刷新操作。
 */
export default function useWorkspaceNavigation({
  projects,
  worktreeTasks,
  projectsLoading,
  worktreesLoading,
  scanProjects,
  scanWorktrees,
  loadConfig,
  loadTaskStatus,
  loadTaskTags,
  loadTaskLinks,
  loadTaskVisibility,
  loadProjectVisibility,
  loadTaskWorkflow,
  loadTaskBlockers,
  clearKeyword,
  clearWorktreeKeyword,
  clearActiveTaskKeys,
  onWorktreesRefreshed,
  message,
}) {
  // activeView 存储当前主视图，并从本地偏好恢复。
  const [activeView, setActiveView] = useState(
    () => localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY) || DEFAULT_ACTIVE_VIEW
  )
  // projectInitialScanDone 记录本次会话是否已为项目视图执行过首次扫描。
  const projectInitialScanDone = useRef(false)
  // initialViewHandled 记录首次视图扫描是否已经由挂载 effect 处理。
  const initialViewHandled = useRef(false)

  useEffect(() => {
    loadConfig()
    if (activeView === 'projects') {
      projectInitialScanDone.current = true
      scanProjects()
    } else {
      scanWorktrees()
    }
    loadTaskStatus()
    loadTaskTags()
    loadTaskLinks()
    loadTaskVisibility()
    loadProjectVisibility()
    loadTaskWorkflow()
    loadTaskBlockers()
    // Store 动作引用会随 Zustand 快照变化；初始化加载必须只执行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!initialViewHandled.current) {
      initialViewHandled.current = true
      return
    }
    if (
      (activeView === 'worktrees' || activeView === 'kanban') &&
      worktreeTasks.length === 0 &&
      !worktreesLoading
    ) {
      scanWorktrees()
    }
    if (activeView !== 'projects') return
    if (!projectInitialScanDone.current) {
      projectInitialScanDone.current = true
      scanProjects()
      return
    }
    if (projects.length === 0 && !projectsLoading) scanProjects()
    // 列表长度会随扫描结果变化；这里只由视图切换触发补扫。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView])

  /**
   * 切换主视图并清空项目与 Worktree 搜索词。
   * @param {string} nextView - 目标主视图。
   */
  const changeView = (nextView) => {
    // 切换前同步触发 store 的 loading 状态，避免目标视图先渲染空态、下一帧才出现加载反馈。
    if (
      (nextView === 'worktrees' || nextView === 'kanban') &&
      worktreeTasks.length === 0 &&
      !worktreesLoading
    ) {
      scanWorktrees()
    }
    if (nextView === 'projects' && projects.length === 0 && !projectsLoading) {
      projectInitialScanDone.current = true
      scanProjects()
    }
    setActiveView(nextView)
    localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, nextView)
    clearKeyword('')
    clearWorktreeKeyword('')
  }

  /**
   * 刷新当前视图所依赖的数据，并提示远程连接失败项目。
   */
  const refresh = async () => {
    if (activeView === 'projects') {
      // scanResult 存储项目扫描结果及远程拉取失败项目。
      const scanResult = await scanProjects({ fetch: true })
      // failedNames 存储无法连接远程的项目名。
      const failedNames = scanResult?.fetchFailedNames || []
      if (failedNames.length > 0) {
        message.warning(
          `${failedNames.length} 个项目连不上远程，已显示本地状态（领先/落后可能不准）：${failedNames.join('、')}`,
          5
        )
      }
      return
    }
    clearActiveTaskKeys([])
    // 手动刷新时 Git 状态扫描可能持续较久；先通知用量统计重新计算，避免价格请求被整个目录扫描阻塞。
    onWorktreesRefreshed?.()
    await scanWorktrees()
  }

  // loading 存储当前视图对应的数据加载状态。
  const loading =
    activeView === 'workflow'
      ? false
      : activeView === 'projects'
        ? projectsLoading
        : worktreesLoading

  return { activeView, changeView, refresh, loading }
}
