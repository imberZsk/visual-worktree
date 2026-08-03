import { readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// requireFromScript 用于从当前项目解析 Electron 包，而不是依赖全局安装。
const requireFromScript = createRequire(import.meta.url)

/**
 * 读取并验证 Electron 包内已经安装的平台运行时。
 * @param {string} electronPackageFile Electron package.json 的绝对路径。
 * @returns {Promise<{packageDir:string,pathFile:string,distDir:string,binaryPath:string}>} 已验证的运行时路径。
 */
export async function inspectElectronInstall(electronPackageFile) {
  // packageDir 存储 Electron 包目录，path.txt 与 dist 都应位于这里。
  const packageDir = dirname(electronPackageFile)
  // pathFile 存储 Electron 安装脚本写入的平台可执行文件相对路径。
  const pathFile = join(packageDir, 'path.txt')
  // distDir 存储 Electron 安装脚本解压后的平台运行时目录。
  const distDir = join(packageDir, 'dist')
  // missingRuntimeHint 存储所有完整性错误共用的可操作修复提示。
  const missingRuntimeHint =
    'Electron 运行时不完整，请使用 Node.js 22.22.2 和 pnpm 11.13.1 重新执行 pnpm install；若依赖图未变化，请执行 pnpm run postinstall。'

  // executableRelativePath 存储 path.txt 中记录的平台可执行文件相对路径。
  let executableRelativePath
  try {
    executableRelativePath = (await readFile(pathFile, 'utf8')).trim()
  } catch {
    throw new Error(
      `缺少 node_modules/electron/path.txt。${missingRuntimeHint}`
    )
  }

  if (!executableRelativePath) {
    throw new Error(
      `node_modules/electron/path.txt 内容为空。${missingRuntimeHint}`
    )
  }

  // distStats 存储 Electron 运行时目录的文件系统类型信息。
  let distStats
  try {
    distStats = await stat(distDir)
  } catch {
    throw new Error(`缺少 node_modules/electron/dist/。${missingRuntimeHint}`)
  }

  if (!distStats.isDirectory()) {
    throw new Error(
      `node_modules/electron/dist 不是目录。${missingRuntimeHint}`
    )
  }

  // binaryPath 存储当前平台 Electron 真正执行的二进制路径。
  const binaryPath = join(distDir, executableRelativePath)
  // binaryStats 存储 Electron 平台可执行文件的文件系统类型信息。
  let binaryStats
  try {
    binaryStats = await stat(binaryPath)
  } catch {
    throw new Error(
      `Electron 可执行文件不存在：${binaryPath}。${missingRuntimeHint}`
    )
  }

  if (!binaryStats.isFile()) {
    throw new Error(
      `Electron 可执行路径不是文件：${binaryPath}。${missingRuntimeHint}`
    )
  }

  return { packageDir, pathFile, distDir, binaryPath }
}

/**
 * 从当前项目依赖中解析 Electron，并输出安装完整性检查结果。
 * @returns {Promise<void>} Electron 运行时完整时完成，否则抛出带修复提示的错误。
 */
export async function verifyElectronInstall() {
  // electronPackageFile 存储当前项目解析到的 Electron package.json 绝对路径。
  let electronPackageFile
  try {
    electronPackageFile = requireFromScript.resolve('electron/package.json')
  } catch {
    throw new Error('未安装 Electron 依赖，请先执行 pnpm install。')
  }

  // installDetails 存储已验证的 Electron 安装目录和二进制路径。
  const installDetails = await inspectElectronInstall(electronPackageFile)
  console.log(
    `[verify-electron-install] Electron 运行时完整：${installDetails.binaryPath}`
  )
}

// currentScriptPath 存储当前模块文件路径，用于区分 CLI 执行与测试导入。
const currentScriptPath = fileURLToPath(import.meta.url)
// invokedScriptPath 存储 Node 进程实际执行的脚本路径；测试导入时指向测试运行器。
const invokedScriptPath = process.argv[1] ? resolve(process.argv[1]) : ''

if (invokedScriptPath === currentScriptPath) {
  verifyElectronInstall().catch((error) => {
    console.error(`[verify-electron-install] ${error.message}`)
    process.exitCode = 1
  })
}
