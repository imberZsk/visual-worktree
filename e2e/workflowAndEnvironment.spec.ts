import { test, expect } from './fixtures/electronApp.ts'
import { createTaskThroughUi } from './helpers/uiActions.ts'
import { prepareWorkspace } from './helpers/workspaceFixture.ts'

test('项目私有流程可执行真实命令并回看最近输出', async ({
  appPage,
  e2eHomePath,
}) => {
  await prepareWorkspace(appPage, e2eHomePath, ['workflow-source'])
  await createTaskThroughUi(appPage, 'feat-workflow-command', [
    'workflow-source',
  ])

  await appPage
    .getByRole('button', {
      name: '打开需求流程 feat-workflow-command',
      exact: true,
    })
    .click()
  await appPage.getByRole('button', { name: '添加私有流程' }).click()
  // editor 存储顶层私有流程编辑弹窗，避免命中其后方仍保持打开的需求流程弹窗。
  const editor = appPage
    .locator('.ant-modal:visible')
    .filter({ hasText: '添加私有流程' })
    .last()
  await expect(
    editor.getByText('workflow-source', { exact: true })
  ).toBeVisible()
  await editor.getByPlaceholder('例如：运行项目单元测试').fill('输出验证')
  await editor
    .getByPlaceholder('留空时仅作为可勾选步骤')
    .fill("printf 'workflow-e2e-output\\n'")
  await editor.getByRole('button', { name: /保\s*存/ }).click()

  // stepRow 存储刚保存的项目私有流程行，用于限定执行和输出查看按钮。
  const stepRow = appPage
    .locator('[data-testid^="workflow-step-row-"]')
    .filter({ hasText: '输出验证' })
  await stepRow.getByRole('button', { name: /执行$/ }).click()
  await expect(appPage.getByText('workflow-e2e-output')).toBeVisible()
  await expect(appPage.getByText('执行成功（退出码 0）')).toBeVisible()
  await appPage
    .getByRole('button', { name: /关\s*闭/ })
    .last()
    .click()
  await expect(stepRow.getByText('已完成')).toBeVisible()

  await stepRow.locator('button').first().click()
  await expect(appPage.getByText('workflow-e2e-output')).toBeVisible()
})

test('空任务可以执行并重新运行环境健康检查', async ({
  appPage,
  e2eHomePath,
}) => {
  await prepareWorkspace(appPage, e2eHomePath, ['env-source'])
  await createTaskThroughUi(appPage, 'chore-env-health')

  await appPage.getByText('环境正常', { exact: true }).click()
  await expect(appPage.getByText('环境检查 · chore-env-health')).toBeVisible()
  await expect(appPage.getByText('任务目录下未找到项目')).toBeVisible()
  await appPage.getByRole('button', { name: '重新检查' }).click()
  await expect(appPage.getByText('任务目录下未找到项目')).toBeVisible()
  await expect(
    appPage.locator('.env-health-result-shell .ant-spin')
  ).toHaveCount(0)
})
