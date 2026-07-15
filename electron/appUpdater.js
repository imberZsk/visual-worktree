/** 注册应用更新 IPC；参数分别为 IPC 注册器、更新器和是否已打包。 */
export function registerAppUpdater(ipcMain, updater, isPackaged) {
  // downloaded 存储安装包是否已完整下载。
  let downloaded = false
  // downloadPromise 存储进行中的下载任务。
  let downloadPromise = null
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  ipcMain.handle('app-update:check', async () => {
    // 业务场景：开发环境不访问发布服务。
    if (!isPackaged) return { available: false }
    // result 存储 GitHub Release 检查结果。
    const result = await updater.checkForUpdates()
    // version 存储远端最新版本号。
    const version = result?.updateInfo?.version
    return version
      ? { available: true, version, downloaded }
      : { available: false }
  })
  ipcMain.handle('app-update:download', async () => {
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
    if (!downloaded) throw new Error('更新尚未下载完成')
    updater.quitAndInstall(false, true)
    return true
  })
}
