// 窗口启动行为纯逻辑：与 Electron 解耦，便于 vitest 直接单测。

/**
 * 判断当前启动环境是否需要自动打开 DevTools
 * @param {Record<string, string | undefined>} env - 启动进程的环境变量集合
 * @returns {boolean} 是否自动打开 DevTools
 */
export function shouldOpenDevTools(env = process.env) {
  // isDevelopment 存储当前是否以开发模式启动应用。
  const isDevelopment = env.NODE_ENV === 'development';
  // wantsDevTools 存储用户是否通过环境变量显式要求打开调试控制台。
  const wantsDevTools = env.OPEN_DEVTOOLS === '1';
  // isSmokeMode 存储当前是否处于启动冒烟验证模式。
  const isSmokeMode = env.PM_SMOKE === '1';

  return isDevelopment && wantsDevTools && !isSmokeMode;
}
