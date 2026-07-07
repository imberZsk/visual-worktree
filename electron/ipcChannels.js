// IPC 通道名常量：主进程与渲染进程共享，避免字符串硬编码不一致。
// 集中定义便于测试与维护。
export const IPC = {
  // 扫描所有项目
  SCAN_PROJECTS: 'scan-projects',
  // 获取单个项目详情状态
  GET_PROJECT_STATUS: 'get-project-status',
  // 切换分支
  CHECKOUT_BRANCH: 'checkout-branch',
  // 拉取更新
  PULL_UPDATES: 'pull-updates',
  // 批量操作
  BATCH_OPERATE: 'batch-operate',
  // 批量进度推送（主进程 → 渲染进程）
  BATCH_PROGRESS: 'batch-progress',
  // 获取 worktree 列表
  GET_WORKTREES: 'get-worktrees',
  // 按任务分组扫描 worktree
  SCAN_WORKTREES_BY_TASK: 'scan-worktrees-by-task',
  // 创建 worktree
  ADD_WORKTREE: 'add-worktree',
  // 删除 worktree
  REMOVE_WORKTREE: 'remove-worktree',
  // 清理失效 worktree
  PRUNE_WORKTREES: 'prune-worktrees',
  // 按任务批量创建 worktree
  BATCH_ADD_WORKTREE: 'batch-add-worktree',
  // 读取配置
  LOAD_CONFIG: 'load-config',
  // 保存配置
  SAVE_CONFIG: 'save-config',
  // 恢复默认配置
  RESET_CONFIG: 'reset-config',
  // 在 Finder 中打开
  OPEN_IN_FINDER: 'open-in-finder',
  // 在 VSCode 中打开
  OPEN_IN_VSCODE: 'open-in-vscode',
  // 在终端中打开
  OPEN_IN_TERMINAL: 'open-in-terminal',
  // 打开系统目录选择器，返回用户选择的目录路径
  SELECT_DIRECTORY: 'select-directory',
  // 打开系统文件选择器，返回用户选择的单个文件路径（用于流程步骤"执行命令"插入文件路径）
  SELECT_FILE: 'select-file',
  // 执行工作流步骤配置的 shell 命令（在任务目录下运行，回传 stdout/stderr）
  RUN_WORKFLOW_STEP: 'run-workflow-step',
  // 工作流步骤执行的实时输出推送（主进程 → 渲染进程）：每来一段 stdout/stderr 即推送，使执行过程可见
  STEP_OUTPUT: 'step-output',
  // 复制文本到系统剪贴板（走主进程 clipboard，规避沙箱 preload 不暴露 clipboard 的问题）
  COPY_TEXT: 'copy-text',
  // 获取提交历史
  GET_COMMITS: 'get-commits',
  // 删除任务文件夹（包含整个目录树）
  REMOVE_TASK_FOLDER: 'remove-task-folder',
  // 归档任务 docs 工作记录到 ~/.visualWorktree/task-docs
  ARCHIVE_TASK_DOCS: 'archive-task-docs',
  // 读取任务状态映射（~/.visualWorktree/task-status.json）
  LOAD_TASK_STATUS: 'load-task-status',
  // 保存任务状态映射（~/.visualWorktree/task-status.json）
  SAVE_TASK_STATUS: 'save-task-status',
  // 读取任务链接映射（~/.visualWorktree/task-links.json）
  LOAD_TASK_LINKS: 'load-task-links',
  // 保存任务链接映射（~/.visualWorktree/task-links.json）
  SAVE_TASK_LINKS: 'save-task-links',
  // 读取任务隐藏/置顶偏好（~/.visualWorktree/task-visibility.json）
  LOAD_TASK_VISIBILITY: 'load-task-visibility',
  // 保存任务隐藏/置顶偏好（~/.visualWorktree/task-visibility.json）
  SAVE_TASK_VISIBILITY: 'save-task-visibility',
  // 读取项目隐藏/置顶偏好（~/.visualWorktree/project-visibility.json）
  LOAD_PROJECT_VISIBILITY: 'load-project-visibility',
  // 保存项目隐藏/置顶偏好（~/.visualWorktree/project-visibility.json）
  SAVE_PROJECT_VISIBILITY: 'save-project-visibility',
  // 读取任务工作流勾选映射（~/.visualWorktree/task-workflow.json）
  LOAD_TASK_WORKFLOW: 'load-task-workflow',
  // 保存任务工作流勾选映射（~/.visualWorktree/task-workflow.json）
  SAVE_TASK_WORKFLOW: 'save-task-workflow',
  // 读取任务工作流步骤最近一次执行输出缓存（~/.visualWorktree/task-workflow-output.json）
  LOAD_TASK_WORKFLOW_OUTPUT: 'load-task-workflow-output',
  // 保存任务工作流步骤最近一次执行输出缓存（~/.visualWorktree/task-workflow-output.json）
  SAVE_TASK_WORKFLOW_OUTPUT: 'save-task-workflow-output',
  // 在系统默认浏览器中打开 URL
  OPEN_EXTERNAL_URL: 'open-external-url',
  // 读取已删除任务的历史记录（~/.visualWorktree/task-history.json）
  LOAD_TASK_HISTORY: 'load-task-history',
  // 追加一条已删除任务记录
  APPEND_TASK_HISTORY: 'append-task-history',
  // 按下标删除一条历史记录
  REMOVE_TASK_HISTORY: 'remove-task-history',
  // 获取任务关联的 Claude Code 会话列表及用量
  GET_CLAUDE_SESSIONS_BY_TASK: 'get-claude-sessions-by-task',
  // 获取所有任务的 Claude Code 用量汇总
  GET_CLAUDE_TASKS_SUMMARY: 'get-claude-tasks-summary',
  // 获取可安全删除的 worktree 列表（已合并+无未提交改动）
  GET_SAFE_TO_REMOVE_WORKTREES: 'get-safe-to-remove-worktrees',
  // 对任务目录执行环境健康检查（依赖/端口/服务/Git）
  CHECK_ENV_HEALTH: 'check-env-health',
  // 读取任务环境检查缓存（~/.visualWorktree/task-env-health.json）
  LOAD_TASK_ENV_HEALTH: 'load-task-env-health',
  // 保存任务环境检查缓存（~/.visualWorktree/task-env-health.json）
  SAVE_TASK_ENV_HEALTH: 'save-task-env-health',
  // 读取任务卡点备注映射（~/.visualWorktree/task-blockers.json）
  LOAD_TASK_BLOCKERS: 'load-task-blockers',
  // 保存任务卡点备注映射（~/.visualWorktree/task-blockers.json）
  SAVE_TASK_BLOCKERS: 'save-task-blockers',
  // 读取想法工作流定义列表（~/.visualWorktree/idea-workflows.json）
  LOAD_IDEA_WORKFLOWS: 'load-idea-workflows',
  // 保存想法工作流定义列表（~/.visualWorktree/idea-workflows.json）
  SAVE_IDEA_WORKFLOWS: 'save-idea-workflows',
  // 读取想法工作流运行历史（~/.visualWorktree/idea-runs.json）
  LOAD_IDEA_RUNS: 'load-idea-runs',
  // 追加一条想法工作流运行记录
  APPEND_IDEA_RUN: 'append-idea-run',
};
