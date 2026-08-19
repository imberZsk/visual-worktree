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

  it('看板外层统一承担纵向滚动，任务列按内容自然增高', () => {
    // css 存储看板布局规则，用于验证纵向内容不会再被外层裁切。
    const css = readFileSync(
      join(process.cwd(), 'src/ui/components/KanbanView.css'),
      'utf8'
    )
    // scrollRule 存储看板滚动视口规则体，应同时允许横向和纵向滚动。
    const scrollRule =
      css.match(/\.kanban-board-scroll\s*\{(?<body>[\s\S]*?)\}/)?.groups
        ?.body || ''
    // contentRule 存储任务列表规则体，不应再创建独立纵向滚动容器。
    const contentRule =
      css.match(/\.kanban-column-content\s*\{(?<body>[\s\S]*?)\}/)?.groups
        ?.body || ''

    expect(scrollRule).toMatch(/overflow-x:\s*auto/)
    expect(scrollRule).toMatch(/overflow-y:\s*auto/)
    expect(contentRule).toMatch(/overflow:\s*visible/)
    expect(contentRule).not.toMatch(/max-height:\s*calc/)
  })

  it('纵向滚动时状态列标题固定在看板顶部', () => {
    // css 存储看板样式，用于验证状态标题相对统一滚动视口保持可见。
    const css = readFileSync(
      join(process.cwd(), 'src/ui/components/KanbanView.css'),
      'utf8'
    )
    // headerRule 存储状态列标题规则体，必须具备完整的 sticky 定位和覆盖层级。
    const headerRule =
      css.match(/\.kanban-column-header\s*\{(?<body>[\s\S]*?)\}/)?.groups
        ?.body || ''
    // boardRule 存储看板列布局规则体，列等高后空列标题才能覆盖完整滚动距离。
    const boardRule =
      css.match(/\.kanban-board\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body || ''

    expect(headerRule).toMatch(/position:\s*sticky/)
    expect(headerRule).toMatch(/top:\s*0/)
    expect(headerRule).toMatch(/z-index:\s*1/)
    expect(headerRule).toMatch(/background:\s*var\(--ant-color-bg-container\)/)
    expect(boardRule).toMatch(/align-items:\s*stretch/)
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
