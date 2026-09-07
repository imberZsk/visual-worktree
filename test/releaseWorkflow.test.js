import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

// RELEASE_WORKFLOW_FILE 存储正式发布 workflow 的仓库相对路径。
const RELEASE_WORKFLOW_FILE = new URL(
  '../.github/workflows/release.yml',
  import.meta.url
)

describe('release workflow 资产白名单', () => {
  // 验证公开 Release 的三层资产筛选允许安装包及 electron-updater 必需元数据。
  it('只允许安装包与更新元数据', () => {
    // workflow 存储正式发布 workflow 文本，用于防止资产白名单被再次放宽。
    const workflow = readFileSync(RELEASE_WORKFLOW_FILE, 'utf8')
    // forbiddenAssetPatterns 存储不得进入公开 Release 链路的技术产物匹配规则。
    const forbiddenAssetPatterns = [
      /release\/\*\.zip/,
      /release\/\*\.zip/,
      /-name ['"][^'"]*\.zip['"]/,
      /-name ['"][^'"]*\.zip['"]/,
    ]

    // forbiddenAssetPattern 存储当前检查的禁用资产匹配规则。
    for (const forbiddenAssetPattern of forbiddenAssetPatterns) {
      expect(workflow).not.toMatch(forbiddenAssetPattern)
    }
    expect(workflow).toContain('release/*.dmg')
    expect(workflow).toContain('release/*.exe')
    expect(workflow).toContain('release/latest*.yml')
    expect(workflow).toContain('release/*.blockmap')
    expect(workflow).toContain('dist-release/latest*.yml')
  })
})
