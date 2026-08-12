// DEFAULT_AI_ASSISTANT_API_URL 存储本地学习环境中的默认 FastAPI 后端地址。
export const DEFAULT_AI_ASSISTANT_API_URL = 'http://127.0.0.1:8000'
// AI_ASSISTANT_API_URL_ENV 存储覆盖 FastAPI 后端地址的环境变量名称。
export const AI_ASSISTANT_API_URL_ENV = 'AI_ASSISTANT_API_URL'
// AI_ASSISTANT_CHAT_PATH 存储后端聊天接口的固定路径。
const AI_ASSISTANT_CHAT_PATH = '/chat'
// AI_ASSISTANT_STREAM_PATH 存储后端流式聊天接口的固定路径。
const AI_ASSISTANT_STREAM_PATH = '/chat/stream'
// AI_MODEL_SETTINGS_PATH 存储后端运行时模型设置接口的固定路径。
const AI_MODEL_SETTINGS_PATH = '/settings/model'

/**
 * 解析 AI 助手后端地址。
 * @param {string} [configuredBaseUrl] - 调用方显式指定的后端地址
 * @returns {string} 去除末尾斜杠的有效地址
 */
function resolveAiAssistantBaseUrl(configuredBaseUrl) {
  // baseUrl 存储调用方、环境变量或默认值最终确定的后端地址。
  const baseUrl = String(
    configuredBaseUrl ||
      process.env[AI_ASSISTANT_API_URL_ENV] ||
      DEFAULT_AI_ASSISTANT_API_URL
  )
    .trim()
    .replace(/\/+$/, '')
  if (!baseUrl) throw new Error('未配置 AI 助手后端地址')
  return baseUrl
}

/**
 * 查询后端当前生效的模型设置安全投影。
 * @param {{fetchImpl?:typeof fetch,baseUrl?:string}} [options] - 可注入网络实现与后端地址
 * @returns {Promise<{model:string,baseUrl:string,apiKeyConfigured:boolean}>} 不含 Key 的设置状态
 */
export async function getAiModelSettings(options = {}) {
  // fetchImpl 存储实际执行设置查询的 HTTP 函数。
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function')
    throw new Error('当前环境不支持 HTTP 请求')
  // response 存储模型设置查询的 HTTP 响应。
  const response = await fetchImpl(
    `${resolveAiAssistantBaseUrl(options.baseUrl)}${AI_MODEL_SETTINGS_PATH}`
  )
  // payload 存储后端返回的安全设置或错误详情。
  const payload = await response.json().catch(() => ({}))
  if (!response.ok)
    throw new Error(
      payload?.detail || `读取模型配置失败（HTTP ${response.status}）`
    )
  return {
    model: String(payload.model || ''),
    baseUrl: String(payload.base_url || ''),
    apiKeyConfigured: Boolean(payload.api_key_configured),
  }
}

/**
 * 更新后端进程当前使用的模型设置。
 * @param {{model:string,baseUrl?:string,apiKey?:string,clearApiKey?:boolean}} settings - 模型、地址和可选凭据
 * @param {{fetchImpl?:typeof fetch,baseUrl?:string}} [options] - 可注入网络实现与后端地址
 * @returns {Promise<{model:string,baseUrl:string,apiKeyConfigured:boolean}>} 不含 Key 的设置状态
 */
export async function updateAiModelSettings(settings, options = {}) {
  // fetchImpl 存储实际执行设置更新的 HTTP 函数。
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function')
    throw new Error('当前环境不支持 HTTP 请求')
  // requestPayload 存储后端 Pydantic 模型接收的字段；Key 只在本次主进程请求内存在。
  const requestPayload = {
    model: settings.model,
    base_url: settings.baseUrl || '',
    clear_api_key: Boolean(settings.clearApiKey),
  }
  if (settings.apiKey) requestPayload.api_key = settings.apiKey
  // response 存储模型设置更新的 HTTP 响应。
  const response = await fetchImpl(
    `${resolveAiAssistantBaseUrl(options.baseUrl)}${AI_MODEL_SETTINGS_PATH}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    }
  )
  // payload 存储后端返回的安全设置或错误详情。
  const payload = await response.json().catch(() => ({}))
  if (!response.ok)
    throw new Error(
      payload?.detail || `保存模型配置失败（HTTP ${response.status}）`
    )
  return {
    model: String(payload.model || ''),
    baseUrl: String(payload.base_url || ''),
    apiKeyConfigured: Boolean(payload.api_key_configured),
  }
}

/**
 * 通过 HTTP 调用 AI 助手后端并返回文本回答。
 * @param {string} message - 用户提交的非空消息
 * @param {{fetchImpl?:typeof fetch,baseUrl?:string}} [options] - 可注入的 fetch 与后端地址，测试时用于隔离真实网络
 * @returns {Promise<string>} 后端返回的 AI 文本回答
 */
export async function sendAiAssistantMessage(message, options = {}) {
  // content 存储去除首尾空白后的用户消息。
  const content = String(message || '').trim()
  if (!content) throw new Error('消息不能为空')

  // fetchImpl 存储实际执行 HTTP 请求的函数，默认使用 Node.js 全局 fetch。
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function')
    throw new Error('当前环境不支持 HTTP 请求')
  // configuredBaseUrl 存储调用方、环境变量或默认值提供的后端地址。
  const baseUrl = resolveAiAssistantBaseUrl(options.baseUrl)

  // response 存储 FastAPI 聊天接口返回的 HTTP 响应。
  const response = await fetchImpl(`${baseUrl}${AI_ASSISTANT_CHAT_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: content }),
  })
  // payload 存储后端 JSON 响应；原实现预赋空对象后在 try/catch 两个分支均被覆盖，触发无效赋值检查，因此只声明并由分支赋值。
  let payload
  try {
    payload = await response.json()
  } catch {
    payload = {}
  }

  if (!response.ok) {
    // errorMessage 存储后端返回的业务错误或 HTTP 状态兜底信息。
    const errorMessage =
      typeof payload?.detail === 'string' && payload.detail.trim()
        ? payload.detail.trim()
        : `AI 助手后端请求失败（HTTP ${response.status}）`
    throw new Error(errorMessage)
  }
  // answer 存储后端返回并清理后的模型回答。
  const answer =
    typeof payload?.answer === 'string' ? payload.answer.trim() : ''
  if (!answer) throw new Error('AI 助手后端未返回文本内容')
  return answer
}

/**
 * 通过 HTTP 消费 AI 助手 NDJSON 流，并逐段通知调用方。
 * @param {string} message - 用户提交的非空消息
 * @param {{fetchImpl?:typeof fetch,baseUrl?:string,workspace?:object,history?:Array<{role:string,content:string}>,attachments?:Array<object>,reasoningEffort?:string,onChunk?:(chunk:string)=>void,onEvent?:(event:object)=>void}} [options] - 可注入的网络实现、聊天上下文、附件和流式事件回调
 * @returns {Promise<string>} 流式响应完成后拼接出的完整回答
 */
export async function streamAiAssistantMessage(message, options = {}) {
  // content 存储去除首尾空白后的用户消息。
  const content = String(message || '').trim()
  if (!content) throw new Error('消息不能为空')

  // fetchImpl 存储实际执行 HTTP 请求的函数。
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function')
    throw new Error('当前环境不支持 HTTP 请求')
  // configuredBaseUrl 存储调用方、环境变量或默认值提供的后端地址。
  const baseUrl = resolveAiAssistantBaseUrl(options.baseUrl)
  // 前端第 5 步（建议在下一行打断点）：组成 HTTP 请求体；确认里面只有 message 和安全 workspace。
  // requestPayload 存储发往 FastAPI 的消息和已由渲染进程清洗的工作区快照。
  const requestPayload = { message: content }
  if (options.workspace && typeof options.workspace === 'object') {
    requestPayload.workspace = options.workspace
  }
  if (Array.isArray(options.history)) {
    requestPayload.history = options.history
  }
  if (Array.isArray(options.attachments)) {
    requestPayload.attachments = options.attachments
  }
  if (typeof options.reasoningEffort === 'string') {
    requestPayload.reasoning_effort = options.reasoningEffort
  }
  // 开发日志只标记调用阶段，不输出消息正文、工作区快照或 API Key。
  if (process.env.NODE_ENV === 'development') {
    console.log('[AI 主进程第 2 步] 正在请求 FastAPI')
  }

  // 前端第 6 步（建议在下一行打断点）：真正发送 HTTP 请求；单步执行后请求会进入 FastAPI。
  // response 存储 FastAPI 流式聊天接口返回的 HTTP 响应。
  const response = await fetchImpl(`${baseUrl}${AI_ASSISTANT_STREAM_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestPayload),
  })
  if (!response.ok) {
    // payload 存储后端在开始流之前返回的 JSON 错误信息。
    const payload = await response.json().catch(() => ({}))
    // errorMessage 存储业务错误或 HTTP 状态兜底提示。
    const errorMessage =
      typeof payload?.detail === 'string' && payload.detail.trim()
        ? payload.detail.trim()
        : `AI 助手后端请求失败（HTTP ${response.status}）`
    throw new Error(errorMessage)
  }
  if (!response.body || typeof response.body.getReader !== 'function')
    throw new Error('AI 助手后端未返回流式内容')

  // reader 存储用于逐块读取 Fetch 响应体的流读取器。
  const reader = response.body.getReader()
  // decoder 存储跨网络块连续解码 UTF-8 文本的解码器。
  const decoder = new TextDecoder()
  // buffer 存储尚未形成完整 NDJSON 行的文本。
  let buffer = ''
  // answer 存储所有 delta 事件拼接出的完整回答。
  let answer = ''
  // completed 标记服务端是否明确发送了完成事件。
  let completed = false

  /**
   * 解析一行 NDJSON 事件并更新当前流状态。
   * @param {string} line - 不含换行符的 JSON 事件文本
   */
  const handleEventLine = (line) => {
    if (!line.trim()) return
    // event 存储服务端发送的单个流式事件。
    let event
    try {
      event = JSON.parse(line)
    } catch {
      throw new Error('AI 助手后端返回了无效的流式数据')
    }
    if (event?.type === 'delta' && typeof event.content === 'string') {
      answer += event.content
      if (typeof options.onEvent === 'function') options.onEvent(event)
      else options.onChunk?.(event.content)
      return
    }
    if (event?.type === 'error') {
      throw new Error(event.message || 'AI 智能助手请求失败')
    }
    if (event?.type === 'done') completed = true
    options.onEvent?.(event)
  }

  while (true) {
    // readResult 存储当前响应体读取结果。
    const readResult = await reader.read()
    buffer += decoder.decode(readResult.value, { stream: !readResult.done })
    // lines 存储当前缓冲区内已经形成的完整事件行。
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) handleEventLine(line)
    if (readResult.done) break
  }
  if (buffer.trim()) handleEventLine(buffer)
  if (!completed) throw new Error('AI 助手流式响应意外结束')
  if (!answer) throw new Error('AI 助手后端未返回文本内容')
  return answer
}
