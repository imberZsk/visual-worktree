import { useEffect, useState } from 'react'
import { api } from '../api.ts'

/**
 * 管理应用更新检查、下载进度订阅和安装流程。
 * @param {object} message - antd message API，用于展示下载错误
 * @returns {object} 应用更新状态与操作
 */
export default function useAppUpdate(message) {
  // version 存储检测到的新版本号。
  const [version, setVersion] = useState(null)
  // downloading 标记安装包是否正在下载。
  const [downloading, setDownloading] = useState(false)
  // downloadPercent 存储安装包当前下载百分比。
  const [downloadPercent, setDownloadPercent] = useState(0)
  // downloaded 标记安装包是否已完整下载。
  const [downloaded, setDownloaded] = useState(false)
  // error 存储最近一次应用更新检查失败原因，用于顶部红色反馈。
  const [error, setError] = useState('')
  // checked 标记最近一次版本检查是否成功完成。
  const [checked, setChecked] = useState(false)
  // checking 标记当前是否正在检查版本。
  const [checking, setChecking] = useState(false)
  // checkDetails 存储服务端实际返回的本地版本、远端版本和检查时间。
  const [checkDetails, setCheckDetails] = useState(null)

  useEffect(() => {
    // mounted 标记组件是否仍挂载，避免异步检查完成后写入卸载组件。
    let mounted = true
    // checkUpdate 存储 preload 的更新检查方法；旧版 preload 可能尚未提供。
    const checkUpdate = api.checkAppUpdate
    if (typeof checkUpdate !== 'function') return undefined
    const runCheck = () => {
      setChecking(true)
      return checkUpdate().finally(() => mounted && setChecking(false))
    }
    runCheck()
      .then((result) => {
        if (mounted) {
          setError('')
          setChecked(true)
          setCheckDetails(result || null)
        }
        if (mounted && result?.available && result.version) {
          setVersion(result.version)
          setDownloaded(Boolean(result.downloaded))
        }
      })
      .catch((reason) => {
        if (mounted) setError(reason?.message || '检查应用更新失败')
      })
    // 首次检查遇到启动网络未就绪时延迟重试一次。
    const retryTimer = window.setTimeout(() => {
      if (!mounted) return
      runCheck()
        .then((result) => {
          if (!mounted) return
          setError('')
          setChecked(true)
          setCheckDetails(result || null)
          if (result?.available && result.version) {
            setVersion(result.version)
            setDownloaded(Boolean(result.downloaded))
          }
        })
        .catch((reason) => {
          if (mounted) setError(reason?.message || '检查应用更新失败')
        })
    }, 15_000)
    /**
     * 阻止异步检查在 hook 卸载后继续写入状态。
     */
    return () => {
      mounted = false
      window.clearTimeout(retryTimer)
    }
  }, [])

  /** 手动重新检查应用更新，并将失败原因保留给顶部状态展示。 */
  const checkNow = async () => {
    if (checking || typeof api.checkAppUpdate !== 'function') return
    setError('')
    setChecking(true)
    try {
      const result = await api.checkAppUpdate()
      setError('')
      setChecked(true)
      setCheckDetails(result || null)
      if (result?.available && result.version) {
        setVersion(result.version)
        setDownloaded(Boolean(result.downloaded))
      } else {
        setVersion(null)
      }
    } catch (reason) {
      setError(reason?.message || '检查应用更新失败')
      setChecked(false)
      setCheckDetails(null)
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    // subscribeProgress 存储更新下载进度订阅方法。
    const subscribeProgress = api.onAppUpdateProgress
    if (typeof subscribeProgress !== 'function') return undefined
    // unsubscribeProgress 存储卸载 hook 时移除监听器的方法。
    const unsubscribeProgress = subscribeProgress((progress) => {
      setDownloadPercent(Number(progress?.percent) || 0)
    })
    return unsubscribeProgress
  }, [])

  /**
   * 下载应用更新，并在下载完成后立即安装重启。
   */
  const downloadAndInstall = async () => {
    if (downloaded) {
      await api.installAppUpdate()
      return
    }
    setDownloading(true)
    setDownloadPercent(0)
    try {
      await api.downloadAppUpdate()
      setDownloaded(true)
      setDownloadPercent(100)
      await api.installAppUpdate()
    } catch (error) {
      message.error(error?.message || '更新下载失败')
    } finally {
      setDownloading(false)
    }
  }

  return {
    version,
    error,
    checked,
    checking,
    checkDetails,
    downloading,
    downloadPercent,
    checkNow,
    downloadAndInstall,
  }
}
