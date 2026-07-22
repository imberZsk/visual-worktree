import { homedir } from 'os'
import { join, resolve } from 'path'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { calculateCost, usdToCny } from './claudeService.js'

// CODEX_SESSIONS_RELATIVE_PATH 存储 Codex 本地会话相对用户目录的位置。
const CODEX_SESSIONS_RELATIVE_PATH = ['.codex', 'sessions']

/**
 * 递归收集 Codex sessions 目录中的 JSONL 文件。
 * @param {string} directory - 当前扫描目录
 * @param {Array<string>} files - 用于累积结果的文件列表
 * @param {object} deps - 可注入的文件系统依赖
 * @returns {Array<string>} JSONL 文件路径列表
 */
function collectCodexSessionFiles(directory, files, deps) {
  // readDirectory 存储当前调用采用的目录读取实现。
  const readDirectory = deps.readdirSync || readdirSync
  // pathExists 存储当前调用采用的路径存在判断实现。
  const pathExists = deps.existsSync || existsSync
  if (!pathExists(directory)) return files
  // entries 存储当前目录的文件和子目录项。
  const entries = readDirectory(directory, { withFileTypes: true })
  for (const entry of entries) {
    // entryPath 存储当前目录项的完整路径。
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) collectCodexSessionFiles(entryPath, files, deps)
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(entryPath)
  }
  return files
}

/**
 * 解析单个 Codex 会话文件，提取工作目录、模型和最终累计 Token。
 * @param {string} filePath - Codex JSONL 会话文件路径
 * @param {object} deps - 可注入的文件系统与计价依赖
 * @returns {object|null} 标准化后的会话用量，无有效元数据时返回 null
 */
function parseCodexSession(filePath, deps) {
  // readFile 存储当前调用采用的文件读取实现。
  const readFile = deps.readFileSync || readFileSync
  // lines 存储会话文件中的 JSONL 行。
  const lines = readFile(filePath, 'utf8').split('\n')
  // sessionMeta 存储会话级 cwd、id 和创建时间。
  let sessionMeta = null
  // model 存储最近一次 turn_context 声明的 Codex 模型名。
  let model = ''
  // totalUsage 存储最后一条 token_count 事件中的累计用量。
  let totalUsage = null
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      // record 存储当前 JSONL 行解析后的事件对象。
      const record = JSON.parse(line)
      if (record?.type === 'session_meta') sessionMeta = record.payload || null
      if (record?.type === 'turn_context' && record.payload?.model) model = record.payload.model
      if (record?.type === 'event_msg' && record.payload?.type === 'token_count') {
        // nextUsage 存储当前累计 Token 快照；只保留非空快照覆盖旧值。
        const nextUsage = record.payload?.info?.total_token_usage
        if (nextUsage) totalUsage = nextUsage
      }
    } catch {
      // 单行损坏不影响同一会话中的其他有效 Token 快照。
    }
  }
  if (!sessionMeta?.cwd || !totalUsage) return null
  // cacheRead 存储缓存命中的输入 Token，Codex 的 input_tokens 已包含该值。
  const cacheRead = Number(totalUsage.cached_input_tokens) || 0
  // cacheWrite 存储写入缓存的输入 Token，Codex 的 input_tokens 已包含该值。
  const cacheWrite = Number(totalUsage.cache_write_input_tokens) || 0
  // usage 存储与现有 UI 一致的四类用量；普通输入扣除缓存项以避免重复累计和计费。
  const usage = {
    input: Math.max(0, (Number(totalUsage.input_tokens) || 0) - cacheRead - cacheWrite),
    output: Number(totalUsage.output_tokens) || 0,
    cacheWrite,
    cacheRead,
  }
  // usd 存储按用户自定义规则或未知模型回退价计算出的美元费用。
  const usd = calculateCost(usage, model, deps.tokenPricing)
  return {
    sessionId: sessionMeta.id || sessionMeta.session_id || filePath,
    cwd: sessionMeta.cwd,
    createdAt: sessionMeta.timestamp || '',
    model,
    usage,
    cost: { usd, cny: usdToCny(usd, deps.tokenPricing?.usdToCny) },
  }
}

/**
 * 扫描全部 Codex 本地会话并提取标准化 Token 用量。
 * @param {object} deps - 可注入依赖及 tokenPricing
 * @returns {Array<object>} Codex 会话列表
 */
export function scanCodexSessions(deps = {}) {
  // resolveHome 存储当前调用采用的用户目录解析函数。
  const resolveHome = deps.homedir || homedir
  // sessionsRoot 存储 Codex 本地会话根目录。
  const sessionsRoot = join(resolveHome(), ...CODEX_SESSIONS_RELATIVE_PATH)
  // files 存储递归发现的全部 Codex JSONL 文件。
  const files = collectCodexSessionFiles(sessionsRoot, [], deps)
  // sessions 存储成功解析且带累计 Token 的会话。
  const sessions = []
  for (const filePath of files) {
    try {
      // session 存储当前文件解析出的标准化会话。
      const session = parseCodexSession(filePath, deps)
      if (session) sessions.push(session)
    } catch {
      // 单文件不可读不阻断其他 Codex 会话统计。
    }
  }
  return sessions
}

/**
 * 判断 Codex 会话工作目录是否位于指定任务目录内。
 * @param {object} session - 标准化 Codex 会话
 * @param {string} taskName - Visual Worktree 任务名
 * @param {string} worktreesRoot - 当前工作区 worktree 根目录
 * @returns {boolean} 会话是否属于该任务
 */
function isCodexSessionForTask(session, taskName, worktreesRoot) {
  if (!session?.cwd || !taskName || !worktreesRoot) return false
  // taskRoot 存储目标任务目录的规范化绝对路径。
  const taskRoot = resolve(worktreesRoot, taskName).replace(/\\/g, '/')
  // sessionCwd 存储会话工作目录的规范化绝对路径。
  const sessionCwd = resolve(session.cwd).replace(/\\/g, '/')
  return sessionCwd === taskRoot || sessionCwd.startsWith(`${taskRoot}/`)
}

/**
 * 获取指定任务关联的 Codex 会话列表。
 * @param {string} taskName - Visual Worktree 任务名
 * @param {string} worktreesRoot - 当前工作区 worktree 根目录
 * @param {object} deps - 可注入依赖及 tokenPricing
 * @returns {Array<object>} 按创建时间倒序的关联会话
 */
export function getCodexSessionsByTask(taskName, worktreesRoot, deps = {}) {
  return scanCodexSessions(deps)
    .filter((session) => isCodexSessionForTask(session, taskName, worktreesRoot))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
}

/**
 * 获取多个任务的 Codex Token 与费用汇总。
 * @param {Array<string>} taskNames - Visual Worktree 任务名列表
 * @param {string} worktreesRoot - 当前工作区 worktree 根目录
 * @param {object} deps - 可注入依赖及 tokenPricing
 * @returns {Record<string,object>} 任务名到用量汇总的映射
 */
export function getCodexTasksSummary(taskNames, worktreesRoot, deps = {}) {
  // sessions 存储一次扫描得到的全部 Codex 会话，供多个任务复用。
  const sessions = scanCodexSessions(deps)
  // summary 存储最终任务用量映射。
  const summary = {}
  for (const taskName of taskNames || []) {
    // matchedSessions 存储属于当前任务的 Codex 会话。
    const matchedSessions = sessions.filter((session) =>
      isCodexSessionForTask(session, taskName, worktreesRoot)
    )
    // usage 存储当前任务四类 Token 的累计值。
    const usage = matchedSessions.reduce(
      (total, session) => ({
        input: total.input + session.usage.input,
        output: total.output + session.usage.output,
        cacheWrite: total.cacheWrite + session.usage.cacheWrite,
        cacheRead: total.cacheRead + session.usage.cacheRead,
      }),
      { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }
    )
    // usd 存储当前任务所有会话美元费用之和。
    const usd = Math.round(matchedSessions.reduce((total, session) => total + session.cost.usd, 0) * 1_000_000) / 1_000_000
    summary[taskName] = {
      sessionCount: matchedSessions.length,
      usage,
      cost: { usd, cny: usdToCny(usd, deps.tokenPricing?.usdToCny) },
    }
  }
  return summary
}
