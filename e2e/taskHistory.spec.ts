import { test, expect } from './fixtures/electronApp.ts'
import { createTaskThroughUi } from './helpers/uiActions.ts'
import { prepareWorkspace } from './helpers/workspaceFixture.ts'

test('历史任务分页完整可见且切换下一页后保持稳定', async ({
  appPage,
  e2eHomePath,
}) => {
  await prepareWorkspace(appPage, e2eHomePath, ['paginated-history-source'])
  await appPage.setViewportSize({ width: 700, height: 520 })
  await appPage.evaluate(async () => {
    // historyEntries 存储不同链接行数的历史记录，用于覆盖翻页前后列表项高度不同的真实场景。
    const historyEntries = Array.from({ length: 14 }, (_, index) => ({
      task: `HISTORY-${index + 1}`,
      link:
        index % 2 === 0
          ? [
              { name: `JIRA-${index + 1}`, url: 'https://example.com/jira' },
              { name: `PRD-${index + 1}`, url: 'https://example.com/prd' },
            ]
          : [],
      deletedAt: new Date(2026, 7, 5, 12, index).toISOString(),
    }))
    for (const historyEntry of historyEntries) {
      await window.api.appendTaskHistory(historyEntry, 'default')
    }
  })

  await appPage.getByText('Worktree', { exact: true }).click()
  await appPage.getByRole('button', { name: /历史任务/ }).click()

  // historyDialog 存储历史任务弹层，用于校验分页器没有超出可见边界。
  const historyDialog = appPage.getByRole('dialog', { name: '历史任务' })
  // pagination 存储历史任务分页器根元素。
  const pagination = historyDialog.locator('.history-task-pagination')
  await expect(pagination).toBeVisible()
  // Ant Design 入场动画会持续改变 dialog 的缩放矩阵；等待动画类移除后再比较稳定几何边界。
  await expect(historyDialog).not.toHaveClass(/ant-zoom/)
  // dialogBox 存储历史任务弹层的屏幕边界。
  const dialogBox = await historyDialog.boundingBox()
  // paginationBox 存储分页器的屏幕边界。
  const paginationBox = await pagination.boundingBox()
  expect(dialogBox).not.toBeNull()
  expect(paginationBox).not.toBeNull()
  if (!dialogBox || !paginationBox) {
    throw new Error('无法读取历史任务弹层或分页器边界')
  }
  expect(paginationBox.y + paginationBox.height).toBeLessThanOrEqual(
    dialogBox.y + dialogBox.height
  )

  await pagination.locator('.ant-pagination-next button').click()
  await expect(pagination.locator('.ant-pagination-item-active')).toHaveText(
    '2'
  )
  // paginationTopSamples 存储翻页完成后连续渲染帧中的分页器纵坐标，用于识别持续布局抖动。
  const paginationTopSamples = await pagination.evaluate(
    async (paginationElement) => {
      // topSamples 存储每个渲染帧采集到的分页器顶部坐标。
      const topSamples = []
      for (let frameIndex = 0; frameIndex < 12; frameIndex += 1) {
        await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame))
        topSamples.push(paginationElement.getBoundingClientRect().top)
      }
      return topSamples
    }
  )
  expect(
    Math.max(...paginationTopSamples) - Math.min(...paginationTopSamples)
  ).toBeLessThan(1)

  await pagination.locator('.ant-pagination-item-3').click()
  await expect(pagination.locator('.ant-pagination-item-active')).toHaveText(
    '3'
  )
  await historyDialog
    .getByRole('button', { name: '从历史中移除' })
    .first()
    .click()
  await appPage.locator('.ant-modal-confirm .ant-btn-dangerous').click()
  await expect(pagination.locator('.ant-pagination-item-active')).toHaveText(
    '3'
  )
})

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
