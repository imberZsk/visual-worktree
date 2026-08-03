import { test, expect } from './fixtures/electronApp.ts'
import { prepareWorkspace } from './helpers/workspaceFixture.ts'

test('首次启动配置路径后扫描并展示真实 Git 项目', async ({
  appPage,
  e2eHomePath,
}) => {
  await expect(appPage.getByText('配置项目路径')).toBeVisible()
  await prepareWorkspace(appPage, e2eHomePath)
  await expect(appPage.getByText('示例项目', { exact: true })).toBeVisible()
  await expect(appPage.getByText('main', { exact: true }).first()).toBeVisible()
  await expect(appPage.getByText('配置项目路径')).toBeHidden()
})

test('首次引导展示当前用户目录下的默认路径', async ({
  appPage,
  e2eHomePath,
}) => {
  await expect(appPage.getByText('配置项目路径')).toBeVisible()
  await expect(
    appPage.getByRole('textbox', { name: '源项目根目录' })
  ).toHaveValue(`${e2eHomePath}/Desktop/work/projects`)
  await expect(
    appPage.getByRole('textbox', { name: 'Worktree 根目录' })
  ).toHaveValue(`${e2eHomePath}/Desktop/work/worktrees`)
})

test('首次引导在任一路径为空时禁用提交', async ({ appPage }) => {
  // sourcePathInput 存储首次引导的源项目路径输入框。
  const sourcePathInput = appPage.getByRole('textbox', {
    name: '源项目根目录',
  })
  // worktreePathInput 存储首次引导的 Worktree 路径输入框。
  const worktreePathInput = appPage.getByRole('textbox', {
    name: 'Worktree 根目录',
  })
  await sourcePathInput.clear()
  await worktreePathInput.clear()
  await expect(
    appPage.getByRole('button', { name: '保存并开始使用' })
  ).toBeDisabled()
  await expect(appPage.getByText('配置项目路径')).toBeVisible()
})

test('首次引导补齐空路径后恢复提交并完成初始化', async ({
  appPage,
  e2eHomePath,
}) => {
  await appPage.getByRole('textbox', { name: '源项目根目录' }).clear()
  await expect(
    appPage.getByRole('button', { name: '保存并开始使用' })
  ).toBeDisabled()
  await appPage
    .getByRole('textbox', { name: '源项目根目录' })
    .fill(`${e2eHomePath}/empty-projects`)
  await expect(
    appPage.getByRole('button', { name: '保存并开始使用' })
  ).toBeEnabled()
  await appPage.getByRole('button', { name: '保存并开始使用' }).click()
  await expect(appPage.getByText('配置项目路径')).toBeHidden()
  // 初始化完成后停留在 Worktree 视图，应断言该视图的可见空状态，避免误命中 SVG 的隐藏 title。
  await expect(appPage.getByText(/暂无 worktree/)).toBeVisible()
})
