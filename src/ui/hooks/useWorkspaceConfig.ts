import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.ts'
import { useStore } from '../store/useStore.ts'
import { ONBOARDING_PATH_FIELD } from '../components/OnboardingModal.tsx'

// DEFAULT_PATH_PROFILE_ID 存储配置缺失路径组合 id 时的兜底值。
const DEFAULT_PATH_PROFILE_ID = 'default'
// SWITCH_WORKSPACE_ONLY_FIELD 存储切换工作区时提交给主进程的瞬时控制字段，避免旧工作区设置覆盖目标工作区。
const SWITCH_WORKSPACE_ONLY_FIELD = '__switchWorkspaceOnly'

/**
 * 管理首次初始化表单、路径组合切换和配置应用后的数据刷新。
 * @param {object} options - 工作区配置依赖。
 * @param {object|null} options.config - 当前应用配置。
 * @param {string} options.activeView - 当前主视图。
 * @param {object} options.message - Ant Design message API。
 * @param {() => Promise<void>} options.scanProjects - 刷新项目列表的动作。
 * @param {() => Promise<void>} options.scanWorktrees - 刷新 Worktree 列表的动作。
 * @param {(project:null) => void} options.clearDetailProject - 清空项目详情的动作。
 * @param {(keys:Array<string>) => void} options.clearActiveTaskKeys - 清空展开任务的动作。
 * @returns {object} 路径组合信息、初始化表单状态和配置操作。
 */
export default function useWorkspaceConfig({
  config,
  activeView,
  message,
  scanProjects,
  scanWorktrees,
  clearDetailProject,
  clearActiveTaskKeys,
}) {
  // sourceProjectsPath 存储首次初始化表单中的源项目根目录。
  const [sourceProjectsPath, setSourceProjectsPath] = useState('')
  // worktreesPath 存储首次初始化表单中的 Worktree 根目录。
  const [worktreesPath, setWorktreesPath] = useState('')
  // pickingField 存储当前正在调用系统目录选择器的字段。
  const [pickingField, setPickingField] = useState('')
  // saving 标记首次初始化配置是否正在保存。
  const [saving, setSaving] = useState(false)
  // switching 标记顶部工作区正在保存并加载目标工作区数据，防止重复切换并统一页面反馈。
  const [switching, setSwitching] = useState(false)
  // pathProfiles 存储当前配置中的有效路径组合数组。
  const pathProfiles = useMemo(
    () => (Array.isArray(config?.pathProfiles) ? config.pathProfiles : []),
    [config?.pathProfiles]
  )
  // activePathProfileId 存储当前启用的路径组合 id。
  const activePathProfileId =
    config?.activePathProfileId || pathProfiles[0]?.id || ''
  // pathProfileOptions 存储顶部路径组合选择器的选项。
  const pathProfileOptions = useMemo(
    () =>
      pathProfiles
        .filter((profile) => profile?.id)
        .map((profile) => ({
          value: profile.id,
          label: profile.name || profile.id,
        })),
    [pathProfiles]
  )

  useEffect(() => {
    if (config?.onboardingCompleted !== false) return
    setSourceProjectsPath(config.sourceProjectsPath || '')
    setWorktreesPath(config.worktreesPath || '')
  }, [
    config?.onboardingCompleted,
    config?.sourceProjectsPath,
    config?.worktreesPath,
  ])

  /**
   * 将保存后的配置写入 Store，并按当前视图刷新对应数据。
   * @param {object} nextConfig - 主进程保存后返回的完整配置。
   */
  const applySavedConfig = async (nextConfig) => {
    // nextState 存储配置切换时需要一起重置的旧目录数据。
    const nextState = {
      config: nextConfig,
      projects: [],
      worktreeTasks: [],
      selectedPaths: [],
    }
    useStore.setState(nextState)
    clearDetailProject(null)
    clearActiveTaskKeys([])
    if (activeView === 'projects') {
      await scanProjects()
      return
    }
    if (activeView === 'worktrees' || activeView === 'kanban') {
      await scanWorktrees()
    }
  }

  /**
   * 打开系统目录选择器并将选择结果写入首次初始化字段。
   * @param {string} field - ONBOARDING_PATH_FIELD 中的字段标识。
   */
  const pickDirectory = async (field) => {
    // currentPath 存储系统选择器默认打开的当前字段路径。
    const currentPath =
      field === ONBOARDING_PATH_FIELD.SOURCE_PROJECTS
        ? sourceProjectsPath
        : worktreesPath
    setPickingField(field)
    try {
      // selection 存储主进程目录选择结果。
      const selection = await api.selectDirectory({ defaultPath: currentPath })
      if (selection?.canceled) return
      if (!selection?.path) {
        message.error(selection?.error || '选择目录失败')
        return
      }
      if (field === ONBOARDING_PATH_FIELD.SOURCE_PROJECTS) {
        setSourceProjectsPath(selection.path)
        return
      }
      setWorktreesPath(selection.path)
    } catch (error) {
      message.error(`选择目录失败：${error?.message || '未知错误'}`)
    } finally {
      setPickingField('')
    }
  }

  /**
   * 保存首次初始化路径，并同步当前路径组合后进入应用。
   */
  const completeOnboarding = async () => {
    // normalizedSourcePath 存储去除首尾空白后的源项目目录。
    const normalizedSourcePath = sourceProjectsPath.trim()
    // normalizedWorktreesPath 存储去除首尾空白后的 Worktree 目录。
    const normalizedWorktreesPath = worktreesPath.trim()
    if (
      !config ||
      !normalizedSourcePath ||
      !normalizedWorktreesPath ||
      saving
    ) {
      return
    }
    // profileId 存储当前路径组合 id。
    const profileId =
      config.activePathProfileId ||
      config.pathProfiles?.[0]?.id ||
      DEFAULT_PATH_PROFILE_ID
    // existingProfiles 存储配置中的合法路径组合数组。
    const existingProfiles = Array.isArray(config.pathProfiles)
      ? config.pathProfiles
      : []
    // updatedProfiles 存储同步首次初始化路径后的路径组合。
    const updatedProfiles = existingProfiles.length
      ? existingProfiles.map((profile) =>
          profile?.id === profileId
            ? {
                ...profile,
                sourceProjectsPath: normalizedSourcePath,
                worktreesPath: normalizedWorktreesPath,
              }
            : profile
        )
      : [
          {
            id: profileId,
            name: '工作路径',
            sourceProjectsPath: normalizedSourcePath,
            worktreesPath: normalizedWorktreesPath,
          },
        ]
    setSaving(true)
    try {
      // savedConfig 存储主进程规范化并持久化后的完整配置。
      const savedConfig = await api.saveConfig({
        ...config,
        onboardingCompleted: true,
        sourceProjectsPath: normalizedSourcePath,
        worktreesPath: normalizedWorktreesPath,
        activePathProfileId: profileId,
        pathProfiles: updatedProfiles,
      })
      applySavedConfig(savedConfig)
      message.success('初始化完成')
    } catch (error) {
      message.error(`保存初始化配置失败：${error?.message || '未知错误'}`)
    } finally {
      setSaving(false)
    }
  }

  /**
   * 保存并启用用户选择的路径组合。
   * @param {string} profileId - 目标路径组合 id。
   */
  const switchPathProfile = async (profileId) => {
    if (!config || profileId === activePathProfileId || switching) return
    // targetProfile 存储用户选择的目标路径组合。
    const targetProfile = pathProfiles.find(
      (profile) => profile?.id === profileId
    )
    if (!targetProfile) return
    setSwitching(true)
    try {
      // savedConfig 存储主进程保存后返回的完整配置。
      const savedConfig = await api.saveConfig({
        activePathProfileId: targetProfile.id,
        pathProfiles,
        [SWITCH_WORKSPACE_ONLY_FIELD]: true,
      })
      await applySavedConfig(savedConfig)
      message.success(`已切换到「${targetProfile.name || targetProfile.id}」`)
    } catch (error) {
      message.error(`切换路径组合失败：${error?.message || '未知错误'}`)
    } finally {
      setSwitching(false)
    }
  }

  return {
    pathProfiles,
    activePathProfileId,
    pathProfileOptions,
    switching,
    applySavedConfig,
    switchPathProfile,
    onboarding: {
      sourceProjectsPath,
      worktreesPath,
      pickingField,
      saving,
      setSourceProjectsPath,
      setWorktreesPath,
      pickDirectory,
      complete: completeOnboarding,
    },
  }
}
