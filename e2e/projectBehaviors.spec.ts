import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './fixtures/electronApp.ts'
import { runGit } from './helpers/gitFixture.ts'
import { prepareWorkspace } from './helpers/workspaceFixture.ts'

test('项目搜索支持命中、无结果和清空恢复', async ({ appPage, e2eHomePath }) => {
  await prepareWorkspace(appPage, e2eHomePath, ['search-alpha', 'search-beta'])
  // searchInput 存储项目列表的搜索输入框。
  const searchInput = appPage.getByPlaceholder('搜索项目名')
  await searchInput.fill('alpha')
  await expect(appPage.getByText('search-alpha', { exact: true })).toBeVisible()
  await expect(appPage.getByText('search-beta', { exact: true })).toBeHidden()
  await searchInput.fill('missing-project')
  await expect(
    appPage.getByText('暂无数据', { exact: true }).last()
  ).toBeVisible()
  await searchInput.clear()
  await expect(appPage.getByText('search-beta', { exact: true })).toBeVisible()
})

test('项目筛选区分主分支、非主分支和有变更项目', async ({
  appPage,
  e2eHomePath,
}) => {
  // workspace 存储两个真实 Git 项目的隔离工作区。
  const workspace = await prepareWorkspace(appPage, e2eHomePath, [
    'main-project',
    'feature-project',
  ])
  await runGit(workspace.projectPaths[1], [
    'checkout',
    '-b',
    'feat/filter-case',
  ])
  await writeFile(join(workspace.projectPaths[0], 'dirty.txt'), 'dirty\n')
  await appPage.getByRole('button', { name: '刷新', exact: true }).click()

  await appPage.getByText('非主分支', { exact: true }).last().click()
  await expect(
    appPage.getByText('feature-project', { exact: true })
  ).toBeVisible()
  await expect(appPage.getByText('main-project', { exact: true })).toBeHidden()
  await appPage.getByText('有变更', { exact: true }).click()
  await expect(appPage.getByText('main-project', { exact: true })).toBeVisible()
  await expect(
    appPage.getByText('feature-project', { exact: true })
  ).toBeHidden()
  await appPage.getByText('全部', { exact: true }).click()
  await expect(
    appPage.getByText('feature-project', { exact: true })
  ).toBeVisible()
})

test('非主分支项目可通过界面真实切回主分支', async ({
  appPage,
  e2eHomePath,
}) => {
  // workspace 存储需要切换真实分支的测试项目。
  const workspace = await prepareWorkspace(appPage, e2eHomePath, [
    'branch-project',
  ])
  // projectPath 存储当前测试仓库的绝对路径。
  const projectPath = workspace.projectPaths[0]
  await runGit(projectPath, ['checkout', '-b', 'feat/e2e-branch'])
  await appPage.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(
    appPage.getByText('feat/e2e-branch', { exact: true })
  ).toBeVisible()
  await appPage.getByRole('button', { name: /切主分支/ }).click()
  await expect(appPage.getByText('main', { exact: true })).toBeVisible()
  // currentBranch 存储界面操作后 Git 实际检出的分支名。
  const currentBranch = await runGit(projectPath, ['branch', '--show-current'])
  expect(currentBranch.trim()).toBe('main')
})

test('复制项目路径写入 macOS 系统剪贴板', async ({
  appPage,
  electronApp,
  e2eHomePath,
}) => {
  // workspace 存储需要复制路径的测试项目。
  const workspace = await prepareWorkspace(appPage, e2eHomePath, [
    'clipboard-project',
  ])
  await appPage.locator('tr[data-row-key] .anticon-copy').click()
  // clipboardText 存储 Electron 主进程从 macOS 系统剪贴板读回的文本。
  const clipboardText = await electronApp.evaluate(({ clipboard }) =>
    clipboard.readText()
  )
  expect(clipboardText).toContain(workspace.projectPaths[0])
})
