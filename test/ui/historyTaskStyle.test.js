import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('历史任务弹层样式', () => {
  it('历史任务列表容器使用最大高度而非固定高度，避免记录少时底部镂空', () => {
    // css 存储渲染进程全局样式文本，用于验证历史任务弹层高度策略。
    const css = readFileSync(join(process.cwd(), 'src/ui/styles.css'), 'utf8')
    // shellRule 存储历史任务列表容器的 CSS 规则内容。
    const shellRule =
      css.match(/\.history-task-list-shell\s*\{(?<body>[\s\S]*?)\}/)?.groups
        ?.body || ''

    expect(shellRule).toMatch(/max-height:\s*min\(68vh,\s*640px\)/)
    expect(shellRule).not.toMatch(/(?:^|\n)\s*height:/)
  })

  it('分页状态使用稳定高度且仅列表滚动，分页器固定在滚动区外', () => {
    // css 存储历史任务弹层样式，用于防止分页再次参与列表高度测量。
    const css = readFileSync(join(process.cwd(), 'src/ui/styles.css'), 'utf8')
    // paginatedShellRule 存储分页状态外壳规则，翻页前后必须保持稳定高度。
    const paginatedShellRule =
      css.match(/\.history-task-list-shell--paginated\s*\{(?<body>[\s\S]*?)\}/)
        ?.groups?.body || ''
    // listRule 存储实际滚动列表规则，分页器不应共享该 overflow。
    const listRule =
      css.match(/\.history-task-list\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ||
      ''

    expect(paginatedShellRule).toMatch(/height:\s*min\(68vh,\s*640px\)/)
    expect(listRule).toMatch(/flex:\s*1 1 auto/)
    expect(listRule).toMatch(/overflow-y:\s*auto/)
    expect(listRule).toMatch(/min-height:\s*0/)
  })
})
