// 工作流步骤「实时输出」的纯逻辑：生成路由 key、追加输出块、判断事件归属。
// 与 Electron/React 解耦，便于 vitest 直接单测；真正的进程 spawn 副作用在 electron/ipcHandlers.js，
// React 状态更新在 src/ui/App.tsx。
//
// 业务场景：用户点某任务某步骤的「执行」按钮后，主进程流式回推 stdout/stderr 片段，
// 渲染进程需要把片段累积到「正在展示该步骤输出的弹窗」里，并据「任务名+步骤key」路由到正确的步骤。

// STEP_KEY_SEP 为拼接 taskName 与 stepKey 的分隔符；用 '::' 这种不易出现在任务名/步骤 key 里的串，
// 避免不同 (任务,步骤) 组合拼出相同 key 而误判
const STEP_KEY_SEP = '::'

/**
 * 生成「正在执行步骤」的唯一路由 key：用于在 store 标记 loading、在前端累积输出时区分不同任务/步骤。
 * @param {string} taskName - 任务名
 * @param {string} stepKey - 步骤 key
 * @returns {string} 组合后的唯一 key
 */
export function stepRunKey(taskName, stepKey) {
  return `${String(taskName ?? '')}${STEP_KEY_SEP}${String(stepKey ?? '')}`
}

/**
 * 判断一个流式输出事件是否归属于指定的任务/步骤（用于把 chunk 路由到正确的展示位）。
 * @param {{taskName?:string, stepKey?:string}} event - 主进程推送的输出事件
 * @param {string} taskName - 目标任务名
 * @param {string} stepKey - 目标步骤 key
 * @returns {boolean} 事件是否属于该任务该步骤
 */
export function isStepEventFor(event, taskName, stepKey) {
  // event 缺失时视为不匹配，避免 undefined 误判
  if (!event) return false
  return event.taskName === taskName && event.stepKey === stepKey
}

/**
 * 把新到的输出片段追加到已有缓冲区尾部；超过上限时只保留尾部内容。
 * WHY 限制上限：长时间运行的脚本可能持续打印，无限累积会撑爆内存与 DOM，故保留最近的 maxChars 字符。
 * @param {string} buffer - 已累积的输出文本
 * @param {string} chunk - 新到的输出片段
 * @param {number} [maxChars=200000] - 缓冲区保留的最大字符数
 * @returns {string} 追加（并按需截断）后的输出文本
 */
export function appendStepChunk(buffer, chunk, maxChars = 200000) {
  // next 为拼接后的完整文本
  const next = `${String(buffer ?? '')}${String(chunk ?? '')}`
  // 超过上限时丢弃头部、只留尾部，保证内存与渲染开销有界
  return next.length > maxChars ? next.slice(next.length - maxChars) : next
}
