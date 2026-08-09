import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('设置页 UI 样式规范', () => {
  it('使用统一的字段、说明和列表间距', () => {
    // css 存储设置页专用样式，用于防止后续回退为散落内联间距。
    const css = readFileSync(
      join(process.cwd(), 'src/ui/components/SettingsModal.css'),
      'utf8'
    )

    expect(css).toMatch(/--settings-space-xs:\s*8px/)
    expect(css).toMatch(/--settings-space-sm:\s*12px/)
    expect(css).toMatch(/--settings-space-lg:\s*24px/)
    expect(css).toMatch(/--settings-control-height:\s*36px/)
    expect(css).toMatch(
      /\.settings-form-stack\s*\.ant-form-item-extra[\s\S]*padding-block-start:\s*var\(--settings-space-xs\)/
    )
    expect(css).toMatch(
      /\.settings-list-content[\s\S]*gap:\s*var\(--settings-space-sm\)/
    )
    expect(css).toMatch(
      /\.settings-list-items[\s\S]*gap:\s*var\(--settings-space-xs\)/
    )
    expect(css).toMatch(
      /\.settings-drawer\s+\.ant-drawer-content-wrapper[\s\S]*max-width:\s*100vw/
    )
  })

  it('样式限定在设置页作用域并使用 Ant Design 语义色', () => {
    // css 存储设置页专用样式，用于验证颜色不会绕过明暗主题 token。
    const css = readFileSync(
      join(process.cwd(), 'src/ui/components/SettingsModal.css'),
      'utf8'
    )

    expect(css).toMatch(/\.settings-surface\s+\.settings-list-row/)
    expect(css).toContain('var(--ant-color-fill-quaternary)')
    expect(css).toContain('var(--ant-color-border-secondary)')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('设置抽屉退出 Electron 窗口拖动区域', () => {
    // css 存储设置页局部样式，用于防止顶部关闭按钮再次被 Header 拖动区域阻断。
    const css = readFileSync(
      join(process.cwd(), 'src/ui/components/SettingsModal.css'),
      'utf8'
    )

    expect(css).toMatch(
      /\.settings-drawer\s*\{[\s\S]*-webkit-app-region:\s*no-drag/
    )
  })

  it('设置页专用样式不残留在全局样式文件', () => {
    // globalCss 存储跨页全局样式，用于防止设置页规则再次回流到全局作用域。
    const globalCss = readFileSync(
      join(process.cwd(), 'src/ui/styles.css'),
      'utf8'
    )
    // settingsCss 存储设置页专用样式，用于确认 Token 费用模块已归入组件作用域。
    const settingsCss = readFileSync(
      join(process.cwd(), 'src/ui/components/SettingsModal.css'),
      'utf8'
    )

    expect(globalCss).not.toContain('token-pricing-rule-header')
    expect(settingsCss).toMatch(
      /\.settings-surface\s+\.token-pricing-rule-header/
    )
  })

  it('设置组件不使用固定行内样式绕开局部样式表', () => {
    // componentSource 存储设置组件源码，用于阻止固定布局或颜色重新写入 JSX。
    const componentSource = readFileSync(
      join(process.cwd(), 'src/ui/components/SettingsModal.tsx'),
      'utf8'
    )

    expect(componentSource).not.toMatch(/\bstyle\s*=/)
    expect(componentSource).not.toMatch(/\bstyles\s*=/)
    expect(componentSource).not.toMatch(/\bstyle\s*:\s*\{/)
  })
})
