import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('AI 助手 UI 样式规范', () => {
  it('专用样式限定在聊天抽屉并使用主题语义色', () => {
    // css 存储 AI 助手组件样式，用于防止样式泄漏或绕过明暗主题。
    const css = readFileSync(
      join(process.cwd(), 'src/ui/components/AiAssistant.css'),
      'utf8'
    )

    expect(css).toMatch(/\.ai-assistant-drawer\s*\{/)
    expect(css).toContain('var(--ant-color-bg-container)')
    expect(css).toContain('var(--ant-color-border-secondary)')
    expect(css).not.toContain('.ai-assistant-composer:focus-within')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('组件不使用固定行内样式且专用规则不残留在全局样式', () => {
    // componentSource 存储 AI 助手组件源码，用于阻止固定布局重新进入 JSX。
    const componentSource = readFileSync(
      join(process.cwd(), 'src/ui/components/AiAssistant.tsx'),
      'utf8'
    )
    // globalCss 存储全局样式，用于确认聊天布局归属组件级样式文件。
    const globalCss = readFileSync(
      join(process.cwd(), 'src/ui/styles.css'),
      'utf8'
    )

    expect(componentSource).not.toMatch(/\bstyle\s*=/)
    expect(componentSource).not.toMatch(/\bstyles\s*=/)
    expect(globalCss).not.toContain('.ai-assistant-message')
    expect(globalCss).not.toContain('.ai-assistant-composer')
  })
})
