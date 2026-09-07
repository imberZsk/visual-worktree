import { describe, expect, it } from 'vitest'
import { parseCliVersion } from '../src/core/cliVersionService.js'

describe('cliVersionService', () => {
  it('从 Claude Code 和 Codex 的版本输出中解析 semver', () => {
    expect(parseCliVersion('2.1.3 (Claude Code)')).toBe('2.1.3')
    expect(parseCliVersion('codex-cli 0.42.0-beta.1')).toBe('0.42.0-beta.1')
  })

  it('无有效版本号时返回空字符串', () => {
    expect(parseCliVersion('unknown')).toBe('')
  })
})
