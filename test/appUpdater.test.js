import { describe, expect, it, vi } from 'vitest'
import {
  loadAutoUpdater,
  registerAppUpdater,
  resolveAutoUpdater,
} from '../electron/appUpdater.js'

/**
 * 创建可记录 IPC handler 的测试替身。
 * @returns {{handlers:Map<string,Function>,handle:Function}} IPC 注册器替身
 */
function createIpcMain() {
  // handlers 存储通道名到处理函数的映射，供测试直接调用注册结果。
  const handlers = new Map()
  return {
    handlers,
    /**
     * 记录指定通道的处理函数。
     * @param {string} channel - IPC 通道名
     * @param {Function} handler - 通道处理函数
     */
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
  }
}

describe('appUpdater', () => {
  it('兼容 electron-updater 的 CommonJS 默认导出', () => {
    // updater 存储 CommonJS 默认导出中的更新器实例。
    const updater = { checkForUpdates: vi.fn() }
    // updaterModule 存储打包环境常见的动态导入结果。
    const updaterModule = { default: { autoUpdater: updater } }

    expect(resolveAutoUpdater(updaterModule)).toBe(updater)
  })

  it('优先使用可用的 ESM 命名导出', () => {
    // namedUpdater 存储 ESM 命名导出的更新器实例。
    const namedUpdater = { checkForUpdates: vi.fn() }
    // defaultUpdater 存储同时存在的 CommonJS 默认导出，用于验证命名导出优先级。
    const defaultUpdater = { checkForUpdates: vi.fn() }

    expect(
      resolveAutoUpdater({
        autoUpdater: namedUpdater,
        default: { autoUpdater: defaultUpdater },
      })
    ).toBe(namedUpdater)
  })

  it('兼容 module.exports 上的 autoUpdater', () => {
    // updater 存储 module.exports 互操作导出中的更新器实例。
    const updater = { checkForUpdates: vi.fn() }

    expect(
      resolveAutoUpdater({ 'module.exports': { autoUpdater: updater } })
    ).toBe(updater)
  })

  it('打包环境动态导入失败时安全降级', async () => {
    // importUpdater 存储模拟模块加载失败的动态导入函数。
    const importUpdater = vi.fn().mockRejectedValue(new Error('load failed'))

    await expect(loadAutoUpdater(importUpdater, true)).resolves.toBeNull()
  })

  it('更新器导出缺失时安全注册并降级为无更新', async () => {
    // ipcMain 存储 IPC 注册器替身，用于调用更新检查处理函数。
    const ipcMain = createIpcMain()

    expect(() => registerAppUpdater(ipcMain, null, true)).not.toThrow()
    // checkHandler 存储应用更新检查处理函数，缺失视为测试失败。
    const checkHandler = ipcMain.handlers.get('app-update:check')
    expect(checkHandler).toBeTypeOf('function')
    await expect(checkHandler()).resolves.toEqual({ available: false })
  })
})
