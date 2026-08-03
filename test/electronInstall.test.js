import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { inspectElectronInstall } from '../scripts/verify-electron-install.mjs'

describe('Electron 安装配置与完整性校验', () => {
  // tempDir 存储每个用例隔离的模拟 Electron 包目录。
  let tempDir

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'visual-worktree-electron-install-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('识别完整的跨平台 Electron 安装目录', async () => {
    // packageFile 存储模拟 Electron package.json 路径。
    const packageFile = join(tempDir, 'package.json')
    // binaryRelativePath 使用嵌套路径模拟 macOS app 内二进制，Windows electron.exe 同样由 join 处理。
    const binaryRelativePath = join(
      'Electron.app',
      'Contents',
      'MacOS',
      'Electron'
    )
    // binaryPath 存储模拟的 Electron 平台可执行文件路径。
    const binaryPath = join(tempDir, 'dist', binaryRelativePath)
    await mkdir(join(tempDir, 'dist', 'Electron.app', 'Contents', 'MacOS'), {
      recursive: true,
    })
    await writeFile(packageFile, '{}\n')
    await writeFile(join(tempDir, 'path.txt'), `${binaryRelativePath}\n`)
    await writeFile(binaryPath, 'electron binary')

    await expect(inspectElectronInstall(packageFile)).resolves.toMatchObject({
      packageDir: tempDir,
      binaryPath,
    })
  })

  it('缺少 path.txt 时返回可执行的重装提示', async () => {
    // packageFile 存储缺失运行时文件的模拟 Electron package.json 路径。
    const packageFile = join(tempDir, 'package.json')
    await writeFile(packageFile, '{}\n')

    await expect(inspectElectronInstall(packageFile)).rejects.toThrow(
      /缺少 node_modules\/electron\/path\.txt.*pnpm run postinstall/
    )
  })

  it('固定本地与 CI 工具版本并在安装后校验 Electron', async () => {
    // workspaceConfig 存储 pnpm 11 构建脚本白名单。
    const workspaceConfig = await readFile('pnpm-workspace.yaml', 'utf8')
    // npmConfig 存储公开 registry 与 Electron 镜像配置。
    const npmConfig = await readFile('.npmrc', 'utf8')
    // packageConfig 存储项目工具版本与本地校验脚本。
    const packageConfig = JSON.parse(await readFile('package.json', 'utf8'))
    // ciWorkflow 存储 macOS/Windows 日常 CI 安装流程。
    const ciWorkflow = await readFile('.github/workflows/ci.yml', 'utf8')
    // releaseWorkflow 存储 macOS/Windows 正式发布安装流程。
    const releaseWorkflow = await readFile(
      '.github/workflows/release.yml',
      'utf8'
    )

    expect(workspaceConfig).toMatch(/allowBuilds:[\s\S]*electron:\s*true/)
    expect(npmConfig).toContain(
      'electron_mirror=https://npmmirror.com/mirrors/electron/'
    )
    expect(packageConfig.engines.node).toBe('22.22.2')
    expect(packageConfig.packageManager).toBe('pnpm@11.13.0')
    expect(packageConfig.scripts.postinstall).toBe(
      'cross-env ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ install-electron'
    )
    expect(packageConfig.scripts.predev).toBe('pnpm run verify:electron')
    expect(packageConfig.scripts['verify:electron']).toBe(
      'node scripts/verify-electron-install.mjs'
    )
    for (const workflow of [ciWorkflow, releaseWorkflow]) {
      expect(workflow).toContain('node-version: 22.22.2')
      expect(workflow).toContain('pnpm run verify:electron')
    }
  })
})
