// DEFAULT_GITLAB_MERGE_TARGET_BRANCH 存储新建 Merge Request 默认使用的目标分支。
export const DEFAULT_GITLAB_MERGE_TARGET_BRANCH = 'test'

/**
 * 生成 GitLab 新建 Merge Request 页面地址，并预填源分支与目标分支。
 * @param {string} gitlabUrl - GitLab 项目首页地址
 * @param {string} sourceBranch - 当前工作分支
 * @param {string} targetBranch - 设置中配置的目标分支
 * @returns {string} 可打开的新建 Merge Request 地址；参数无效时返回空字符串
 */
export function buildGitlabMergeRequestUrl(
  gitlabUrl: string,
  sourceBranch: string,
  targetBranch: string
) {
  // normalizedSourceBranch 存储去除首尾空白后的源分支名。
  const normalizedSourceBranch = String(sourceBranch || '').trim()
  // normalizedTargetBranch 存储去除首尾空白后的目标分支名。
  const normalizedTargetBranch = String(targetBranch || '').trim()
  if (
    !normalizedSourceBranch ||
    !normalizedTargetBranch ||
    normalizedSourceBranch === normalizedTargetBranch
  )
    return ''

  try {
    // projectUrl 存储经过标准 URL API 校验的 GitLab 项目地址。
    const projectUrl = new URL(String(gitlabUrl || '').trim())
    if (!['http:', 'https:'].includes(projectUrl.protocol)) return ''
    // projectPath 存储去除尾部斜杠后的项目路径，避免生成双斜杠。
    const projectPath = projectUrl.pathname.replace(/\/+$/, '')
    if (!projectUrl.host || !projectPath) return ''
    projectUrl.pathname = `${projectPath}/-/merge_requests/new`
    projectUrl.search = ''
    projectUrl.hash = ''
    projectUrl.searchParams.set(
      'merge_request[source_branch]',
      normalizedSourceBranch
    )
    projectUrl.searchParams.set(
      'merge_request[target_branch]',
      normalizedTargetBranch
    )
    return projectUrl.toString()
  } catch {
    return ''
  }
}
