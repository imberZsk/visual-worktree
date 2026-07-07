// preload 脚本（CommonJS）：在隔离上下文中向渲染进程暴露受限的 IPC API。
// 渲染进程通过 window.api.xxx 调用，不直接接触 ipcRenderer，保证安全。
// 注意：sandbox 默认开启的 preload 中 require('electron') 不暴露 clipboard 等模块，
// 故剪贴板写入改走主进程 IPC（见 COPY_TEXT），不在此直接 require clipboard。
const { contextBridge, ipcRenderer } = require('electron');

// IPC 通道常量（与 ipcChannels.js 保持一致；preload 为 cjs 故内联）
const IPC = {
  SCAN_PROJECTS: 'scan-projects',
  GET_PROJECT_STATUS: 'get-project-status',
  CHECKOUT_BRANCH: 'checkout-branch',
  PULL_UPDATES: 'pull-updates',
  BATCH_OPERATE: 'batch-operate',
  BATCH_PROGRESS: 'batch-progress',
  GET_WORKTREES: 'get-worktrees',
  SCAN_WORKTREES_BY_TASK: 'scan-worktrees-by-task',
  ADD_WORKTREE: 'add-worktree',
  REMOVE_WORKTREE: 'remove-worktree',
  PRUNE_WORKTREES: 'prune-worktrees',
  BATCH_ADD_WORKTREE: 'batch-add-worktree',
  LOAD_CONFIG: 'load-config',
  SAVE_CONFIG: 'save-config',
  RESET_CONFIG: 'reset-config',
  OPEN_IN_FINDER: 'open-in-finder',
  OPEN_IN_VSCODE: 'open-in-vscode',
  OPEN_IN_TERMINAL: 'open-in-terminal',
  SELECT_DIRECTORY: 'select-directory',
  SELECT_FILE: 'select-file',
  RUN_WORKFLOW_STEP: 'run-workflow-step',
  STEP_OUTPUT: 'step-output',
  COPY_TEXT: 'copy-text',
  GET_COMMITS: 'get-commits',
  REMOVE_TASK_FOLDER: 'remove-task-folder',
  ARCHIVE_TASK_DOCS: 'archive-task-docs',
  LOAD_TASK_STATUS: 'load-task-status',
  SAVE_TASK_STATUS: 'save-task-status',
  LOAD_TASK_LINKS: 'load-task-links',
  SAVE_TASK_LINKS: 'save-task-links',
  LOAD_TASK_VISIBILITY: 'load-task-visibility',
  SAVE_TASK_VISIBILITY: 'save-task-visibility',
  LOAD_PROJECT_VISIBILITY: 'load-project-visibility',
  SAVE_PROJECT_VISIBILITY: 'save-project-visibility',
  LOAD_TASK_WORKFLOW: 'load-task-workflow',
  SAVE_TASK_WORKFLOW: 'save-task-workflow',
  LOAD_TASK_WORKFLOW_OUTPUT: 'load-task-workflow-output',
  SAVE_TASK_WORKFLOW_OUTPUT: 'save-task-workflow-output',
  OPEN_EXTERNAL_URL: 'open-external-url',
  LOAD_TASK_HISTORY: 'load-task-history',
  APPEND_TASK_HISTORY: 'append-task-history',
  REMOVE_TASK_HISTORY: 'remove-task-history',
  GET_CLAUDE_SESSIONS_BY_TASK: 'get-claude-sessions-by-task',
  GET_CLAUDE_TASKS_SUMMARY: 'get-claude-tasks-summary',
  GET_SAFE_TO_REMOVE_WORKTREES: 'get-safe-to-remove-worktrees',
  CHECK_ENV_HEALTH: 'check-env-health',
  LOAD_TASK_ENV_HEALTH: 'load-task-env-health',
  SAVE_TASK_ENV_HEALTH: 'save-task-env-health',
  LOAD_TASK_BLOCKERS: 'load-task-blockers',
  SAVE_TASK_BLOCKERS: 'save-task-blockers',
  LOAD_IDEA_WORKFLOWS: 'load-idea-workflows',
  SAVE_IDEA_WORKFLOWS: 'save-idea-workflows',
  LOAD_IDEA_RUNS: 'load-idea-runs',
  APPEND_IDEA_RUN: 'append-idea-run',
};

// 暴露给渲染进程的 API 对象
contextBridge.exposeInMainWorld('api', {
  // 扫描所有项目
  scanProjects: (opts) => ipcRenderer.invoke(IPC.SCAN_PROJECTS, opts),
  // 获取单个项目状态
  getProjectStatus: (path, opts) => ipcRenderer.invoke(IPC.GET_PROJECT_STATUS, path, opts),
  // 切换分支
  checkoutBranch: (path, branch) => ipcRenderer.invoke(IPC.CHECKOUT_BRANCH, path, branch),
  // 拉取更新
  pullUpdates: (path) => ipcRenderer.invoke(IPC.PULL_UPDATES, path),
  // 批量操作
  batchOperate: (paths, op, args) => ipcRenderer.invoke(IPC.BATCH_OPERATE, paths, op, args),
  // 获取 worktree 列表
  getWorktrees: (path) => ipcRenderer.invoke(IPC.GET_WORKTREES, path),
  // 按任务分组扫描 worktree
  scanWorktreesByTask: (opts) => ipcRenderer.invoke(IPC.SCAN_WORKTREES_BY_TASK, opts),
  // 创建 worktree
  addWorktree: (projectPath, targetPath, branch, opts) => ipcRenderer.invoke(IPC.ADD_WORKTREE, projectPath, targetPath, branch, opts),
  // 删除 worktree
  removeWorktree: (projectPath, worktreePath, opts) => ipcRenderer.invoke(IPC.REMOVE_WORKTREE, projectPath, worktreePath, opts),
  // 清理失效 worktree
  pruneWorktrees: (projectPath) => ipcRenderer.invoke(IPC.PRUNE_WORKTREES, projectPath),
  // 按任务批量创建 worktree
  batchAddWorktree: (params) => ipcRenderer.invoke(IPC.BATCH_ADD_WORKTREE, params),
  // 读取配置
  loadConfig: () => ipcRenderer.invoke(IPC.LOAD_CONFIG),
  // 保存配置
  saveConfig: (config) => ipcRenderer.invoke(IPC.SAVE_CONFIG, config),
  // 恢复默认配置
  resetConfig: () => ipcRenderer.invoke(IPC.RESET_CONFIG),
  // 获取提交历史
  getCommits: (path, n) => ipcRenderer.invoke(IPC.GET_COMMITS, path, n),
  // 在 Finder 中打开
  openInFinder: (path) => ipcRenderer.invoke(IPC.OPEN_IN_FINDER, path),
  // 在 VSCode 中打开
  openInVscode: (path) => ipcRenderer.invoke(IPC.OPEN_IN_VSCODE, path),
  // 在终端中打开（优先 Ghostty，否则系统 Terminal）
  openInTerminal: (path) => ipcRenderer.invoke(IPC.OPEN_IN_TERMINAL, path),
  // 打开系统目录选择器：payload={defaultPath?}，返回 {canceled,path?}
  selectDirectory: (payload) => ipcRenderer.invoke(IPC.SELECT_DIRECTORY, payload),
  // 打开系统文件选择器：payload={defaultPath?}，返回 {canceled,path?}
  selectFile: (payload) => ipcRenderer.invoke(IPC.SELECT_FILE, payload),
  // 执行工作流步骤的 shell 命令：payload={command,cwd,task,branch}，在 cwd 下运行，返回 {success,code,stdout,stderr,error}
  runWorkflowStep: (payload) => ipcRenderer.invoke(IPC.RUN_WORKFLOW_STEP, payload),
  // 复制文本到系统剪贴板：走主进程 clipboard（沙箱 preload 不暴露 clipboard 模块），
  // 返回 Promise<boolean> 表示是否成功
  copyText: (text) => ipcRenderer.invoke(IPC.COPY_TEXT, text),
  // 删除任务文件夹（删除 worktreesRoot 下对应任务目录的整个文件夹）
  removeTaskFolder: (folderPath) => ipcRenderer.invoke(IPC.REMOVE_TASK_FOLDER, folderPath),
  // 归档任务 docs 工作记录到 ~/.visualWorktree/task-docs/{任务名}
  archiveTaskDocs: (taskDir, taskName) => ipcRenderer.invoke(IPC.ARCHIVE_TASK_DOCS, taskDir, taskName),
  // 读取任务状态映射（~/.visualWorktree/task-status.json）
  loadTaskStatus: () => ipcRenderer.invoke(IPC.LOAD_TASK_STATUS),
  // 保存任务状态映射（~/.visualWorktree/task-status.json）
  saveTaskStatus: (map) => ipcRenderer.invoke(IPC.SAVE_TASK_STATUS, map),
  // 读取任务链接映射（~/.visualWorktree/task-links.json）
  loadTaskLinks: () => ipcRenderer.invoke(IPC.LOAD_TASK_LINKS),
  // 保存任务链接映射（~/.visualWorktree/task-links.json）
  saveTaskLinks: (map) => ipcRenderer.invoke(IPC.SAVE_TASK_LINKS, map),
  // 读取任务隐藏/置顶偏好（~/.visualWorktree/task-visibility.json）
  loadTaskVisibility: () => ipcRenderer.invoke(IPC.LOAD_TASK_VISIBILITY),
  // 保存任务隐藏/置顶偏好（~/.visualWorktree/task-visibility.json）
  saveTaskVisibility: (prefs) => ipcRenderer.invoke(IPC.SAVE_TASK_VISIBILITY, prefs),
  // 读取项目隐藏/置顶偏好（~/.visualWorktree/project-visibility.json）
  loadProjectVisibility: () => ipcRenderer.invoke(IPC.LOAD_PROJECT_VISIBILITY),
  // 保存项目隐藏/置顶偏好（~/.visualWorktree/project-visibility.json）
  saveProjectVisibility: (prefs) => ipcRenderer.invoke(IPC.SAVE_PROJECT_VISIBILITY, prefs),
  // 读取任务工作流勾选映射（~/.visualWorktree/task-workflow.json）
  loadTaskWorkflow: () => ipcRenderer.invoke(IPC.LOAD_TASK_WORKFLOW),
  // 保存任务工作流勾选映射（~/.visualWorktree/task-workflow.json）
  saveTaskWorkflow: (map) => ipcRenderer.invoke(IPC.SAVE_TASK_WORKFLOW, map),
  // 读取任务工作流步骤最近一次执行输出缓存（~/.visualWorktree/task-workflow-output.json）
  loadTaskWorkflowOutput: () => ipcRenderer.invoke(IPC.LOAD_TASK_WORKFLOW_OUTPUT),
  // 保存任务工作流步骤最近一次执行输出缓存（~/.visualWorktree/task-workflow-output.json）
  saveTaskWorkflowOutput: (map) => ipcRenderer.invoke(IPC.SAVE_TASK_WORKFLOW_OUTPUT, map),
  // 在系统默认浏览器中打开 URL
  openExternalUrl: (url) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL_URL, url),
  // 读取已删除任务的历史记录
  loadTaskHistory: () => ipcRenderer.invoke(IPC.LOAD_TASK_HISTORY),
  // 追加一条已删除任务记录（{ task, link }）
  appendTaskHistory: (entry) => ipcRenderer.invoke(IPC.APPEND_TASK_HISTORY, entry),
  // 按下标删除一条历史记录
  removeTaskHistory: (idx) => ipcRenderer.invoke(IPC.REMOVE_TASK_HISTORY, idx),
  // 获取任务关联的 Claude Code 会话列表及 token 用量
  getClaudeSessionsByTask: (taskName) => ipcRenderer.invoke(IPC.GET_CLAUDE_SESSIONS_BY_TASK, taskName),
  // 获取所有任务的 Claude Code 用量汇总
  getClaudeTasksSummary: (taskNames) => ipcRenderer.invoke(IPC.GET_CLAUDE_TASKS_SUMMARY, taskNames),
  // 获取可安全删除的 worktree 列表
  getSafeToRemoveWorktrees: () => ipcRenderer.invoke(IPC.GET_SAFE_TO_REMOVE_WORKTREES),
  // 对任务目录执行环境健康检查（依赖/端口/服务/Git）
  checkEnvHealth: (taskDir) => ipcRenderer.invoke(IPC.CHECK_ENV_HEALTH, taskDir),
  // 读取任务环境检查缓存（~/.visualWorktree/task-env-health.json）
  loadTaskEnvHealth: () => ipcRenderer.invoke(IPC.LOAD_TASK_ENV_HEALTH),
  // 保存任务环境检查缓存（~/.visualWorktree/task-env-health.json）
  saveTaskEnvHealth: (map) => ipcRenderer.invoke(IPC.SAVE_TASK_ENV_HEALTH, map),
  // 读取任务卡点备注映射（~/.visualWorktree/task-blockers.json）
  loadTaskBlockers: () => ipcRenderer.invoke(IPC.LOAD_TASK_BLOCKERS),
  // 保存任务卡点备注映射（~/.visualWorktree/task-blockers.json）
  saveTaskBlockers: (map) => ipcRenderer.invoke(IPC.SAVE_TASK_BLOCKERS, map),
  // 读取想法工作流定义列表（~/.visualWorktree/idea-workflows.json）
  loadIdeaWorkflows: () => ipcRenderer.invoke(IPC.LOAD_IDEA_WORKFLOWS),
  // 保存想法工作流定义列表（~/.visualWorktree/idea-workflows.json）
  saveIdeaWorkflows: (defs) => ipcRenderer.invoke(IPC.SAVE_IDEA_WORKFLOWS, defs),
  // 读取想法工作流运行历史（~/.visualWorktree/idea-runs.json，最近50条）
  loadIdeaRuns: () => ipcRenderer.invoke(IPC.LOAD_IDEA_RUNS),
  // 追加一条想法工作流运行记录（插入头部，超50条截断）
  appendIdeaRun: (run) => ipcRenderer.invoke(IPC.APPEND_IDEA_RUN, run),
  // 订阅批量进度事件，返回取消订阅函数
  onBatchProgress: (callback) => {
    // listener 包装回调，剥离 event 参数
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on(IPC.BATCH_PROGRESS, listener);
    return () => ipcRenderer.removeListener(IPC.BATCH_PROGRESS, listener);
  },
  // 订阅工作流步骤的实时输出事件，返回取消订阅函数。
  // 回调入参 { taskName, stepKey, chunk }：每来一段 stdout/stderr 即触发，供渲染进程累积展示执行过程
  onStepOutput: (callback) => {
    // listener 包装回调，剥离 event 参数
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on(IPC.STEP_OUTPUT, listener);
    return () => ipcRenderer.removeListener(IPC.STEP_OUTPUT, listener);
  },
});
