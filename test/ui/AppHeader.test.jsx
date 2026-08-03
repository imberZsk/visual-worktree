import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import AppHeader from '../../src/ui/components/AppHeader.tsx'

// COMPONENT_SOURCE 存储 Header 组件源码，用于阻止固定行内视觉规则和重复刷新 Tooltip 回归。
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

afterEach(() => cleanup())

describe('AppHeader', () => {
  it('刷新按钮保留可访问名称和点击行为，但不再包裹重复 Tooltip', () => {
    // onRefresh 存储刷新按钮点击回调调用记录。
    const onRefresh = vi.fn()
    render(<AppHeader {...BASE_PROPS} onRefresh={onRefresh} />)

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))

    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(COMPONENT_SOURCE).not.toContain('<Tooltip title="刷新">')
  })

  it('固定视觉规则位于相邻 CSS，Header 可拖动且控件保持可交互', () => {
    expect(COMPONENT_SOURCE).not.toMatch(/\bstyle\s*=\s*\{\{/)
    expect(STYLE_SOURCE).toMatch(
      /\.app-header\.ant-layout-header[\s\S]*-webkit-app-region:\s*drag/
    )
    expect(STYLE_SOURCE).toMatch(
      /\.app-header__interactive[\s\S]*-webkit-app-region:\s*no-drag/
    )
    expect(STYLE_SOURCE).toContain('env(titlebar-area-width, 100vw)')
    expect(STYLE_SOURCE).toMatch(
      /\.app-header--macos\.ant-layout-header\s*\{[\s\S]*padding-inline-start:\s*96px/
    )
  })
})
