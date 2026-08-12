import { test, expect } from './fixtures/electronApp.ts'

// STARTUP_ICON_SIZE_PX 存储启动图标在真实 Electron 窗口中的设计尺寸。
const STARTUP_ICON_SIZE_PX = 80
// CENTER_TOLERANCE_PX 存储截图像素计算允许的亚像素取整误差。
const CENTER_TOLERANCE_PX = 1

test('React 挂载前在窗口中央展示小号项目图标且不显示 loading', async ({
  electronApp,
  appPage,
}, testInfo) => {
  await expect(appPage.locator('#root')).toBeVisible()
  // startupPagePromise 存储隐藏启动预览窗口对应的 Playwright 页面等待任务。
  const startupPagePromise = electronApp.waitForEvent('window')
  await electronApp.evaluate(async ({ BrowserWindow, session }) => {
    // pathModule 存储 Node 路径工具，用于跨平台定位构建后的入口文件。
    const pathModule = process.getBuiltinModule('node:path')
    // previewPartition 存储启动预览窗口独立 session 名，避免请求拦截影响主测试窗口。
    const previewPartition = `e2e-startup-preview-${Date.now()}`
    // previewSession 存储仅用于启动占位验收的隔离 Electron session。
    const previewSession = session.fromPartition(previewPartition)
    previewSession.webRequest.onBeforeRequest(
      { urls: ['<all_urls>'] },
      (details, callback) => {
        // shouldBlockScript 标记当前请求是否为 React/Vite 构建脚本；图片等首屏资源继续真实加载。
        const shouldBlockScript = /\.js(?:$|\?)/.test(details.url)
        callback({ cancel: shouldBlockScript })
      }
    )
    // previewWindow 存储不显示到桌面的真实 Electron 启动预览窗口。
    const previewWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      backgroundColor: '#141414',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        session: previewSession,
      },
    })
    // 测试期间保留原生窗口引用，防止局部变量释放后窗口被垃圾回收。
    globalThis.__visualWorktreeStartupPreview = previewWindow
    await previewWindow.loadFile(
      pathModule.join(process.cwd(), 'dist/index.html')
    )
  })
  // startupPage 存储真实加载构建入口、但尚未执行 React 的隐藏 Electron 页面。
  const startupPage = await startupPagePromise
  await startupPage.waitForLoadState('domcontentloaded')

  // startupIcon 存储启动占位中的项目图标元素。
  const startupIcon = startupPage.locator('#startup-splash img')
  await expect(startupIcon).toBeVisible()
  await expect(startupPage.locator('.startup-splash__spinner')).toHaveCount(0)
  // iconBox 存储启动图标在窗口内的实际像素边界。
  const iconBox = await startupIcon.boundingBox()
  // viewportSize 存储隐藏预览页面的 CSS 视口尺寸。
  const viewportSize = await startupPage.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
  expect(iconBox).not.toBeNull()
  expect(iconBox?.width).toBe(STARTUP_ICON_SIZE_PX)
  expect(iconBox?.height).toBe(STARTUP_ICON_SIZE_PX)
  expect(
    Math.abs(
      (iconBox?.x || 0) +
        STARTUP_ICON_SIZE_PX / 2 -
        (viewportSize?.width || 0) / 2
    )
  ).toBeLessThanOrEqual(CENTER_TOLERANCE_PX)
  expect(
    Math.abs(
      (iconBox?.y || 0) +
        STARTUP_ICON_SIZE_PX / 2 -
        (viewportSize?.height || 0) / 2
    )
  ).toBeLessThanOrEqual(CENTER_TOLERANCE_PX)

  // screenshotPath 存储启动占位的真实 Electron 截图，供人工复核主题背景和图标观感。
  const screenshotPath = testInfo.outputPath('startup-splash.png')
  await startupPage.screenshot({ path: screenshotPath, animations: 'disabled' })
  await testInfo.attach('startup-splash', {
    path: screenshotPath,
    contentType: 'image/png',
  })

  await startupPage.evaluate(() => {
    localStorage.setItem('vw-theme', 'light')
  })
  await startupPage.reload()
  await expect(startupPage.locator('#startup-splash img')).toBeVisible()
  await expect(startupPage.locator('.startup-splash__spinner')).toHaveCount(0)
  // lightBackgroundColor 存储亮色主题启动占位的实际背景色。
  const lightBackgroundColor = await startupPage
    .locator('html')
    .evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(lightBackgroundColor).toBe('rgb(255, 255, 255)')
  // lightScreenshotPath 存储用户所述白色启动背景下的项目图标截图。
  const lightScreenshotPath = testInfo.outputPath('startup-splash-light.png')
  await startupPage.screenshot({
    path: lightScreenshotPath,
    animations: 'disabled',
  })
  await testInfo.attach('startup-splash-light', {
    path: lightScreenshotPath,
    contentType: 'image/png',
  })
  await startupPage.close()
})
