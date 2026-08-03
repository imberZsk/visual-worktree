import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './fixtures/electronApp.ts'
import { createTaskThroughUi } from './helpers/uiActions.ts'
import { prepareWorkspace } from './helpers/workspaceFixture.ts'

test('没有安全候选时清理建议展示空状态且禁用删除', async ({
  appPage,
  e2eHomePath,
}) => {
  await prepareWorkspace(appPage, e2eHomePath, ['cleanup-empty-source'])
  await appPage.getByText('Worktree', { exact: true }).click()
  await appPage.getByRole('button', { name: /清理建议/ }).click()
  await expect(appPage.getByText('Worktree 清理建议')).toBeVisible()
  await expect(appPage.getByText('没有可安全删除的 worktree')).toBeVisible()
  await expect(appPage.getByRole('button', { name: /删除选中/ })).toBeDisabled()
})

test('已合并且干净的 Worktree 可从清理建议中安全删除', async ({
  appPage,
  e2eHomePath,
}) => {
  // workspace 存储安全清理候选的真实 Worktree 根路径。
  const workspace = await prepareWorkspace(appPage, e2eHomePath, [
    'cleanup-safe-source',
  ])
  await createTaskThroughUi(appPage, 'chore-cleanup-safe', [
    'cleanup-safe-source',
  ])
  // worktreePath 存储将由清理建议删除的真实 Worktree 路径。
  const worktreePath = join(
    workspace.worktreesRoot,
    'chore-cleanup-safe',
    'cleanup-safe-source'
  )
  await appPage.getByRole('button', { name: /清理建议/ }).click()
  await expect(
    appPage
      .locator('.ant-modal:visible tbody tr')
      .getByText('chore-cleanup-safe', { exact: true })
      .first()
  ).toBeVisible()
  await appPage
    .locator('.ant-modal:visible tbody .ant-checkbox-wrapper')
    .click()
  await appPage.getByRole('button', { name: /删除选中/ }).click()
  await appPage.getByRole('button', { name: /确定删除/ }).click()
  await expect(appPage.getByText('成功删除 1 个 worktree')).toBeVisible()
  await expect(access(worktreePath)).rejects.toThrow()
})
