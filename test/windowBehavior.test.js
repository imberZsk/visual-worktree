import { describe, it, expect } from 'vitest'
import {
  getTitleBarOverlayOptions,
  getWindowChromeOptions,
  shouldOpenDevTools,
  shouldShowMainWindow,
} from '../src/core/windowBehavior.js'

// 窗口行为纯逻辑测试：不启动 Electron，只验证启动环境到窗口副作用的决策。

describe('windowBehavior', () => {
  it('开发模式默认不打开 DevTools', () => {
    // env 存储启动时传入的环境变量集合。
    const env = { NODE_ENV: 'development' }

    expect(shouldOpenDevTools(env)).toBe(false)
  })

  it('开发模式显式设置 OPEN_DEVTOOLS=1 时打开 DevTools', () => {
    // env 存储启动时传入的环境变量集合。
    const env = { NODE_ENV: 'development', OPEN_DEVTOOLS: '1' }

    expect(shouldOpenDevTools(env)).toBe(true)
  })

  it('冒烟模式不打开 DevTools', () => {
    // env 存储启动时传入的环境变量集合。
    const env = { NODE_ENV: 'development', OPEN_DEVTOOLS: '1', PM_SMOKE: '1' }

    expect(shouldOpenDevTools(env)).toBe(false)
  })

  it('普通开发与生产环境显示主窗口', () => {
    // developmentEnv 存储普通开发环境，应保持原有可见窗口行为。
    const developmentEnv = { NODE_ENV: 'development' }
    // productionEnv 存储正式应用环境，应保持原有可见窗口行为。
    const productionEnv = { NODE_ENV: 'production' }

    expect(shouldShowMainWindow(developmentEnv)).toBe(true)
    expect(shouldShowMainWindow(productionEnv)).toBe(true)
  })

  it('冒烟和 E2E 自动化环境隐藏主窗口', () => {
    // smokeEnv 存储启动冒烟环境，验证时不应显示窗口。
    const smokeEnv = { PM_SMOKE: '1' }
    // e2eEnv 存储 Playwright Electron 环境，真实渲染时不应抢占用户焦点。
    const e2eEnv = { VISUAL_WORKTREE_E2E: '1' }

    expect(shouldShowMainWindow(smokeEnv)).toBe(false)
    expect(shouldShowMainWindow(e2eEnv)).toBe(false)
  })

  it('macOS 隐藏原生标题栏并保留系统交通灯', () => {
    // chromeOptions 存储 macOS 自定义标题栏窗口配置。
    const chromeOptions = getWindowChromeOptions('darwin')

    expect(chromeOptions).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 22 },
    })
  })

  it('Windows 和 Linux 使用与应用 Header 等高的窗口控件覆盖层', () => {
    // windowsOptions 存储 Windows 自定义标题栏窗口配置。
    const windowsOptions = getWindowChromeOptions('win32')
    // linuxOptions 存储 Linux 自定义标题栏窗口配置。
    const linuxOptions = getWindowChromeOptions('linux')

    expect(windowsOptions.titleBarStyle).toBe('hidden')
    expect(windowsOptions.titleBarOverlay.height).toBe(64)
    expect(linuxOptions).toEqual(windowsOptions)
  })

  it('窗口控件覆盖层随应用主题切换颜色并安全回退暗色', () => {
    expect(getTitleBarOverlayOptions('light')).toEqual({
      color: '#ffffff',
      symbolColor: '#1f1f1f',
      height: 64,
    })
    expect(getTitleBarOverlayOptions('unexpected')).toEqual({
      color: '#141414',
      symbolColor: '#f5f5f5',
      height: 64,
    })
  })
})
