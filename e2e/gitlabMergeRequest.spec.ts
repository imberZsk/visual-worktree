import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { test, expect } from './fixtures/electronApp.ts'
import { prepareWorkspace } from './helpers/workspaceFixture.ts'

// execFileAsync 存储 Promise 化的进程执行函数，用于给隔离测试仓库增加 GitLab remote。
const execFileAsync = promisify(execFile)

test('GitLab 图标悬停可选择多个设置分支创建 MR', async ({
  appPage,
  e2eHomePath,
}, testInfo) => {
  // workspace 存储隔离的项目根目录、Worktree 根目录和真实 Git 仓库路径。
  const workspace = await prepareWorkspace(appPage, e2eHomePath, [
    'gitlab-project',
  ])
  // projectPath 存储本用例唯一项目的绝对路径。
  const projectPath = workspace.projectPaths[0]
  await execFileAsync('git', [
    '-C',
    projectPath,
    'remote',
    'add',
    'origin',
    'git@gitlab.example.com:team/gitlab-project.git',
  ])

  await appPage.getByRole('button', { name: '刷新', exact: true }).click()
  // gitlabButton 存储项目行中支持悬停菜单的 GitLab 图标按钮。
  const gitlabButton = appPage.getByRole('button', {
    name: 'GitLab 操作 gitlab-project',
  })
  await expect(gitlabButton).toBeVisible()

  await appPage.getByRole('button', { name: '设置', exact: true }).click()
  // targetBranchSelect 存储设置页中的 MR 多目标分支 tags 选择器。
  const targetBranchSelect = appPage.getByRole('combobox', {
    name: 'GitLab MR 目标分支（可多个）',
  })
  await expect(appPage.locator('.ant-select-selection-item')).toContainText([
    'test',
  ])
  await targetBranchSelect.fill('master')
  await targetBranchSelect.press('Enter')
  await targetBranchSelect.fill('gamma')
  await targetBranchSelect.press('Enter')
  await appPage.locator('.ant-drawer-footer button').last().click()
  await expect(appPage.getByRole('dialog', { name: '设置' })).toBeHidden()

  await gitlabButton.hover()
  await expect(
    appPage.getByText('创建合并到 test 的 MR', { exact: true })
  ).toBeVisible()
  await expect(
    appPage.getByText('创建合并到 master 的 MR', { exact: true })
  ).toBeVisible()
  await expect(
    appPage.getByText('创建合并到 gamma 的 MR', { exact: true })
  ).toBeVisible()
  // screenshotPath 存储实际 Electron 界面中的 GitLab hover 菜单截图。
  const screenshotPath = testInfo.outputPath('gitlab-merge-request-hover.png')
  await appPage.screenshot({ path: screenshotPath, animations: 'disabled' })
  await testInfo.attach('gitlab-merge-request-hover', {
    path: screenshotPath,
    contentType: 'image/png',
  })
})
