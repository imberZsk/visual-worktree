import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GITLAB_MERGE_TARGET_BRANCH,
  buildGitlabMergeRequestUrl,
} from '../src/ui/gitlabLogic.ts'

describe('GitLab Merge Request URL', () => {
  it('默认目标分支为 test', () => {
    expect(DEFAULT_GITLAB_MERGE_TARGET_BRANCH).toBe('test')
  })

  it('为包含斜杠的源分支和目标分支生成预填参数', () => {
    // mergeRequestUrl 存储从 GitLab 项目地址生成的新建 MR 页面地址。
    const mergeRequestUrl = buildGitlabMergeRequestUrl(
      'https://gitlab.example.com/team/project/',
      'feat/CYTRD-100 修复',
      'release/test'
    )
    // parsedUrl 存储标准 URL 解析结果，用于验证路径和编码后的查询参数。
    const parsedUrl = new URL(mergeRequestUrl)

    expect(parsedUrl.pathname).toBe('/team/project/-/merge_requests/new')
    expect(parsedUrl.searchParams.get('merge_request[source_branch]')).toBe(
      'feat/CYTRD-100 修复'
    )
    expect(parsedUrl.searchParams.get('merge_request[target_branch]')).toBe(
      'release/test'
    )
  })

  it('源分支、目标分支或项目地址无效时不生成入口', () => {
    expect(
      buildGitlabMergeRequestUrl(
        'https://gitlab.example.com/team/project',
        '',
        'test'
      )
    ).toBe('')
    expect(
      buildGitlabMergeRequestUrl(
        'https://gitlab.example.com/team/project',
        'feat/a',
        ' '
      )
    ).toBe('')
    expect(buildGitlabMergeRequestUrl('not-a-url', 'feat/a', 'test')).toBe('')
    expect(
      buildGitlabMergeRequestUrl(
        'https://gitlab.example.com/team/project',
        'test',
        'test'
      )
    ).toBe('')
  })
})
