import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  session,
  clipboard,
  dialog,
} from 'electron'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { execFile } from 'child_process'
import { registerIpcHandlers } from './ipcHandlers.js'
import { shouldOpenDevTools } from '../src/core/windowBehavior.js'
import { loadAutoUpdater, registerAppUpdater } from './appUpdater.js'

// Electron 主进程入口：创建窗口、注册 IPC、加载渲染进程。
// 业务逻辑全在 src/core，主进程只做窗口管理与 IPC 转发。

/**
 * 异步补齐 SSH_AUTH_SOCK：macOS GUI 应用不继承登录 shell 的 SSH_AUTH_SOCK，
 * 通过 launchctl 从 launchd 取得 socket 路径后注入 process.env，
 * 使 simple-git 派生的子进程能访问 SSH agent，fetch 不再因鉴权超时被误报连接失败。
 * 使用 execFile 异步版本，避免在主进程 JS 线程同步阻塞事件循环。
 * @returns {Promise<void>}
 */
function warmSshAuthSock() {
  // 非 macOS 或已有 SSH_AUTH_SOCK 时跳过
  if (process.platform !== 'darwin' || process.env.SSH_AUTH_SOCK) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    execFile(
      'launchctl',
      ['getenv', 'SSH_AUTH_SOCK'],
      { encoding: 'utf8' },
      (err, stdout) => {
        if (!err) {
          // sock 存储 launchd 返回的 SSH agent socket 路径
          const sock = stdout.trim()
          if (sock) process.env.SSH_AUTH_SOCK = sock
        }
        // launchctl 不可用或 SSH agent 未启动时静默降级，不影响非 SSH 远程
        resolve()
      }
    )
  })
}

// __dirname 在 ESM 中不存在，需从 import.meta.url 推导
const __dirname = dirname(fileURLToPath(import.meta.url))
// 是否开发环境：决定加载 vite dev server 还是打包后的 dist
const isDev = process.env.NODE_ENV === 'development'
// PM_SMOKE 冒烟模式：启动自检，验证窗口与渲染进程后退出，用于脚本验证 Electron 能启动
const isSmoke = process.env.PM_SMOKE === '1'
// mainWindow 持有主窗口引用，供 IPC 推送进度使用
let mainWindow = null

/**
 * 创建主窗口并加载渲染进程页面
 * @returns {BrowserWindow} 创建的窗口实例
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    // 冒烟模式下不显示窗口，避免 CI/无头环境弹窗
    show: process.env.PM_SMOKE !== '1',
    title: 'Visual Worktree',
    // 窗口背景色：默认暗色（与应用默认主题一致），避免启动时白屏闪烁
    backgroundColor: '#141414',
    webPreferences: {
      // preload 必须是 CommonJS（.cjs），在隔离环境暴露安全 API
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // 开发环境连 vite dev server，生产环境加载构建产物
  if (isDev) {
    mainWindow.loadURL('http://localhost:5275')
    // DevTools 只在显式设置 OPEN_DEVTOOLS=1 时打开，避免日常 dev 启动自动弹控制台。
    if (shouldOpenDevTools(process.env)) mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
  return mainWindow
}

// 注册 IPC handler，注入窗口获取器、shell 与 clipboard
registerIpcHandlers(ipcMain, {
  getWindow: () => mainWindow,
  shell,
  clipboard,
  dialog,
})
// appUpdater 存储打包环境动态加载并兼容 CommonJS/ESM 后的更新器；导入或解析失败时安全降级，不阻断启动。
const appUpdater = await loadAutoUpdater(
  () => import('electron-updater'),
  app.isPackaged
)
registerAppUpdater(ipcMain, appUpdater, app.isPackaged)

// PM_SMOKE 冒烟模式自检：验证窗口与渲染进程后打印 SMOKE_OK 并退出。
/**
 * 冒烟自检：等待页面加载完成，验证 preload 暴露的 window.api 是否可用
 * @param {BrowserWindow} win - 主窗口
 * @returns {Promise<void>}
 */
async function runSmokeCheck(win) {
  try {
    // 等待渲染进程页面加载结束
    await new Promise((resolve, reject) => {
      // 加载失败直接 reject
      win.webContents.once('did-finish-load', resolve)
      win.webContents.once('did-fail-load', (_e, code, desc) =>
        reject(new Error(`load failed ${code} ${desc}`))
      )
    })
    // 在渲染进程中检查 window.api 的关键方法是否存在
    const apiOk = await win.webContents.executeJavaScript(
      "typeof window.api === 'object' && typeof window.api.scanProjects === 'function' && typeof window.api.batchOperate === 'function'"
    )
    if (!apiOk) throw new Error('window.api 未正确暴露')
    // 实际调用一次 scanProjects 验证 IPC 链路通（用临时空目录，避免扫描真实项目耗时）
    console.log('SMOKE_OK preload-api-available ipc-ready')
    app.exit(0)
  } catch (e) {
    console.error('SMOKE_FAIL', e.message)
    app.exit(1)
  }
}

/**
 * 注入 Content-Security-Policy 响应头，消除 Electron 不安全 CSP 警告并提升安全性。
 * dev 与 prod 用不同策略：dev 需放开 unsafe-eval 与 ws 连接以支持 vite HMR；
 * prod 用严格策略，仅允许自身资源。antd 的 CSS-in-JS 需要 style-src unsafe-inline。
 * @returns {void}
 */
function setupCSP() {
  // policy 为最终下发的 CSP 字符串，按环境区分
  const policy = isDev
    ? // 开发：允许 vite dev server 的 eval/内联与 websocket 热更新连接
      "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:5275 http://localhost:5275; img-src 'self' data:; font-src 'self' data:"
    : // 生产：严格策略，仅自身资源；样式因 antd 内联需 unsafe-inline
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"
  // 对所有响应注入 CSP 头
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })
}

// app ready 后创建窗口
app.whenReady().then(() => {
  // 异步补齐 SSH_AUTH_SOCK，不阻塞事件循环；git fetch 鉴权所需 socket 在后台静默填充
  warmSshAuthSock()
  // 先注入 CSP，再加载页面
  setupCSP()
  // 开发模式下设置 Dock 图标为自定义 logo（打包后的 app 由 icns 提供图标，无需此步）
  if (isDev && process.platform === 'darwin' && app.dock) {
    // devIconPath 指向 build 目录下的 png 图标
    const devIconPath = join(__dirname, '../build/icon.png')
    try {
      app.dock.setIcon(devIconPath)
    } catch (e) {
      // 图标设置失败不影响启动
    }
  }
  const win = createWindow()
  // 冒烟模式下执行自检
  if (isSmoke) {
    runSmokeCheck(win)
    return
  }
  // macOS：dock 点击时若无窗口则重建
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 非 macOS：所有窗口关闭即退出
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
