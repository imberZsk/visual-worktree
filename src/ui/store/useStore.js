import { create } from 'zustand';
import { api } from '../api.js';
import { loadTaskStatusMap, normalizeTaskLinkMap, setTaskLinksInMap, setTaskStatusInMap } from '../worktreeLogic.js';
import { loadTaskWorkflowMap, setStepDoneInMap } from '../workflowLogic.js';
import { PROJECT_VISIBILITY_STORAGE_KEY, TASK_VISIBILITY_STORAGE_KEY, hasVisibilityKey, loadVisibilityPrefsFromStorage, normalizeVisibilityPrefs, setVisibilityKey } from '../visibilityLogic.js';
import { stepRunKey } from '../../core/stepOutputLog.js';

// 全局状态管理（Zustand）：项目列表、筛选条件、加载与批量进度状态。

// 从 localStorage 读取主题偏好，默认 dark（暗色模式）
const savedTheme = (() => {
  try {
    return localStorage.getItem('vw-theme') || 'dark';
  } catch (e) {
    return 'dark';
  }
})();

// 应用 store
export const useStore = create((set, get) => ({
  // 当前主题：'dark' 暗色（默认）| 'light' 亮色
  theme: savedTheme,
  // 项目状态列表
  projects: [],
  // 是否正在扫描
  loading: false,
  // 当前筛选类型
  filter: 'all',
  // 搜索关键词
  keyword: '',
  // 表格选中的项目路径数组
  selectedPaths: [],
  // 批量操作进度 { done, total, current }，null 表示无进行中操作
  batchProgress: null,
  // 应用配置
  config: null,
  // 按任务分组的 worktree 列表
  worktreeTasks: [],
  // worktree 是否正在加载
  worktreeLoading: false,
  // 任务状态映射「任务名 → 状态 key」（人工标记，持久化到 ~/.visualWorktree/task-status.json）；启动后由 loadTaskStatus 异步填充
  taskStatusMap: loadTaskStatusMap(),
  // 任务链接映射「任务名 → {name,url}[]」（Jira/飞书需求/工单地址及展示名称，持久化到 ~/.visualWorktree/task-links.json）；启动后由 loadTaskLinks 异步填充
  taskLinkMap: {},
  // 任务隐藏/置顶偏好，持久化到 ~/.visualWorktree/task-visibility.json；Electron 文件加载前先用 localStorage 兜底首屏
  taskVisibility: loadVisibilityPrefsFromStorage(TASK_VISIBILITY_STORAGE_KEY),
  // 项目隐藏/置顶偏好，持久化到 ~/.visualWorktree/project-visibility.json；key 使用项目绝对路径
  projectVisibility: loadVisibilityPrefsFromStorage(PROJECT_VISIBILITY_STORAGE_KEY),
  // 任务卡点备注映射「任务名 → 卡点文本」（持久化到 ~/.visualWorktree/task-blockers.json）；启动后由 loadTaskBlockers 异步填充
  taskBlockerMap: {},
  // 任务工作流勾选映射「任务名 → 已勾选步骤 key 数组」（需求流程进度，持久化到 ~/.visualWorktree/task-workflow.json）；
  // 启动后由 loadTaskWorkflow 异步填充，localStorage 预填保证首屏可用
  taskWorkflowMap: loadTaskWorkflowMap(),
  // 任务环境检查缓存「任务名 → 上次环境检查状态」（持久化到 ~/.visualWorktree/task-env-health.json）
  taskEnvHealthMap: {},
  // runningSteps 正在执行的步骤集合：key 为 stepRunKey(taskName, stepKey)，value 为 true。
  // 用对象（而非全局 loading）支持多任务/多步骤并发执行，各自独立显示按钮 loading，互不影响。
  runningSteps: {},

  /**
   * 标记某任务某步骤进入「执行中」状态（按钮显示 loading）。
   * @param {string} taskName - 任务名
   * @param {string} stepKey - 步骤 key
   */
  startRunningStep: (taskName, stepKey) => {
    // key 为该步骤的唯一路由 key
    const key = stepRunKey(taskName, stepKey);
    set({ runningSteps: { ...get().runningSteps, [key]: true } });
  },

  /**
   * 清除某任务某步骤的「执行中」状态（执行结束/失败/异常时调用）。
   * @param {string} taskName - 任务名
   * @param {string} stepKey - 步骤 key
   */
  finishRunningStep: (taskName, stepKey) => {
    // key 为该步骤的唯一路由 key
    const key = stepRunKey(taskName, stepKey);
    // next 为移除该 key 后的新映射（不可变更新）
    const next = { ...get().runningSteps };
    delete next[key];
    set({ runningSteps: next });
  },

  /**
   * 设置/清除某任务的人工状态，并持久化到 ~/.visualWorktree/task-status.json
   * @param {string} taskName - 任务名
   * @param {string} [statusKey] - 目标状态 key；为空或未知值时清除该任务状态
   */
  setTaskStatus: (taskName, statusKey) => {
    // next 为更新后的状态映射（纯函数返回新对象，保证不可变更新）
    const next = setTaskStatusInMap(get().taskStatusMap, taskName, statusKey);
    // fire-and-forget 持久化到文件（不等待，避免阻塞 UI 更新）
    api.saveTaskStatus(next);
    set({ taskStatusMap: next });
  },

  /**
   * 从 ~/.visualWorktree/task-status.json 异步加载任务状态映射，启动时调用一次
   */
  loadTaskStatus: async () => {
    try {
      const map = await api.loadTaskStatus();
      set({ taskStatusMap: map || {} });
    } catch (e) {
      // 加载失败时保持初始值（localStorage 已预填）
    }
  },

  /**
   * 设置/清除某任务的 Jira/飞书需求/工单链接条目，并持久化到 ~/.visualWorktree/task-links.json
   * @param {string} taskName - 任务名
   * @param {string|string[]|Array<{name?:string,url?:string}>} links - 链接 URL、URL 数组或命名链接条目数组；为空时删除该任务链接
   */
  setTaskLink: (taskName, links) => {
    // next 为更新后的链接映射；纯函数内兼容旧版字符串并过滤空白/重复项。
    const next = setTaskLinksInMap(get().taskLinkMap, taskName, links);
    api.saveTaskLinks(next);
    set({ taskLinkMap: next });
  },

  /**
   * 从 ~/.visualWorktree/task-links.json 异步加载任务链接映射，启动时调用一次
   */
  loadTaskLinks: async () => {
    try {
      const map = await api.loadTaskLinks();
      set({ taskLinkMap: normalizeTaskLinkMap(map) });
    } catch (e) {}
  },

  /**
   * 从 ~/.visualWorktree/task-visibility.json 异步加载任务隐藏/置顶偏好。
   */
  loadTaskVisibility: async () => {
    try {
      // prefs 存储主进程读取的任务可见性偏好。
      const prefs = await api.loadTaskVisibility();
      set({ taskVisibility: normalizeVisibilityPrefs(prefs) });
    } catch (e) {}
  },

  /**
   * 设置或恢复隐藏某个任务，并持久化偏好。
   * @param {string} taskName - 任务名
   * @param {boolean} hidden - true 隐藏，false 恢复显示
   */
  setTaskHidden: (taskName, hidden) => {
    // next 存储更新后的任务可见性偏好。
    const next = setVisibilityKey(get().taskVisibility, 'hidden', taskName, hidden);
    api.saveTaskVisibility(next);
    set({ taskVisibility: next });
  },

  /**
   * 设置或取消置顶某个任务，并持久化偏好。
   * @param {string} taskName - 任务名
   * @param {boolean} pinned - true 置顶，false 取消置顶
   */
  setTaskPinned: (taskName, pinned) => {
    // next 存储更新后的任务可见性偏好。
    const next = setVisibilityKey(get().taskVisibility, 'pinned', taskName, pinned);
    api.saveTaskVisibility(next);
    set({ taskVisibility: next });
  },

  /**
   * 从 ~/.visualWorktree/project-visibility.json 异步加载项目隐藏/置顶偏好。
   */
  loadProjectVisibility: async () => {
    try {
      // prefs 存储主进程读取的项目可见性偏好。
      const prefs = await api.loadProjectVisibility();
      set({ projectVisibility: normalizeVisibilityPrefs(prefs) });
    } catch (e) {}
  },

  /**
   * 设置或恢复隐藏某个项目，并持久化偏好；隐藏时同步清掉已选路径，避免批量误操作。
   * @param {string} projectPath - 项目绝对路径
   * @param {boolean} hidden - true 隐藏，false 恢复显示
   */
  setProjectHidden: (projectPath, hidden) => {
    // next 存储更新后的项目可见性偏好。
    const next = setVisibilityKey(get().projectVisibility, 'hidden', projectPath, hidden);
    // selectedPaths 存储隐藏后仍可保留的勾选路径；被隐藏的项目要从批量选择中剔除。
    const selectedPaths = hidden
      ? get().selectedPaths.filter((path) => path !== projectPath)
      : get().selectedPaths;
    api.saveProjectVisibility(next);
    set({ projectVisibility: next, selectedPaths });
  },

  /**
   * 设置或取消置顶某个项目，并持久化偏好。
   * @param {string} projectPath - 项目绝对路径
   * @param {boolean} pinned - true 置顶，false 取消置顶
   */
  setProjectPinned: (projectPath, pinned) => {
    // next 存储更新后的项目可见性偏好。
    const next = setVisibilityKey(get().projectVisibility, 'pinned', projectPath, pinned);
    api.saveProjectVisibility(next);
    set({ projectVisibility: next });
  },

  /**
   * 设置某任务的卡点备注并持久化到 ~/.visualWorktree/task-blockers.json
   * @param {string} taskName - 任务名
   * @param {string} text - 卡点备注文本；为空时删除该任务卡点
   */
  setTaskBlocker: (taskName, text) => {
    // next 为更新后的卡点映射
    const next = { ...get().taskBlockerMap };
    // 去首尾空白后非空才存，空则删除该键避免存储残留
    const trimmed = (text || '').trim();
    if (trimmed) next[taskName] = trimmed;
    else delete next[taskName];
    api.saveTaskBlockers(next);
    set({ taskBlockerMap: next });
  },

  /**
   * 从 ~/.visualWorktree/task-blockers.json 异步加载任务卡点映射，启动时调用一次
   */
  loadTaskBlockers: async () => {
    try {
      const map = await api.loadTaskBlockers();
      set({ taskBlockerMap: map || {} });
    } catch (e) {}
  },

  /**
   * 切换某任务某工作流步骤的勾选态，并持久化到 ~/.visualWorktree/task-workflow.json
   * @param {string} taskName - 任务名
   * @param {string} stepKey - 步骤 key
   * @param {boolean} done - 目标勾选态（true 勾上 / false 取消）
   */
  toggleWorkflowStep: (taskName, stepKey, done) => {
    // next 为更新后的工作流映射（纯函数返回新对象，保证不可变更新）
    const next = setStepDoneInMap(get().taskWorkflowMap, taskName, stepKey, done);
    // fire-and-forget 持久化到文件（不等待，避免阻塞 UI 更新）
    api.saveTaskWorkflow(next);
    set({ taskWorkflowMap: next });
  },

  /**
   * 从 ~/.visualWorktree/task-workflow.json 异步加载任务工作流勾选映射，启动时调用一次
   */
  loadTaskWorkflow: async () => {
    try {
      const map = await api.loadTaskWorkflow();
      set({ taskWorkflowMap: map || {} });
    } catch (e) {
      // 加载失败时保持初始值（localStorage 已预填）
    }
  },

  /**
   * 设置任务环境检查缓存并持久化到 ~/.visualWorktree/task-env-health.json
   * @param {Record<string,object>} map - 任务名到环境检查缓存的映射
   */
  setTaskEnvHealthMap: (map) => {
    // next 为即将写入 store 和磁盘的环境检查缓存映射
    const next = map && typeof map === 'object' && !Array.isArray(map) ? map : {};
    api.saveTaskEnvHealth(next);
    set({ taskEnvHealthMap: next });
  },

  /**
   * 从 ~/.visualWorktree/task-env-health.json 异步加载任务环境检查缓存
   */
  loadTaskEnvHealth: async () => {
    try {
      const map = await api.loadTaskEnvHealth();
      set({ taskEnvHealthMap: map || {} });
    } catch (e) {
      // 加载失败时保持空缓存，不影响环境检查实时执行
    }
  },

  /**
   * 切换主题并持久化
   */
  toggleTheme: () => {
    // next 为切换后的主题
    const next = get().theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem('vw-theme', next);
    } catch (e) {
      // localStorage 不可用时忽略持久化
    }
    set({ theme: next });
  },

  /**
   * 设置筛选类型
   * @param {string} filter - 筛选类型
   */
  setFilter: (filter) => set({ filter }),

  /**
   * 设置搜索关键词
   * @param {string} keyword - 关键词
   */
  setKeyword: (keyword) => set({ keyword }),

  /**
   * 设置选中的项目路径
   * @param {string[]} selectedPaths - 选中路径数组
   */
  setSelectedPaths: (selectedPaths) => set({ selectedPaths }),

  /**
   * 扫描项目并更新列表
   * @param {object} [opts] - 扫描选项（如 fetch）
   * @returns {Promise<{fetchFailedNames:string[]}>} 扫描结果摘要；fetchFailedNames 为本次因连不上远程而未能更新的项目名列表
   */
  scan: async (opts = {}) => {
    set({ loading: true });
    try {
      // projects 为扫描得到的项目状态数组
      const projects = await api.scanProjects(opts);
      set({ projects, loading: false });
      // fetchFailedNames 收集本次尝试 fetch 但失败（远程不可达/超时）的项目名，供 UI 友好提示
      const fetchFailedNames = projects.filter((p) => p.fetchFailed).map((p) => p.name);
      return { fetchFailedNames };
    } catch (e) {
      console.error('扫描失败', e);
      set({ loading: false });
      // 整体扫描异常（如 IPC 失败）时返回空摘要，避免调用方读取 undefined
      return { fetchFailedNames: [] };
    }
  },

  /**
   * 加载配置到 store
   */
  loadConfig: async () => {
    // config 存储主进程从 ~/.visualWorktree/config.json 读取到的最新应用配置。
    const config = await api.loadConfig();
    set({ config });
    return config;
  },

  /**
   * 扫描按任务分组的 worktree 并更新 store
   */
  scanWorktrees: async () => {
    set({ worktreeLoading: true });
    try {
      // tasks 为按任务分组的 worktree 列表
      const tasks = await api.scanWorktreesByTask({ status: true });
      set({ worktreeTasks: tasks, worktreeLoading: false });
    } catch (e) {
      console.error('扫描 worktree 失败', e);
      set({ worktreeLoading: false });
    }
  },

  /**
   * 执行批量操作并跟踪进度
   * @param {string} operation - 操作类型
   * @param {object} args - 操作参数
   * @returns {Promise<Array>} 操作结果
   */
  runBatch: async (operation, args) => {
    // paths 为当前选中的且未隐藏的项目路径；隐藏项目不参与批量操作。
    const paths = get().selectedPaths.filter((path) => !hasVisibilityKey(get().projectVisibility, 'hidden', path));
    if (!paths.length) return [];
    set({ batchProgress: { done: 0, total: paths.length, current: '' } });
    // 订阅主进程推送的进度事件
    const unsub = api.onBatchProgress((p) => set({ batchProgress: p }));
    try {
      const results = await api.batchOperate(paths, operation, args);
      // 批量拉取完成后清空项目 Tab 勾选，避免下一次误操作同一批项目。
      if (operation === 'pull') set({ selectedPaths: [] });
      return results;
    } finally {
      unsub?.();
      set({ batchProgress: null });
      // 操作后重新扫描以刷新状态
      get().scan();
    }
  },
}));
