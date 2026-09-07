import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('项目详情抽屉样式', () => {
  it('抽屉和关闭按钮退出 Electron 窗口拖动区域', () => {
    // componentSource 存储项目详情组件源码，用于确认专用样式作用域已挂载到 Drawer 根节点。
    const componentSource = readFileSync(
      join(process.cwd(), 'src/ui/components/ProjectDetail.tsx'),
      'utf8'
    )
    // css 存储项目详情局部样式，用于防止 macOS 顶部拖动区域重新吞掉按钮点击。
    const css = readFileSync(
      join(process.cwd(), 'src/ui/components/ProjectDetail.css'),
      'utf8'
    )

    expect(componentSource).toContain('rootClassName="project-detail-drawer"')
    expect(css).toMatch(
      /\.project-detail-drawer\s*\{[^}]*-webkit-app-region:\s*no-drag/s
    )
    expect(css).toMatch(
      /\.project-detail-drawer \.ant-drawer-close\s*\{[^}]*-webkit-app-region:\s*no-drag/s
    )
    expect(css).toContain('height: 32px')
    expect(css).toContain('width: 32px')
  })
})
