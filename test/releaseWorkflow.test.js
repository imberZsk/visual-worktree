import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

// RELEASE_WORKFLOW_FILE 存储正式发布 workflow 的仓库相对路径。
const RELEASE_WORKFLOW_FILE = new URL(
  '../.github/workflows/release.yml',
  import.meta.url
)

describe('release workflow 资产白名单', () => {
  // 验证公开 Release 的三层资产筛选只允许 3 个普通用户安装包。
  it('只允许 DMG、Setup EXE 与 portable EXE', () => {
    // workflow 存储正式发布 workflow 文本，用于防止资产白名单被再次放宽。
    const workflow = readFileSync(RELEASE_WORKFLOW_FILE, 'utf8')
    // forbiddenAssetPatterns 存储不得进入公开 Release 链路的技术产物匹配规则。
    const forbiddenAssetPatterns = [
      /release\/\*\.zip/,
      /release\/latest\*\.yml/,
      /release\/\*\.blockmap/,
      /-name ['"][^'"]*\.zip['"]/,
      /-name ['"][^'"]*\.yml['"]/,
      /-name ['"][^'"]*\.blockmap['"]/,
    ]

    // forbiddenAssetPattern 存储当前检查的禁用资产匹配规则。
    for (const forbiddenAssetPattern of forbiddenAssetPatterns) {
      expect(workflow).not.toMatch(forbiddenAssetPattern)
    }
    expect(workflow).toContain('release/*.dmg')
    expect(workflow).toContain('release/*.exe')
    expect(workflow).toContain(
      'release_assets=(dist-release/*.dmg dist-release/*Setup*.exe dist-release/*portable*.exe)'
    )
    expect(workflow).toContain('[ "${#all_files[@]}" -ne 3 ]')
  })
})
