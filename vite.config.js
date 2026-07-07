import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Vite 配置：前端渲染进程构建。base 用相对路径以便 Electron file:// 协议加载
export default defineConfig({
  root: resolve(__dirname, 'src/ui'),
  base: './',
  plugins: [react()],
  server: {
    // port 存储 Electron 开发窗口连接的 Vite 固定端口。
    port: 5275,
    // strictPort 存储是否强制使用固定端口，避免 Electron 连接到错误地址。
    strictPort: true,
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    // 分包体积告警阈值设为 1200kB：默认 500kB 是为 Web「网络下载时间」设的启发式，
    // 但本应用经 Electron file:// 从本地磁盘一次性加载，无网络传输成本，该默认值不适用。
    // antd 5 全量组件+图标+rc 生态在 Vite 8/Rolldown 下约 1085kB 是其当前体积下限（已确认全部具名引入、无整包导入、
    // 业务代码已拆离至独立 21kB 块），无法再安全压缩，故将阈值调至匹配真实场景。
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // 手动分包：把第三方库与频繁改动的业务代码分离，缩小业务 chunk、改善构建产物组织。
        // 关键：antd 与其内部 rc-*/@rc-component/dayjs 等依赖互相引用，必须整体归一个 chunk，
        // 否则拆散会产生 antd <-> vendor 循环依赖。
        manualChunks(id) {
          // 仅对第三方依赖分包，业务代码保持在主 chunk（业务改动频繁，独立小块利于区分）
          if (!id.includes('node_modules')) return undefined;
          // antd 生态整体成块：antd 本体、官方图标、rc-* 系列组件、@rc-component、日期库 dayjs。
          // 全部归一处以避免内部互相引用被拆散导致的循环依赖
          if (
            id.includes('/antd/') ||
            id.includes('/@ant-design/') ||
            id.includes('/rc-') ||
            id.includes('/@rc-component/') ||
            id.includes('/dayjs/')
          ) {
            return 'antd';
          }
          // react 运行时单独成块
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react';
          // 其余第三方依赖归入通用 vendor 块
          return 'vendor';
        },
      },
    },
  },
});
