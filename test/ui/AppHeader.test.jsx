import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import AppHeader from '../../src/ui/components/AppHeader.tsx'

// mockApi 存储 Header 依赖的窗口平台和全屏 API 替身。
const mockApi = vi.hoisted(() => ({
  platform: 'darwin',
  getWindowFullscreen: vi.fn().mockResolvedValue(false),
  onWindowFullscreenChanged: vi.fn(() => () => {}),
}))

// FULLSCREEN_SESSION_STORAGE_KEY 存储 Header 重载前的全屏状态测试键。
const FULLSCREEN_SESSION_STORAGE_KEY = 'visual-worktree-window-fullscreen'

vi.mock('../../src/ui/api.ts', () => ({ api: mockApi }))

// COMPONENT_SOURCE 存储 Header 组件源码，用于阻止固定行内视觉规则和重复文字按钮 Tooltip 回归。
const COMPONENT_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/ui/components/AppHeader.tsx'),
  'utf8'
)
// STYLE_SOURCE 存储 Header 相邻样式，用于锁定窗口拖动区与控件交互区边界。
const STYLE_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/ui/components/AppHeader.css'),
  'utf8'
)
// BASE_PROPS 存储 Header 组件测试所需的默认属性。
const BASE_PROPS = {
  activeView: 'worktrees',
  isNarrow: false,
  pathProfileOptions: [],
  activePathProfileId: 'default',
  pathProfileSwitching: false,
  updateVersion: null,
  updateError: '',
  updateChecked: false,
  updateChecking: false,
  onCheckUpdate: () => {},
  updateDownloading: false,
  updateDownloadPercent: 0,
  loading: false,
  themeMode: 'dark',
  onViewChange: () => {},
  onPathProfileChange: () => {},
  onDownloadUpdate: () => {},
  onCreateWorktree: () => {},
  onRefresh: () => {},
  onToggleTheme: () => {},
  onOpenSettings: () => {},
}

afterEach(() => {
  cleanup()
  mockApi.getWindowFullscreen.mockReset().mockResolvedValue(false)
  mockApi.onWindowFullscreenChanged.mockClear()
  sessionStorage.removeItem(FULLSCREEN_SESSION_STORAGE_KEY)
})

describe('AppHeader', () => {
  it('刷新按钮保留可访问名称和点击行为，但不再包裹重复 Tooltip', () => {
    // onRefresh 存储刷新按钮点击回调调用记录。
    const onRefresh = vi.fn()
    render(<AppHeader {...BASE_PROPS} onRefresh={onRefresh} />)

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))

    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(COMPONENT_SOURCE).not.toContain('<Tooltip title="刷新">')
  })

  it('文字操作按钮保留点击行为，但不再包裹重复 Tooltip', () => {
    // onCreateWorktree 存储创建 Worktree 按钮点击回调调用记录。
    const onCreateWorktree = vi.fn()
    // onOpenSettings 存储设置按钮点击回调调用记录。
    const onOpenSettings = vi.fn()
    render(
      <AppHeader
        {...BASE_PROPS}
        onCreateWorktree={onCreateWorktree}
        onOpenSettings={onOpenSettings}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '创建 Worktree' }))
    fireEvent.click(screen.getByRole('button', { name: '设置' }))

    expect(onCreateWorktree).toHaveBeenCalledTimes(1)
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(COMPONENT_SOURCE).not.toContain(
      '<Tooltip title="按任务创建 Worktree">'
    )
    expect(COMPONENT_SOURCE).not.toContain('<Tooltip title="设置">')
  })

  it('固定视觉规则位于相邻 CSS，Header 可拖动且控件保持可交互', () => {
    expect(COMPONENT_SOURCE).not.toMatch(/\bstyle\s*=\s*\{\{/)
    expect(STYLE_SOURCE).toMatch(
      /\.app-header\.ant-layout-header[\s\S]*-webkit-app-region:\s*drag/
    )
    expect(STYLE_SOURCE).toMatch(
      /\.app-header__interactive[\s\S]*-webkit-app-region:\s*no-drag/
    )
    expect(STYLE_SOURCE).toMatch(
      /\.app-header--select-open\.ant-layout-header[\s\S]*-webkit-app-region:\s*no-drag/
    )
    expect(COMPONENT_SOURCE).toContain('className="app-header__drag-strip"')
    expect(STYLE_SOURCE).toMatch(
      /\.app-header--macos \.app-header__drag-strip[\s\S]*-webkit-app-region:\s*drag/
    )
    expect(COMPONENT_SOURCE).toContain('onOpenChange={setPathProfileOpen}')
    expect(STYLE_SOURCE).toContain('env(titlebar-area-width, 100vw)')
    expect(STYLE_SOURCE).toMatch(
      /\.app-header--macos\.ant-layout-header\s*\{[\s\S]*padding-inline-start:\s*96px/
    )
  })

  it('挂载时已全屏也会立即释放交通灯占位', async () => {
    mockApi.getWindowFullscreen.mockResolvedValue(true)
    // container 存储 Header 挂载容器，用于断言全屏样式类。
    const { container } = render(<AppHeader {...BASE_PROPS} />)

    await waitFor(() =>
      expect(
        container
          .querySelector('.app-header')
          ?.classList.contains('app-header--fullscreen')
      ).toBe(true)
    )
  })

  it('Command+R 后首帧沿用全屏布局避免标题横向抖动', () => {
    sessionStorage.setItem(FULLSCREEN_SESSION_STORAGE_KEY, 'true')
    mockApi.getWindowFullscreen.mockImplementation(() => new Promise(() => {}))
    // container 存储 Header 挂载容器，用于验证 IPC 返回前的第一帧已是全屏布局。
    const { container } = render(<AppHeader {...BASE_PROPS} />)

    expect(
      container
        .querySelector('.app-header')
        ?.classList.contains('app-header--fullscreen')
    ).toBe(true)
  })
})
