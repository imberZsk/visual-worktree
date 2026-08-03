import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './fixtures/electronApp.ts'
import { createTaskThroughUi } from './helpers/uiActions.ts'
import { prepareWorkspace } from './helpers/workspaceFixture.ts'

test('不选择项目时只创建空任务目录并展示追加项目入口', async ({
  appPage,
  e2eHomePath,
}) => {
  // workspace 存储空任务对应的隔离 Worktree 根目录。
  const workspace = await prepareWorkspace(appPage, e2eHomePath, [
    'empty-task-source',
  ])
  await createTaskThroughUi(appPage, 'chore-empty-task')
  await expect(appPage.getByText('还没有项目 worktree')).toBeVisible()
  await expect(appPage.getByRole('button', { name: /添加项目/ })).toBeVisible()
  await access(join(workspace.worktreesRoot, 'chore-empty-task'))
})

test('干净 Worktree 可以删除并同步移除任务目录', async ({
  appPage,
  e2eHomePath,
}) => {
  // workspace 存储待删除 Worktree 的隔离路径。
  const workspace = await prepareWorkspace(appPage, e2eHomePath, [
    'clean-remove-project',
  ])
  await createTaskThroughUi(appPage, 'fix-clean-remove', [
    'clean-remove-project',
  ])
  await appPage.getByRole('button', { name: '删除任务', exact: true }).click()
  await appPage.locator('.ant-modal-confirm .ant-btn-dangerous').click()
  await expect(
    appPage
      .locator('.ant-collapse-header')
      .filter({ hasText: 'fix-clean-remove' })
  ).toHaveCount(0)
  await expect(
    access(join(workspace.worktreesRoot, 'fix-clean-remove'))
  ).rejects.toThrow()
})

test('有未提交变更的 Worktree 删除时要求再次确认并可取消保留', async ({
  appPage,
  e2eHomePath,
}) => {
  // workspace 存储需要制造脏改动的 Worktree 根目录。
  const workspace = await prepareWorkspace(appPage, e2eHomePath, [
    'dirty-remove-project',
  ])
  await createTaskThroughUi(appPage, 'fix-dirty-remove', [
    'dirty-remove-project',
  ])
  // dirtyWorktreePath 存储测试任务下真实 Worktree 的绝对路径。
  const dirtyWorktreePath = join(
    workspace.worktreesRoot,
    'fix-dirty-remove',
    'dirty-remove-project'
  )
  await writeFile(join(dirtyWorktreePath, 'uncommitted.txt'), 'keep me\n')
  await appPage.getByRole('button', { name: '删除任务', exact: true }).click()
  await appPage.locator('.ant-modal-confirm .ant-btn-dangerous').click()
  await expect(appPage.getByText(/有未提交变更/).last()).toBeVisible()
  await appPage
    .getByRole('button', { name: /取\s*消/ })
    .last()
    .click()
  await expect(
    appPage.getByText('fix-dirty-remove', { exact: true }).first()
  ).toBeVisible()
  await access(dirtyWorktreePath)
})

test('有未提交变更的 Worktree 经明确二次确认后可强制删除', async ({
  appPage,
  e2eHomePath,
}) => {
  // workspace 存储强制删除测试的 Worktree 根目录。
  const workspace = await prepareWorkspace(appPage, e2eHomePath, [
    'force-remove-project',
  ])
  await createTaskThroughUi(appPage, 'fix-force-remove', [
    'force-remove-project',
  ])
  // forceWorktreePath 存储需要强制删除的脏 Worktree 路径。
  const forceWorktreePath = join(
    workspace.worktreesRoot,
    'fix-force-remove',
    'force-remove-project'
  )
  await writeFile(join(forceWorktreePath, 'uncommitted.txt'), 'discard me\n')
  await appPage.getByRole('button', { name: '删除任务', exact: true }).click()
  await appPage.locator('.ant-modal-confirm .ant-btn-dangerous').click()
  await expect(appPage.getByText(/有未提交变更/).last()).toBeVisible()
  await appPage.getByRole('button', { name: '强制删除' }).click()
  await expect(
    appPage
      .locator('.ant-collapse-header')
      .filter({ hasText: 'fix-force-remove' })
  ).toHaveCount(0)
  await expect(access(forceWorktreePath)).rejects.toThrow()
})
