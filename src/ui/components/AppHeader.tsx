import React, { useState } from 'react'
import {
  Button,
  Layout,
  Progress,
  Segmented,
  Select,
  Space,
  Tooltip,
} from 'antd'
import {
  DownloadOutlined,
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

/**
 * 渲染应用标题、视图切换和全局快捷操作。
 * @param {object} props - 组件属性
 * @param {string} props.activeView - 当前主视图
 * @param {boolean} props.isNarrow - 是否为窄屏布局
 * @param {Array<object>} props.pathProfileOptions - 路径组合选项
 * @param {string} props.activePathProfileId - 当前路径组合 id
 * @param {boolean} props.pathProfileSwitching - 是否正在切换路径组合
 * @param {string|null} props.updateVersion - 可下载的新版本号
 * @param {boolean} props.updateDownloading - 是否正在下载更新
 * @param {number} props.updateDownloadPercent - 更新下载百分比
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
  updateVersion,
  updateDownloading,
  updateDownloadPercent,
  loading,
  themeMode,
  onViewChange,
  onPathProfileChange,
  onDownloadUpdate,
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

  return (
    <Header
      className={`app-header${MACOS_HEADER_CLASS}${
        pathProfileOpen ? ' app-header--select-open' : ''
      }`}
    >
      <div className="app-header__left">
        <span className="app-header__title">Visual Worktree</span>
        <Space size={8} className="app-header__interactive">
          <Segmented
            value={activeView}
            onChange={onViewChange}
            options={MAIN_VIEW_OPTIONS}
            disabled={pathProfileSwitching}
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
              onChange={onPathProfileChange}
            />
          )}
        </Space>
      </div>
      <Space className="app-header__interactive">
        {updateVersion && (
          <Tooltip title={`新版本 v${updateVersion}`}>
            {updateDownloading ? (
              <Progress
                percent={Math.round(updateDownloadPercent)}
                size="small"
                className="app-header__update-progress"
              />
            ) : (
              <Button
                size="small"
                type="text"
                icon={<DownloadOutlined />}
                aria-label="下载更新"
                onClick={onDownloadUpdate}
              />
            )}
          </Tooltip>
        )}
        {canCreateWorktree && (
          <Tooltip title="按任务创建 Worktree">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              aria-label="创建 Worktree"
              onClick={onCreateWorktree}
            >
              {isNarrow ? '' : '创建 Worktree'}
            </Button>
          </Tooltip>
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
        <Tooltip title="设置">
          <Button
            icon={<SettingOutlined />}
            aria-label="设置"
            onClick={onOpenSettings}
          >
            {isNarrow ? '' : '设置'}
          </Button>
        </Tooltip>
      </Space>
    </Header>
  )
}
