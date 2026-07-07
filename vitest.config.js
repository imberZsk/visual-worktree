import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest 配置：核心模块（src/core）在 node 环境跑真实 git 命令；UI 组件用 happy-dom
export default defineConfig({
  plugins: [react()],
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.js'],
      reporter: ['text', 'html'],
    },
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          globals: true,
          include: ['test/**/*.{test,spec}.{js,jsx,mjs}'],
          exclude: ['test/ui/**'],
          setupFiles: [],
          testTimeout: 20000,
        },
      },
      {
        test: {
          name: 'ui',
          environment: 'happy-dom',
          globals: true,
          include: ['test/ui/**/*.{test,spec}.{js,jsx,mjs}'],
          setupFiles: [],
          testTimeout: 20000,
        },
      },
    ],
  },
});
