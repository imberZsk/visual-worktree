import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

// execFileAsync 存储 promise 化的进程执行函数，用于构造真实临时 Git 仓库。
const execFileAsync = promisify(execFile)

/**
 * 在指定目录执行 Git 命令并在失败时保留标准错误供测试定位。
 * @param cwd - Git 命令工作目录
 * @param args - 传给 Git 的参数列表
 * @returns Git 命令的标准输出
 */
export async function runGit(cwd: string, args: string[]): Promise<string> {
  // result 存储 Git 子进程的标准输出与错误信息。
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8' })
  return result.stdout
}

/**
 * 创建包含一次提交的真实 Git 仓库，供项目扫描和 Worktree 流程使用。
 * @param projectsRoot - 临时源项目根目录
 * @param projectName - 仓库目录及界面展示名称
 * @returns 新仓库的绝对路径
 */
export async function createGitProject(
  projectsRoot: string,
  projectName: string
): Promise<string> {
  // projectPath 存储新建测试仓库的绝对路径。
  const projectPath = join(projectsRoot, projectName)
  await mkdir(projectPath, { recursive: true })
  await runGit(projectPath, ['init', '-b', 'main'])
  await runGit(projectPath, ['config', 'user.name', 'E2E User'])
  await runGit(projectPath, ['config', 'user.email', 'e2e@example.com'])
  await writeFile(join(projectPath, 'README.md'), `# ${projectName}\n`)
  await runGit(projectPath, ['add', 'README.md'])
  await runGit(projectPath, ['commit', '-m', 'initial commit'])
  return projectPath
}
