import React, { useState, useMemo } from 'react'
import { Layout, App as AntApp, Grid } from 'antd'
import { api } from './api.ts'
import { useStore } from './store/useStore.ts'
import {
  normalizeWorkflowSteps,
  DEFAULT_WORKFLOW_STEPS,
} from './workflowLogic.ts'
import ProjectTable from './components/ProjectTable.tsx'
import ProjectDetail from './components/ProjectDetail.tsx'
import SettingsModal from './components/SettingsModal.tsx'
import WorktreePanel from './components/WorktreePanel.tsx'
import CreateWorktreeModal from './components/CreateWorktreeModal.tsx'
import CleanupSuggestionsModal from './components/CleanupSuggestionsModal.tsx'
import KanbanView from './components/KanbanView.tsx'
import WorkflowTabView from './components/WorkflowTabView.tsx'
import AiAssistant from './components/AiAssistant.tsx'
import EnvHealthModal from './components/EnvHealthModal.tsx'
import OnboardingModal from './components/OnboardingModal.tsx'
import TaskHistoryModal from './components/TaskHistoryModal.tsx'
import BatchProgressModal from './components/BatchProgressModal.tsx'
import StepOutputModal from './components/StepOutputModal.tsx'
import AppHeader from './components/AppHeader.tsx'
import WorktreeToolbar from './components/WorktreeToolbar.tsx'
import ProjectOverviewControls from './components/ProjectOverviewControls.tsx'
import useAppUpdate from './hooks/useAppUpdate.ts'
import useTaskHistory from './hooks/useTaskHistory.ts'
import useBatchOperations from './hooks/useBatchOperations.ts'
import useWorkspaceViewData from './hooks/useWorkspaceViewData.ts'
import useAiUsageSummary from './hooks/useAiUsageSummary.ts'
import useWorkspaceNavigation from './hooks/useWorkspaceNavigation.ts'
import useWorkflowExecution from './hooks/useWorkflowExecution.ts'
import useEnvHealthCheck from './hooks/useEnvHealthCheck.ts'
import useProjectActions from './hooks/useProjectActions.ts'
import useTaskLifecycle from './hooks/useTaskLifecycle.ts'
import useVisibilityTransitions from './hooks/useVisibilityTransitions.ts'
import useWorkspaceConfig from './hooks/useWorkspaceConfig.ts'

const { Content } = Layout
// 响应式断点 hook：用于根据屏幕宽度调整布局
const { useBreakpoint } = Grid

// 主应用组件：组合工具栏、统计卡片、项目表格、详情抽屉、设置弹窗与批量操作。
export default function App() {
  // 从全局 store 取状态与动作
  const {
    projects,
    loading,
    filter,
    keyword,
    selectedPaths,
    batchProgress,
    config,
  } = useStore()
  const {
    worktreeTasks,
    worktreeLoading,
    theme: themeMode,
    taskStatusMap,
    taskLinkMap,
    taskWorkflowMap,
    taskBlockerMap,
    taskEnvHealthMap,
    runningSteps,
    taskVisibility,
    projectVisibility,
  } = useStore()
  const {
    setFilter,
    setKeyword,
    setSelectedPaths,
    scan,
    loadConfig,
    runBatch,
    scanWorktrees,
    toggleTheme,
    setTaskStatus,
    loadTaskStatus,
    setTaskLink,
    loadTaskLinks,
    toggleWorkflowStep,
    loadTaskWorkflow,
    setTaskBlocker,
    loadTaskBlockers,
    setTaskEnvHealthMap,
    loadTaskEnvHealth,
    startRunningStep,
    finishRunningStep,
    loadTaskVisibility,
    loadProjectVisibility,
    setTaskHidden,
    setTaskPinned,
    setProjectHidden,
    setProjectPinned,
  } = useStore()
  // 从 AntApp 上下文取 message/modal，使提示与确认框跟随明暗主题（替代脱离上下文的静态方法）
  const { message, modal } = AntApp.useApp()
  // projectActions 管理单项目 Git 操作、外部工具入口及单个 Worktree 清理。
  const projectActions = useProjectActions({
    config,
    message,
    modal,
    scanProjects: scan,
    scanWorktrees,
  })
  // appUpdate 存储应用更新状态和下载操作，由独立 hook 管理更新生命周期。
  const appUpdate = useAppUpdate(message)
  // detailProject 当前查看详情的项目
  const [detailProject, setDetailProject] = useState(null)
  // settingsOpen 设置弹窗开关
  const [settingsOpen, setSettingsOpen] = useState(false)
  // worktreeActiveKeys 受控的 worktree 任务面板展开集合（任务名数组）；
  // 初值 [] 表示全部收起，刷新后保持收起态
  const [worktreeActiveKeys, setWorktreeActiveKeys] = useState([])
  // worktreeKeyword 存储 Worktree 视图按任务名或项目名过滤的搜索词。
  const [worktreeKeyword, setWorktreeKeyword] = useState('')
  // workspaceNavigation 管理主视图、首次加载、按需扫描和手动刷新。
  const workspaceNavigation = useWorkspaceNavigation({
    projects,
    worktreeTasks,
    projectsLoading: loading,
    worktreesLoading: worktreeLoading,
    scanProjects: scan,
    scanWorktrees,
    loadConfig,
    loadTaskStatus,
    loadTaskLinks,
    loadTaskVisibility,
    loadProjectVisibility,
    loadTaskWorkflow,
    loadTaskBlockers,
    clearKeyword: setKeyword,
    clearWorktreeKeyword: setWorktreeKeyword,
    clearActiveTaskKeys: setWorktreeActiveKeys,
    message,
  })
  // activeView 存储当前主视图，供页面组件和其他业务 hook 使用。
  const activeView = workspaceNavigation.activeView
  // visibilityTransitions 管理任务和项目的隐藏动画、临时展示及卸载清理。
  const visibilityTransitions = useVisibilityTransitions({
    setTaskHidden,
    setProjectHidden,
    setActiveTaskKeys: setWorktreeActiveKeys,
    onProjectHiding: (projectPath) => {
      if (detailProject?.path === projectPath) setDetailProject(null)
    },
  })
  // workspaceConfig 管理首次初始化、路径组合选择以及配置切换后的数据刷新。
  const workspaceConfig = useWorkspaceConfig({
    config,
    activeView,
    message,
    scanProjects: scan,
    scanWorktrees,
    clearDetailProject: setDetailProject,
    clearActiveTaskKeys: setWorktreeActiveKeys,
  })
  // taskHistory 管理当前路径组合的删除历史、确认框和分页。
  const taskHistory = useTaskHistory({
    workspaceId: workspaceConfig.activePathProfileId,
    modal,
  })
  // cleanupOpen 清理建议模态框开关
  const [cleanupOpen, setCleanupOpen] = useState(false)
  // screens 当前命中的响应式断点集合（如 { xs:true, sm:true, ... }）
  const screens = useBreakpoint()
  // isNarrow 窄屏标记：lg 断点未命中（<992px）时为真，用于压缩 Header 与工具栏
  const isNarrow = !screens.lg

  // workspaceViewData 计算项目和任务列表的过滤、排序、统计与可见性数据。
  const workspaceViewData = useWorkspaceViewData({
    projects,
    worktreeTasks,
    projectVisibility,
    taskVisibility,
    taskStatusMap,
    taskStatuses: config?.taskStatuses,
    selectedPaths,
    filter,
    keyword,
    worktreeKeyword,
    taskTitleBadges: config?.taskTitleBadges,
    showHiddenProjects: visibilityTransitions.showHiddenProjects,
    showHiddenTasks: visibilityTransitions.showHiddenTasks,
  })
  // batchOperations 管理项目批量操作菜单、确认和结果提示。
  const batchOperations = useBatchOperations({
    selectedPaths: workspaceViewData.visibleSelectedPaths,
    config,
    runBatch,
    message,
    modal,
  })

  // envHealth 管理环境检查缓存、自动检查和详情弹窗状态。
  const envHealth = useEnvHealthCheck({
    taskEnvHealthMap,
    tasks: workspaceViewData.visibleTasks,
    config,
    setTaskEnvHealthMap,
    loadTaskEnvHealth,
  })
  // taskLifecycle 管理任务创建、文档归档、删除及创建弹窗状态。
  const taskLifecycle = useTaskLifecycle({
    config,
    projects,
    taskStatusMap,
    taskLinkMap,
    message,
    modal,
    scanProjects: scan,
    scanWorktrees,
    setTaskLink,
    setActiveKeys: setWorktreeActiveKeys,
    runEnvHealthCheck: envHealth.runCheck,
  })
  // aiUsage 管理可见任务的 AI 用量加载和工具栏总计。
  const aiUsage = useAiUsageSummary({
    tasks: workspaceViewData.visibleTasks,
    usageTools: config?.aiUsageTools,
    tokenPricing: config?.tokenPricing,
  })

  // workflowSteps 当前生效的工作流（需求流程）步骤清单：来自配置，规范化后兜底默认清单。
  // 用 ?? 而非 || 区分「未配置（undefined → 用默认）」与「显式清空（[] → 尊重为空）」。
  const workflowSteps = useMemo(() => {
    // raw 为配置中的步骤数组；未设置时回退默认清单
    const raw = config?.workflowSteps ?? DEFAULT_WORKFLOW_STEPS
    return normalizeWorkflowSteps(raw)
  }, [config])
  // workflowExecution 管理步骤执行、实时输出与最近输出缓存，App 仅负责把操作传给视图组件。
  const workflowExecution = useWorkflowExecution({
    workflowSteps,
    loadConfig,
    toggleWorkflowStep,
    startRunningStep,
    finishRunningStep,
    message,
  })

  /**
   * 持久化指定项目的私有流程，并同步更新 Store 中的完整配置。
   * @param {string} projectPath - 源项目绝对路径
   * @param {Array<object>} steps - 该项目最新的私有流程步骤
   */
  const saveProjectWorkflowSteps = async (projectPath, steps) => {
    if (!config || !projectPath) return
    // nextProjectWorkflowSteps 存储合并本次项目修改后的全部私有流程配置。
    const nextProjectWorkflowSteps = {
      ...(config.projectWorkflowSteps || {}),
      [projectPath]: normalizeWorkflowSteps(steps),
    }
    // savedConfig 存储主进程规范化并落盘后的完整配置。
    const savedConfig = await api.saveConfig({
      ...config,
      projectWorkflowSteps: nextProjectWorkflowSteps,
    })
    useStore.setState({ config: savedConfig })
  }

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <AppHeader
        activeView={activeView}
        isNarrow={isNarrow}
        pathProfileOptions={workspaceConfig.pathProfileOptions}
        activePathProfileId={workspaceConfig.activePathProfileId}
        pathProfileSwitching={workspaceConfig.switching}
        updateVersion={appUpdate.version}
        updateDownloading={appUpdate.downloading}
        updateDownloadPercent={appUpdate.downloadPercent}
        loading={workspaceNavigation.loading}
        themeMode={themeMode}
        onViewChange={workspaceNavigation.changeView}
        onPathProfileChange={workspaceConfig.switchPathProfile}
        onDownloadUpdate={appUpdate.downloadAndInstall}
        onCreateWorktree={() => taskLifecycle.openCreate()}
        onRefresh={workspaceNavigation.refresh}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <Content
        style={{
          padding: 16,
          // 项目扫描时列表由局部加载面板替代，同时锁住内容区滚动；Header 位于 Content 外，仍可自由切换。
          overflow: activeView === 'projects' && loading ? 'hidden' : 'auto',
        }}
      >
        {/* 工作区切换异步刷新当前数据区域，不使用全内容遮罩；视图切换和窗口拖动始终可用。 */}
        <div key={activeView} className="view-fade">
          {/* worktree 视图：排序栏 + 按任务分组面板 */}
          {activeView === 'worktrees' ? (
            <>
              <WorktreeToolbar
                aiUsageTotal={aiUsage.total}
                aiUsageTools={config?.aiUsageTools ?? ['claude-code']}
                directCnyDisplay={
                  config?.tokenPricing?.directCnyDisplay === true
                }
                hasHiddenTasks={workspaceViewData.hasHiddenTasks}
                showHiddenTasks={visibilityTransitions.showHiddenTasks}
                sortOrder={workspaceViewData.taskSortOrder}
                keyword={worktreeKeyword}
                onOpenHistory={taskHistory.show}
                onOpenCleanup={() => setCleanupOpen(true)}
                onToggleHiddenTasks={
                  visibilityTransitions.toggleShowHiddenTasks
                }
                onSortOrderChange={workspaceViewData.setTaskSortOrder}
                onKeywordChange={setWorktreeKeyword}
              />
              <WorktreePanel
                tasks={workspaceViewData.filteredTasks}
                loading={workspaceNavigation.loading}
                emptyDescription={
                  worktreeKeyword.trim() ? '未找到匹配的任务或项目' : undefined
                }
                activeKeys={worktreeActiveKeys}
                onActiveKeysChange={setWorktreeActiveKeys}
                onOpenFinder={projectActions.openFinder}
                onOpenVscode={projectActions.openVscode}
                onOpenTerminal={projectActions.openTerminal}
                onCopyPath={projectActions.copyPath}
                onRemove={projectActions.removeWorktree}
                onRemoveTask={taskLifecycle.removeTask}
                onPrune={projectActions.pruneWorktree}
                taskStatusMap={taskStatusMap}
                taskStatuses={config?.taskStatuses ?? []}
                onTaskStatusChange={setTaskStatus}
                taskLinkMap={taskLinkMap}
                onTaskLinkChange={setTaskLink}
                onOpenUrl={projectActions.openUrl}
                onAddWorktree={taskLifecycle.addWorktreeToTask}
                onEnvCheck={envHealth.showDetails}
                envHealthMap={envHealth.healthMap}
                cicdLinks={config?.cicdLinks ?? {}}
                claudeUsageMap={aiUsage.usageMap}
                aiUsageTools={config?.aiUsageTools ?? ['claude-code']}
                directCnyDisplay={
                  config?.tokenPricing?.directCnyDisplay === true
                }
                workflowSteps={workflowSteps}
                projectWorkflowSteps={config?.projectWorkflowSteps ?? {}}
                onSaveProjectWorkflowSteps={saveProjectWorkflowSteps}
                workflowMap={taskWorkflowMap}
                hiddenTaskKeys={taskVisibility.hidden}
                pinnedTaskKeys={taskVisibility.pinned}
                hidingTaskKeys={visibilityTransitions.hidingTaskKeys}
                showHiddenTasks={visibilityTransitions.showHiddenTasks}
                onTaskHiddenChange={visibilityTransitions.changeTaskHidden}
                onTaskPinnedChange={setTaskPinned}
                taskTitleBadges={workspaceViewData.taskTitleBadges}
                onToggleStep={toggleWorkflowStep}
                onRunStepAction={workflowExecution.runStep}
                onRunWorkflowSteps={workflowExecution.runSteps}
                runningSteps={runningSteps}
                lastStepOutputs={workflowExecution.lastStepOutputs}
                lastOutputVersion={workflowExecution.lastOutputVersion}
                onViewLastOutput={workflowExecution.viewLastOutput}
                onViewCurrentOutput={workflowExecution.viewCurrentOutput}
              />
            </>
          ) : activeView === 'kanban' ? (
            <KanbanView
              tasks={workspaceViewData.visibleTasks}
              loading={workspaceNavigation.loading}
              workflowSteps={workflowSteps}
              taskWorkflowMap={taskWorkflowMap}
              taskStatusMap={taskStatusMap}
              taskStatuses={config?.taskStatuses ?? []}
              kanbanSettings={config?.kanbanSettings ?? {}}
              pinnedTaskKeys={taskVisibility.pinned}
              taskBlockerMap={taskBlockerMap}
              onBlockerChange={setTaskBlocker}
              onTaskPinnedChange={setTaskPinned}
              onOpenVscode={projectActions.openVscode}
              onTaskClick={(taskName) => {
                workspaceNavigation.changeView('worktrees')
                setWorktreeActiveKeys([taskName])
              }}
            />
          ) : activeView === 'workflow' ? (
            <WorkflowTabView />
          ) : (
            <>
              <ProjectOverviewControls
                stats={workspaceViewData.projectStats}
                filter={filter}
                keyword={keyword}
                isNarrow={isNarrow}
                hasHiddenProjects={workspaceViewData.hasHiddenProjects}
                showHiddenProjects={visibilityTransitions.showHiddenProjects}
                selectedPaths={workspaceViewData.visibleSelectedPaths}
                batchMenuItems={batchOperations.menuItems}
                onFilterChange={setFilter}
                onKeywordChange={setKeyword}
                onToggleHiddenProjects={
                  visibilityTransitions.toggleShowHiddenProjects
                }
                onBatchMenuClick={batchOperations.handleMenuClick}
              />

              {/* 项目扫描只遮罩表格区域，顶部导航、路径切换和筛选工具仍可操作。 */}
              <ProjectTable
                data={workspaceViewData.filteredProjects}
                loading={loading}
                selectedPaths={workspaceViewData.visibleSelectedPaths}
                onSelectChange={setSelectedPaths}
                onDetail={setDetailProject}
                onCheckoutMain={projectActions.checkoutMain}
                onPull={projectActions.pull}
                onOpenFinder={projectActions.openFinder}
                onOpenVscode={projectActions.openVscode}
                onOpenUrl={projectActions.openUrl}
                onOpenTerminal={projectActions.openTerminal}
                onCopyPath={projectActions.copyPath}
                hiddenProjectKeys={projectVisibility.hidden}
                pinnedProjectKeys={projectVisibility.pinned}
                hidingProjectKeys={visibilityTransitions.hidingProjectKeys}
                loadingPaths={projectActions.loadingPaths}
                showHiddenProjects={visibilityTransitions.showHiddenProjects}
                onProjectHiddenChange={
                  visibilityTransitions.changeProjectHidden
                }
                onProjectPinnedChange={setProjectPinned}
              />
            </>
          )}
        </div>
      </Content>

      <BatchProgressModal progress={batchProgress} />

      {/* 关闭输出弹窗不会中断后台步骤，执行状态仍由 App 持续维护。 */}
      <StepOutputModal
        output={workflowExecution.stepOutput}
        onClose={workflowExecution.closeOutput}
      />

      {/* 详情抽屉：宽度自适应，窄屏占满，宽屏固定 560 */}
      <ProjectDetail
        project={detailProject}
        drawerWidth={isNarrow ? '100%' : 560}
        onClose={() => setDetailProject(null)}
        onOpenFinder={projectActions.openFinder}
        onOpenVscode={projectActions.openVscode}
        worktreesRoot={config?.worktreesPath}
        hiddenTaskKeys={taskVisibility.hidden}
        pinnedTaskKeys={taskVisibility.pinned}
        showHiddenTasks={visibilityTransitions.showHiddenTasks}
      />

      {/* 首次安装只展示两条必要路径，避免用户进入完整设置后找不到路径组合管理入口。 */}
      <OnboardingModal
        open={config?.onboardingCompleted === false}
        sourceProjectsPath={workspaceConfig.onboarding.sourceProjectsPath}
        worktreesPath={workspaceConfig.onboarding.worktreesPath}
        pickingField={workspaceConfig.onboarding.pickingField}
        saving={workspaceConfig.onboarding.saving}
        onSourceProjectsPathChange={
          workspaceConfig.onboarding.setSourceProjectsPath
        }
        onWorktreesPathChange={workspaceConfig.onboarding.setWorktreesPath}
        onPickDirectory={workspaceConfig.onboarding.pickDirectory}
        onSubmit={workspaceConfig.onboarding.complete}
      />

      {/* 设置弹窗 */}
      <SettingsModal
        open={settingsOpen}
        config={config}
        onClose={() => setSettingsOpen(false)}
        onSaved={workspaceConfig.applySavedConfig}
      />

      {/* AI 助手只接收工作区安全状态，组件内会排除路径、远程地址和文件内容。 */}
      <AiAssistant projects={projects} worktreeTasks={worktreeTasks} />

      {/* 按任务创建 worktree 弹窗 */}
      <CreateWorktreeModal
        open={taskLifecycle.createOpen}
        projects={projects}
        projectsLoading={loading}
        worktreesPath={config?.worktreesPath}
        defaultTask={taskLifecycle.createDefaultTask}
        onSubmit={taskLifecycle.createWorktrees}
        onClose={taskLifecycle.closeCreate}
      />

      {/* 创建表单提交后由独立弹层展示逐项目进度，避免用户误以为应用卡住。 */}
      <BatchProgressModal
        progress={taskLifecycle.createProgress}
        title="正在创建 Worktree"
      />

      {/* Worktree 清理建议弹窗：展示可安全删除的 worktree（已合并+无改动），勾选+二次确认删除 */}
      <CleanupSuggestionsModal
        open={cleanupOpen}
        onClose={() => setCleanupOpen(false)}
        onDeleted={scanWorktrees}
      />

      {/* 环境健康检查结果弹窗：展示依赖、端口、服务和 Git 检查结果。 */}
      <EnvHealthModal
        open={envHealth.modal.open}
        taskName={envHealth.modal.taskName}
        taskDir={envHealth.modal.taskDir}
        result={envHealth.modal.result}
        loading={envHealth.modal.loading}
        onClose={envHealth.modal.close}
        onRefresh={(task) => envHealth.runCheck(task, { open: true })}
      />

      {/* 已删除任务历史弹窗：展示任务名、链接、删除时间，支持删除单条和分页。 */}
      <TaskHistoryModal
        open={taskHistory.open}
        loading={taskHistory.loading}
        history={taskHistory.items}
        pagination={taskHistory.pagination.pagination}
        page={taskHistory.pagination.page}
        pageSize={taskHistory.pagination.pageSize}
        taskStatuses={config?.taskStatuses ?? []}
        listShellRef={taskHistory.pagination.listShellRef}
        onClose={taskHistory.close}
        onOpenFinder={projectActions.openFinder}
        onOpenVscode={projectActions.openVscode}
        onOpenUrl={projectActions.openUrl}
        onRequestDelete={taskHistory.requestRemove}
      />
    </Layout>
  )
}
