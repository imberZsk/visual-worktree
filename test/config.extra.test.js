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

// config 补充测试：覆盖工作区 id 去重、空工作区回退默认、resetConfig 自建目录等未覆盖分支。

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
    // 手写三组同 id 的新结构工作区，触发唯一 id 后缀递增分支。
    writeFileSync(
      file,
      JSON.stringify({
        pathProfiles: [
          {
            id: 'dup',
            name: '组一',
            sourceProjectsPath: '/a/src',
            worktreesPath: '/a/wt',
            settings: { onboardingCompleted: true },
          },
          {
            id: 'dup',
            name: '组二',
            sourceProjectsPath: '/b/src',
            worktreesPath: '/b/wt',
            settings: { onboardingCompleted: true },
          },
          {
            id: 'dup',
            name: '组三',
            sourceProjectsPath: '/c/src',
            worktreesPath: '/c/wt',
            settings: { onboardingCompleted: true },
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

  it('工作区列表为空时回退为单个新默认工作区', () => {
    // dir 存储本用例的临时配置目录
    const dir = join(ctx.root, 'cfgdir')
    const { file } = getConfigPaths(dir)
    mkdirSync(dir, { recursive: true })
    // pathProfiles 为空数组时命中全新的默认工作区分支，不读取旧顶层路径。
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

    // 回退时使用新结构默认路径，旧顶层字段不会迁移。
    expect(cfg.pathProfiles).toHaveLength(1)
    expect(cfg.pathProfiles[0].id).toBe('default')
    expect(cfg.pathProfiles[0].sourceProjectsPath).not.toBe('/top/src')
  })

  it('保留旧版本未嵌套 settings 的路径组合', () => {
    // dir 存储该兼容性用例的隔离配置目录。
    const dir = join(ctx.root, 'legacy-path-profiles')
    // file 存储需要模拟的旧版路径组合配置文件。
    const { file } = getConfigPaths(dir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      file,
      JSON.stringify({
        activePathProfileId: 'personal',
        onboardingCompleted: true,
        pathProfiles: [
          {
            id: 'work',
            name: '工作',
            sourceProjectsPath: '/work/projects',
            worktreesPath: '/work/worktrees',
          },
          {
            id: 'personal',
            name: '个人',
            sourceProjectsPath: '/personal/projects',
            worktreesPath: '/personal/worktrees',
          },
        ],
      }),
      'utf8'
    )

    // cfg 存储读取后的当前工作区配置，应保留已选个人路径而非回退默认路径。
    const cfg = loadConfig(dir)

    expect(cfg.activePathProfileId).toBe('personal')
    expect(cfg.sourceProjectsPath).toBe('/personal/projects')
    expect(cfg.worktreesPath).toBe('/personal/worktrees')
    expect(cfg.onboardingCompleted).toBe(true)
    expect(cfg.pathProfiles).toHaveLength(2)
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
            settings: { onboardingCompleted: true },
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
    // diskConfig 存储 resetConfig 创建的新工作区嵌套磁盘结构。
    const diskConfig = JSON.parse(readFileSync(file, 'utf8'))
    expect(diskConfig.pathProfiles[0].settings.mainBranches).toEqual([
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
