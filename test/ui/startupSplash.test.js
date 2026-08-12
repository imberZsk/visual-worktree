import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// INDEX_HTML_PATH 存储渲染进程入口文件路径，用于验证 React 加载前的启动占位结构。
const INDEX_HTML_PATH = join(process.cwd(), 'src/ui/index.html')
// STARTUP_ICON_PATH 存储启动占位使用的轻量项目图标路径。
const STARTUP_ICON_PATH = join(process.cwd(), 'src/ui/assets/startup-icon.png')

describe('Electron 启动占位', () => {
  it('React 挂载前使用当前主题背景居中展示小号项目图标', () => {
    // indexHtml 存储渲染进程入口源码，用于锁定不依赖 React 的首屏结构与关键样式。
    const indexHtml = readFileSync(INDEX_HTML_PATH, 'utf8')

    expect(indexHtml).toContain('id="startup-splash"')
    expect(indexHtml).toContain('aria-label="Visual Worktree"')
    expect(indexHtml).toContain('src="./assets/startup-icon.png"')
    expect(indexHtml).toContain('--startup-icon-size: 80px')
    expect(indexHtml).not.toContain('startup-splash__spinner')
    expect(indexHtml).not.toContain('startup-spinner-item')
    expect(indexHtml).toMatch(
      /#startup-splash\s*\{[\s\S]*position:\s*fixed[\s\S]*place-items:\s*center[\s\S]*background:\s*inherit/
    )
    expect(indexHtml).toMatch(
      /#startup-splash\s*\{[\s\S]*-webkit-app-region:\s*drag/
    )
  })

  it('启动占位引用仓库内的独立 PNG 资源', () => {
    expect(existsSync(STARTUP_ICON_PATH)).toBe(true)
    // pngSignature 存储启动图标前 8 字节，用于确认资源是可被 Chromium 直接解码的 PNG。
    const pngSignature = readFileSync(STARTUP_ICON_PATH).subarray(0, 8)

    expect(Array.from(pngSignature)).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ])
  })
})
