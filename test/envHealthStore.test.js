import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import {
  getTaskEnvHealthPaths,
  loadTaskEnvHealth,
  saveTaskEnvHealth,
} from '../src/core/envHealthStore.js'
import { makeTempRoot } from './helpers.js'

// envHealthStore 测试：验证环境检查结果缓存的读写、损坏回退与保存失败分支。

describe('envHealthStore', () => {
  // ctx 存储本次用例的临时根目录及清理函数
  let ctx
  // baseDir 存储注入的缓存目录，避免污染真实用户目录
  let baseDir
  beforeEach(() => {
    ctx = makeTempRoot()
    baseDir = join(ctx.root, 'store')
  })
  afterEach(() => ctx.cleanup())

  it('文件不存在时 load 返回空对象', () => {
    // 缓存文件尚未创建，命中 existsSync 提前返回分支
    expect(loadTaskEnvHealth(baseDir)).toEqual({})
  })

  it('save 后 load 能读回同一映射', () => {
    // map 为待缓存的任务环境检查映射
    const map = { 'TASK-1': { status: 'ok', projectCount: 2 } }
    const ok = saveTaskEnvHealth(map, baseDir)
    expect(ok).toBe(true)
    expect(loadTaskEnvHealth(baseDir)).toEqual(map)
  })

  it('缓存内容损坏时 load 回退空对象', () => {
    // 手写非法 JSON，命中 load 的 catch 回退分支
    const { dir, file } = getTaskEnvHealthPaths(baseDir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, '{ broken json', 'utf8')
    expect(loadTaskEnvHealth(baseDir)).toEqual({})
  })

  it('缓存内容非对象（数组）时 load 回退空对象', () => {
    // 数组不是有效映射，命中 isEnvHealthMap 为 false 分支
    const { dir, file } = getTaskEnvHealthPaths(baseDir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, JSON.stringify([1, 2, 3]), 'utf8')
    expect(loadTaskEnvHealth(baseDir)).toEqual({})
  })

  it('save 传入非对象时归一化为空对象写盘', () => {
    // 传入数组，isEnvHealthMap 为 false，落盘应写空对象
    const ok = saveTaskEnvHealth([1, 2], baseDir)
    expect(ok).toBe(true)
    expect(loadTaskEnvHealth(baseDir)).toEqual({})
  })

  it('目标目录路径被文件占用导致 save 失败时返回 false', () => {
    // 先把 baseDir 本身建成文件，使其下的 mkdir/writeFile 失败，命中 save 的 catch 分支
    mkdirSync(ctx.root, { recursive: true })
    writeFileSync(baseDir, 'i am a file', 'utf8')
    const ok = saveTaskEnvHealth({ 'TASK-X': {} }, baseDir)
    expect(ok).toBe(false)
  })
})
