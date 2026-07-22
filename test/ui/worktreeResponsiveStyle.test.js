import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'

describe('Worktree 标题响应式样式', () => {
  it('徽标组只在剩余空间不足时动态收缩并横向滚动', () => {
    // css 存储渲染层全局样式文本。
    const css = readFileSync('src/ui/styles.css', 'utf8')
    // badgesRule 存储徽标滚动容器对应的 CSS 规则。
    const badgesRule =
      css.match(/\.worktree-task-badges-scroll\s*\{([^}]+)\}/)?.[1] || ''
    expect(badgesRule).toContain('flex: 1 1 0')
    expect(badgesRule).toContain('min-width: 0')
    expect(badgesRule).toContain('overflow-x: auto')
    expect(badgesRule).toContain('scrollbar-width: none')
    expect(css).toMatch(
      /\.worktree-task-badges-scroll::-webkit-scrollbar\s*\{[^}]*display:\s*none/
    )
    expect(badgesRule).not.toContain('width: max-content')
    expect(badgesRule).not.toMatch(/\d+vw/)
    expect(badgesRule).not.toMatch(/max-width:\s*\d+px/)
  })

  it('标题占满折叠头剩余区域，右侧操作不参与收缩', () => {
    // css 存储渲染层全局样式文本。
    const css = readFileSync('src/ui/styles.css', 'utf8')
    // collapseTitleRule 存储 Ant Design 6 折叠标题 flex 项对应的 CSS 规则。
    const collapseTitleRule =
      css.match(
        /\.worktree-task-collapse\.ant-collapse\s*>\s*\.ant-collapse-item\s*>\s*\.ant-collapse-header\s*>\s*\.ant-collapse-title\s*\{([^}]+)\}/
      )?.[1] || ''
    // titleRule 存储任务标题父容器对应的 CSS 规则。
    const titleRule =
      css.match(/\.worktree-task-title\s*\{([^}]+)\}/)?.[1] || ''
    // extraRule 存储折叠面板右侧操作区域对应的 CSS 规则。
    const extraRule =
      css.match(
        /\.worktree-task-collapse \.ant-collapse-extra\s*\{([^}]+)\}/
      )?.[1] || ''
    expect(collapseTitleRule).toContain('flex: 1 1 0')
    expect(collapseTitleRule).toContain('min-width: 0')
    expect(collapseTitleRule).toContain('overflow: hidden')
    expect(titleRule).toContain('width: 100%')
    expect(extraRule).toContain('flex: 0 0 auto')
    expect(css).not.toContain('.ant-collapse-header-text')
  })
})
