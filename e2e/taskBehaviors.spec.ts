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
  // testingColumn 存储任务所在的“测试中”动态状态列，用于比较标题模块与任务卡片边界。
  const testingColumn = testingTaskCard.locator(
    'xpath=ancestor::*[contains(@class, "kanban-column")]'
  )
  // columnHeaderBounds 存储“测试中”标题模块的实际像素边界。
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

test('动态看板支持全区域横向滚动、隐藏列和任务置顶并持久化', async ({
  appPage,
  e2eHomePath,
}) => {
  await prepareWorkspace(appPage, e2eHomePath, ['dynamic-kanban-source'])
  await createTaskThroughUi(appPage, 'feat-kanban-pin')
  await appPage.setViewportSize({ width: 900, height: 700 })
  await appPage.getByRole('button', { name: '设置', exact: true }).click()
  await appPage.getByRole('tab', { name: '展示' }).click()
  await appPage.getByRole('button', { name: '配置任务状态' }).click()
  // statusDialog 存储任务状态编辑弹层，看板显示与固定偏好统一在这里配置。
  const statusDialog = appPage.getByRole('dialog', { name: /任务状态（/ })
  await statusDialog.getByRole('checkbox', { name: '看板展示 待提测' }).click()
  await statusDialog.getByRole('button', { name: /完\s*成/ }).click()
  await appPage.locator('.ant-drawer-footer button').last().click()
  await expect(appPage.getByRole('dialog', { name: '设置' })).toBeHidden()
  await appPage.getByText('看板', { exact: true }).click()

  // kanbanColumns 存储设置页筛选后生成的动态看板列。
  const kanbanColumns = appPage.locator('.kanban-column')
  await expect(kanbanColumns).toHaveCount(6)
  await expect(appPage.getByRole('button', { name: '设置看板列' })).toHaveCount(
    0
  )
  // boardScroll 存储看板横向滚动视口，用于验证多列不会被压缩到一屏。
  const boardScroll = appPage.locator('.kanban-board-scroll')
  // horizontalOverflowPx 存储看板内容超出可视区的横向像素。
  const horizontalOverflowPx = await boardScroll.evaluate(
    (element) => element.scrollWidth - element.clientWidth
  )
  expect(horizontalOverflowPx).toBeGreaterThan(0)
  await expect(appPage.locator('[data-status-key="pending-test"]')).toHaveCount(
    0
  )
  // boardScrollBox 存储横向滚动视口边界，下方空白区域也必须属于该视口。
  const boardScrollBox = await boardScroll.boundingBox()
  expect(boardScrollBox).not.toBeNull()
  if (!boardScrollBox) throw new Error('无法读取看板横向滚动视口边界')
  expect(boardScrollBox.height).toBeGreaterThan(500)
  await appPage.mouse.move(
    boardScrollBox.x + boardScrollBox.width / 2,
    boardScrollBox.y + boardScrollBox.height - 24
  )
  await appPage.mouse.wheel(480, 0)
  await expect
    .poll(() => boardScroll.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0)

  await appPage
    .getByRole('button', {
      name: '置顶任务 feat-kanban-pin',
    })
    .click()
  await expect(
    appPage.getByRole('button', { name: '取消置顶任务 feat-kanban-pin' })
  ).toBeVisible()

  await appPage.reload()
  await appPage.getByText('看板', { exact: true }).click()
  await expect(appPage.locator('.kanban-column')).toHaveCount(6)
  await expect(appPage.locator('[data-status-key="pending-test"]')).toHaveCount(
    0
  )
  await expect(
    appPage.getByRole('button', { name: '取消置顶任务 feat-kanban-pin' })
  ).toBeVisible()
  await expect(
    appPage.getByRole('button', {
      name: '在 VSCode 中打开任务 feat-kanban-pin',
    })
  ).toBeEnabled()
})
