import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

// RELEASE_WORKFLOW_FILE 存储正式发布 workflow 的仓库相对路径。
const RELEASE_WORKFLOW_FILE = new URL(
  '../.github/workflows/release.yml',
  import.meta.url
)

describe('release workflow 资产白名单', () => {
  it('三层筛选只允许 latest YAML，不允许所有 YAML', () => {
    // workflow 存储正式发布 workflow 文本，用于防止 glob 被再次放宽。
    const workflow = readFileSync(RELEASE_WORKFLOW_FILE, 'utf8')
    // uploadAllowlistMatches 存储 artifact 上传层的 latest YAML 白名单出现次数。
    const uploadAllowlistMatches =
      workflow.match(/release\/latest\*\.yml/g) || []
    // findAllowlistMatches 存储汇总与发布层的 latest YAML 白名单出现次数。
    const findAllowlistMatches = workflow.match(/-name 'latest\*\.yml'/g) || []

    expect(workflow).not.toContain('release/*.yml')
    expect(workflow).not.toMatch(/-name ['"]\*\.yml['"]/)
    expect(uploadAllowlistMatches).toHaveLength(1)
    expect(findAllowlistMatches).toHaveLength(2)
  })
})
