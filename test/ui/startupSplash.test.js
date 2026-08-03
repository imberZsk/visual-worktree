import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// INDEX_HTML_PATH 存储渲染进程入口文件路径，用于验证 React 加载前的启动占位结构。
const INDEX_HTML_PATH = join(process.cwd(), 'src/ui/index.html')
// STARTUP_ICON_PATH 存储启动占位使用的轻量项目图标路径。
const STARTUP_ICON_PATH = join(process.cwd(), 'src/ui/assets/startup-icon.png')

describe('Electron 启动占位', () => {
  it('React 挂载前使用当前主题背景居中展示项目图标和启动状态', () => {
    // indexHtml 存储渲染进程入口源码，用于锁定不依赖 React 的首屏结构与关键样式。
    const indexHtml = readFileSync(INDEX_HTML_PATH, 'utf8')

    expect(indexHtml).toContain('id="startup-splash"')
    expect(indexHtml).toContain('aria-label="Visual Worktree 正在启动"')
    expect(indexHtml).toContain('src="./assets/startup-icon.png"')
    expect(indexHtml).toContain('class="startup-splash__spinner"')
    expect(indexHtml).toContain('--startup-spinner-color: #1668dc')
    expect(indexHtml).toContain('--startup-spinner-color: #1677ff')
    expect(
      indexHtml.match(/class="startup-splash__spinner-item"/g)
    ).toHaveLength(4)
    expect(indexHtml).toMatch(
      /#startup-splash\s*\{[\s\S]*position:\s*fixed[\s\S]*place-items:\s*center[\s\S]*background:\s*inherit/
    )
    expect(indexHtml).toMatch(
      /#startup-splash\s*\{[\s\S]*-webkit-app-region:\s*drag/
    )
    expect(indexHtml).toMatch(
      /\.startup-splash__spinner\s*\{[\s\S]*top:\s*calc\(100% \+ 16px\)[\s\S]*animation:\s*startup-spinner-rotate 1\.2s linear infinite/
    )
    expect(indexHtml).toMatch(
      /\.startup-splash__spinner-item\s*\{[\s\S]*width:\s*var\(--startup-spinner-item-size\)[\s\S]*animation:\s*startup-spinner-item 1s linear infinite alternate/
    )
    expect(indexHtml).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.startup-splash__spinner-item\s*\{\s*animation:\s*none/
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
