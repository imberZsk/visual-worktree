import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('全局滚动条样式', () => {
  it('隐藏原生滚动条外观但不禁用各业务容器的滚动能力', () => {
    // globalCss 存储全局样式文本，用于防止滚动条轨道重新出现在应用界面。
    const globalCss = readFileSync(
      join(process.cwd(), 'src/ui/styles.css'),
      'utf8'
    )
    // kanbanCss 存储看板样式文本，用于确认隐藏滚动条后横向浏览能力仍然存在。
    const kanbanCss = readFileSync(
      join(process.cwd(), 'src/ui/components/KanbanView.css'),
      'utf8'
    )

    expect(globalCss).toMatch(/\*\s*\{[\s\S]*scrollbar-width:\s*none/)
    expect(globalCss).toMatch(
      /\*::-webkit-scrollbar\s*\{[\s\S]*display:\s*none/
    )
    expect(kanbanCss).toMatch(
      /\.kanban-board-scroll\s*\{[\s\S]*overflow-x:\s*auto/
    )
  })
})
