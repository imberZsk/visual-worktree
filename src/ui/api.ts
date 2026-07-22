// API 适配层：优先用 Electron preload 暴露的 window.api；
// 在纯浏览器环境（无 Electron）降级为空实现，避免页面崩溃，便于 vite 单独预览/调试。
import {
  PROJECT_VISIBILITY_STORAGE_KEY,
  TASK_VISIBILITY_STORAGE_KEY,
  loadVisibilityPrefsFromStorage,
  saveVisibilityPrefsToStorage,
} from './visibilityLogic.ts'

// hasElectron 标记当前是否运行在 Electron 渲染进程中
const hasElectron = typeof window !== 'undefined' && !!window.api

// TASK_WORKFLOW_OUTPUT_STORAGE_KEY 存储浏览器降级环境下的流程步骤输出缓存 localStorage key。
const TASK_WORKFLOW_OUTPUT_STORAGE_KEY = 'vw-task-workflow-output'

// 浏览器降级实现：返回空数据并在控制台提示
const browserFallback = {
  checkAppUpdate: async () => ({ available: false }),
  downloadAppUpdate: async () => ({ downloaded: false }),
  installAppUpdate: async () => false,
  // 浏览器降级环境不会收到桌面端更新下载进度。
  onAppUpdateProgress: () => () => {},
  // 浏览器降级平台标识：无 Node process，用 navigator.platform 粗判 Windows，识别不出默认按 darwin（保持原有 UI 展示）
  platform:
    typeof navigator !== 'undefined' && /win/i.test(navigator.platform || '')
      ? 'win32'
      : 'darwin',
  scanProjects: async () => {
    console.warn('[api] 非 Electron 环境，scanProjects 返回空')
    return []
  },
  getProjectStatus: async () => null,
  checkoutBranch: async () => ({ success: false, error: '非 Electron 环境' }),
  pullUpdates: async () => ({ success: false, error: '非 Electron 环境' }),
  syncUpdates: async () => ({ success: false, error: '非 Electron 环境' }),
  batchOperate: async () => [],
  getWorktrees: async () => [],
  scanWorktreesByTask: async () => [],
  addWorktree: async () => ({ success: false, error: '非 Electron 环境' }),
  removeWorktree: async () => ({ success: false, error: '非 Electron 环境' }),
  pruneWorktrees: async () => ({ success: false, error: '非 Electron 环境' }),
  batchAddWorktree: async () => [],
  loadConfig: async () => ({
    onboardingCompleted: false,
    sourceProjectsPath: '',
    worktreesPath: '',
    activePathProfileId: 'default',
    pathProfiles: [
      {
        id: 'default',
        name: '工作路径',
        sourceProjectsPath: '',
        worktreesPath: '',
      },
    ],
    mainBranches: ['master', 'main'],
    ignoredProjects: [],
  }),
  saveConfig: async (c) => c,
  resetConfig: async () => browserFallback.loadConfig(),
  getCommits: async () => [],
  openInFinder: async () => ({ success: true }),
  openInVscode: async () => ({ success: true }),
  openInTerminal: async () => ({ success: true }),
  // 浏览器降级：无 Electron 原生对话框，返回明确错误给设置页提示
  selectDirectory: async () => ({
    canceled: false,
    error: '仅桌面端可选择目录',
  }),
  // 浏览器降级：无 Electron 原生对话框，返回明确错误给设置页提示
  selectFile: async () => ({ canceled: false, error: '仅桌面端可选择文件' }),
  // 浏览器降级：无主进程无法跑 shell 命令，回传明确失败提示
  runWorkflowStep: async () => ({
    success: false,
    error: '仅桌面端可执行命令',
  }),
  copyText: async () => true,
  removeTaskFolder: async () => ({ success: false, error: '非 Electron 环境' }),
  archiveTaskDocs: async (_taskDir, taskName) => ({
    success: true,
    docsPath: `/tmp/visual-worktree-task-docs/${taskName || 'task'}`,
    archivedProjects: 0,
  }),
  loadTaskStatus: async () => {
    // 浏览器降级：从 localStorage 读取（与旧版兼容）
    try {
      const r = localStorage.getItem('vw-task-status')
      return r ? JSON.parse(r) : {}
    } catch {
      return {}
    }
  },
  saveTaskStatus: async (map) => {
    try {
      localStorage.setItem('vw-task-status', JSON.stringify(map || {}))
      return true
    } catch {
      return false
    }
  },
  loadTaskLinks: async () => {
    try {
      const r = localStorage.getItem('vw-task-links')
      return r ? JSON.parse(r) : {}
    } catch {
      return {}
    }
  },
  saveTaskLinks: async (map) => {
    try {
      localStorage.setItem('vw-task-links', JSON.stringify(map || {}))
      return true
    } catch {
      return false
    }
  },
  loadTaskVisibility: async () =>
    loadVisibilityPrefsFromStorage(TASK_VISIBILITY_STORAGE_KEY),
  saveTaskVisibility: async (prefs) =>
    saveVisibilityPrefsToStorage(TASK_VISIBILITY_STORAGE_KEY, prefs),
  loadProjectVisibility: async () =>
    loadVisibilityPrefsFromStorage(PROJECT_VISIBILITY_STORAGE_KEY),
  saveProjectVisibility: async (prefs) =>
    saveVisibilityPrefsToStorage(PROJECT_VISIBILITY_STORAGE_KEY, prefs),
  loadTaskWorkflow: async () => {
    // 浏览器降级：从 localStorage 读取任务工作流勾选映射
    try {
      const r = localStorage.getItem('vw-task-workflow')
      return r ? JSON.parse(r) : {}
    } catch {
      return {}
    }
  },
  saveTaskWorkflow: async (map) => {
    try {
      localStorage.setItem('vw-task-workflow', JSON.stringify(map || {}))
      return true
    } catch {
      return false
    }
  },
  loadTaskWorkflowOutput: async () => {
    try {
      // raw 存储 localStorage 中的原始流程输出缓存 JSON。
      const raw = localStorage.getItem(TASK_WORKFLOW_OUTPUT_STORAGE_KEY)
      // parsed 存储反序列化后的缓存映射；空值回退空对象。
      const parsed = raw ? JSON.parse(raw) : {}
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {}
    } catch {
      return {}
    }
  },
  saveTaskWorkflowOutput: async (map) => {
    try {
      localStorage.setItem(
        TASK_WORKFLOW_OUTPUT_STORAGE_KEY,
        JSON.stringify(map || {})
      )
      return true
    } catch {
      return false
    }
  },
  openExternalUrl: async (url) => {
    try {
      window.open(url, '_blank')
      return { success: true }
    } catch {
      return { success: false }
    }
  },
  loadTaskHistory: async (workspaceId) => {
    try {
      const r = localStorage.getItem('vw-task-history')
      // list 存储浏览器降级环境中的完整历史记录列表。
      const list = r ? JSON.parse(r) : []
      if (!workspaceId || !Array.isArray(list)) return Array.isArray(list) ? list : []
      // migratedList 存储把旧版无工作区记录归入当前工作区后的列表。
      const migratedList = list.map((item) =>
        item?.workspaceId ? item : { ...item, workspaceId }
      )
      localStorage.setItem('vw-task-history', JSON.stringify(migratedList))
      return migratedList.filter((item) => item?.workspaceId === workspaceId)
    } catch {
      return []
    }
  },
  appendTaskHistory: async (entry, workspaceId) => {
    try {
      // list 现有历史列表；新记录插入头部
      const r = localStorage.getItem('vw-task-history')
      const list = r ? JSON.parse(r) : []
      // link 存储任务被删除时的需求链接；新版为命名链接数组，旧版字符串仍原样兼容历史展示。
      const link = Array.isArray(entry.link) ? entry.link : entry.link || ''
      // status 为任务被删除时的人工标记状态（可选）
      list.unshift({
        task: entry.task || '',
        link,
        status: entry.status || '',
        docsPath: entry.docsPath || '',
        workspaceId: workspaceId || '',
        deletedAt: new Date().toISOString(),
      })
      localStorage.setItem('vw-task-history', JSON.stringify(list))
      return true
    } catch {
      return false
    }
  },
  removeTaskHistory: async (idx, workspaceId) => {
    try {
      const r = localStorage.getItem('vw-task-history')
      const list = r ? JSON.parse(r) : []
      // targetIndex 存储当前工作区下标在完整历史列表中的实际下标。
      const targetIndex = workspaceId
        ? list.reduce((matchingIndexes, item, itemIndex) => {
            if (item?.workspaceId === workspaceId) matchingIndexes.push(itemIndex)
            return matchingIndexes
          }, [])[idx]
        : idx
      if (Number.isInteger(targetIndex)) list.splice(targetIndex, 1)
      localStorage.setItem('vw-task-history', JSON.stringify(list))
      return true
    } catch {
      return false
    }
  },
  getClaudeSessionsByTask: async () => [],
  getClaudeTasksSummary: async () => ({}),
  // 浏览器降级：无主进程，可安全删除列表/环境检查/卡点/想法工作流均返回空或成功兜底
  getSafeToRemoveWorktrees: async () => [],
  checkEnvHealth: async () => ({
    deps: { status: 'ok', message: '非 Electron 环境', fixes: [] },
    ports: { status: 'ok', message: '非 Electron 环境', fixes: [] },
    services: { status: 'ok', message: '非 Electron 环境', fixes: [] },
    git: { status: 'ok', message: '非 Electron 环境', fixes: [] },
    summary: {
      status: 'ok',
      projectCount: 0,
      issueCount: 0,
      failedProjects: [],
      message: '非 Electron 环境',
    },
    projects: [],
  }),
  loadTaskEnvHealth: async () => {
    try {
      const r = localStorage.getItem('vw-task-env-health')
      return r ? JSON.parse(r) : {}
    } catch {
      return {}
    }
  },
  saveTaskEnvHealth: async (map) => {
    try {
      localStorage.setItem('vw-task-env-health', JSON.stringify(map || {}))
      return true
    } catch {
      return false
    }
  },
  loadTaskBlockers: async () => {
    try {
      const r = localStorage.getItem('vw-task-blockers')
      return r ? JSON.parse(r) : {}
    } catch {
      return {}
    }
  },
  saveTaskBlockers: async (map) => {
    try {
      localStorage.setItem('vw-task-blockers', JSON.stringify(map || {}))
      return true
    } catch {
      return false
    }
  },
  loadIdeaWorkflows: async () => {
    try {
      const r = localStorage.getItem('vw-idea-workflows')
      return r ? JSON.parse(r) : []
    } catch {
      return []
    }
  },
  saveIdeaWorkflows: async (defs) => {
    try {
      localStorage.setItem('vw-idea-workflows', JSON.stringify(defs || []))
      return true
    } catch {
      return false
    }
  },
  loadIdeaRuns: async () => {
    try {
      const r = localStorage.getItem('vw-idea-runs')
      return r ? JSON.parse(r) : []
    } catch {
      return []
    }
  },
  appendIdeaRun: async (run) => {
    try {
      // list 现有运行历史；新记录插入头部并截断到50条
      const r = localStorage.getItem('vw-idea-runs')
      const list = r ? JSON.parse(r) : []
      list.unshift(run)
      localStorage.setItem('vw-idea-runs', JSON.stringify(list.slice(0, 50)))
      return true
    } catch {
      return false
    }
  },
  onBatchProgress: () => () => {},
  // 浏览器降级：无主进程不会推送步骤输出，订阅为空操作，返回空的取消订阅函数
  onStepOutput: () => () => {},
}

// 导出统一 api：Electron 环境用真实实现，否则降级
export const api = hasElectron ? window.api : browserFallback
export { hasElectron }
