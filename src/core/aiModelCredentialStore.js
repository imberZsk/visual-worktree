import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

// DEFAULT_AI_MODEL 存储设置页和本地凭据缺省使用的模型名称。
export const DEFAULT_AI_MODEL = 'gpt-5.6-sol'
// AI_MODEL_CREDENTIALS_FILENAME 存储独立于普通配置文件的加密凭据文件名。
export const AI_MODEL_CREDENTIALS_FILENAME = 'ai-model-credentials.enc'

/**
 * 生成可展示但不能还原完整凭据的 API Key 掩码。
 * @param {string} apiKey - 仅在 Electron 主进程内存在的完整 API Key
 * @returns {string} 只保留末四位的安全提示
 */
export function maskAiModelApiKey(apiKey) {
  // normalizedApiKey 存储清理空白后的 Key，仅用于生成显示掩码。
  const normalizedApiKey = String(apiKey || '').trim()
  if (!normalizedApiKey) return ''
  // visibleSuffix 存储允许设置页确认凭据的末四位字符。
  const visibleSuffix = normalizedApiKey.slice(-4)
  return `••••••••${visibleSuffix}`
}

/**
 * 校验并规范化要保存的模型配置。
 * @param {object} value - 包含 model、baseUrl 和 apiKey 的原始表单值
 * @returns {{model:string,baseUrl:string,apiKey:string,clearApiKey:boolean}} 可安全交给后端和加密存储的配置
 */
export function normalizeAiModelCredentials(value = {}) {
  // model 存储去除首尾空格后的模型名称。
  const model = String(value.model || '').trim()
  // baseUrl 存储去除末尾斜杠后的兼容接口地址，空值表示 OpenAI 官方地址。
  const baseUrl = String(value.baseUrl || '')
    .trim()
    .replace(/\/+$/, '')
  // apiKey 存储用户本次填写的模型凭据，只允许进入主进程内存和加密文件。
  const apiKey = String(value.apiKey || '').trim()
  // clearApiKey 存储用户是否明确要求禁用 Key，用于区别“留空沿用后端环境变量”。
  const clearApiKey = Boolean(value.clearApiKey)
  if (!model) throw new Error('模型名称不能为空')
  if (baseUrl && !/^https?:\/\//i.test(baseUrl))
    throw new Error('Base URL 必须以 http:// 或 https:// 开头')
  return { model, baseUrl, apiKey, clearApiKey }
}

/**
 * 读取由 Electron safeStorage 加密保存的模型配置。
 * @param {{dataDir:string,safeStorage:object}} options - 本地数据目录和 Electron safeStorage
 * @returns {{model:string,baseUrl:string,apiKey:string,clearApiKey:boolean}|null} 解密配置；文件不存在时返回 null
 */
export function loadAiModelCredentials({ dataDir, safeStorage }) {
  // credentialsPath 存储当前用户的加密模型配置文件绝对路径。
  const credentialsPath = join(dataDir, AI_MODEL_CREDENTIALS_FILENAME)
  if (!existsSync(credentialsPath)) return null
  if (!safeStorage?.isEncryptionAvailable?.())
    throw new Error('系统安全存储当前不可用，无法读取 AI 模型配置')
  try {
    // encryptedValue 存储从 Base64 文件还原的系统加密二进制内容。
    const encryptedValue = Buffer.from(
      readFileSync(credentialsPath, 'utf8'),
      'base64'
    )
    // decryptedValue 存储仅在主进程内短暂存在的配置 JSON 明文。
    const decryptedValue = safeStorage.decryptString(encryptedValue)
    return normalizeAiModelCredentials(JSON.parse(decryptedValue))
  } catch (error) {
    throw new Error(`读取 AI 模型配置失败：${error?.message || '未知错误'}`, {
      cause: error,
    })
  }
}

/**
 * 使用 Electron safeStorage 加密并保存模型配置。
 * @param {object} value - 要保存的 model、baseUrl 和 apiKey
 * @param {{dataDir:string,safeStorage:object}} options - 本地数据目录和 Electron safeStorage
 * @returns {{model:string,baseUrl:string,apiKey:string,clearApiKey:boolean}} 已规范化的完整配置
 */
export function saveAiModelCredentials(value, { dataDir, safeStorage }) {
  if (!safeStorage?.isEncryptionAvailable?.())
    throw new Error('系统安全存储当前不可用，无法保存 AI 模型配置')
  // credentials 存储通过统一校验的模型配置。
  const credentials = normalizeAiModelCredentials(value)
  // encryptedValue 存储由操作系统安全能力加密后的二进制内容。
  const encryptedValue = safeStorage.encryptString(JSON.stringify(credentials))
  // credentialsPath 存储加密配置文件的绝对路径。
  const credentialsPath = join(dataDir, AI_MODEL_CREDENTIALS_FILENAME)
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(credentialsPath, encryptedValue.toString('base64'), {
    encoding: 'utf8',
    mode: 0o600,
  })
  return credentials
}
