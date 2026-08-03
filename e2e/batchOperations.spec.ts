import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './fixtures/electronApp.ts'
import { runGit } from './helpers/gitFixture.ts'
import { prepareWorkspace } from './helpers/workspaceFixture.ts'

test('批量菜单先拉取再切主分支且不再提供暂存入口', async ({
  appPage,
  e2eHomePath,
}, testInfo) => {
  // workspace 存储两个待批量切换分支的真实仓库。
  const workspace = await prepareWorkspace(appPage, e2eHomePath, [
    'checkout-one',
    'checkout-two',
  ])
  for (const projectPath of workspace.projectPaths) {
    await runGit(projectPath, ['checkout', '-b', 'feat/batch-checkout'])
  }
  await appPage.getByRole('button', { name: '刷新', exact: true }).click()
  await appPage.locator('tr[data-row-key] .ant-checkbox-wrapper').nth(0).click()
  await appPage.locator('tr[data-row-key] .ant-checkbox-wrapper').nth(1).click()
  await appPage.getByRole('button', { name: /批量操作（2）/ }).click()
  // batchMenuItems 存储当前展开菜单的可见操作项，用于锁定顺序和入口集合。
  const batchMenuItems = appPage.locator(
    '.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item'
  )
  await expect(batchMenuItems).toHaveCount(2)
  await expect(batchMenuItems.nth(0)).toHaveText('批量拉取更新')
  await expect(batchMenuItems.nth(1)).toHaveText('批量切到主分支')
  await expect(appPage.getByText('批量暂存变更', { exact: true })).toHaveCount(
    0
  )
  // screenshotPath 存储菜单验收截图，供无头 E2E 后人工检查顺序与文案。
  const screenshotPath = testInfo.outputPath('batch-menu.png')
  await appPage.screenshot({ path: screenshotPath, animations: 'disabled' })
  await testInfo.attach('batch-menu', {
    path: screenshotPath,
    contentType: 'image/png',
  })
  await batchMenuItems.nth(1).click()
  await appPage.locator('.ant-modal-confirm .ant-btn-primary').click()
  await expect(appPage.getByText('全部成功（2 个）')).toBeVisible()
  for (const projectPath of workspace.projectPaths) {
    // currentBranch 存储当前仓库批量操作后的实际分支名。
    const currentBranch = await runGit(projectPath, [
      'branch',
      '--show-current',
    ])
    expect(currentBranch.trim()).toBe('main')
  }
})

test('批量拉取从本地远程仓库获取真实新提交', async ({
  appPage,
  e2eHomePath,
}) => {
  // workspace 存储需要配置本地远程的测试仓库。
  const workspace = await prepareWorkspace(appPage, e2eHomePath, [
    'pull-project',
  ])
  // projectPath 存储被应用执行 pull 的源仓库路径。
  const projectPath = workspace.projectPaths[0]
  // remotePath 存储模拟 origin 的本地 bare Git 仓库路径。
  const remotePath = join(e2eHomePath, 'pull-origin.git')
  // writerPath 存储模拟另一位开发者提交代码的克隆仓库路径。
  const writerPath = join(e2eHomePath, 'pull-writer')
  await mkdir(remotePath, { recursive: true })
  await runGit(remotePath, ['init', '--bare'])
  await runGit(projectPath, ['remote', 'add', 'origin', remotePath])
  await runGit(projectPath, ['push', '-u', 'origin', 'main'])
  await runGit(e2eHomePath, ['clone', remotePath, writerPath])
  await runGit(writerPath, ['config', 'user.name', 'Remote Writer'])
  await runGit(writerPath, ['config', 'user.email', 'writer@example.com'])
  await writeFile(join(writerPath, 'remote-change.txt'), 'remote change\n')
  await runGit(writerPath, ['add', 'remote-change.txt'])
  await runGit(writerPath, ['commit', '-m', 'remote change'])
  await runGit(writerPath, ['push', 'origin', 'main'])

  await appPage
    .locator('tr[data-row-key] .ant-checkbox-wrapper')
    .first()
    .click()
  await appPage.getByRole('button', { name: /批量操作（1）/ }).click()
  await appPage.getByText('批量拉取更新', { exact: true }).click()
  await appPage.locator('.ant-modal-confirm .ant-btn-primary').click()
  await expect(appPage.getByText('全部成功（1 个）')).toBeVisible()
  // latestCommit 存储 UI 拉取后源仓库最新提交标题。
  const latestCommit = await runGit(projectPath, ['log', '-1', '--pretty=%s'])
  expect(latestCommit.trim()).toBe('remote change')
})
