import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('动态看板布局样式', () => {
  it('状态列具有最小宽度且看板内容支持横向滚动', () => {
    // css 存储看板组件局部样式，用于防止多状态列再次压缩到不可读宽度。
    const css = readFileSync(
      join(process.cwd(), 'src/ui/components/KanbanView.css'),
      'utf8'
    )

    expect(css).toMatch(/\.kanban-board-scroll\s*\{[\s\S]*overflow-x:\s*auto/)
    expect(css).toMatch(/\.kanban-column\s*\{[\s\S]*min-width:\s*280px/)
    expect(css).toMatch(/\.kanban-board\s*\{[\s\S]*width:\s*max-content/)
  })

  it('横向滚动层撑满看板高度以扩大左右滑动命中区域', () => {
    // css 存储看板布局规则。
    const css = readFileSync(
      join(process.cwd(), 'src/ui/components/KanbanView.css'),
      'utf8'
    )
    // scrollRule 存储横向滚动视口规则体。
    const scrollRule =
      css.match(/\.kanban-board-scroll\s*\{(?<body>[\s\S]*?)\}/)?.groups
        ?.body || ''
    // boardRule 存储横向内容规则体。
    const boardRule =
      css.match(/\.kanban-board\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body || ''

    expect(scrollRule).toMatch(/flex:\s*1 1 auto/)
    expect(boardRule).toMatch(/min-height:\s*100%/)
    expect(css).not.toContain('.kanban-column--pinned')
  })

  it('看板不再为列设置保留顶部工具栏', () => {
    // css 存储看板样式，用于防止设置入口再次占据独立行。
    const css = readFileSync(
      join(process.cwd(), 'src/ui/components/KanbanView.css'),
      'utf8'
    )

    expect(css).not.toContain('.kanban-toolbar')
    expect(css).not.toContain('.kanban-column-settings')
  })
})
