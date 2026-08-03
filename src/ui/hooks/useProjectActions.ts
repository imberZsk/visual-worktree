import { useState } from 'react'
import { api } from '../api.ts'
import { quotePathForCopy } from '../worktreeLogic.ts'
import { withConfirmDefaults } from '../modalDefaults.ts'

// DEFAULT_MAIN_BRANCH 存储配置缺失时使用的主分支候选名。
const DEFAULT_MAIN_BRANCH = 'master'

/**
 * 从路径字符串或带 path 字段的对象中读取目标路径。
 * @param {object|string|null} target - 路径目标。
 * @returns {string} 可传给主进程的路径。
 */
function resolveTargetPath(target) {
  return typeof target === 'string' ? target : target?.path || ''
}

/**
 * 管理单项目 Git 操作、外部工具入口与单个 Worktree 清理。
 * @param {object} options - 项目操作依赖。
 * @param {object|null} options.config - 当前应用配置。
 * @param {object} options.message - Ant Design message API。
 * @param {object} options.modal - Ant Design modal API。
 * @param {() => Promise<void>} options.scanProjects - 刷新项目列表的动作。
 * @param {() => Promise<void>} options.scanWorktrees - 刷新 Worktree 列表的动作。
 * @returns {object} 项目 loading 状态及相关操作。
 */
export default function useProjectActions({
  config,
  message,
  modal,
  scanProjects,
  scanWorktrees,
}) {
  // loadingPaths 存储正在执行 Git 操作的项目路径集合。
  const [loadingPaths, setLoadingPaths] = useState(new Set())

  /**
   * 更新指定项目的 loading 状态。
   * @param {string} projectPath - 项目绝对路径。
   * @param {boolean} loading - 是否正在执行操作。
   */
  const setProjectLoading = (projectPath, loading) => {
    setLoadingPaths((previousPaths) => {
      // nextPaths 存储更新后的项目 loading 集合。
      const nextPaths = new Set(previousPaths)
      if (loading) nextPaths.add(projectPath)
      else nextPaths.delete(projectPath)
      return nextPaths
    })
  }

  /**
   * 将单个项目切换到配置的主分支。
   * @param {object} project - 待操作项目。
   */
  const checkoutMain = async (project) => {
    if (!project?.path || loadingPaths.has(project.path)) return
    setProjectLoading(project.path, true)
    try {
      // mainBranch 存储本次请求的首选主分支名。
      const mainBranch = config?.mainBranches?.[0] || DEFAULT_MAIN_BRANCH
      // result 存储主进程返回的切换结果。
      const result = await api.checkoutBranch(project.path, mainBranch)
      if (result?.success) {
        message.success(`${project.name} 已切到 ${result.branch || mainBranch}`)
        scanProjects()
      } else {
        message.error(`切换失败：${result?.error || '未知错误'}`)
      }
    } finally {
      setProjectLoading(project.path, false)
    }
  }

  /**
   * 拉取单个项目的远程更新。
   * @param {object} project - 待操作项目。
   */
  const pull = async (project) => {
    if (!project?.path || loadingPaths.has(project.path)) return
    setProjectLoading(project.path, true)
    try {
      // result 存储主进程返回的拉取结果。
      const result = await api.pullUpdates(project.path)
      if (result?.success) {
        message.success(`${project.name} 已拉取更新`)
        scanProjects()
      } else {
        message.error(`拉取失败：${result?.error || '未知错误'}`)
      }
    } finally {
      setProjectLoading(project.path, false)
    }
  }

  /**
   * 在系统文件管理器中打开目标路径。
   * @param {object|string} target - 路径或带 path 字段的对象。
   */
  const openFinder = (target) => {
    // targetPath 存储解析后的目标路径。
    const targetPath = resolveTargetPath(target)
    if (targetPath) api.openInFinder(targetPath)
  }

  /**
   * 在 VS Code 中打开目标路径。
   * @param {object|string} target - 路径或带 path 字段的对象。
   */
  const openVscode = async (target) => {
    // targetPath 存储解析后的目标路径。
    const targetPath = resolveTargetPath(target)
    if (!targetPath) return
    // result 存储主进程打开编辑器的结果。
    const result = await api.openInVscode(targetPath)
    if (result && !result.success) {
      message.error(result.error || '打开 VSCode 失败')
    }
  }

  /**
   * 在终端中打开目标路径。
   * @param {object|string} target - 路径或带 path 字段的对象。
   */
  const openTerminal = async (target) => {
    // targetPath 存储解析后的目标路径。
    const targetPath = resolveTargetPath(target)
    if (!targetPath) return
    // result 存储主进程打开终端的结果。
    const result = await api.openInTerminal(targetPath)
    if (result && !result.success) {
      message.error(result.error || '打开终端失败')
    }
  }

  /**
   * 将可安全粘贴到终端的目标路径复制到剪贴板。
   * @param {object|string} target - 路径或带 path 字段的对象。
   */
  const copyPath = async (target) => {
    // targetPath 存储解析后的目标路径。
    const targetPath = resolveTargetPath(target)
    if (!targetPath) return
    // copied 标记剪贴板写入是否成功。
    const copied = await api.copyText(quotePathForCopy(targetPath))
    if (copied) message.success('已复制路径')
    else message.error('复制失败')
  }

  /**
   * 在系统默认浏览器中打开外部 URL。
   * @param {string} url - 待打开 URL。
   */
  const openUrl = async (url) => {
    if (!url) return
    // result 存储主进程打开外部链接的结果。
    const result = await api.openExternalUrl(url)
    if (result && !result.success) message.error('打开链接失败')
  }

  /**
   * 确认后删除单个 Worktree，安全删除失败时提供强制删除确认。
   * @param {object} worktree - 待删除 Worktree。
   */
  const removeWorktree = (worktree) => {
    if (!worktree?.projectPath || !worktree?.path) return
    modal.confirm(
      withConfirmDefaults({
        title: '删除 Worktree',
        content: `确认删除 ${worktree.project} 的 worktree（分支 ${worktree.branch}）？`,
        okType: 'danger',
        onOk: async () => {
          // result 存储优先执行的安全删除结果。
          const result = await api.removeWorktree(
            worktree.projectPath,
            worktree.path,
            {}
          )
          if (result?.success) {
            message.success('已删除')
            scanWorktrees()
            return
          }
          modal.confirm(
            withConfirmDefaults({
              title: '该 worktree 有未提交变更',
              content: '强制删除将丢弃这些变更，是否继续？',
              okType: 'danger',
              okText: '强制删除',
              onOk: async () => {
                // forcedResult 存储用户确认后的强制删除结果。
                const forcedResult = await api.removeWorktree(
                  worktree.projectPath,
                  worktree.path,
                  { force: true }
                )
                if (forcedResult?.success) {
                  message.success('已强制删除')
                  scanWorktrees()
                } else {
                  message.error(
                    `删除失败：${forcedResult?.error || '未知错误'}`
                  )
                }
              },
            })
          )
        },
      })
    )
  }

  /**
   * 清理指定项目的失效 Worktree 引用。
   * @param {object} worktree - 包含项目路径的 Worktree。
   */
  const pruneWorktree = async (worktree) => {
    if (!worktree?.projectPath) return
    // result 存储主进程返回的清理结果。
    const result = await api.pruneWorktrees(worktree.projectPath)
    if (result?.success) {
      message.success('已清理失效 worktree')
      scanWorktrees()
    } else {
      message.error(`清理失败：${result?.error || '未知错误'}`)
    }
  }

  return {
    loadingPaths,
    checkoutMain,
    pull,
    openFinder,
    openVscode,
    openTerminal,
    copyPath,
    openUrl,
    removeWorktree,
    pruneWorktree,
  }
}
