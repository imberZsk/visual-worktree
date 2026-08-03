import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { createGitProject } from './gitFixture.ts'

export type PreparedWorkspace = {
  projectsRoot: string
  worktreesRoot: string
  projectPaths: string[]
}

/**
 * 创建真实临时仓库并通过首次引导配置应用，返回可供业务流程使用的路径。
 * @param appPage - Electron 渲染进程页面
 * @param e2eHomePath - 当前用例独占的临时 HOME
 * @param projectNames - 需要创建的测试项目名称
 * @returns 已完成应用初始化的测试工作区
 */
export async function prepareWorkspace(
  appPage: Page,
  e2eHomePath: string,
  projectNames: string[] = ['示例项目']
): Promise<PreparedWorkspace> {
  // projectsRoot 存储当前用例的临时源项目根目录。
  const projectsRoot = join(e2eHomePath, 'projects')
  // worktreesRoot 存储当前用例的临时 Worktree 根目录。
  const worktreesRoot = join(e2eHomePath, 'worktrees')
  await mkdir(worktreesRoot, { recursive: true })
  // projectPaths 存储按输入名称创建的真实 Git 仓库绝对路径。
  const projectPaths = await Promise.all(
    projectNames.map((projectName) =>
      createGitProject(projectsRoot, projectName)
    )
  )

  await appPage
    .getByRole('textbox', { name: '源项目根目录' })
    .fill(projectsRoot)
  await appPage
    .getByRole('textbox', { name: 'Worktree 根目录' })
    .fill(worktreesRoot)
  await appPage.getByRole('button', { name: '保存并开始使用' }).click()
  await appPage.getByText('配置项目路径').waitFor({ state: 'hidden' })
  await appPage.getByText('项目', { exact: true }).click()
  await appPage.getByText(projectNames[0], { exact: true }).waitFor()

  return { projectsRoot, worktreesRoot, projectPaths }
}
