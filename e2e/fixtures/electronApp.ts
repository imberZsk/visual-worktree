import {
  test as base,
  expect,
  _electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// E2E_ENV_FLAG 存储仅供自动化测试识别当前 Electron 进程的环境变量。
const E2E_ENV_FLAG = 'VISUAL_WORKTREE_E2E'
// OFFLINE_AI_ASSISTANT_API_URL 存储测试专用的不可达后端，确保 E2E 不会误用开发机上偶然运行的 FastAPI 服务。
const OFFLINE_AI_ASSISTANT_API_URL = 'http://127.0.0.1:1'

type ElectronFixtures = {
  electronApp: ElectronApplication
  appPage: Page
  e2eHomePath: string
}

/**
 * 启动使用独立 HOME 的生产模式 Electron，防止 E2E 读取或污染用户真实配置。
 * @param e2eHomePath - 当前用例独占的临时用户目录
 * @returns 已完成首个窗口加载的 Electron 应用
 */
async function launchIsolatedElectron(
  e2eHomePath: string
): Promise<ElectronApplication> {
  // isolatedEnvironment 存储传入 Electron 子进程的隔离环境变量。
  const isolatedEnvironment = {
    ...process.env,
    HOME: e2eHomePath,
    USERPROFILE: e2eHomePath,
    NODE_ENV: 'production',
    AI_ASSISTANT_API_URL: OFFLINE_AI_ASSISTANT_API_URL,
    [E2E_ENV_FLAG]: '1',
  }
  // isolatedUserDataPath 存储 Chromium localStorage 等渲染进程数据；macOS 不保证仅靠 HOME 改写默认 userData 路径。
  const isolatedUserDataPath = join(e2eHomePath, 'electron-user-data')
  // 旧夹具只隔离 HOME，导致主视图 localStorage 在 E2E 应用之间串联；显式 user-data-dir 才能保证每个用例完全独立。
  return _electron.launch({
    args: ['.', `--user-data-dir=${isolatedUserDataPath}`],
    env: isolatedEnvironment,
  })
}

export const test = base.extend<ElectronFixtures>({
  e2eHomePath: async ({ browserName: _browserName }, fixtureUse) => {
    // browserName 仅用于满足 Playwright 的夹具对象解构约束，Electron 测试不启动浏览器项目。
    void _browserName
    // e2eHomePath 存储当前用例的隔离用户目录。
    const e2eHomePath = await mkdtemp(join(tmpdir(), 'visual-worktree-e2e-'))
    await mkdir(join(e2eHomePath, 'Desktop'), { recursive: true })
    await fixtureUse(e2eHomePath)
    await rm(e2eHomePath, { recursive: true, force: true })
  },
  electronApp: async ({ e2eHomePath }, fixtureUse, testInfo) => {
    // electronApp 存储当前用例启动的 Electron 应用实例。
    const electronApp = await launchIsolatedElectron(e2eHomePath)
    // electronTracePath 存储真实 Electron 上下文的 trace；Playwright 默认 trace 只覆盖浏览器上下文，
    // 导致 UI Mode 右侧显示 about:blank，因此这里显式记录 Electron 页面截图、DOM 与源码。
    const electronTracePath = testInfo.outputPath('electron-trace.zip')
    await electronApp.context().tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true,
    })
    await fixtureUse(electronApp)
    await electronApp.context().tracing.stop({ path: electronTracePath })
    await testInfo.attach('Electron 页面 Trace', {
      path: electronTracePath,
      contentType: 'application/zip',
    })
    await electronApp.close()
  },
  appPage: async ({ electronApp }, fixtureUse) => {
    // appPage 存储 Electron 应用的首个渲染进程页面。
    const appPage = await electronApp.firstWindow()
    await appPage.waitForLoadState('domcontentloaded')
    await fixtureUse(appPage)
  },
})

export { expect }
