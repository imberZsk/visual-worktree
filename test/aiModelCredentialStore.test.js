import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AI_MODEL_CREDENTIALS_FILENAME,
  loadAiModelCredentials,
  maskAiModelApiKey,
  normalizeAiModelCredentials,
  saveAiModelCredentials,
} from '../src/core/aiModelCredentialStore.js'

// tempDirs 存储测试创建的临时目录，结束后统一清理。
const tempDirs = []

/**
 * 创建可逆但不包含明文的 safeStorage 测试替身。
 * @returns {object} 具备 Electron safeStorage 同形接口的测试对象
 */
function createSafeStorageStub() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value).map((byte) => byte ^ 0x5a),
    decryptString: (value) =>
      Buffer.from(value)
        .map((byte) => byte ^ 0x5a)
        .toString('utf8'),
  }
}

afterEach(() => {
  for (const directory of tempDirs.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

describe('aiModelCredentialStore', () => {
  it('encrypts API key at rest and restores credentials', () => {
    // dataDir 存储本用例隔离的凭据目录。
    const dataDir = mkdtempSync(join(tmpdir(), 'vw-ai-settings-'))
    tempDirs.push(dataDir)
    // safeStorage 存储本用例的可逆加密替身。
    const safeStorage = createSafeStorageStub()

    saveAiModelCredentials(
      {
        model: 'gpt-5.6-sol',
        baseUrl: 'https://gateway.example.com/v1/',
        apiKey: 'secret-api-key',
      },
      { dataDir, safeStorage }
    )

    // encryptedFile 存储实际落盘的 Base64 密文，用于确认不含 Key 明文。
    const encryptedFile = readFileSync(
      join(dataDir, AI_MODEL_CREDENTIALS_FILENAME),
      'utf8'
    )
    expect(encryptedFile).not.toContain('secret-api-key')
    expect(loadAiModelCredentials({ dataDir, safeStorage })).toEqual({
      model: 'gpt-5.6-sol',
      baseUrl: 'https://gateway.example.com/v1',
      apiKey: 'secret-api-key',
      clearApiKey: false,
    })
  })

  it('rejects non-http Base URL', () => {
    expect(() =>
      normalizeAiModelCredentials({
        model: 'test-model',
        baseUrl: 'file:///tmp/model',
      })
    ).toThrow('Base URL 必须以 http:// 或 https:// 开头')
  })

  it('only exposes the last four API key characters in display hint', () => {
    expect(maskAiModelApiKey('secret-api-key')).toBe('••••••••-key')
    expect(maskAiModelApiKey('')).toBe('')
  })
})
