import { test, expect } from './fixtures/electronApp.ts'
import { prepareWorkspace } from './helpers/workspaceFixture.ts'

// DELAYED_WORKTREE_SCAN_MS 存储首次视图加载验收使用的可观察扫描延迟。
const DELAYED_WORKTREE_SCAN_MS = 800

test('窄窗口主操作保持可达且刷新期间只展示一个内容 loading', async ({
  appPage,
  e2eHomePath,
}) => {
  await prepareWorkspace(appPage, e2eHomePath, ['narrow-project'])
  await appPage.setViewportSize({ width: 820, height: 620 })

  // horizontalOverflow 存储页面根节点超出视口的横向像素数。
  const horizontalOverflow = await appPage
    .locator('html')
    .evaluate((element) => element.scrollWidth - element.clientWidth)
  expect(horizontalOverflow).toBeLessThanOrEqual(0)
  await expect(appPage.getByRole('button', { name: /设置/ })).toBeVisible()
  await expect(appPage.getByPlaceholder('搜索项目名')).toBeVisible()

  await appPage.getByRole('button', { name: /刷新/ }).click()
  // visibleContentSpinners 存储刷新瞬间内容区实际可见的加载容器数量。
  const visibleContentSpinners = appPage.locator(
    'main .ant-spin-spinning:visible'
  )
  await expect(visibleContentSpinners).toHaveCount(1)
  await expect(
    appPage.getByText('narrow-project', { exact: true })
  ).toBeVisible()
})

test('首次任务视图切换使用局部 loading，刷新无悬停文字且 Header 布局稳定', async ({
  electronApp,
  appPage,
  e2eHomePath,
}, testInfo) => {
  await prepareWorkspace(appPage, e2eHomePath, ['loading-project'])
  await expect(appPage.getByText('初始化完成')).toBeHidden()
  await electronApp.evaluate(
    async ({ ipcMain }, scanOptions) => {
      ipcMain.removeHandler('scan-worktrees-by-task')
      ipcMain.handle('scan-worktrees-by-task', async () => {
        await new Promise((resolve) => setTimeout(resolve, scanOptions.delayMs))
        return []
      })
    },
    {
      delayMs: DELAYED_WORKTREE_SCAN_MS,
    }
  )

  await appPage.getByText('Worktree', { exact: true }).click()
  // worktreeLoadingState 存储首次切换时只显示 Spin 的局部加载区域。
  const worktreeLoadingState = appPage.getByRole('status', {
    name: 'Worktree 加载状态',
  })
  await expect(worktreeLoadingState.locator('.ant-spin')).toBeVisible()
  await expect(appPage.getByText('正在加载 Worktree...')).toHaveCount(0)
  // loadingScreenshotPath 存储 Worktree 局部加载状态截图。
  const loadingScreenshotPath = testInfo.outputPath(
    'worktree-local-loading.png'
  )
  await appPage.screenshot({
    path: loadingScreenshotPath,
    animations: 'disabled',
  })
  await testInfo.attach('worktree-local-loading', {
    path: loadingScreenshotPath,
    contentType: 'image/png',
  })
  await expect(appPage.getByText(/暂无 worktree/)).toBeVisible()

  await appPage.getByText('项目', { exact: true }).click()
  await appPage.getByText('看板', { exact: true }).click()
  // kanbanLoadingState 存储首次切换时只显示 Spin 的局部加载区域。
  const kanbanLoadingState = appPage.getByRole('status', {
    name: '看板加载状态',
  })
  await expect(kanbanLoadingState.locator('.ant-spin')).toBeVisible()
  await expect(appPage.getByText('正在加载看板...')).toHaveCount(0)
  // kanbanLoadingScreenshotPath 存储看板局部加载状态截图。
  const kanbanLoadingScreenshotPath = testInfo.outputPath(
    'kanban-local-loading.png'
  )
  await appPage.screenshot({
    path: kanbanLoadingScreenshotPath,
    animations: 'disabled',
  })
  await testInfo.attach('kanban-local-loading', {
    path: kanbanLoadingScreenshotPath,
    contentType: 'image/png',
  })
  await expect(appPage.getByText('待启动', { exact: true })).toBeVisible()

  // headerTitleBounds 存储 macOS 标题相对窗口左侧的位置，用于锁定交通灯后的安全间距。
  const headerTitleBounds = await appPage
    .locator('.app-header__title')
    .boundingBox()
  expect(headerTitleBounds?.x).toBeGreaterThanOrEqual(96)

  // refreshButton 存储 Header 刷新操作，悬停后不应再生成重复文字浮层。
  const refreshButton = appPage.getByRole('button', { name: '刷新' })
  await refreshButton.hover()
  // headerScreenshotPath 存储去除重复原生标题栏后的应用内容 Header 截图。
  const headerScreenshotPath = testInfo.outputPath('custom-app-header.png')
  await appPage.screenshot({
    path: headerScreenshotPath,
    animations: 'disabled',
  })
  await expect(appPage.getByRole('tooltip', { name: '刷新' })).toHaveCount(0)
  await testInfo.attach('custom-app-header', {
    path: headerScreenshotPath,
    contentType: 'image/png',
  })
})
