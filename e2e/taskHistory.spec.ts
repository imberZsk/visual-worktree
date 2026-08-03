import { test, expect } from './fixtures/electronApp.ts'
import { createTaskThroughUi } from './helpers/uiActions.ts'
import { prepareWorkspace } from './helpers/workspaceFixture.ts'

test('没有删除记录时历史任务展示明确空状态', async ({
  appPage,
  e2eHomePath,
}) => {
  await prepareWorkspace(appPage, e2eHomePath, ['empty-history-source'])
  await appPage.getByText('Worktree', { exact: true }).click()
  await appPage.getByRole('button', { name: /历史任务/ }).click()
  await expect(appPage.getByText('暂无历史任务记录')).toBeVisible()
})

test('无项目任务删除后写入并展示当前工作区历史记录', async ({
  appPage,
  e2eHomePath,
}) => {
  await prepareWorkspace(appPage, e2eHomePath, ['history-source'])
  await appPage.getByText('Worktree', { exact: true }).click()
  await appPage.getByRole('button', { name: '创建 Worktree' }).click()
  await appPage
    .getByPlaceholder('PROJ-1234-需求简述')
    .fill('chore-history-case')
  await appPage.getByRole('button', { name: /^创\s*建$/ }).click()
  await expect(
    appPage.getByText('chore-history-case', { exact: true }).first()
  ).toBeVisible()

  await appPage.getByRole('button', { name: '删除任务', exact: true }).click()
  await expect(
    appPage.getByText(/删除任务「chore-history-case」/).last()
  ).toBeVisible()
  await appPage.locator('.ant-modal-confirm .ant-btn-dangerous').click()
  await expect(
    appPage.getByText('chore-history-case', { exact: true })
  ).toBeHidden()

  await appPage.getByRole('button', { name: /历史任务/ }).click()
  await expect(
    appPage.getByText('历史任务', { exact: true }).last()
  ).toBeVisible()
  await expect(
    appPage.getByText('chore-history-case', { exact: true })
  ).toBeVisible()
})

test('历史任务记录可以经确认后单独移除', async ({ appPage, e2eHomePath }) => {
  await prepareWorkspace(appPage, e2eHomePath, ['remove-history-source'])
  await createTaskThroughUi(appPage, 'chore-remove-history')
  await appPage.getByRole('button', { name: '删除任务', exact: true }).click()
  await appPage.locator('.ant-modal-confirm .ant-btn-dangerous').click()
  await appPage.getByRole('button', { name: /历史任务/ }).click()
  await expect(
    appPage.getByText('chore-remove-history', { exact: true })
  ).toBeVisible()
  await appPage.getByRole('button', { name: '从历史中移除' }).click()
  await appPage.locator('.ant-modal-confirm .ant-btn-dangerous').click()
  await expect(appPage.getByText('暂无历史任务记录')).toBeVisible()
})
