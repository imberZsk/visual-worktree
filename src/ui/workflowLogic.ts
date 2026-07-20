// 任务工作流（需求流程）前端纯逻辑：与 React/antd 解耦，便于 vitest 单测。
//
// 业务场景：worktree 视图里每个任务（跨多仓库的需求）有一组「研发流程步骤」——
// 如「需求确认 / 开发实现 / 测试验证 / 提交交付」。
// 这些步骤聚集在一个入口里，点开后逐步操作。每个步骤统一支持两种能力（可叠加）：
//   - 打勾标记「这步做完了」：勾选状态按「任务名 + 步骤 key」持久化（所有步骤都可勾选）；
//   - 可选挂一段执行命令（command）：配置了 command 的步骤额外提供「执行」按钮，点一下在任务目录跑该 shell 命令。
// 步骤清单本身在「设置」里可增删/改名/配命令，故此模块只负责清单的规范化与勾选态的读写，
// 命令的占位符渲染与真正执行在主进程（src/core/commandRunner.js + electron 层）完成。

// 默认工作流步骤清单从 core 纯数据模块 import 后再 export：数据下沉到 core，使 config.js（主进程）
// 不必反向依赖本 ui 模块（否则打包后 src/ui 不进 asar，主进程 import 会崩溃）。
// 用 import + export 而非 `export {…} from`：后者只是转发、不在本模块作用域建立局部绑定，
// 会导致本文件内的 normalizeWorkflowSteps 引用 DEFAULT_WORKFLOW_STEPS 时报 not defined。
// ui 侧仍可从本模块取 DEFAULT_WORKFLOW_STEPS，引用方无需改动。
import { DEFAULT_WORKFLOW_STEPS } from '../core/workflowSteps.js'
export { DEFAULT_WORKFLOW_STEPS }

// TASK_ARG_MODE_AUTO 表示执行脚本类命令时自动追加任务目录参数。
export const TASK_ARG_MODE_AUTO = 'auto'
// TASK_ARG_MODE_NONE 表示永不自动追加任务目录参数。
export const TASK_ARG_MODE_NONE = 'none'
// TASK_ARG_MODE_APPEND_PATH 表示总是追加任务目录参数（若命令未显式使用 {path}）。
export const TASK_ARG_MODE_APPEND_PATH = 'appendPath'
// TASK_ARG_MODES 存储合法参数模式集合，用于规范化用户配置。
const TASK_ARG_MODES = new Set([
  TASK_ARG_MODE_AUTO,
  TASK_ARG_MODE_NONE,
  TASK_ARG_MODE_APPEND_PATH,
])

/**
 * 由步骤展示名派生一个 slug 形式的 key（仅用于补全缺失 key 的兜底）。
 * 保留中英文与数字，其余字符转连字符；为空时回退 'step'，便于后续去重补序号。
 * @param {string} label - 步骤展示名
 * @returns {string} slug 形式的 key（可能与已有 key 重复，由 normalize 负责去重）
 */
function slugifyLabel(label) {
  // slug 把空白与符号折叠为连字符，保留中英文数字；前后多余连字符去掉
  const slug = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^一-龥a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  // 全部被过滤光（如纯符号名）时回退固定前缀，保证非空
  return slug || 'step'
}

/**
 * 规范化流程步骤的任务目录参数模式。
 * @param {string} mode - 原始参数模式，可能来自旧配置或表单
 * @returns {'auto'|'none'|'appendPath'} 可保存/执行的参数模式
 */
function normalizeTaskArgMode(mode) {
  // value 存储去空白后的模式值，避免 null/undefined 污染配置。
  const value = String(mode || '').trim()
  return TASK_ARG_MODES.has(value) ? value : TASK_ARG_MODE_AUTO
}

/**
 * 规范化工作流步骤清单：过滤无效项、补全缺失的 key、保证 key 全局唯一、规整 command。
 * 业务动机：设置里用户新增的步骤可能没有 key（或改名后想沿用旧 key）；保存前统一在此收敛，
 * 让每个步骤都有稳定唯一的 key（勾选态依赖它），避免两步同 key 导致勾选互相串台。
 * @param {Array<{key?:string,label?:string,command?:string,taskArgMode?:string}>} steps - 原始步骤数组（可能来自配置或表单）
 * @returns {Array<{key:string,label:string,command:string,taskArgMode:string}>} 规范化后的步骤数组（label 为空的项被丢弃）
 */
export function normalizeWorkflowSteps(steps) {
  // 非数组输入（损坏配置）直接回退默认清单，保证 UI 总有步骤可渲染
  if (!Array.isArray(steps))
    return DEFAULT_WORKFLOW_STEPS.map((s) => ({ ...s }))
  // used 记录已占用的 key，用于检测冲突并追加序号去重
  const used = new Set()
  // result 累积规范化后的步骤
  const result = []
  for (const raw of steps) {
    // label 去空白后为空的步骤视为无效（用户留空行），直接跳过不入列表
    const label = String(raw?.label ?? '').trim()
    if (!label) continue
    // command 为该步骤的执行命令：去首尾空白；非字符串（如旧配置遗留的其它字段）收敛为空串。
    // 空串表示该步骤仅可勾选、不渲染执行按钮（向后兼容旧 type:'action' 步骤——它们无 command）
    const command = typeof raw?.command === 'string' ? raw.command.trim() : ''
    // base 为初始候选 key：优先用传入的 key（改名沿用旧 key 才能保住勾选态），否则由 label 派生
    const base = String(raw?.key ?? '').trim() || slugifyLabel(label)
    // key 在 base 基础上去重：已占用时追加 -2 / -3 … 直到唯一
    let key = base
    let n = 2
    while (used.has(key)) {
      key = `${base}-${n}`
      n += 1
    }
    used.add(key)
    // autoCheckOnSuccess 表示命令成功后是否自动勾选流程步骤；旧配置缺失时默认开启，延续现有成功即完成体验。
    const autoCheckOnSuccess = raw?.autoCheckOnSuccess !== false
    // stopOnFailure 表示批量运行中该步骤失败后是否停止后续步骤；旧配置缺失时默认停止，避免失败后继续误操作。
    const stopOnFailure = raw?.stopOnFailure !== false
    // taskArgMode 表示执行命令时如何给脚本传入任务目录；旧配置缺失时默认 auto，兼顾免配置与兼容性。
    const taskArgMode = normalizeTaskArgMode(raw?.taskArgMode)
    result.push({
      key,
      label,
      command,
      autoCheckOnSuccess,
      stopOnFailure,
      taskArgMode,
    })
  }
  return result
}

/**
 * 取某任务在工作流勾选映射中的「已勾选步骤 key 集合」（容错：缺失时回退空数组）。
 * @param {Record<string,string[]>} map - 工作流映射「任务名 → 已勾选步骤 key 数组」
 * @param {string} taskName - 任务名
 * @returns {string[]} 该任务已勾选的步骤 key 数组（不存在时为空数组）
 */
export function getTaskDoneSteps(map, taskName) {
  // doneList 为该任务已勾选 key 列表，非数组（缺失/损坏）时回退空数组
  const doneList = map?.[taskName]
  return Array.isArray(doneList) ? doneList : []
}

/**
 * 判断某任务的某个步骤是否已勾选。
 * @param {Record<string,string[]>} map - 工作流映射
 * @param {string} taskName - 任务名
 * @param {string} stepKey - 步骤 key
 * @returns {boolean} 是否已勾选
 */
export function isStepDone(map, taskName, stepKey) {
  return getTaskDoneSteps(map, taskName).includes(stepKey)
}

/**
 * 在工作流映射上设置某任务某步骤的勾选态（纯函数，返回新对象，不修改入参）。
 * 勾选则把 key 并入该任务列表，取消则移除；某任务勾选列表清空后删除该键，避免存储残留空数组。
 * @param {Record<string,string[]>} map - 现有工作流映射
 * @param {string} taskName - 任务名
 * @param {string} stepKey - 步骤 key
 * @param {boolean} done - 目标勾选态（true 勾上 / false 取消）
 * @returns {Record<string,string[]>} 更新后的新映射
 */
export function setStepDoneInMap(map, taskName, stepKey, done) {
  // next 为入参浅拷贝，保证不可变更新（便于 React/Zustand 触发重渲染）
  const next = { ...(map || {}) }
  // 任务名或步骤 key 缺失时原样返回，避免写入无效键
  if (!taskName || !stepKey) return next
  // current 为该任务当前已勾选的 key 集合（去重后便于增删）
  const current = new Set(getTaskDoneSteps(next, taskName))
  if (done) current.add(stepKey)
  else current.delete(stepKey)
  // 清空后删除该任务键（缺失即等价于「全部未勾选」，无需占用存储）
  if (current.size === 0) {
    delete next[taskName]
  } else {
    next[taskName] = [...current]
  }
  return next
}

/**
 * 计算某任务的工作流进度（所有步骤都可勾选，故全部计入完成度总数）。
 * @param {Array<{key:string}>} steps - 当前生效的步骤清单
 * @param {Record<string,string[]>} map - 工作流勾选映射
 * @param {string} taskName - 任务名
 * @returns {{done:number, total:number}} 已勾选数与步骤总数（total 为全部步骤个数）
 */
export function computeWorkflowProgress(steps, map, taskName) {
  // list 为有效步骤数组（容错非数组输入）；所有步骤均可勾选，total 即步骤总数
  const list = Array.isArray(steps) ? steps : []
  // doneSet 为该任务已勾选 key 集合，用于判断每个步骤是否完成
  const doneSet = new Set(getTaskDoneSteps(map, taskName))
  // done 为已勾选且仍存在于当前清单中的步骤数（排除已被删除的历史步骤，避免进度虚高）
  const done = list.reduce((acc, s) => acc + (doneSet.has(s.key) ? 1 : 0), 0)
  return { done, total: list.length }
}

// 工作流勾选映射在 localStorage 中的存储键（浏览器降级用，Electron 下走文件持久化）
export const TASK_WORKFLOW_STORAGE_KEY = 'vw-task-workflow'

/**
 * 从 localStorage 读取工作流勾选映射（容错：缺失/损坏时回退空映射）。
 * @returns {Record<string,string[]>} 任务名 → 已勾选步骤 key 数组 的映射
 */
export function loadTaskWorkflowMap() {
  try {
    // raw 为原始 JSON 字符串，可能为 null（从未写入）
    const raw = localStorage.getItem(TASK_WORKFLOW_STORAGE_KEY)
    if (!raw) return {}
    // parsed 需校验为普通对象，防止存入数组/标量导致后续出错
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {}
  } catch (e) {
    // localStorage 不可用或 JSON 损坏时回退空映射，避免阻塞面板渲染
    return {}
  }
}

/**
 * 将工作流勾选映射持久化到 localStorage。
 * @param {Record<string,string[]>} map - 工作流勾选映射
 */
export function saveTaskWorkflowMap(map) {
  try {
    localStorage.setItem(TASK_WORKFLOW_STORAGE_KEY, JSON.stringify(map || {}))
  } catch (e) {
    // localStorage 不可用时忽略持久化（不影响当前会话内的内存状态）
  }
}
