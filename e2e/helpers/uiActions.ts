import type { Page } from '@playwright/test'

/**
 * 通过真实界面创建任务，可选择零个或多个源项目生成 Worktree。
 * @param appPage - Electron 渲染进程页面
 * @param taskName - 任务目录及默认分支名称
 * @param projectNames - 需要创建 Worktree 的项目展示名称
 * @returns 完成创建后的异步流程
 */
export async function createTaskThroughUi(
  appPage: Page,
  taskName: string,
  projectNames: string[] = []
): Promise<void> {
  await appPage.getByText('Worktree', { exact: true }).click()
  await appPage.getByRole('button', { name: '创建 Worktree' }).click()
  await appPage.getByPlaceholder('PROJ-1234-需求简述').fill(taskName)
  if (projectNames.length > 0) {
    await appPage.getByRole('combobox', { name: /选择项目/ }).click()
    for (const projectName of projectNames) {
      await appPage
        .locator('.ant-select-dropdown:visible .ant-select-item-option')
        .filter({ hasText: projectName })
        .click()
    }
  }
  await appPage.getByRole('button', { name: /^创\s*建$/ }).click()
  await appPage.getByText(taskName, { exact: true }).first().waitFor()
}
