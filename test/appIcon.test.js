import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// DOCK_ICON_PATH 存储开发版与安装版共用的透明 Dock 图标源文件位置。
const DOCK_ICON_PATH = join(process.cwd(), 'build/dock-icon.png')

describe('macOS Dock 图标', () => {
  it('开发版和安装版统一使用额外打包的 Dock PNG', () => {
    // packageConfig 存储安装包资源声明，用于验证 Dock PNG 会进入应用 Resources 目录。
    const packageConfig = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8')
    )
    // mainSource 存储 Electron 启动逻辑，用于防止安装版再次只依赖系统渲染 ICNS。
    const mainSource = readFileSync(
      join(process.cwd(), 'electron/main.js'),
      'utf8'
    )

    expect(existsSync(DOCK_ICON_PATH)).toBe(true)
    expect(packageConfig.build.extraResources).toContainEqual({
      from: 'build/dock-icon.png',
      to: 'dock-icon.png',
    })
    expect(mainSource).toContain("join(process.resourcesPath, 'dock-icon.png')")
    expect(mainSource).toContain("join(__dirname, '../build/dock-icon.png')")
    expect(mainSource).not.toContain("isDev && process.platform === 'darwin'")
  })
})
