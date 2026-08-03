import { test, expect } from './fixtures/electronApp.ts'
import { createTaskThroughUi } from './helpers/uiActions.ts'
import { prepareWorkspace } from './helpers/workspaceFixture.ts'

test('任务支持隐藏、显示隐藏项和恢复显示', async ({ appPage, e2eHomePath }) => {
  await prepareWorkspace(appPage, e2eHomePath, ['visibility-source'])
  await createTaskThroughUi(appPage, 'chore-visibility-task')
  await appPage
    .getByRole('button', {
      name: '隐藏任务 chore-visibility-task',
      exact: true,
    })
    .click()
  await expect(
    appPage.getByText('chore-visibility-task', { exact: true })
  ).toBeHidden()
  await appPage.getByRole('button', { name: '显示隐藏任务' }).click()
  await expect(
    appPage.getByText('chore-visibility-task', { exact: true }).first()
  ).toBeVisible()
  await appPage
    .getByRole('button', {
      name: '恢复显示任务 chore-visibility-task',
      exact: true,
    })
    .click()
  await expect(appPage.getByText('已隐藏', { exact: true })).toBeHidden()
})

test('任务链接支持填写名称和地址、保存回显及清除', async ({
  appPage,
  e2eHomePath,
}) => {
  await prepareWorkspace(appPage, e2eHomePath, ['link-source'])
  await createTaskThroughUi(appPage, 'feat-task-link')
  // linkButton 存储任务标题操作区内的需求链接管理按钮。
  const linkButton = appPage
    .locator('.ant-collapse-header .anticon-link')
    .locator('xpath=ancestor::button')
  await linkButton.click()
  await appPage.getByPlaceholder('链接名称').fill('需求文档')
  await appPage
    .getByPlaceholder('如 Jira 地址、PRD')
    .fill('https://example.com/prd/1')
  await appPage
    .locator('.ant-popover:visible')
    .getByRole('button', { name: /保\s*存/ })
    .click()
  await expect(appPage.getByText('需求文档', { exact: true })).toBeVisible()

  await linkButton.click()
  await expect(appPage.getByPlaceholder('链接名称')).toHaveValue('需求文档')
  await appPage
    .locator('.ant-popover:visible')
    .getByRole('button', { name: /清\s*除/ })
    .click()
  await expect(appPage.getByText('需求文档', { exact: true })).toBeHidden()
})

test('任务状态可以切换并在看板移动到对应列', async ({
  appPage,
  e2eHomePath,
}, testInfo) => {
  await prepareWorkspace(appPage, e2eHomePath, ['status-source'])
  await createTaskThroughUi(appPage, 'feat-status-task')
  await appPage.getByText('未开始', { exact: true }).click()
  await appPage.getByText('测试中', { exact: true }).last().click()
  await expect(
    appPage.getByText('测试中', { exact: true }).first()
  ).toBeVisible()
  await appPage.getByText('看板', { exact: true }).click()
  // testingTaskCard 存储看板中同时包含任务名与目标状态的任务卡片。
  const testingTaskCard = appPage
    .locator('.ant-card')
    .filter({ hasText: 'feat-status-task' })
  await expect(testingTaskCard).toContainText('测试中')
  // testingColumn 存储任务所在的进行中列，用于比较标题模块与任务卡片边界。
  const testingColumn = testingTaskCard.locator(
    'xpath=ancestor::*[contains(@class, "kanban-column")]'
  )
  // columnHeaderBounds 存储进行中标题模块的实际像素边界。
  const columnHeaderBounds = await testingColumn
    .locator('.kanban-column-header')
    .boundingBox()
  // taskCardBounds 存储任务卡片的实际像素边界。
  const taskCardBounds = await testingTaskCard.boundingBox()
  expect(columnHeaderBounds).not.toBeNull()
  expect(taskCardBounds).not.toBeNull()
  // leftEdgeOffsetPx 存储标题和卡片左边缘偏移，允许 1px 渲染取整误差。
  const leftEdgeOffsetPx = Math.abs(taskCardBounds!.x - columnHeaderBounds!.x)
  // rightEdgeOffsetPx 存储标题和卡片右边缘偏移，防止滚动容器再次固定缩进。
  const rightEdgeOffsetPx = Math.abs(
    taskCardBounds!.x +
      taskCardBounds!.width -
      (columnHeaderBounds!.x + columnHeaderBounds!.width)
  )
  expect(leftEdgeOffsetPx).toBeLessThanOrEqual(1)
  expect(rightEdgeOffsetPx).toBeLessThanOrEqual(1)
  // screenshotPath 存储看板列对齐后的真实渲染截图，供无头视觉验收。
  const screenshotPath = testInfo.outputPath('kanban-column-alignment.png')
  await appPage.screenshot({ path: screenshotPath, animations: 'disabled' })
  await testInfo.attach('kanban-column-alignment', {
    path: screenshotPath,
    contentType: 'image/png',
  })
})
