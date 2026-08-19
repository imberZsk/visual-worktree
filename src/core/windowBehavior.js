// 窗口启动行为纯逻辑：与 Electron 解耦，便于 vitest 直接单测。

// CUSTOM_TITLE_BAR_HEIGHT 存储应用内 Header 与系统窗口控件覆盖层共用的高度。
const CUSTOM_TITLE_BAR_HEIGHT = 64
// MACOS_TRAFFIC_LIGHT_POSITION 存储隐藏标题栏后 macOS 系统窗口按钮的位置。
const MACOS_TRAFFIC_LIGHT_POSITION = { x: 16, y: 22 }
// TITLE_BAR_THEME_COLORS 存储窗口控件覆盖层在明暗主题下的背景和图标色。
const TITLE_BAR_THEME_COLORS = {
  dark: { color: '#141414', symbolColor: '#f5f5f5' },
  light: { color: '#ffffff', symbolColor: '#1f1f1f' },
}

/**
 * 判断当前启动环境是否需要自动打开 DevTools
 * @param {Record<string, string | undefined>} env - 启动进程的环境变量集合
 * @returns {boolean} 是否自动打开 DevTools
 */
export function shouldOpenDevTools(env = process.env) {
  // isDevelopment 存储当前是否以开发模式启动应用。
  const isDevelopment = env.NODE_ENV === 'development'
  // wantsDevTools 存储用户是否通过环境变量显式要求打开调试控制台。
  const wantsDevTools = env.OPEN_DEVTOOLS === '1'
  // isSmokeMode 存储当前是否处于启动冒烟验证模式。
  const isSmokeMode = env.PM_SMOKE === '1'

  return isDevelopment && wantsDevTools && !isSmokeMode
}

/**
 * 判断主窗口创建后是否立即显示，自动化验证时保持离屏渲染。
 * @param {Record<string, string | undefined>} env - 启动进程的环境变量集合
 * @returns {boolean} 是否向用户显示主窗口
 */
export function shouldShowMainWindow(env = process.env) {
  // isSmokeMode 存储当前是否处于启动冒烟验证模式。
  const isSmokeMode = env.PM_SMOKE === '1'
  // isE2EMode 存储当前是否由 Playwright 执行 Electron 端到端测试。
  const isE2EMode = env.VISUAL_WORKTREE_E2E === '1'

  // E2E 原本只隔离了 HOME，却仍显示 Electron 窗口抢占焦点；两类自动化环境都应使用隐藏窗口完成真实渲染验证。
  return !isSmokeMode && !isE2EMode
}

/**
 * 获取 Windows/Linux 原生窗口控件覆盖层的主题配置。
 * @param {'light'|'dark'} themeMode - 应用当前明暗主题
 * @returns {{color:string,symbolColor:string,height:number}} 覆盖层颜色和高度
 */
export function getTitleBarOverlayOptions(themeMode = 'dark') {
  // normalizedThemeMode 存储经过白名单约束的窗口主题，异常值统一回退暗色。
  const normalizedThemeMode = themeMode === 'light' ? 'light' : 'dark'
  // themeColors 存储当前主题对应的窗口控件背景与图标颜色。
  const themeColors = TITLE_BAR_THEME_COLORS[normalizedThemeMode]

  return { ...themeColors, height: CUSTOM_TITLE_BAR_HEIGHT }
}

/**
 * 获取各平台用于移除重复原生标题栏、同时保留系统窗口控件的窗口选项。
 * @param {NodeJS.Platform} platform - 当前运行平台
 * @returns {object} 可合并到 BrowserWindow 构造参数的标题栏选项
 */
export function getWindowChromeOptions(platform = process.platform) {
  if (platform === 'darwin') {
    return {
      // macOS 默认会吞掉非活动窗口的首次按下，导致窗口虽在上层却必须先点一下才能拖动自定义标题栏。
      acceptFirstMouse: true,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: MACOS_TRAFFIC_LIGHT_POSITION,
    }
  }

  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: getTitleBarOverlayOptions('dark'),
  }
}
