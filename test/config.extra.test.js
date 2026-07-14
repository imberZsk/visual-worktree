import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  loadConfig,
  saveConfig,
  resetConfig,
  getConfigPaths,
} from '../src/core/config.js'
import { makeTempRoot } from './helpers.js'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

// config 补充测试：覆盖路径组合 id 去重、空组合回退默认、resetConfig 自建目录等未覆盖分支。

describe('config - 补充覆盖', () => {
  // ctx 存储本次用例的临时根目录及清理函数
  let ctx
  beforeEach(() => {
    ctx = makeTempRoot()
  })
  afterEach(() => {
    ctx.cleanup()
  })

  it('重复 id 的路径组合会被追加序号去重', () => {
    // dir 存储本用例的临时配置目录
    const dir = join(ctx.root, 'cfgdir')
    const { file } = getConfigPaths(dir)
    mkdirSync(dir, { recursive: true })
    // 手写两组同 id 配置，触发 dedupePathProfileIds 的 while 递增后缀分支
    writeFileSync(
      file,
      JSON.stringify({
        pathProfiles: [
          {
            id: 'dup',
            name: '组一',
            sourceProjectsPath: '/a/src',
            worktreesPath: '/a/wt',
          },
          {
            id: 'dup',
            name: '组二',
            sourceProjectsPath: '/b/src',
            worktreesPath: '/b/wt',
          },
          {
            id: 'dup',
            name: '组三',
            sourceProjectsPath: '/c/src',
            worktreesPath: '/c/wt',
          },
        ],
      }),
      'utf8'
    )

    // cfg 存储读取并去重后的配置
    const cfg = loadConfig(dir)
    // ids 存储去重后的组合 id 列表，用于验证唯一性
    const ids = cfg.pathProfiles.map((p) => p.id)

    expect(ids).toEqual(['dup', 'dup-2', 'dup-3'])
    expect(new Set(ids).size).toBe(3)
  })

  it('路径组合全部无效时回退为单个默认组合', () => {
    // dir 存储本用例的临时配置目录
    const dir = join(ctx.root, 'cfgdir')
    const { file } = getConfigPaths(dir)
    mkdirSync(dir, { recursive: true })
    // pathProfiles 为空数组，map/filter 后仍为空，命中「回退默认组合」分支
    writeFileSync(
      file,
      JSON.stringify({
        sourceProjectsPath: '/top/src',
        worktreesPath: '/top/wt',
        pathProfiles: [],
      }),
      'utf8'
    )

    const cfg = loadConfig(dir)

    // 回退时用顶层路径构造兜底组合
    expect(cfg.pathProfiles).toHaveLength(1)
    expect(cfg.pathProfiles[0].id).toBe('default')
    expect(cfg.pathProfiles[0].sourceProjectsPath).toBe('/top/src')
  })

  it('activePathProfileId 指向不存在组合时回退第一组', () => {
    // dir 存储本用例的临时配置目录
    const dir = join(ctx.root, 'cfgdir')
    const { file } = getConfigPaths(dir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      file,
      JSON.stringify({
        activePathProfileId: 'ghost',
        pathProfiles: [
          {
            id: 'real',
            name: '真实',
            sourceProjectsPath: '/r/src',
            worktreesPath: '/r/wt',
          },
        ],
      }),
      'utf8'
    )

    const cfg = loadConfig(dir)

    // 找不到 ghost，回退到第一组 real 并同步顶层路径
    expect(cfg.activePathProfileId).toBe('real')
    expect(cfg.sourceProjectsPath).toBe('/r/src')
  })

  it('resetConfig 在目录不存在时会自动创建目录', () => {
    // dir 存储尚未创建的配置目录，验证 resetConfig 会 mkdir 后写入
    const dir = join(ctx.root, 'fresh-cfgdir')
    const result = resetConfig(dir)
    const { file } = getConfigPaths(dir)

    // 目录被创建、默认配置写盘成功
    expect(result.mainBranches).toEqual(['master', 'main'])
    expect(JSON.parse(readFileSync(file, 'utf8')).mainBranches).toEqual([
      'master',
      'main',
    ])
  })

  it('saveConfig 在目录不存在时会自动创建目录', () => {
    // dir 存储尚未创建的配置目录，验证 saveConfig 首次保存会 mkdir
    const dir = join(ctx.root, 'save-fresh-dir')
    const saved = saveConfig({ sourceProjectsPath: '/new/src' }, dir)
    expect(saved.sourceProjectsPath).toBe('/new/src')
  })
})
