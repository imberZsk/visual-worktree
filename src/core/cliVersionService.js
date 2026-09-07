import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
// OFFICIAL_NPM_REGISTRY 存储版本查询和安装使用的官方 npm registry。
const OFFICIAL_NPM_REGISTRY = 'https://registry.npmjs.org'
// TOOL_DEFINITIONS 存储受支持工具的展示名、npm 包名及可执行文件名。
const TOOL_DEFINITIONS = {
  claude: {
    name: 'Claude Code',
    packageName: '@anthropic-ai/claude-code',
    bin: 'claude',
  },
  codex: { name: 'Codex', packageName: '@openai/codex', bin: 'codex' },
}

/**
 * 构造 Electron GUI 可用的命令环境，补齐登录 Shell、Volta 和桌面应用内置 Codex 路径。
 * @returns {Promise<NodeJS.ProcessEnv>} 子进程环境
 */
async function buildCliEnvironment() {
  // shellPath 存储用户登录 Shell，缺失时使用当前平台常见默认值。
  const shellPath = process.env.SHELL || '/bin/zsh'
  // loginPath 存储登录 Shell 中的 PATH；读取失败时回退主进程 PATH。
  let loginPath = process.env.PATH || ''
  if (process.platform !== 'win32') {
    try {
      const result = await runCliCommand(
        shellPath,
        ['-lic', 'printf %s "$PATH"'],
        process.env
      )
      loginPath = String(result.stdout || '').trim() || loginPath
    } catch {
      // Shell 配置异常不能阻断版本功能，后续继续使用 Electron 当前 PATH。
    }
  }
  // pathEntries 存储去重后的命令搜索目录。
  const pathEntries = loginPath.split(delimiter).filter(Boolean)
  // voltaBinPath 存储当前用户 Volta shim 目录。
  const voltaBinPath = join(homedir(), '.volta', 'bin')
  if (
    existsSync(join(voltaBinPath, 'claude')) ||
    existsSync(join(voltaBinPath, 'codex'))
  ) {
    const existingIndex = pathEntries.indexOf(voltaBinPath)
    if (existingIndex >= 0) pathEntries.splice(existingIndex, 1)
    pathEntries.unshift(voltaBinPath)
  }
  if (process.platform === 'darwin') {
    // appResourcePaths 存储系统级和用户级 ChatGPT/Codex 应用资源目录。
    const appResourcePaths = [
      '/Applications/ChatGPT.app/Contents/Resources',
      '/Applications/Codex.app/Contents/Resources',
      join(homedir(), 'Applications/ChatGPT.app/Contents/Resources'),
      join(homedir(), 'Applications/Codex.app/Contents/Resources'),
    ]
    for (const resourcePath of appResourcePaths) {
      if (
        existsSync(join(resourcePath, 'codex')) &&
        !pathEntries.includes(resourcePath)
      ) {
        pathEntries.push(resourcePath)
      }
    }
  }
  return { ...process.env, PATH: pathEntries.join(delimiter) }
}

/**
 * 使用修正后的环境执行命令。
 * @param {string} bin - 可执行文件名
 * @param {string[]} args - 命令参数
 * @param {NodeJS.ProcessEnv} env - 已构造的子进程环境
 * @returns {Promise<{stdout:string,stderr:string}>} 命令输出
 */
async function runCliCommand(bin, args, env) {
  // childProcess 存储惰性加载的 Node 子进程模块，避免无关测试的局部 mock 在模块初始化阶段失败。
  const childProcess = await import('node:child_process')
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      bin,
      args,
      { env, maxBuffer: 20 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `${stdout || ''}\n${stderr || ''}`.trim() || error.message
            )
          )
          return
        }
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') })
      }
    )
  })
}

/**
 * 从 CLI 版本输出中提取可比较的 semver。
 * @param {string} output - CLI 原始输出
 * @returns {string} 版本号
 */
export function parseCliVersion(output) {
  // match 存储版本输出中首个 semver。
  const match = String(output || '').match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)
  return match?.[0] || ''
}

/**
 * 查询指定 AI CLI 的本地版本与 npm 最新版本。
 * @param {'claude'|'codex'} toolId - 工具标识
 * @returns {Promise<object>} 本地和最新版本信息
 */
export async function checkCliVersion(toolId) {
  // definition 存储当前工具声明。
  const definition = TOOL_DEFINITIONS[toolId]
  if (!definition) throw new Error(`不支持查询 ${toolId} 的版本`)
  // env 存储 Finder 启动 Electron 时可用的完整命令环境。
  const env = await buildCliEnvironment()
  const [local, latest] = await Promise.all([
    runCliCommand(definition.bin, ['--version'], env),
    runCliCommand(
      'npm',
      [
        'view',
        definition.packageName,
        'version',
        `--registry=${OFFICIAL_NPM_REGISTRY}`,
      ],
      env
    ),
  ])
  // version 存储本机 CLI 的规范版本号。
  const version = parseCliVersion(local.stdout)
  // latestVersion 存储 npm registry 返回的最新版本号。
  const latestVersion = String(latest.stdout || '').trim()
  if (!version) throw new Error(`${definition.name} 未返回有效版本号`)
  if (!latestVersion) throw new Error('npm 未返回最新版本号')
  return { toolId, name: definition.name, version, latestVersion }
}

/**
 * 将指定 AI CLI 更新到 npm 最新版本并校验实际命中版本。
 * @param {'claude'|'codex'} toolId - 工具标识
 * @returns {Promise<object>} 更新后的版本信息
 */
export async function updateCli(toolId) {
  // definition 存储当前工具声明。
  const definition = TOOL_DEFINITIONS[toolId]
  if (!definition) throw new Error(`不支持更新 ${toolId} 的版本`)
  // env 存储安装、路径解析和版本校验共用的命令环境。
  const env = await buildCliEnvironment()
  // latest 存储更新前查询到的精确目标版本。
  const latest = await runCliCommand(
    'npm',
    [
      'view',
      definition.packageName,
      'version',
      `--registry=${OFFICIAL_NPM_REGISTRY}`,
    ],
    env
  )
  // latestVersion 存储本次安装目标版本。
  const latestVersion = String(latest.stdout || '').trim()
  // locator 存储当前平台查询可执行文件路径的系统命令。
  const locator = process.platform === 'win32' ? 'where' : 'which'
  // locatedTool 存储更新前实际命中的 CLI 路径。
  const locatedTool = await runCliCommand(locator, [definition.bin], env)
  // toolPath 存储第一条有效可执行文件路径。
  const toolPath =
    String(locatedTool.stdout || '')
      .split(/\r?\n/)
      .find(Boolean) || ''
  // usesVolta 标记当前工具是否由 Volta shim 管理。
  const usesVolta = toolPath.replaceAll('\\', '/').includes('/.volta/bin/')
  if (usesVolta) {
    await runCliCommand(
      'volta',
      ['install', `${definition.packageName}@${latestVersion}`],
      { ...env, npm_config_registry: OFFICIAL_NPM_REGISTRY }
    )
  } else {
    await runCliCommand(
      'npm',
      [
        'install',
        '-g',
        `${definition.packageName}@${latestVersion}`,
        `--registry=${OFFICIAL_NPM_REGISTRY}`,
      ],
      env
    )
  }
  // verified 存储安装后当前 PATH 实际命中的版本。
  const verified = await runCliCommand(definition.bin, ['--version'], env)
  // installedVersion 存储更新后解析出的版本号。
  const installedVersion = parseCliVersion(verified.stdout)
  if (installedVersion !== latestVersion) {
    throw new Error(
      `已执行更新，但 ${definition.name} 当前版本仍为 ${installedVersion || '未知'}，目标版本为 ${latestVersion}。当前命令路径：${toolPath || '未知'}`
    )
  }
  return {
    toolId,
    name: definition.name,
    version: installedVersion,
    latestVersion,
  }
}
