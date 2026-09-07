/**
 * 从 ESM 动态导入结果中解析 electron-updater 的 autoUpdater。
 * @param {object|null|undefined} updaterModule - import('electron-updater') 返回的模块命名空间
 * @returns {object|null} 可用的 autoUpdater；导出结构异常时返回 null
 */
export function resolveAutoUpdater(updaterModule) {
  // commonJsExports 存储 CommonJS 包在不同 Node/Electron 打包环境中的默认导出对象。
  const commonJsExports =
    updaterModule?.default || updaterModule?.['module.exports']
  // 打包后 electron-updater 可能只挂在 default 下；兼容命名导出与两种 CommonJS interop 形态，避免应用启动时拿到 undefined。
  return updaterModule?.autoUpdater || commonJsExports?.autoUpdater || null
}

/**
 * 按运行环境加载 electron-updater，并在模块加载失败时安全降级。
 * @param {()=>Promise<object>} importUpdater - 动态导入 electron-updater 的函数
 * @param {boolean} isPackaged - 当前是否为已打包应用
 * @returns {Promise<object|null>} 可用的 autoUpdater；开发环境或加载失败时返回 null
 */
export async function loadAutoUpdater(importUpdater, isPackaged) {
  if (!isPackaged) return null
  try {
    // updaterModule 存储动态导入得到的模块命名空间，由兼容解析逻辑提取真实更新器。
    const updaterModule = await importUpdater()
    return resolveAutoUpdater(updaterModule)
  } catch {
    // 更新能力属于增强功能；模块缺失或加载失败时必须允许主应用继续启动。
    return null
  }
}

/**
 * 注册应用更新 IPC。
 * @param {object} ipcMain - Electron IPC 注册器
 * @param {object|null} updater - electron-updater 的 autoUpdater 实例
 * @param {boolean} isPackaged - 当前是否为已打包应用
 */
export function registerAppUpdater(ipcMain, updater, isPackaged) {
  // APP_UPDATE_PROGRESS_CHANNEL 存储下载进度推送到渲染进程的 IPC 通道名。
  const APP_UPDATE_PROGRESS_CHANNEL = 'app-update:progress'
  // downloaded 存储安装包是否已完整下载。
  let downloaded = false
  // downloadPromise 存储进行中的下载任务。
  let downloadPromise = null
  // downloadSender 存储当前下载请求对应的渲染进程，用于推送下载进度。
  let downloadSender = null
  if (updater) {
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.on('download-progress', (progress) => {
      // percent 存储 electron-updater 上报并限制在 0 到 100 范围内的下载百分比。
      const percent = Math.min(100, Math.max(0, Number(progress?.percent) || 0))
      downloadSender?.send(APP_UPDATE_PROGRESS_CHANNEL, { percent })
    })
  }
  ipcMain.handle('app-update:check', async () => {
    // 版本检查只访问 GitHub Release API，开发版也必须真实检查；是否打包仅影响后续下载安装能力。
    // result 存储 GitHub Release 检查结果。electron-updater 需要 latest.yml 才能检查，
    // 但版本提示本身只读取 GitHub API，避免用户仅为查看版本而依赖额外元数据文件。
    const response = await fetch(
      'https://api.github.com/repos/imberZsk/visual-worktree/releases/latest',
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Visual-Worktree',
        },
      }
    )
    if (!response.ok)
      throw new Error(`检查应用更新失败（HTTP ${response.status}）`)
    const release = await response.json()
    // version 存储远端最新版本号；仅在 electron-updater 已完成当前版本比较后使用。
    const version = String(release?.tag_name || '').replace(/^v/, '')
    const currentVersion = String(
      process.env.VISUAL_WORKTREE_VERSION || ''
    ).replace(/^v/, '')
    const newer = version && currentVersion && version !== currentVersion
    if (!currentVersion) return { available: false }
    return {
      available: Boolean(newer),
      version: newer ? version : null,
      currentVersion,
      latestVersion: version,
      checkedAt: new Date().toISOString(),
      canInstall: Boolean(isPackaged && updater),
      downloaded,
    }
  })
  ipcMain.handle('app-update:download', async (event) => {
    if (!updater) throw new Error('应用更新模块不可用')
    downloadSender = event?.sender || null
    // 业务场景：重复点击复用同一下载任务。
    if (!downloadPromise)
      downloadPromise = updater
        .downloadUpdate()
        .then(() => {
          downloaded = true
          return { downloaded: true }
        })
        .finally(() => {
          downloadPromise = null
          downloadSender = null
        })
    return downloadPromise
  })
  ipcMain.handle('app-update:install', () => {
    if (!updater) throw new Error('应用更新模块不可用')
    if (!downloaded) throw new Error('更新尚未下载完成')
    updater.quitAndInstall(false, true)
    return true
  })
}
