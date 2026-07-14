import { existsSync, readFileSync, readdirSync, statSync, lstatSync } from 'fs'
import { join } from 'path'
import net from 'net'
import { simpleGit } from 'simple-git'
import {
  DEFAULT_WORK_DOCUMENT_TEMPLATES,
  normalizeWorkDocumentTemplates,
} from './taskDocsService.js'

// 环境健康检查服务：纯 Node 模块，不依赖 Electron / AI。
// 对一个任务目录（其下每个子目录是一个项目 worktree）并行检查 4 项：
//   - 依赖一致性：package.json / lock / node_modules 是否齐备
//   - 端口占用：从 package.json scripts 提取常用端口，探测是否已被占用
//   - 服务连通性：从 .env 提取数据库/Redis/API 地址，TCP 探测可达性
//   - Git 状态：未提交改动 / 领先落后远程
// 每项返回 { status:'ok'|'warning'|'error', message, fixes:[] }，便于 UI 直接渲染。

// TCP 探测默认超时（毫秒）：连不上的地址要尽快失败，不让检查整体卡住
const PROBE_TIMEOUT_MS = 2000

// 依赖锁文件名：命中其一即认为项目声明了确定性依赖
const LOCK_FILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']

// Docker 运行入口文件名：命中其一表示项目可能在容器内安装和加载 PHP 依赖。
const DOCKER_RUNTIME_FILE_HINTS = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'Dockerfile',
  'dockerfile',
  '.docker/Dockerfile',
  'docker/Dockerfile',
]

// 检查项中文名映射：项目级 issues 展示时避免 UI 再重复维护一份标签表
const CHECK_LABELS = {
  deps: '依赖',
  ports: '端口',
  services: '服务',
  git: 'Git',
}

// ENVIRONMENT_ISSUE_CHECK_KEYS 存储会计入环境问题的问题域；Git 属于工作区状态提示，不代表项目环境不可用。
const ENVIRONMENT_ISSUE_CHECK_KEYS = ['deps', 'ports', 'services']

// 项目类型中文名映射：detectProjectKind 返回给 UI 直接展示
const PROJECT_KIND_LABELS = {
  frontend: '前端',
  miniprogram: '小程序',
  backend: '后端',
  backend_php: 'PHP 后端',
  backend_java: 'Java 后端',
  backend_python: 'Python 后端',
  fullstack: '全栈',
  unknown: '未知',
}

// CHECKABLE_PROJECT_KINDS 存储环境检查真正支持的业务项目类型；unknown 多为文档、插件或工具目录，不进入环境问题聚合。
const CHECKABLE_PROJECT_KINDS = new Set([
  'frontend',
  'miniprogram',
  'backend',
  'backend_php',
  'backend_java',
  'backend_python',
  'fullstack',
])

// NODE_DEPENDENCY_PROJECT_KINDS 存储应按 package.json/node_modules 检查依赖的项目类型。
const NODE_DEPENDENCY_PROJECT_KINDS = new Set([
  'frontend',
  'miniprogram',
  'backend',
  'fullstack',
])

// 小程序项目名称特征：覆盖公司内常见命名以及通用小程序命名片段
const MINIPROGRAM_NAME_HINTS = [
  'hybrid-mobile',
  'wxapp',
  'miniprogram',
  'miniapp',
  '-mini',
]

// 前端项目名称特征：作为依赖/文件特征不足时的辅助判断，不单独决定复杂项目归类
const FRONTEND_NAME_HINTS = ['frontend', 'pc-web']

// 小程序依赖特征：命中时优先展示为“小程序”，它本质属于前端但需要用户看到更准确的项目形态
const MINIPROGRAM_PACKAGE_HINTS = [
  'miniprogram-ci',
  'miniprogram-simulate',
  'miniprogram-automator',
  '@tarojs/taro',
  '@dcloudio/uni-app',
  '@ntocc-monitor/miniprogram',
]

// 前端依赖特征：命中越多越倾向判定为前端项目
const FRONTEND_PACKAGE_HINTS = [
  'vite',
  'webpack',
  'next',
  'nuxt',
  'react',
  'react-dom',
  'vue',
  '@vue/cli-service',
  'svelte',
  '@sveltejs/kit',
  '@angular/core',
  'react-scripts',
]

// 后端依赖特征：覆盖 Node 常见服务框架、ORM 与基础服务客户端
const BACKEND_PACKAGE_HINTS = [
  'express',
  'koa',
  'fastify',
  '@nestjs/core',
  'egg',
  'prisma',
  '@prisma/client',
  'typeorm',
  'sequelize',
  'mongoose',
  'mysql2',
  'pg',
  'redis',
]

// 前端脚本特征：用于没有明显依赖但 scripts 已暴露构建工具的项目
const FRONTEND_SCRIPT_HINTS = [
  { label: 'vite', pattern: /\bvite\b/ },
  { label: 'webpack', pattern: /\bwebpack\b/ },
  { label: 'next dev', pattern: /\bnext\s+dev\b/ },
  { label: 'next start', pattern: /\bnext\s+start\b/ },
  { label: 'nuxt', pattern: /\bnuxt\b/ },
  { label: 'react-scripts', pattern: /\breact-scripts\b/ },
  { label: 'vue-cli-service', pattern: /\bvue-cli-service\b/ },
]

// 后端脚本特征：用于从启动命令识别 Node 服务项目
const BACKEND_SCRIPT_HINTS = [
  {
    label: 'node server/app/main/index',
    pattern:
      /\bnode(?:\s+--[^\s]+(?:=\S+)?)*\s+(?:\.\/)?(?:[\w.-]+\/)*(?:server|app|main|index)(?:\.[cm]?[jt]s)?\b/,
  },
  {
    label: 'ts-node server/app/main/index',
    pattern:
      /\bts-node(?:\s+--[^\s]+(?:=\S+)?)*\s+(?:\.\/)?(?:[\w.-]+\/)*(?:server|app|main|index)(?:\.[cm]?ts)?\b/,
  },
  { label: 'nest start', pattern: /\bnest\s+start\b/ },
  { label: 'nodemon', pattern: /\bnodemon\b/ },
  { label: 'pm2', pattern: /\bpm2\b/ },
]

// 小程序文件特征：微信/跨端小程序项目常见配置文件
const MINIPROGRAM_FILE_HINTS = [
  'project.config.json',
  'project.private.config.json',
  'miniapp.json',
  'miniprogram/app.json',
  'miniprogram/sitemap.json',
  'static/wx/project.config.json',
]

// 前端文件特征：多数前端工程会有入口 HTML 或前端框架配置
const FRONTEND_FILE_HINTS = [
  'index.html',
  'vite.config.js',
  'vite.config.ts',
  'next.config.js',
  'next.config.mjs',
  'nuxt.config.js',
  'nuxt.config.ts',
  'src/main.js',
  'src/main.ts',
  'src/main.jsx',
  'src/main.tsx',
  'src/App.jsx',
  'src/App.tsx',
]

// 后端文件特征：覆盖 Java/Go/Python 以及常见 Node 服务入口
const BACKEND_FILE_HINTS = ['go.mod', 'server.js', 'src/main/java']

// PHP 后端文件特征：覆盖 Composer、Laravel/ThinkPHP 与传统 PHP 入口。
const PHP_BACKEND_FILE_HINTS = [
  'composer.json',
  'composer.lock',
  'index.php',
  'public/index.php',
  'artisan',
  'ThinkPHP/ThinkPHP.php',
  'Application',
]

// Java 后端文件特征：Maven / Gradle 是 Java 服务项目最稳定的入口。
const JAVA_BACKEND_FILE_HINTS = [
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'src/main/java',
]

// Python 后端文件特征：覆盖常见依赖声明与 Django/FastAPI 简化入口。
const PYTHON_BACKEND_FILE_HINTS = [
  'requirements.txt',
  'pyproject.toml',
  'Pipfile',
  'manage.py',
  'app.py',
  'main.py',
]

/**
 * 探测某个 host:port 是否可建立 TCP 连接（用于「端口被占用」「服务可达」判断）。
 * 连接成功 → 有服务在监听；连接被拒/超时 → 无服务。失败不抛出，统一返回布尔。
 * @param {string} host - 主机名或 IP
 * @param {number} port - 端口号
 * @param {number} [timeout] - 超时毫秒
 * @returns {Promise<boolean>} 是否连接成功（有服务监听）
 */
export function probeTcp(host, port, timeout = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    // socket 用于发起一次性 TCP 连接探测
    const socket = new net.Socket()
    // settled 防止 error/timeout/connect 多次回调重复 resolve
    let settled = false
    // done 统一收尾：销毁 socket 并只 resolve 一次
    const done = (result) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeout)
    // 连接成功：有服务在监听
    socket.once('connect', () => done(true))
    // 超时：视为不可达
    socket.once('timeout', () => done(false))
    // 出错（含连接被拒）：视为无服务/不可达
    socket.once('error', () => done(false))
    try {
      socket.connect(port, host)
    } catch (e) {
      done(false)
    }
  })
}

/**
 * 计算任务环境检查需要跳过的根级工作文档入口名。
 * WHY：工作文档目录由任务流程自动生成，用来放需求/排查记录，不是前后端项目；若被当项目扫描会制造假的依赖/Git 问题。
 * @param {Array<{type?:string,path?:string,content?:string}>} [templates] - 用户配置的工作文档模板列表
 * @returns {Set<string>} 需要从任务根目录扫描中排除的第一层目录名或文件名
 */
function buildSkippedWorkDocumentEntryNames(
  templates = DEFAULT_WORK_DOCUMENT_TEMPLATES
) {
  // sourceTemplates 存储默认 docs 与用户配置模板的合集，确保历史默认 docs 始终不被当成项目。
  const sourceTemplates = [
    ...DEFAULT_WORK_DOCUMENT_TEMPLATES,
    ...(Array.isArray(templates) ? templates : []),
  ]
  // skippedNames 存储模板路径在任务根目录下的第一段，用于和 readdir 的 entry 名称匹配。
  const skippedNames = new Set()

  for (const template of normalizeWorkDocumentTemplates(sourceTemplates)) {
    // firstSegment 存储工作文档相对路径的第一层入口；环境检查只扫描任务目录下一层子目录。
    const firstSegment = String(template.path || '')
      .split('/')
      .filter(Boolean)[0]
    if (firstSegment) skippedNames.add(firstSegment)
  }

  return skippedNames
}

/**
 * 列出任务目录下的项目 worktree 子目录（每个子目录是一个项目）。
 * @param {string} taskDir - 任务目录
 * @param {Array<{type?:string,path?:string,content?:string}>} [workDocumentTemplates] - 工作文档模板，用于排除根级文档目录
 * @returns {string[]} 项目目录绝对路径列表
 */
function listProjectDirs(
  taskDir,
  workDocumentTemplates = DEFAULT_WORK_DOCUMENT_TEMPLATES
) {
  // dirs 累积任务目录下的子目录（即各项目 worktree）
  const dirs = []
  // skippedEntries 存储不应当作为项目检查的任务根级工作文档入口名。
  const skippedEntries = buildSkippedWorkDocumentEntryNames(
    workDocumentTemplates
  )
  if (!taskDir || !existsSync(taskDir)) return dirs
  try {
    for (const entry of readdirSync(taskDir)) {
      // 跳过隐藏项（.git 等）
      if (entry.startsWith('.')) continue
      // 跳过 docs 等工作文档目录；它们可能含有文档辅助文件，但不是可启动项目。
      if (skippedEntries.has(entry)) continue
      const full = join(taskDir, entry)
      try {
        if (statSync(full).isDirectory()) dirs.push(full)
      } catch (e) {
        continue
      }
    }
  } catch (e) {
    // 读取失败返回已收集部分
  }
  return dirs
}

/**
 * 安全读取 JSON 文件，解析失败时返回 null，让调用方走降级逻辑。
 * @param {string} filePath - JSON 文件路径
 * @returns {object|null} 解析后的对象；失败时为 null
 */
function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (e) {
    return null
  }
}

/**
 * 判断依赖目录入口是否存在，软链接按入口本身存在处理，不跟随目标。
 * WHY：worktree 会把 node_modules 软链接到源项目；existsSync 会跟随软链接，断链时误报本 worktree 缺依赖入口。
 * @param {string} entryPath - 依赖目录或软链接路径
 * @returns {boolean} 路径入口是否是目录或软链接
 */
function dependencyEntryExists(entryPath) {
  try {
    // entryStat 存储路径入口本身的文件状态；lstat 不会跟随软链接目标。
    const entryStat = lstatSync(entryPath)
    return entryStat.isDirectory() || entryStat.isSymbolicLink()
  } catch (e) {
    return false
  }
}

/**
 * 判断项目是否声明了 Docker 运行配置。
 * @param {string} projectDir - 项目目录
 * @returns {boolean} 是否存在常见 Docker / Compose 配置文件
 */
function hasDockerRuntimeConfig(projectDir) {
  return DOCKER_RUNTIME_FILE_HINTS.some((file) => {
    // dockerFilePath 存储当前候选 Docker 配置的绝对路径。
    const dockerFilePath = join(projectDir, file)
    return existsSync(dockerFilePath)
  })
}

/**
 * 返回项目目录最后一段名称，用于 UI 摘要和问题前缀。
 * @param {string} projectDir - 项目目录绝对路径
 * @returns {string} 项目目录名
 */
function projectNameOf(projectDir) {
  // 先归一化为正斜杠（Windows 下 realpathSync/join 返回反斜杠，split('/') 切不开），
  // 再用 split 取最后一段；macOS 上 replace 是 no-op，行为与修改前完全一致
  const parts = String(projectDir || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
  return parts[parts.length - 1] || String(projectDir || '')
}

/**
 * 统计候选依赖在 package.json 依赖集合中的命中情况。
 * @param {Record<string,string>} deps - 合并后的 dependencies/devDependencies
 * @param {string[]} hints - 候选依赖名列表
 * @param {string} prefix - 命中原因前缀
 * @returns {{score:number,reasons:string[]}} 命中分数与原因
 */
function scorePackageHints(deps, hints, prefix) {
  // reasons 累积命中的依赖说明，展示给用户理解系统为何这样判断
  const reasons = []
  // score 命中分数：每个依赖命中记 2 分，比文件和脚本更可信
  let score = 0
  for (const name of hints) {
    if (Object.prototype.hasOwnProperty.call(deps, name)) {
      score += 2
      reasons.push(`${prefix}依赖 ${name}`)
    }
  }
  return { score, reasons }
}

/**
 * 统计候选名称片段在项目名中的命中情况。
 * @param {string} projectName - 项目目录名或 package name
 * @param {string[]} hints - 候选名称片段
 * @param {string} prefix - 命中原因前缀
 * @returns {{score:number,reasons:string[]}} 命中分数与原因
 */
function scoreNameHints(projectName, hints, prefix) {
  // normalized 为小写项目名，便于大小写无关匹配
  const normalized = String(projectName || '').toLowerCase()
  // reasons 累积命中的名称说明
  const reasons = []
  // score 命中分数：项目命名是辅助证据，每个命中记 1 分
  let score = 0
  for (const hint of hints) {
    if (normalized.includes(hint.toLowerCase())) {
      score += 1
      reasons.push(`${prefix}名称 ${hint}`)
    }
  }
  return { score, reasons }
}

/**
 * 统计候选脚本文本在 package scripts 中的命中情况。
 * @param {string} scriptsText - package.json scripts 拼接文本
 * @param {Array<string|{label:string,pattern:RegExp}>} hints - 候选脚本关键字或正则规则
 * @param {string} prefix - 命中原因前缀
 * @returns {{score:number,reasons:string[]}} 命中分数与原因
 */
function scoreScriptHints(scriptsText, hints, prefix) {
  // normalized 为小写脚本文本，便于大小写无关匹配
  const normalized = String(scriptsText || '').toLowerCase()
  // reasons 累积命中的脚本说明
  const reasons = []
  // score 命中分数：脚本命中记 1 分，作为辅助判断
  let score = 0
  for (const hint of hints) {
    // label 为用户可读的脚本命中说明；pattern 为更精确的匹配规则
    const label = typeof hint === 'string' ? hint : hint.label
    const pattern = typeof hint === 'string' ? null : hint.pattern
    // matched 标记当前规则是否命中；字符串规则保留兼容，正则规则避免 vitest/node 构建脚本误判
    const matched = pattern
      ? pattern.test(normalized)
      : normalized.includes(label.toLowerCase())
    if (matched) {
      score += 1
      reasons.push(`${prefix}脚本 ${label}`)
    }
  }
  return { score, reasons }
}

/**
 * 统计候选文件在项目目录中的命中情况。
 * @param {string} projectDir - 项目目录绝对路径
 * @param {string[]} hints - 候选相对路径列表
 * @param {string} prefix - 命中原因前缀
 * @returns {{score:number,reasons:string[]}} 命中分数与原因
 */
function scoreFileHints(projectDir, hints, prefix) {
  // reasons 累积命中的文件说明
  const reasons = []
  // score 命中分数：文件命中记 1 分，帮助识别非 Node 或简化项目
  let score = 0
  for (const rel of hints) {
    if (existsSync(join(projectDir, rel))) {
      score += 1
      reasons.push(`${prefix}文件 ${rel}`)
    }
  }
  return { score, reasons }
}

/**
 * 自动识别项目类型（前端/小程序/后端/具体语言后端/全栈/未知），不依赖用户手动配置目录角色。
 * WHY：worktree 创建后需要立即自动检查环境，类型判断必须来自项目自身特征，而不是设置里的人工映射。
 * @param {string} projectDir - 项目目录绝对路径
 * @returns {{kind:'frontend'|'miniprogram'|'backend'|'backend_php'|'backend_java'|'backend_python'|'fullstack'|'unknown', label:string, confidence:number, reasons:string[]}} 识别结果
 */
export function detectProjectKind(projectDir) {
  // projectName 为目录名；某些历史项目 package.name 不可靠，目录名反而最接近仓库真实类型
  const projectName = projectNameOf(projectDir)
  // pkgPath 为 package.json 路径；没有时仍可通过 pom.xml/go.mod 等文件识别后端
  const pkgPath = join(projectDir, 'package.json')
  // pkg 为 package.json 内容；解析失败时按空对象处理
  const pkg = existsSync(pkgPath) ? readJson(pkgPath) || {} : {}
  // packageName 为 package.json name；与目录名合并后用于命名特征识别
  const packageName = pkg.name || ''
  // searchableName 合并目录名和 package name，避免 hybrid-mobile 这类仓库 package.name 写成 mobile_end 时漏判
  const searchableName = `${projectName} ${packageName}`
  // deps 合并运行时依赖与开发依赖，便于一次性匹配框架/工具特征
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  // scriptsText 拼接全部 scripts 命令，用于识别启动/构建工具
  const scriptsText = Object.values(pkg.scripts || {}).join(' ')

  // miniprogramScore/miniprogramReasons 累积小程序特征分数和命中原因
  let miniprogramScore = 0
  const miniprogramReasons = []
  // frontendScore/frontendReasons 累积前端特征分数和命中原因
  let frontendScore = 0
  const frontendReasons = []
  // backendScore/backendReasons 累积后端特征分数和命中原因
  let backendScore = 0
  const backendReasons = []
  // phpScore/phpReasons 累积 PHP 后端特征分数和命中原因
  let phpScore = 0
  const phpReasons = []
  // javaScore/javaReasons 累积 Java 后端特征分数和命中原因
  let javaScore = 0
  const javaReasons = []
  // pythonScore/pythonReasons 累积 Python 后端特征分数和命中原因
  let pythonScore = 0
  const pythonReasons = []

  // miniprogramName 命中的小程序命名特征；公司仓库命名在这里是强业务信号
  const miniprogramName = scoreNameHints(
    searchableName,
    MINIPROGRAM_NAME_HINTS,
    '小程序'
  )
  miniprogramScore += miniprogramName.score
  miniprogramReasons.push(...miniprogramName.reasons)
  // miniprogramPackage 命中的小程序依赖特征
  const miniprogramPackage = scorePackageHints(
    deps,
    MINIPROGRAM_PACKAGE_HINTS,
    '小程序'
  )
  miniprogramScore += miniprogramPackage.score
  miniprogramReasons.push(...miniprogramPackage.reasons)
  // miniprogramFiles 命中的小程序文件特征
  const miniprogramFiles = scoreFileHints(
    projectDir,
    MINIPROGRAM_FILE_HINTS,
    '小程序'
  )
  miniprogramScore += miniprogramFiles.score
  miniprogramReasons.push(...miniprogramFiles.reasons)
  // frontendName 命中的前端命名特征，帮助 web-app 这类历史工程保持前端归类
  const frontendName = scoreNameHints(
    searchableName,
    FRONTEND_NAME_HINTS,
    '前端'
  )
  frontendScore += frontendName.score
  frontendReasons.push(...frontendName.reasons)
  // frontendPackage 命中的前端依赖特征
  const frontendPackage = scorePackageHints(
    deps,
    FRONTEND_PACKAGE_HINTS,
    '前端'
  )
  frontendScore += frontendPackage.score
  frontendReasons.push(...frontendPackage.reasons)
  // backendPackage 命中的后端依赖特征
  const backendPackage = scorePackageHints(deps, BACKEND_PACKAGE_HINTS, '后端')
  backendScore += backendPackage.score
  backendReasons.push(...backendPackage.reasons)
  // frontendScript 命中的前端脚本特征
  const frontendScript = scoreScriptHints(
    scriptsText,
    FRONTEND_SCRIPT_HINTS,
    '前端'
  )
  frontendScore += frontendScript.score
  frontendReasons.push(...frontendScript.reasons)
  // backendScript 命中的后端脚本特征
  const backendScript = scoreScriptHints(
    scriptsText,
    BACKEND_SCRIPT_HINTS,
    '后端'
  )
  backendScore += backendScript.score
  backendReasons.push(...backendScript.reasons)
  // frontendFiles 命中的前端文件特征
  const frontendFiles = scoreFileHints(projectDir, FRONTEND_FILE_HINTS, '前端')
  frontendScore += frontendFiles.score
  frontendReasons.push(...frontendFiles.reasons)
  // backendFiles 命中的后端文件特征
  const backendFiles = scoreFileHints(projectDir, BACKEND_FILE_HINTS, '后端')
  backendScore += backendFiles.score
  backendReasons.push(...backendFiles.reasons)
  // phpFiles 命中的 PHP 后端文件特征
  const phpFiles = scoreFileHints(
    projectDir,
    PHP_BACKEND_FILE_HINTS,
    'PHP 后端'
  )
  phpScore += phpFiles.score
  phpReasons.push(...phpFiles.reasons)
  // javaFiles 命中的 Java 后端文件特征
  const javaFiles = scoreFileHints(
    projectDir,
    JAVA_BACKEND_FILE_HINTS,
    'Java 后端'
  )
  javaScore += javaFiles.score
  javaReasons.push(...javaFiles.reasons)
  // pythonFiles 命中的 Python 后端文件特征
  const pythonFiles = scoreFileHints(
    projectDir,
    PYTHON_BACKEND_FILE_HINTS,
    'Python 后端'
  )
  pythonScore += pythonFiles.score
  pythonReasons.push(...pythonFiles.reasons)

  // hasMiniprogram 小程序优先：它属于前端子类型，但 UI 需要比“前端”更精确的展示
  const hasMiniprogram = miniprogramScore > 0
  // typedBackendCandidates 存储具体后端语言候选，按分数选最高者。
  const typedBackendCandidates = [
    { kind: 'backend_php', score: phpScore, reasons: phpReasons },
    { kind: 'backend_java', score: javaScore, reasons: javaReasons },
    { kind: 'backend_python', score: pythonScore, reasons: pythonReasons },
  ]
  // typedBackend 存储命中的具体语言后端；分数相同时保持 PHP/Java/Python 的稳定顺序。
  const typedBackend = typedBackendCandidates
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)[0]
  // hasFrontend/hasBackend 标记是否达到可置信的类型阈值
  const hasFrontend = frontendScore > 0
  const hasBackend = backendScore > 0 || !!typedBackend
  // kind 为最终类型：同时命中则视为全栈，否则取命中侧，完全无命中为未知
  const kind = hasMiniprogram
    ? 'miniprogram'
    : typedBackend
      ? typedBackend.kind
      : hasFrontend && hasBackend
        ? 'fullstack'
        : hasFrontend
          ? 'frontend'
          : hasBackend
            ? 'backend'
            : 'unknown'
  // reasons 为最终展示原因；未知项目给出兜底说明，避免详情为空
  const reasons =
    kind === 'unknown'
      ? ['未命中常见前端/后端/小程序/PHP/Java/Python 特征，跳过环境检查']
      : kind === 'miniprogram'
        ? [...miniprogramReasons, ...frontendReasons]
        : typedBackend
          ? typedBackend.reasons
          : [...frontendReasons, ...backendReasons]
  // confidence 为简化置信度：最高 1，分数越高越接近 1
  const confidence =
    kind === 'unknown'
      ? 0
      : Math.min(
          1,
          (miniprogramScore +
            frontendScore +
            backendScore +
            phpScore +
            javaScore +
            pythonScore) /
            6
        )

  return {
    kind,
    label: PROJECT_KIND_LABELS[kind],
    confidence,
    reasons,
  }
}

/**
 * 判断项目类型是否应进入环境健康检查。
 * @param {string} kind - detectProjectKind 返回的项目类型
 * @returns {boolean} 是否属于前端/后端/小程序/全栈等可检查业务项目
 */
function isCheckableProjectKind(kind) {
  return CHECKABLE_PROJECT_KINDS.has(kind)
}

/**
 * 从任务目录候选子目录中收集需要执行环境检查的项目。
 * WHY：superpowers、docs、openspec 等工具/文档目录可能也有 package.json，但它们不是本应用要判断的前后端运行环境。
 * @param {string[]} projectDirs - 任务目录下候选项目目录绝对路径列表
 * @returns {Array<{dir:string,kindInfo:ReturnType<typeof detectProjectKind>}>} 可检查项目目录与识别信息
 */
function collectCheckableProjectEntries(projectDirs) {
  // entries 累积通过类型识别过滤后的业务项目目录。
  const entries = []
  for (const dir of projectDirs) {
    // kindInfo 存储当前目录的自动识别结果，后续 checkProject 复用，避免重复读取 package.json。
    const kindInfo = detectProjectKind(dir)
    if (isCheckableProjectKind(kindInfo.kind)) entries.push({ dir, kindInfo })
  }
  return entries
}

/**
 * 从文本中提取端口号（匹配 --port 3000 / PORT=3000 / :3000 等常见写法）。
 * @param {string} text - 待扫描文本（通常是 package.json scripts 拼接）
 * @returns {number[]} 去重后的端口号列表
 */
function extractPorts(text) {
  // ports 累积命中的端口号
  const ports = new Set()
  // 匹配 --port 3000 / --port=3000 / -p 3000
  for (const m of text.matchAll(/-{1,2}p(?:ort)?[=\s]+(\d{2,5})/gi))
    ports.add(Number(m[1]))
  // 匹配 PORT=3000 / PORT 3000
  for (const m of text.matchAll(/\bPORT[=\s]+(\d{2,5})/g))
    ports.add(Number(m[1]))
  // 匹配 :3000（如 localhost:3000、0.0.0.0:8080）
  for (const m of text.matchAll(/:(\d{4,5})\b/g)) ports.add(Number(m[1]))
  // 过滤明显非法端口
  return [...ports].filter((p) => p >= 1 && p <= 65535)
}

/**
 * 判断项目类型是否应按 Node 依赖目录检查。
 * @param {string} kind - 项目类型
 * @returns {boolean} 是否使用 Node 依赖检查
 */
function isNodeDependencyProjectKind(kind) {
  return NODE_DEPENDENCY_PROJECT_KINDS.has(kind)
}

/**
 * 检查 Node 项目的依赖一致性（package.json / lock / node_modules）。
 * @param {string} projectDir - 项目目录
 * @returns {{status:string, message:string, fixes:string[]}} 检查结果
 */
function checkNodeProjectDeps(projectDir) {
  // pkgPath 为项目 package.json 路径
  const pkgPath = join(projectDir, 'package.json')
  // 非 Node 项目（无 package.json）：跳过，不算问题
  if (!existsSync(pkgPath))
    return {
      status: 'ok',
      message: '非 Node 项目，跳过 Node 依赖检查',
      fixes: [],
      skipped: true,
    }

  // nodeModulesPath 存储当前项目依赖目录入口路径，可能是真实目录，也可能是 worktree 复用源项目依赖的软链接。
  const nodeModulesPath = join(projectDir, 'node_modules')
  // hasNodeModules 是否已安装依赖目录
  const hasNodeModules = dependencyEntryExists(nodeModulesPath)
  // hasLock 是否存在任一锁文件
  const hasLock = LOCK_FILES.some((f) => existsSync(join(projectDir, f)))

  // 未安装依赖：最常见的「环境没装好」场景，给出安装建议
  if (!hasNodeModules) {
    // installCmd 依据锁文件类型推荐对应包管理器安装命令
    const installCmd = existsSync(join(projectDir, 'pnpm-lock.yaml'))
      ? 'pnpm install'
      : existsSync(join(projectDir, 'yarn.lock'))
        ? 'yarn install'
        : 'npm install'
    return {
      status: 'error',
      message: '未安装依赖（缺少 node_modules）',
      fixes: [`在 ${projectDir} 运行 ${installCmd}`],
    }
  }
  // 有依赖但无锁文件：依赖版本不确定，提示补锁文件
  if (!hasLock) {
    return {
      status: 'warning',
      message: '已安装依赖但缺少 lock 文件，依赖版本不确定',
      fixes: ['提交 lock 文件以锁定依赖版本'],
    }
  }
  return {
    status: 'ok',
    message: '依赖完整（node_modules + lock 齐备）',
    fixes: [],
  }
}

/**
 * 检查 PHP 项目的 Composer 依赖一致性。
 * @param {string} projectDir - 项目目录
 * @returns {{status:string, message:string, fixes:string[], skipped?:boolean}} 检查结果
 */
function checkPhpProjectDeps(projectDir) {
  // composerPath 存储 Composer 依赖声明文件路径。
  const composerPath = join(projectDir, 'composer.json')
  if (!existsSync(composerPath)) {
    return {
      status: 'ok',
      message: 'PHP 项目未声明 composer.json，跳过 Composer 依赖检查',
      fixes: [],
      skipped: true,
    }
  }

  // hasVendor 存储 Composer 安装后的 vendor 目录是否存在。
  const hasVendor = existsSync(join(projectDir, 'vendor'))
  // hasComposerLock 存储 Composer 锁文件是否存在，用于判断依赖版本是否固定。
  const hasComposerLock = existsSync(join(projectDir, 'composer.lock'))
  // hasDockerRuntime 存储项目是否存在 Docker 运行配置；容器场景下 vendor 可能在镜像内或启动时准备。
  const hasDockerRuntime = hasDockerRuntimeConfig(projectDir)

  // Docker 运行场景下，本机 worktree 缺少 vendor 不代表容器里的 PHP 服务不可用。
  if (!hasVendor && hasDockerRuntime) {
    return {
      status: 'ok',
      message: '检测到 Docker 运行配置，跳过本机 PHP vendor 检查',
      fixes: [],
      skipped: true,
    }
  }
  if (!hasVendor) {
    return {
      status: 'error',
      message: '未安装 PHP 依赖（缺少 vendor）',
      fixes: [`在 ${projectDir} 运行 composer install`],
    }
  }
  if (!hasComposerLock) {
    return {
      status: 'warning',
      message: 'PHP 依赖已安装但缺少 composer.lock，依赖版本不确定',
      fixes: ['提交 composer.lock 以锁定依赖版本'],
    }
  }
  return {
    status: 'ok',
    message: 'PHP 依赖完整（vendor + composer.lock 齐备）',
    fixes: [],
  }
}

/**
 * 检查 Java 项目的依赖声明。
 * WHY：Maven/Gradle 依赖通常在用户级缓存中，不适合按项目目录强制检查本地依赖文件夹。
 * @param {string} projectDir - 项目目录
 * @returns {{status:string, message:string, fixes:string[], skipped?:boolean}} 检查结果
 */
function checkJavaProjectDeps(projectDir) {
  // hasBuildFile 存储是否存在 Maven 或 Gradle 构建文件。
  const hasBuildFile = JAVA_BACKEND_FILE_HINTS.some((file) =>
    existsSync(join(projectDir, file))
  )
  if (!hasBuildFile) {
    return {
      status: 'warning',
      message: '未发现 Java 构建文件（pom.xml / build.gradle）',
      fixes: ['确认项目根目录是否正确'],
    }
  }
  return {
    status: 'ok',
    message: 'Java 依赖由 Maven/Gradle 缓存管理，跳过本地依赖目录检查',
    fixes: [],
    skipped: true,
  }
}

/**
 * 检查 Python 项目的依赖环境。
 * @param {string} projectDir - 项目目录
 * @returns {{status:string, message:string, fixes:string[], skipped?:boolean}} 检查结果
 */
function checkPythonProjectDeps(projectDir) {
  // hasDependencyFile 存储是否存在 Python 依赖声明文件。
  const hasDependencyFile = [
    'requirements.txt',
    'pyproject.toml',
    'Pipfile',
  ].some((file) => existsSync(join(projectDir, file)))
  if (!hasDependencyFile) {
    return {
      status: 'ok',
      message: 'Python 项目未发现依赖声明文件，跳过依赖检查',
      fixes: [],
      skipped: true,
    }
  }
  // hasVirtualEnv 存储项目内常见虚拟环境目录是否存在。
  const hasVirtualEnv = ['.venv', 'venv'].some((dir) =>
    existsSync(join(projectDir, dir))
  )
  if (!hasVirtualEnv) {
    return {
      status: 'warning',
      message: '未发现 Python 虚拟环境（.venv / venv）',
      fixes: [`在 ${projectDir} 创建虚拟环境并安装依赖`],
    }
  }
  return {
    status: 'ok',
    message: 'Python 依赖环境已准备（虚拟环境存在）',
    fixes: [],
  }
}

/**
 * 按项目类型检查依赖一致性。
 * @param {string} projectDir - 项目目录
 * @param {ReturnType<typeof detectProjectKind>} [kindInfo] - 项目类型识别结果
 * @returns {{status:string, message:string, fixes:string[], skipped?:boolean}} 检查结果
 */
function checkProjectDeps(projectDir, kindInfo = null) {
  // projectKind 存储当前项目类型；缺少时现场识别以兼容聚合检查调用。
  const projectKind = kindInfo?.kind || detectProjectKind(projectDir).kind
  if (projectKind === 'backend_php') return checkPhpProjectDeps(projectDir)
  if (projectKind === 'backend_java') return checkJavaProjectDeps(projectDir)
  if (projectKind === 'backend_python')
    return checkPythonProjectDeps(projectDir)
  if (isNodeDependencyProjectKind(projectKind))
    return checkNodeProjectDeps(projectDir)
  return {
    status: 'ok',
    message: '非前后端运行项目，跳过依赖检查',
    fixes: [],
    skipped: true,
  }
}

/**
 * 从项目配置文件中提取通用端口声明。
 * @param {string} projectDir - 项目目录
 * @returns {number[]} 去重后的端口号列表
 */
function extractProjectConfigPorts(projectDir) {
  // configFiles 存储非 Node 项目里常见的端口声明文件。
  const configFiles = [
    '.env',
    '.env.local',
    '.env.development',
    'application.properties',
    'application.yml',
    'application.yaml',
  ]
  // ports 存储从配置文件内容中提取出的端口集合。
  const ports = new Set()

  for (const file of configFiles) {
    // filePath 存储当前候选配置文件的绝对路径。
    const filePath = join(projectDir, file)
    if (!existsSync(filePath)) continue
    try {
      for (const port of extractPorts(readFileSync(filePath, 'utf8')))
        ports.add(port)
    } catch (e) {
      // 单个配置文件读取失败不阻断整体端口检查。
    }
  }

  return [...ports]
}

/**
 * 探测一组本机端口是否被占用。
 * @param {number[]} ports - 待探测端口号列表
 * @returns {Promise<number[]>} 已被占用的端口号列表
 */
async function collectOccupiedPorts(ports) {
  // occupied 累积已被占用的端口（本机有服务在监听）
  const occupied = []
  await Promise.all(
    ports.map(async (port) => {
      // 探测本机回环地址该端口是否有服务监听
      if (await probeTcp('127.0.0.1', port)) occupied.push(port)
    })
  )
  return occupied
}

/**
 * 把端口探测结果转换成统一检查项。
 * @param {number[]} ports - 待探测端口号列表
 * @param {string} emptyMessage - 未发现端口声明时的提示
 * @returns {Promise<{status:string, message:string, fixes:string[], occupied:number[], skipped?:boolean}>} 检查结果
 */
async function buildPortCheckResult(ports, emptyMessage) {
  // 未声明端口：无需检查
  if (ports.length === 0)
    return {
      status: 'ok',
      message: emptyMessage,
      fixes: [],
      occupied: [],
      skipped: true,
    }

  // occupied 存储当前已被占用的端口。
  const occupied = await collectOccupiedPorts(ports)
  if (occupied.length > 0) {
    return {
      status: 'warning',
      message: `端口被占用：${occupied.join(', ')}`,
      fixes: occupied.map((p) => `查看占用进程：lsof -i :${p}，必要时 kill`),
      occupied,
    }
  }
  return {
    status: 'ok',
    message: `端口空闲：${ports.join(', ')}`,
    fixes: [],
    occupied: [],
  }
}

/**
 * 检查单个项目声明的端口是否被占用。
 * @param {string} projectDir - 项目目录
 * @param {ReturnType<typeof detectProjectKind>} [kindInfo] - 项目类型识别结果
 * @returns {Promise<{status:string, message:string, fixes:string[], occupied:number[]}>}
 */
async function checkProjectPorts(projectDir, kindInfo = null) {
  // projectKind 存储当前项目类型，用于决定从 package scripts 还是通用配置中读取端口。
  const projectKind = kindInfo?.kind || detectProjectKind(projectDir).kind
  // pkgPath 为项目 package.json 路径
  const pkgPath = join(projectDir, 'package.json')
  if (!existsSync(pkgPath) || !isNodeDependencyProjectKind(projectKind)) {
    // ports 存储 PHP/Java/Python 等非 Node 项目配置中声明的端口。
    const ports = extractProjectConfigPorts(projectDir)
    return buildPortCheckResult(ports, '未发现端口声明')
  }

  // ports 从 scripts 文本中提取的候选端口
  let ports
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    // scriptsText 拼接所有 npm script 命令文本用于端口提取
    const scriptsText = Object.values(pkg.scripts || {}).join(' ')
    ports = extractPorts(scriptsText)
  } catch (e) {
    return {
      status: 'warning',
      message: 'package.json 解析失败',
      fixes: [],
      occupied: [],
    }
  }
  return buildPortCheckResult(ports, '未在 scripts 中发现端口声明')
}

/**
 * 从 .env 文本中提取需要探测连通性的 host:port 列表（数据库/Redis/通用 URL）。
 * @param {string} envText - .env 文件内容
 * @returns {Array<{key:string, host:string, port:number}>} 待探测地址列表
 */
function extractEnvEndpoints(envText) {
  // endpoints 累积从 .env 解析出的待探测地址
  const endpoints = []
  for (const rawLine of envText.split('\n')) {
    // 跳过注释与空行
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    // eqIdx 为 key=value 的分隔位置
    const eqIdx = line.indexOf('=')
    if (eqIdx < 0) continue
    // key/value 为环境变量名与值（去引号）
    const key = line.slice(0, eqIdx).trim()
    const value = line
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
    if (!value) continue

    // 形如 scheme://[user:pass@]host:port[/...] 的连接串：提取 host 和 port
    const urlMatch = value.match(
      /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^:/?#]+):(\d{2,5})/i
    )
    if (urlMatch) {
      endpoints.push({ key, host: urlMatch[1], port: Number(urlMatch[2]) })
      continue
    }
    // 形如 host:port 的裸地址（如 REDIS_HOST 不带 scheme 的情况较少见，做兜底）
    const hostPortMatch = value.match(/^([a-z0-9.-]+):(\d{2,5})$/i)
    if (hostPortMatch) {
      endpoints.push({
        key,
        host: hostPortMatch[1],
        port: Number(hostPortMatch[2]),
      })
    }
  }
  return endpoints
}

/**
 * 检查单个项目 .env 中声明的外部服务连通性。
 * @param {string} projectDir - 项目目录
 * @returns {Promise<{status:string, message:string, fixes:string[], unreachable:string[]}>}
 */
async function checkProjectServices(projectDir) {
  // envText 累积项目下各 .env 文件内容
  let envText = ''
  // 常见 env 文件名都纳入扫描
  for (const name of ['.env', '.env.local', '.env.development']) {
    const p = join(projectDir, name)
    if (existsSync(p)) {
      try {
        envText += readFileSync(p, 'utf8') + '\n'
      } catch (e) {
        // 单个文件读失败跳过
      }
    }
  }
  // 无 .env：无外部服务声明，跳过
  if (!envText.trim())
    return {
      status: 'ok',
      message: '无 .env，跳过服务检查',
      fixes: [],
      unreachable: [],
    }

  // endpoints 从 .env 解析出的待探测地址
  const endpoints = extractEnvEndpoints(envText)
  if (endpoints.length === 0)
    return {
      status: 'ok',
      message: '.env 中未发现 host:port 形式的服务地址',
      fixes: [],
      unreachable: [],
    }

  // unreachable 累积不可达的服务（key host:port 形式）
  const unreachable = []
  await Promise.all(
    endpoints.map(async (ep) => {
      // 探测该地址是否可建立 TCP 连接
      if (!(await probeTcp(ep.host, ep.port)))
        unreachable.push(`${ep.key} (${ep.host}:${ep.port})`)
    })
  )

  if (unreachable.length > 0) {
    return {
      status: 'error',
      message: `服务不可达：${unreachable.join('；')}`,
      fixes: ['确认对应服务已启动，或检查 .env 中地址/端口是否正确'],
      unreachable,
    }
  }
  return {
    status: 'ok',
    message: `服务可达（${endpoints.length} 个）`,
    fixes: [],
    unreachable: [],
  }
}

/**
 * 检查单个项目的 Git 状态（未提交改动 / 领先落后远程）。
 * @param {string} projectDir - 项目目录
 * @returns {Promise<{status:string, message:string, fixes:string[]}>}
 */
async function checkProjectGit(projectDir) {
  // 非 git 仓库：跳过
  if (!existsSync(join(projectDir, '.git')))
    return { status: 'ok', message: '非 git 仓库，跳过', fixes: [] }
  try {
    const git = simpleGit(projectDir)
    // status 当前工作区状态（含 ahead/behind/files）
    const status = await git.status()
    // notes 累积需要提示的问题片段
    const notes = []
    if (!status.isClean()) notes.push(`${status.files.length} 个未提交改动`)
    if (status.behind > 0) notes.push(`落后远程 ${status.behind}`)
    if (status.ahead > 0) notes.push(`领先远程 ${status.ahead}`)

    // 有未提交改动或落后远程：提示但不算致命错误（warning）
    if (notes.length > 0) {
      // fixes 依据具体情况给出建议
      const fixes = []
      if (!status.isClean())
        fixes.push('提交或暂存改动：git add -A && git commit / git stash')
      if (status.behind > 0) fixes.push('拉取更新：git pull')
      return { status: 'warning', message: notes.join('，'), fixes }
    }
    return { status: 'ok', message: '工作区干净，与远程同步', fixes: [] }
  } catch (e) {
    return {
      status: 'warning',
      message: `git 状态检查失败：${e.message}`,
      fixes: [],
    }
  }
}

/**
 * 合并多个项目的同类检查结果为一个聚合结果。
 * 状态取最严重者（error > warning > ok），message/fixes 按项目前缀汇总。
 * @param {Array<{dir:string, result:{status:string, message:string, fixes:string[]}}>} items - 各项目结果
 * @returns {{status:string, message:string, fixes:string[]}} 聚合结果
 */
function mergeResults(items) {
  // 无项目：直接返回 ok
  if (items.length === 0) return { status: 'ok', message: '无项目', fixes: [] }
  // severity 状态严重度排序，用于取最严重状态
  const severity = { ok: 0, warning: 1, error: 2 }
  // worst 累积当前最严重状态
  let worst = 'ok'
  // messages/fixes 累积带项目名前缀的信息
  const messages = []
  const fixes = []
  for (const { dir, result } of items) {
    // projName 取项目目录最后一段作为简短前缀；先归一化反斜杠再 split，兼容 Windows 路径
    const projName =
      dir.replace(/\\/g, '/').split('/').filter(Boolean).pop() || dir
    if (severity[result.status] > severity[worst]) worst = result.status
    // 仅非 ok 项计入消息，减少噪音；全 ok 时下方统一给「全部正常」
    if (result.status !== 'ok') messages.push(`[${projName}] ${result.message}`)
    for (const f of result.fixes || []) fixes.push(`[${projName}] ${f}`)
  }
  // 全部正常：给出简洁正向反馈，附带其中一个项目的 message 作为说明
  if (messages.length === 0)
    return { status: 'ok', message: items[0].result.message, fixes: [] }
  return { status: worst, message: messages.join('；'), fixes }
}

/**
 * 把单个项目的环境检查结果整理成 UI 可直接展示的问题列表。
 * @param {{deps:object, ports:object, services:object, git:object}} checks - 单项目检查结果
 * @returns {Array<{key:string,label:string,status:string,message:string,fixes:string[]}>} 非 ok 环境检查项列表
 */
function collectIssues(checks) {
  // issues 累积 warning/error 环境检查项；Git 明细仍展示，但不计入环境问题聚合。
  const issues = []
  for (const key of ENVIRONMENT_ISSUE_CHECK_KEYS) {
    // item 为当前检查项结果，缺失时按错误处理以便问题可见
    const item = checks[key] || {
      status: 'error',
      message: '检查结果缺失',
      fixes: [],
    }
    if (item.status !== 'ok') {
      issues.push({
        key,
        label: CHECK_LABELS[key],
        status: item.status,
        message: item.message,
        fixes: item.fixes || [],
      })
    }
  }
  return issues
}

/**
 * 根据项目内的问题列表计算项目级状态。
 * @param {Array<{status:string}>} issues - warning/error 环境检查项列表
 * @returns {'ok'|'warning'|'failed'} 项目级状态
 */
function getProjectStatusFromIssues(issues) {
  // hasError 存储是否存在真正错误项；只有 error 才需要任务列表红色展示。
  const hasError = issues.some((issue) => issue.status === 'error')
  if (hasError) return 'failed'
  // hasWarning 存储是否存在环境提示项；非环境类 Git warning 不参与这里的状态计算。
  const hasWarning = issues.some((issue) => issue.status === 'warning')
  return hasWarning ? 'warning' : 'ok'
}

/**
 * 检查单个项目并返回项目级详情（类型、状态、检查项、问题列表）。
 * @param {string} dir - 项目目录绝对路径
 * @param {ReturnType<typeof detectProjectKind>} [detectedKindInfo] - 已识别的项目类型信息，用于避免重复识别
 * @returns {Promise<object>} 项目级环境检查结果
 */
async function checkProject(dir, detectedKindInfo = null) {
  // kindInfo 为自动识别出的项目类型和命中原因
  const kindInfo = detectedKindInfo || detectProjectKind(dir)
  // checks 为单项目 4 类检查结果
  const checks = {
    deps: checkProjectDeps(dir, kindInfo),
    ports: await checkProjectPorts(dir, kindInfo),
    services: await checkProjectServices(dir),
    git: await checkProjectGit(dir),
  }
  // issues 为非 ok 环境检查项列表；Git 未提交等工作区提示不计入环境问题。
  const issues = collectIssues(checks)
  // status 为项目环境状态：error 才是 failed，环境 warning-only 保持黄色提示。
  const status = getProjectStatusFromIssues(issues)
  // name 为项目目录名，用于任务级汇总和 UI 标题
  const name = projectNameOf(dir)
  return {
    name,
    dir,
    path: dir,
    kind: kindInfo.kind,
    kindLabel: kindInfo.label,
    confidence: kindInfo.confidence,
    reasons: kindInfo.reasons,
    status,
    issueCount: issues.length,
    issues,
    checks,
  }
}

/**
 * 汇总全部项目的环境检查状态，供任务行红/绿状态使用。
 * @param {Array<{name:string,status:string,issueCount:number}>} projects - 项目级检查结果列表
 * @returns {{status:'ok'|'warning'|'failed', projectCount:number, issueCount:number, failedProjects:string[], message:string}} 任务级汇总
 */
function summarizeProjects(projects) {
  // projectCount 为任务下项目数量
  const projectCount = projects.length
  // issueCount 为所有项目非 ok 环境检查项总数，Git 工作区提示不计入。
  const issueCount = projects.reduce(
    (sum, project) => sum + (project.issueCount || 0),
    0
  )
  // failedProjects 保持历史字段名，实际存储所有非 ok 项目名，兼容旧 UI 读取。
  const failedProjects = projects
    .filter((project) => project.status !== 'ok')
    .map((project) => project.name)
  // hasFailed 存储是否存在真正错误项目，用于决定是否红色展示。
  const hasFailed = projects.some((project) => project.status === 'failed')
  // hasWarning 存储是否存在 warning-only 项目，用于决定是否黄色展示。
  const hasWarning = projects.some((project) => project.status === 'warning')
  // status 为任务级总状态：error 红色，warning 黄色，全部正常绿色。
  const status = hasFailed ? 'failed' : hasWarning ? 'warning' : 'ok'
  // message 为任务行 tooltip 与详情顶部摘要文案
  const message =
    projectCount === 0
      ? '任务目录下未找到项目'
      : status === 'ok'
        ? `${projectCount} 个项目环境正常`
        : `${failedProjects.length} 个项目存在 ${issueCount} 个环境问题`
  return { status, projectCount, issueCount, failedProjects, message }
}

/**
 * 对一组项目目录并行执行 4 类检查并聚合（供「全部」与「按角色分组」复用）。
 * @param {string[]} dirs - 待检查的项目目录绝对路径列表
 * @returns {Promise<{deps:object, ports:object, services:object, git:object}>} 4 项聚合结果
 */
async function checkDirs(dirs) {
  // 4 类检查各自对所有项目并行执行，再聚合；4 类之间也并行（Promise.all）
  const [depsItems, portsItems, servicesItems, gitItems] = await Promise.all([
    Promise.all(
      dirs.map(async (dir) => ({ dir, result: checkProjectDeps(dir) }))
    ),
    Promise.all(
      dirs.map(async (dir) => ({ dir, result: await checkProjectPorts(dir) }))
    ),
    Promise.all(
      dirs.map(async (dir) => ({
        dir,
        result: await checkProjectServices(dir),
      }))
    ),
    Promise.all(
      dirs.map(async (dir) => ({ dir, result: await checkProjectGit(dir) }))
    ),
  ])
  return {
    deps: mergeResults(depsItems),
    ports: mergeResults(portsItems),
    services: mergeResults(servicesItems),
    git: mergeResults(gitItems),
  }
}

/**
 * 从任务目录下按角色配置筛选出该角色对应的项目目录。
 * 角色的 dirs 列出子目录名，命中则纳入；任务目录下不存在的子目录名忽略。
 * @param {string} taskDir - 任务目录
 * @param {string[]} roleDirs - 该角色声明的子目录名列表
 * @param {string[]} allDirs - 任务目录下实际存在的全部项目目录绝对路径
 * @returns {string[]} 命中该角色的项目目录绝对路径列表
 */
function pickDirsForRole(taskDir, roleDirs, allDirs) {
  // wanted 该角色声明的子目录名集合，用于按目录名匹配
  const wanted = new Set(
    (roleDirs || []).map((d) => String(d).trim()).filter(Boolean)
  )
  // 按「目录最后一段（子目录名）是否在 wanted 中」筛选实际存在的项目目录
  // 先归一化为正斜杠再 split，兼容 Windows 反斜杠；macOS 上为 no-op
  return allDirs.filter((dir) => {
    const name = dir.replace(/\\/g, '/').split('/').filter(Boolean).pop()
    return wanted.has(name)
  })
}

/**
 * 对一个任务目录执行完整环境健康检查（4 项并行，跨项目聚合）。
 * 当传入 roles（前后端等角色配置）且非空时，按角色分别检查并在 byRole 中分组返回；
 * 顶层 deps/ports/services/git 仍为全部项目的聚合，保证调用方旧渲染逻辑兼容。
 * @param {string} taskDir - 任务目录（其下每个子目录是一个项目 worktree）
 * @param {Array<{name:string, dirs:string[]}>} [roles] - 角色配置：{ name 角色名, dirs 该角色的子目录名列表 }
 * @param {{workDocumentTemplates?:Array<{type?:string,path?:string,content?:string}>}} [opts] - 额外选项：工作文档模板用于跳过根级 docs/notes 等目录
 * @returns {Promise<{deps:object, ports:object, services:object, git:object, byRole?:Array}>} 聚合结果（含可选按角色分组）
 */
export async function checkEnvHealth(taskDir, roles = [], opts = {}) {
  // workDocumentTemplates 存储当前配置里的工作文档模板，用于避免 docs 等文档目录被误扫成项目。
  const workDocumentTemplates = opts?.workDocumentTemplates
  // projectDirs 任务目录下的项目列表
  const projectDirs = listProjectDirs(taskDir, workDocumentTemplates)
  // 无项目：4 项统一返回正常提示；空任务目录不是环境故障。
  if (projectDirs.length === 0) {
    // empty 为无项目时的统一结果，供旧详情结构继续展示说明文案。
    const empty = { status: 'ok', message: '任务目录下未找到项目', fixes: [] }
    return {
      deps: empty,
      ports: empty,
      services: empty,
      git: empty,
      summary: {
        status: 'ok',
        projectCount: 0,
        issueCount: 0,
        failedProjects: [],
        message: '任务目录下未找到项目',
      },
      projects: [],
    }
  }

  // projectEntries 存储过滤 unknown 后真正需要检查的业务项目；工具/文档目录不应制造环境问题。
  const projectEntries = collectCheckableProjectEntries(projectDirs)
  // checkableDirs 存储可检查项目目录，供角色分组复用。
  const checkableDirs = projectEntries.map((entry) => entry.dir)
  if (projectEntries.length === 0) {
    // skipped 为仅发现非前后端目录时的统一结果；它不是环境异常，因此展示为 ok。
    const skipped = {
      status: 'ok',
      message: '未发现需要环境检查的前后端项目',
      fixes: [],
    }
    return {
      deps: skipped,
      ports: skipped,
      services: skipped,
      git: skipped,
      summary: {
        status: 'ok',
        projectCount: 0,
        issueCount: 0,
        failedProjects: [],
        message: '未发现需要环境检查的前后端项目',
      },
      projects: [],
    }
  }

  // projects 为每个项目的类型识别与检查详情，供新 UI 显示红/绿状态和问题列表
  const projects = await Promise.all(
    projectEntries.map((entry) => checkProject(entry.dir, entry.kindInfo))
  )
  // summary 为任务级汇总状态，供 Worktree 任务行 badge 使用
  const summary = summarizeProjects(projects)
  // aggregate 为全部项目的聚合结果（不论是否配置角色都返回，供顶层卡片渲染）
  const aggregate = {
    deps: mergeResults(
      projects.map((project) => ({
        dir: project.dir,
        result: project.checks.deps,
      }))
    ),
    ports: mergeResults(
      projects.map((project) => ({
        dir: project.dir,
        result: project.checks.ports,
      }))
    ),
    services: mergeResults(
      projects.map((project) => ({
        dir: project.dir,
        result: project.checks.services,
      }))
    ),
    git: mergeResults(
      projects.map((project) => ({
        dir: project.dir,
        result: project.checks.git,
      }))
    ),
    summary,
    projects,
  }

  // validRoles 为有效角色配置（含名称且至少声明一个子目录），无则不分组
  const validRoles = (Array.isArray(roles) ? roles : []).filter(
    (r) =>
      r &&
      String(r.name || '').trim() &&
      Array.isArray(r.dirs) &&
      r.dirs.length > 0
  )
  // 未配置角色：只返回全部聚合，保持原有行为
  if (validRoles.length === 0) return aggregate

  // byRole 累积每个角色的检查结果；命中目录为空的角色也保留并提示
  const byRole = []
  for (const role of validRoles) {
    // dirs 该角色命中的项目目录
    const dirs = pickDirsForRole(taskDir, role.dirs, checkableDirs)
    if (dirs.length === 0) {
      // 该角色声明的子目录在任务目录下都不存在：给出提示，避免静默漏检
      const miss = {
        status: 'warning',
        message: `未找到该角色的目录：${role.dirs.join(', ')}`,
        fixes: [],
      }
      byRole.push({
        name: role.name,
        deps: miss,
        ports: miss,
        services: miss,
        git: miss,
      })
      continue
    }
    // 对该角色命中的目录执行 4 类检查
    const res = await checkDirs(dirs)
    byRole.push({ name: role.name, ...res })
  }

  // 返回时附带 byRole 分组，顶层仍保留全部聚合（向后兼容旧渲染）
  return { ...aggregate, byRole }
}
