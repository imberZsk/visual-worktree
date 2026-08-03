import { test, expect } from './fixtures/electronApp.ts'
import { prepareWorkspace } from './helpers/workspaceFixture.ts'

test('项目操作区不再提供修改源目录的同步更新按钮', async ({
  appPage,
  e2eHomePath,
}, testInfo) => {
  await prepareWorkspace(appPage, e2eHomePath, ['source-project'])

  await expect(
    appPage.getByText('source-project', { exact: true })
  ).toBeVisible()
  await expect(appPage.getByRole('button', { name: '同步更新' })).toHaveCount(0)
  // 初始化成功消息属于瞬时反馈，截图前等待它退出，避免遮挡项目操作区。
  await expect(appPage.locator('.ant-message-notice')).toHaveCount(0, {
    timeout: 5000,
  })
  // screenshotPath 存储项目 Tab 操作区验收截图，用于确认移除按钮后其他操作仍对齐。
  const screenshotPath = testInfo.outputPath(
    'project-actions-without-sync-updates.png'
  )
  await appPage.screenshot({ path: screenshotPath, animations: 'disabled' })
  await testInfo.attach('project-actions-without-sync-updates', {
    path: screenshotPath,
    contentType: 'image/png',
  })
})

test('项目视图支持搜索、详情、置顶、隐藏与恢复显示', async ({
  appPage,
  e2eHomePath,
}) => {
  await prepareWorkspace(appPage, e2eHomePath, [
    'alpha-project',
    'beta-project',
  ])

  await expect(appPage.getByText('项目总数').locator('../..')).toContainText(
    '2'
  )
  await appPage.getByPlaceholder('搜索项目名').fill('alpha')
  await expect(
    appPage.getByText('alpha-project', { exact: true })
  ).toBeVisible()
  await expect(appPage.getByText('beta-project', { exact: true })).toBeHidden()
  await appPage.getByPlaceholder('搜索项目名').clear()

  await appPage.getByRole('button', { name: '置顶项目 beta-project' }).click()
  await expect(appPage.getByText('置顶', { exact: true })).toBeVisible()
  await appPage.getByRole('button', { name: '隐藏项目 alpha-project' }).click()
  await expect(appPage.getByText('alpha-project', { exact: true })).toBeHidden()
  await appPage.getByRole('button', { name: '显示隐藏项目' }).click()
  await expect(
    appPage.getByText('alpha-project', { exact: true })
  ).toBeVisible()
  await appPage
    .getByRole('button', { name: '恢复显示项目 alpha-project' })
    .click()

  await appPage
    .getByRole('button', { name: /详\s*情/ })
    .first()
    .click()
  await expect(
    appPage.getByText('beta-project', { exact: true }).last()
  ).toBeVisible()
  await appPage.locator('.ant-drawer-close').click()
})

test('主题切换和设置弹窗在常用窗口尺寸下可完整操作', async ({
  appPage,
  e2eHomePath,
}) => {
  await prepareWorkspace(appPage, e2eHomePath)
  await appPage.setViewportSize({ width: 1000, height: 700 })

  // themeButton 存储当前主题对应的太阳或月亮图标按钮。
  const themeButton = appPage
    .locator('.anticon-sun, .anticon-moon')
    .first()
    .locator('xpath=ancestor::button')
  // originalBackground 存储切换前 body 的背景色，用于验证主题确实发生变化。
  const originalBackground = await appPage
    .locator('body')
    .evaluate((element) => getComputedStyle(element).backgroundColor)
  await themeButton.click()
  await expect(appPage.locator('body')).not.toHaveCSS(
    'background-color',
    originalBackground
  )
  await appPage.getByRole('button', { name: /设置/ }).click()
  await expect(appPage.getByRole('dialog', { name: '设置' })).toBeVisible()
  await expect(appPage.getByRole('tab', { name: '路径' })).toBeVisible()
  await expect(appPage.getByRole('tab', { name: '流程' })).toBeVisible()
  await expect(appPage.getByRole('tab', { name: '展示' })).toBeVisible()
  // tabName 依次存储需要验证可切换且内容可达的设置分页名称。
  for (const tabName of [
    '工具',
    '工作文档',
    '流程',
    'Token 费用',
    '展示',
    'CI/CD',
  ]) {
    await appPage.getByRole('tab', { name: tabName }).click()
    await expect(appPage.getByRole('tab', { name: tabName })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  }
  await appPage.getByRole('tab', { name: '展示' }).click()
  // projectCountSwitch 存储项目数徽标的展示开关，用于验证设置落盘与重新加载。
  const projectCountSwitch = appPage
    .getByTestId('display-badge-card-projectCount')
    .getByRole('switch')
  await expect(projectCountSwitch).toBeChecked()
  await projectCountSwitch.click()
  await appPage.locator('.ant-drawer-footer button').last().click()
  await expect(appPage.getByRole('dialog', { name: '设置' })).toBeHidden()

  await appPage.getByRole('button', { name: /设置/ }).click()
  await appPage.getByRole('tab', { name: '展示' }).click()
  await expect(
    appPage.getByTestId('display-badge-card-projectCount').getByRole('switch')
  ).not.toBeChecked()
  await appPage.locator('.ant-drawer-footer button').nth(1).click()
})
