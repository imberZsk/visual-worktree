import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './fixtures/electronApp.ts'
import { prepareWorkspace } from './helpers/workspaceFixture.ts'

test('按任务为多个项目创建真实 Worktree 并展示任务', async ({
  appPage,
  e2eHomePath,
}) => {
  // workspace 存储包含两个真实源仓库的隔离测试工作区。
  const workspace = await prepareWorkspace(appPage, e2eHomePath, [
    'alpha-project',
    'beta-project',
  ])
  await appPage.getByText('Worktree', { exact: true }).click()
  await appPage.getByRole('button', { name: /创建 Worktree/ }).click()
  await expect(
    appPage.getByRole('dialog', { name: '按任务创建 Worktree' })
  ).toBeVisible()
  await appPage.getByPlaceholder('PROJ-1234-需求简述').fill('feat-e2e-flow')
  await appPage.getByRole('combobox', { name: /选择项目/ }).click()
  await appPage
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: 'alpha-project' })
    .click()
  await appPage
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: 'beta-project' })
    .click()
  await expect(appPage.getByText(/将创建到/)).toHaveCount(0)
  await appPage.getByRole('button', { name: /^创\s*建$/ }).click()

  await expect(
    appPage.getByText('feat-e2e-flow', { exact: true }).first()
  ).toBeVisible()
  await expect(
    appPage.getByRole('button', { name: /项目数量 2/ })
  ).toBeVisible()
  await access(join(workspace.worktreesRoot, 'feat-e2e-flow', 'alpha-project'))
  await access(join(workspace.worktreesRoot, 'feat-e2e-flow', 'beta-project'))

  await appPage.getByText('未开始', { exact: true }).click()
  await appPage.getByText('开发中', { exact: true }).last().click()
  await expect(
    appPage.getByText('开发中', { exact: true }).first()
  ).toBeVisible()

  await appPage
    .getByRole('button', { name: '置顶任务 feat-e2e-flow', exact: true })
    .click()
  await expect(appPage.getByText('置顶', { exact: true })).toBeVisible()
  await appPage.getByText('环境正常', { exact: true }).first().click()
  await expect(appPage.getByText(/环境检查 · feat-e2e-flow/)).toBeVisible()
  await appPage.locator('.ant-modal-close:visible').click()

  await appPage
    .getByRole('button', { name: '打开需求流程 feat-e2e-flow', exact: true })
    .click()
  await expect(appPage.getByText('需求流程 - feat-e2e-flow')).toBeVisible()
  await appPage.locator('.ant-modal-close:visible').click()

  await appPage.getByText('看板', { exact: true }).click()
  await expect(
    appPage.getByText('feat-e2e-flow', { exact: true })
  ).toBeVisible()
  // taskCard 存储目标任务的看板卡片，避免动态列标题与卡片状态同名时定位歧义。
  const taskCard = appPage
    .locator('.kanban-task-card')
    .filter({ hasText: 'feat-e2e-flow' })
  await expect(taskCard.getByText('开发中', { exact: true })).toBeVisible()
  await appPage.getByRole('button', { name: /添加备注/ }).click()
  await appPage.getByPlaceholder(/记录任务备注/).fill('等待 E2E 联调完成')
  await appPage
    .getByTestId('kanban-blocker-actions')
    .getByRole('button', { name: /保\s*存/ })
    .click()
  await expect(appPage.getByText('等待 E2E 联调完成')).toBeVisible()
})
