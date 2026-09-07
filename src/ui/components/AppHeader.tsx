import React, { useEffect, useState } from 'react'
import { Button, Layout, Segmented, Select, Space, Tooltip } from 'antd'
import {
  MoonOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  SunOutlined,
} from '@ant-design/icons'
import { api } from '../api.ts'
import './AppHeader.css'

// Header 存储 antd 顶部布局组件。
const { Header } = Layout

// MAIN_VIEW_OPTIONS 存储主界面可切换的视图选项。
const MAIN_VIEW_OPTIONS = [
  { label: 'Worktree', value: 'worktrees' },
  { label: '项目', value: 'projects' },
  { label: '看板', value: 'kanban' },
]
// MACOS_HEADER_CLASS 存储 macOS 隐藏标题栏后用于避让系统窗口按钮的样式类。
const MACOS_HEADER_CLASS = api.platform === 'darwin' ? ' app-header--macos' : ''
// FULLSCREEN_SESSION_STORAGE_KEY 存储当前窗口的全屏状态，用于 Command+R 后首帧保持布局。
const FULLSCREEN_SESSION_STORAGE_KEY = 'visual-worktree-window-fullscreen'

/**
 * 渲染应用标题、视图切换和全局快捷操作。
 * @param {object} props - 组件属性
 * @param {string} props.activeView - 当前主视图
 * @param {boolean} props.isNarrow - 是否为窄屏布局
 * @param {Array<object>} props.pathProfileOptions - 路径组合选项
 * @param {string} props.activePathProfileId - 当前路径组合 id
 * @param {boolean} props.pathProfileSwitching - 是否正在切换路径组合
 * @param {boolean} props.loading - 当前视图是否正在刷新
 * @param {'light'|'dark'} props.themeMode - 当前主题模式
 * @param {(view:string) => void} props.onViewChange - 主视图切换回调
 * @param {(profileId:string) => void} props.onPathProfileChange - 路径组合切换回调
 * @param {() => void} props.onDownloadUpdate - 下载更新回调
 * @param {() => void} props.onCreateWorktree - 创建 Worktree 回调
 * @param {() => void} props.onRefresh - 刷新当前视图回调
 * @param {() => void} props.onToggleTheme - 切换主题回调
 * @param {() => void} props.onOpenSettings - 打开设置回调
 * @returns {JSX.Element} 应用顶部导航
 */
export default function AppHeader({
  activeView,
  isNarrow,
  pathProfileOptions,
  activePathProfileId,
  pathProfileSwitching,
  loading,
  themeMode,
  onViewChange,
  onPathProfileChange,
  onCreateWorktree,
  onRefresh,
  onToggleTheme,
  onOpenSettings,
}) {
  // canCreateWorktree 标记当前视图是否支持创建 Worktree。
  const canCreateWorktree =
    activeView === 'worktrees' || activeView === 'kanban'
  // pathProfileOpen 标记路径组合下拉是否展开；展开时临时停用 Header 原生拖动，让空白区域点击能关闭弹层。
  const [pathProfileOpen, setPathProfileOpen] = useState(false)
  // isFullscreen 存储 macOS 原生全屏状态；全屏隐藏交通灯后标题可贴近左侧。
  // 初始化函数从当前页面会话恢复状态，避免 Command+R 时先渲染非全屏间距造成横向抖动。
  const [isFullscreen, setIsFullscreen] = useState(() => {
    if (api.platform !== 'darwin') return false
    try {
      return sessionStorage.getItem(FULLSCREEN_SESSION_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })

  useEffect(() => {
    /**
     * 同步当前原生全屏状态到 React 和页面会话。
     * @param {boolean} nextFullscreen - 窗口是否已进入 macOS 原生全屏
     * @returns {void}
     */
    const applyFullscreenState = (nextFullscreen) => {
      // normalizedFullscreen 存储规范化后的布尔状态，防止 IPC 异常值污染布局。
      const normalizedFullscreen = Boolean(nextFullscreen)
      setIsFullscreen(normalizedFullscreen)
      try {
        sessionStorage.setItem(
          FULLSCREEN_SESSION_STORAGE_KEY,
          String(normalizedFullscreen)
        )
      } catch {
        // 会话存储不可用时仍保留当前 React 状态，不影响全屏切换。
      }
    }
    // unsubscribe 存储全屏变化监听的取消函数，避免 Header 卸载后继续更新状态。
    const unsubscribe = api.onWindowFullscreenChanged?.(applyFullscreenState)
    // 主动读取初始状态，修复 Header 挂载前已进入全屏时错过事件的问题。
    api
      .getWindowFullscreen?.()
      .then(applyFullscreenState)
      .catch(() => undefined)
    return unsubscribe
  }, [])

  /**
   * 关闭工作区下拉后再触发异步切换，避免 Select 被 loading 禁用时丢失关闭事件并让 Header 残留 no-drag。
   * @param {string} profileId - 用户选择的目标工作区 id
   */
  const handlePathProfileChange = (profileId) => {
    setPathProfileOpen(false)
    onPathProfileChange(profileId)
  }

  return (
    <Header
      className={`app-header${MACOS_HEADER_CLASS}${isFullscreen ? ' app-header--fullscreen' : ''}${
        pathProfileOpen ? ' app-header--select-open' : ''
      }`}
    >
      {/* macOS 顶部拖动带不受 Select 展开时 no-drag 状态影响，确保窗口失焦后仍可从最上沿直接拖动。 */}
      <div className="app-header__drag-strip" aria-hidden="true" />
      <div className="app-header__left">
        <span className="app-header__title">Visual Worktree</span>
        <Space size={8} className="app-header__interactive">
          <Segmented
            value={activeView}
            onChange={onViewChange}
            options={MAIN_VIEW_OPTIONS}
          />
          {pathProfileOptions.length > 1 && (
            <Select
              className={`path-profile-select app-header__path-profile${
                isNarrow ? ' app-header__path-profile--narrow' : ''
              }`}
              value={activePathProfileId}
              options={pathProfileOptions}
              popupMatchSelectWidth={false}
              loading={pathProfileSwitching}
              disabled={pathProfileSwitching}
              onOpenChange={setPathProfileOpen}
              onChange={handlePathProfileChange}
            />
          )}
        </Space>
      </div>
      <Space className="app-header__interactive">
        {canCreateWorktree && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            aria-label="创建 Worktree"
            onClick={onCreateWorktree}
          >
            {isNarrow ? '' : '创建 Worktree'}
          </Button>
        )}
        {activeView !== 'workflow' && (
          <Button
            icon={<ReloadOutlined />}
            aria-label="刷新"
            loading={loading}
            onClick={onRefresh}
          >
            {isNarrow ? '' : '刷新'}
          </Button>
        )}
        <Tooltip title={themeMode === 'dark' ? '切换到亮色' : '切换到暗色'}>
          <Button
            icon={themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            aria-label={themeMode === 'dark' ? '切换到亮色' : '切换到暗色'}
            onClick={onToggleTheme}
          />
        </Tooltip>
        <Button
          icon={<SettingOutlined />}
          aria-label="设置"
          onClick={onOpenSettings}
        >
          {isNarrow ? '' : '设置'}
        </Button>
      </Space>
    </Header>
  )
}
