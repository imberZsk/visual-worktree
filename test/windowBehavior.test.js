import { describe, it, expect } from 'vitest';
import { shouldOpenDevTools } from '../src/core/windowBehavior.js';

// 窗口行为纯逻辑测试：不启动 Electron，只验证启动环境到窗口副作用的决策。

describe('windowBehavior', () => {
  it('开发模式默认不打开 DevTools', () => {
    // env 存储启动时传入的环境变量集合。
    const env = { NODE_ENV: 'development' };

    expect(shouldOpenDevTools(env)).toBe(false);
  });

  it('开发模式显式设置 OPEN_DEVTOOLS=1 时打开 DevTools', () => {
    // env 存储启动时传入的环境变量集合。
    const env = { NODE_ENV: 'development', OPEN_DEVTOOLS: '1' };

    expect(shouldOpenDevTools(env)).toBe(true);
  });

  it('冒烟模式不打开 DevTools', () => {
    // env 存储启动时传入的环境变量集合。
    const env = { NODE_ENV: 'development', OPEN_DEVTOOLS: '1', PM_SMOKE: '1' };

    expect(shouldOpenDevTools(env)).toBe(false);
  });
});
