import { test, expect } from './fixtures/electronApp.ts'
import { createTaskThroughUi } from './helpers/uiActions.ts'
import { prepareWorkspace } from './helpers/workspaceFixture.ts'

test('设置取消后不保存展示开关修改', async ({
  appPage,
  e2eHomePath,
}, testInfo) => {
  await prepareWorkspace(appPage, e2eHomePath)
  await appPage.getByRole('button', { name: '设置', exact: true }).click()
  await appPage.getByRole('tab', { name: '展示' }).click()
  await expect(
    appPage.getByText(
      '按需选择任务标题旁显示哪些辅助信息，让任务列表保持清爽但不丢关键状态。'
    )
  ).toHaveCount(0)
  await appPage.getByLabel('项目数量说明').hover()
  await expect(appPage.getByText('任务包含的项目数。')).toBeVisible()
  await appPage.getByRole('tab', { name: '展示' }).hover()
  // displayScreenshotPath 存储精简后的展示徽标卡片截图，用于检查标题、问号和开关的紧凑布局。
  const displayScreenshotPath = testInfo.outputPath(
    'settings-display-badges.png'
  )
  await appPage.screenshot({
    path: displayScreenshotPath,
    animations: 'disabled',
  })
  await testInfo.attach('settings-display-badges', {
    path: displayScreenshotPath,
    contentType: 'image/png',
  })
  // projectCountSwitch 存储任务项目数徽标的展示开关。
  const projectCountSwitch = appPage
    .getByTestId('display-badge-card-projectCount')
    .getByRole('switch')
  await expect(projectCountSwitch).toBeChecked()
  await projectCountSwitch.click()
  await appPage.locator('.ant-drawer-footer button').nth(1).click()
  await appPage.getByRole('button', { name: '设置', exact: true }).click()
  await appPage.getByRole('tab', { name: '展示' }).click()
  await expect(
    appPage.getByTestId('display-badge-card-projectCount').getByRole('switch')
  ).toBeChecked()
})

test('连续切换工作区时两条居中提示保持完整间距', async ({
  appPage,
  e2eHomePath,
}, testInfo) => {
  // workspace 存储当前用例创建的真实项目与 Worktree 根目录，两个路径组合复用目录以缩短切换扫描时间。
  const workspace = await prepareWorkspace(appPage, e2eHomePath)
  await expect(appPage.locator('.ant-message-notice')).toHaveCount(0, {
    timeout: 5000,
  })
  await appPage.evaluate(async ({ projectsRoot, worktreesRoot }) => {
    // currentConfig 存储首次引导完成后的完整配置，新增路径组合时保留其它工作区设置。
    const currentConfig = await window.api.loadConfig()
    await window.api.saveConfig({
      ...currentConfig,
      activePathProfileId: 'work',
      pathProfiles: [
        {
          id: 'work',
          name: '工作区',
          sourceProjectsPath: projectsRoot,
          worktreesPath: worktreesRoot,
          settings: { onboardingCompleted: true },
        },
        {
          id: 'personal',
          name: '个人区',
          sourceProjectsPath: projectsRoot,
          worktreesPath: worktreesRoot,
          settings: { onboardingCompleted: true },
        },
      ],
    })
  }, workspace)
  await appPage.reload()
  await expect(
    appPage.getByText('工作区', { exact: true }).first()
  ).toBeVisible()

  // profileSelect 存储顶部路径组合选择器，连续切换用于让两条成功提示同时存在。
  const profileSelect = appPage.locator('.app-header__path-profile')
  await profileSelect.click()
  await appPage.getByText('个人区', { exact: true }).last().click()
  await expect(appPage.getByText('已切换到「个人区」')).toBeVisible()
  await expect(profileSelect).toBeEnabled()
  await profileSelect.click()
  await appPage.getByText('工作区', { exact: true }).last().click()
  await expect(appPage.getByText('已切换到「工作区」')).toBeVisible()

  // notices 存储两条尚未过期的全局提示，必须同时可见且不互相遮挡。
  const notices = appPage.locator('.ant-message-notice')
  await expect(notices).toHaveCount(2)
  // messageListBox 存储 Ant Design 消息滚动容器边界；任何提示越过该边界都会被 overflow 裁切。
  const messageListBox = await appPage
    .locator('.ant-message-list')
    .boundingBox()
  // noticeBoxes 存储提示框按屏幕纵坐标排序后的真实边界，用于验证两条消息之间保留可见间距。
  const noticeBoxes = await notices.evaluateAll((nodes) =>
    nodes
      .map((node) => {
        const rect = node.getBoundingClientRect()
        return { top: rect.top, bottom: rect.bottom }
      })
      .sort((left, right) => left.top - right.top)
  )
  expect(messageListBox).not.toBeNull()
  expect(noticeBoxes[0].top).toBeGreaterThanOrEqual(messageListBox!.y)
  expect(noticeBoxes.at(-1)!.bottom).toBeLessThanOrEqual(
    messageListBox!.y + messageListBox!.height
  )
  expect(noticeBoxes[1].top - noticeBoxes[0].bottom).toBeGreaterThanOrEqual(8)

  // screenshotPath 存储双提示真实渲染截图，便于无头测试后检查居中位置和视觉间距。
  const screenshotPath = testInfo.outputPath('centered-message-pair.png')
  await appPage.screenshot({ path: screenshotPath, animations: 'disabled' })
  await testInfo.attach('centered-message-pair', {
    path: screenshotPath,
    contentType: 'image/png',
  })
})

test('Token 计价开关控制输入可编辑并保存统计工具', async ({
  appPage,
  e2eHomePath,
}) => {
  await prepareWorkspace(appPage, e2eHomePath)
  await appPage.getByRole('button', { name: '设置', exact: true }).click()
  await appPage.getByRole('tab', { name: 'Token 费用' }).click()
  // pricingPanel 存储 Token 计价设置区域。
  const pricingPanel = appPage.getByTestId('token-pricing-settings-panel')
  // pricingSwitch 存储自定义 Token 计价启用开关。
  const pricingSwitch = pricingPanel.getByRole('switch', {
    name: '启用自定义计价',
  })
  await expect(pricingSwitch).not.toBeChecked()
  await expect(pricingPanel.getByRole('spinbutton').first()).toBeDisabled()
  await pricingSwitch.click()
  await expect(pricingPanel.getByRole('spinbutton').first()).toBeEnabled()
  await pricingPanel.getByRole('combobox').click()
  await appPage.getByText('Codex', { exact: true }).last().click()
  await pricingPanel.getByRole('spinbutton').first().fill('4.5')
  await appPage.locator('.ant-drawer-footer button').last().click()

  await appPage.getByRole('button', { name: '设置', exact: true }).click()
  await appPage.getByRole('tab', { name: 'Token 费用' }).click()
  await expect(
    appPage
      .getByTestId('token-pricing-settings-panel')
      .getByText('Codex', { exact: true })
  ).toBeVisible()
  await expect(
    appPage
      .getByTestId('token-pricing-settings-panel')
      .getByRole('spinbutton')
      .first()
  ).toHaveValue('4.500000')
})

test('CI/CD 空态保持标签到新增按钮的标准间距', async ({
  appPage,
  e2eHomePath,
}, testInfo) => {
  await prepareWorkspace(appPage, e2eHomePath)
  await appPage.getByRole('button', { name: '设置', exact: true }).click()
  await appPage.getByRole('tab', { name: 'CI/CD' }).click()

  // cicdLabel 存储 CI/CD 配置的可见表单标签，用于测量标签与首个控件的真实间距。
  const cicdLabel = appPage.getByText('CI/CD 流水线地址（按项目配置，选填）', {
    exact: true,
  })
  // addCicdButton 存储 CI/CD 空态下唯一可见的配置控件。
  const addCicdButton = appPage.getByRole('button', {
    name: '添加项目 CI/CD 地址',
  })
  // cicdContent 存储列表内容容器，用于确认空列表不会留下参与 gap 计算的滚动子项。
  const cicdContent = addCicdButton.locator(
    'xpath=ancestor::div[contains(@class, "settings-list-content")]'
  )
  await expect(cicdContent.locator('.settings-list-scroll')).toHaveCount(0)

  // labelBox 与 buttonBox 存储渲染后的边界，验证标准标签间距而非只检查 class 名。
  const labelBox = await cicdLabel.boundingBox()
  const buttonBox = await addCicdButton.boundingBox()
  expect(labelBox).not.toBeNull()
  expect(buttonBox).not.toBeNull()
  // labelToControlGapPx 存储可见标签底部到按钮顶部的距离；允许 1px 抗锯齿取整误差。
  const labelToControlGapPx = buttonBox!.y - (labelBox!.y + labelBox!.height)
  expect(labelToControlGapPx).toBeGreaterThanOrEqual(7)
  expect(labelToControlGapPx).toBeLessThanOrEqual(9)

  // screenshotPath 存储 CI/CD 空态验收截图，供无头测试后人工检查整体视觉节奏。
  const screenshotPath = testInfo.outputPath('settings-cicd-empty.png')
  await appPage.screenshot({ path: screenshotPath, animations: 'disabled' })
  await testInfo.attach('settings-cicd-empty', {
    path: screenshotPath,
    contentType: 'image/png',
  })
})

test('任务状态新增删除和数量更新后在任务与看板中持久生效', async ({
  appPage,
  e2eHomePath,
}, testInfo) => {
  await prepareWorkspace(appPage, e2eHomePath, ['status-label-source'])
  await appPage.getByRole('button', { name: '设置', exact: true }).click()
  await appPage.getByRole('tab', { name: '展示' }).click()
  // developingRow 存储稳定“开发中”状态所在行，避免依赖可变的列表序号。
  const developingRow = appPage.getByTestId('task-status-row-developing')
  // developingInput 存储稳定“开发中”状态对应的名称输入框。
  const developingInput = developingRow.getByRole('textbox', {
    name: '状态名称',
  })
  await expect(developingInput).toHaveValue('开发中')
  await developingInput.fill('处理中')

  // statusSettings 存储完整动态状态配置区，数量标题应随增删即时更新。
  const statusSettings = appPage.getByTestId('task-status-settings')
  await expect(statusSettings.getByText('任务状态（7/20）')).toBeVisible()
  await expect(
    statusSettings.locator('.settings-status-name-field .ant-form-item-tooltip')
  ).toHaveCount(0)
  await expect(statusSettings.getByText('状态 2', { exact: true })).toHaveCount(
    0
  )
  await statusSettings.getByRole('button', { name: '添加任务状态' }).click()
  await expect(statusSettings.getByText('任务状态（8/20）')).toBeVisible()
  // customStatusRow 存储新增在列表末尾的状态行，默认归入进行中看板列。
  const customStatusRow = statusSettings.locator('.settings-status-row').last()
  await customStatusRow
    .getByRole('textbox', { name: '状态名称' })
    .fill('联调中')
  await expect(
    customStatusRow.getByText('进行中', { exact: true })
  ).toBeVisible()
  // selfTestingRow 存储要删除的内置“自测中”状态行，删除只影响状态定义，不删除任务数据。
  const selfTestingRow = statusSettings.getByTestId(
    'task-status-row-self-testing'
  )
  await selfTestingRow.getByRole('button', { name: '删除状态' }).click()
  await expect(statusSettings.getByText('任务状态（7/20）')).toBeVisible()

  // statusInputs 存储删除和新增完成后的七个状态名称输入框，用于验证列表数量与横向布局。
  const statusInputs = statusSettings.locator('input[aria-label="状态名称"]')
  await expect(statusInputs).toHaveCount(7)
  // horizontalOverflowPx 存储状态区超出自身可视宽度的像素数，正常三栏布局不应产生横向滚动。
  const horizontalOverflowPx = await statusSettings.evaluate(
    (element) => element.scrollWidth - element.clientWidth
  )
  expect(horizontalOverflowPx).toBeLessThanOrEqual(1)
  // 初始化成功消息属于瞬时反馈，截图前等待它退出，避免遮挡状态行影响视觉验收。
  await expect(appPage.locator('.ant-message-notice')).toHaveCount(0, {
    timeout: 5000,
  })
  // 截图状态设置区顶部，人工验收标题、名称、看板归类和图标操作的节奏。
  await statusSettings.evaluate((element) =>
    element.scrollIntoView({ block: 'start' })
  )
  // topScreenshotPath 存储状态设置区顶部的真实视口截图，避免长元素与固定底栏拼接产生伪影。
  const topScreenshotPath = testInfo.outputPath(
    'settings-task-status-labels-top.png'
  )
  await appPage.screenshot({
    path: topScreenshotPath,
    animations: 'disabled',
  })
  await testInfo.attach('settings-task-status-labels-top', {
    path: topScreenshotPath,
    contentType: 'image/png',
  })

  // addStatusButton 存储列表末尾新增操作；滚入视口后必须完整位于固定保存栏上方。
  const addStatusButton = statusSettings.getByRole('button', {
    name: '添加任务状态',
  })
  await addStatusButton.scrollIntoViewIfNeeded()
  // addButtonBox 与 footerBox 存储新增按钮和固定保存栏边界，用于防止底部操作被遮挡。
  const addButtonBox = await addStatusButton.boundingBox()
  const footerBox = await appPage.locator('.ant-drawer-footer').boundingBox()
  expect(addButtonBox).not.toBeNull()
  expect(footerBox).not.toBeNull()
  expect(
    footerBox!.y - (addButtonBox!.y + addButtonBox!.height)
  ).toBeGreaterThan(8)
  // bottomScreenshotPath 存储状态设置区底部的真实视口截图，用于验收末行、新增操作和保存栏间距。
  const bottomScreenshotPath = testInfo.outputPath(
    'settings-task-status-labels-bottom.png'
  )
  await appPage.screenshot({
    path: bottomScreenshotPath,
    animations: 'disabled',
  })
  await testInfo.attach('settings-task-status-labels-bottom', {
    path: bottomScreenshotPath,
    contentType: 'image/png',
  })

  await appPage.locator('.ant-drawer-footer button').last().click()
  await expect(appPage.getByRole('dialog', { name: '设置' })).toBeHidden()
  await createTaskThroughUi(appPage, 'feat-custom-status-label')
  await appPage.getByText('未开始', { exact: true }).click()
  await expect(appPage.getByText('自测中', { exact: true })).toHaveCount(0)
  await appPage.getByText('联调中', { exact: true }).last().click()
  await expect(
    appPage.getByText('联调中', { exact: true }).first()
  ).toBeVisible()

  await appPage.reload()
  await expect(
    appPage.getByText('feat-custom-status-label', { exact: true }).first()
  ).toBeVisible()
  await expect(
    appPage.getByText('联调中', { exact: true }).first()
  ).toBeVisible()
  await appPage.getByText('看板', { exact: true }).click()
  // customStatusCard 存储重载后仍使用自定义状态标签的任务卡片。
  const customStatusCard = appPage
    .locator('.ant-card')
    .filter({ hasText: 'feat-custom-status-label' })
  await expect(customStatusCard).toContainText('联调中')
})

test('恢复默认设置需要确认且恢复当前工作区展示配置', async ({
  appPage,
  e2eHomePath,
}) => {
  await prepareWorkspace(appPage, e2eHomePath)
  await appPage.getByRole('button', { name: '设置', exact: true }).click()
  await appPage.getByRole('tab', { name: '展示' }).click()
  await appPage
    .getByTestId('display-badge-card-projectCount')
    .getByRole('switch')
    .click()
  await appPage.locator('.ant-drawer-footer button').last().click()

  await appPage.getByRole('button', { name: '设置', exact: true }).click()
  await appPage.getByRole('button', { name: /恢复默认设置/ }).click()
  await expect(appPage.getByText('确认恢复默认设置？').last()).toBeVisible()
  await appPage.getByRole('button', { name: /确认恢复/ }).click()
  await appPage.getByRole('button', { name: '设置', exact: true }).click()
  await appPage.getByRole('tab', { name: '展示' }).click()
  await expect(
    appPage.getByTestId('display-badge-card-projectCount').getByRole('switch')
  ).toBeChecked()
})
