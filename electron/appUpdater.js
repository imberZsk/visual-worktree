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
  // downloaded 存储安装包是否已完整下载。
  let downloaded = false
  // downloadPromise 存储进行中的下载任务。
  let downloadPromise = null
  if (updater) {
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
  }
  ipcMain.handle('app-update:check', async () => {
    // 开发环境不访问发布服务；打包环境若更新模块导出异常也降级为无更新，不能让桌面应用启动崩溃。
    if (!isPackaged || !updater) return { available: false }
    // result 存储 GitHub Release 检查结果。
    const result = await updater.checkForUpdates()
    // version 存储远端最新版本号。
    const version = result?.updateInfo?.version
    return version
      ? { available: true, version, downloaded }
      : { available: false }
  })
  ipcMain.handle('app-update:download', async () => {
    if (!updater) throw new Error('应用更新模块不可用')
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
