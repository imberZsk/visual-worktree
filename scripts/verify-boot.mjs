import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

// Electron 启动冒烟测试（headless / Xvfb-less）：
// 在 CI/无头环境用 --headless 与 offscreen 渲染，验证主进程能 ready、窗口能创建、
// 渲染进程能加载且 preload 暴露的 window.api 可用。通过环境变量 PM_SMOKE=1 让 main 自检后退出。

// 项目根目录
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// 必须先构建出 dist（生产模式加载本地文件，避免依赖 vite dev server）
if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('[verify-boot] 缺少 dist/index.html，请先运行 npm run build:ui');
  process.exit(2);
}

// electron 可执行文件路径
const electronBin = join(root, 'node_modules', '.bin', 'electron');

// 启动 electron，注入冒烟标记环境变量；offscreen 渲染避免需要显示器
const child = spawn(electronBin, ['.'], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PM_SMOKE: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

// out 累积子进程输出，用于判断自检结果
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });
child.stderr.on('data', (d) => { out += d.toString(); process.stderr.write(d); });

// 超时保护：30s 未完成判定失败
const timer = setTimeout(() => {
  console.error('[verify-boot] 超时：30s 内未收到自检成功标记');
  child.kill('SIGKILL');
  process.exit(3);
}, 30000);

child.on('exit', (code) => {
  clearTimeout(timer);
  // SMOKE_OK 是 main 自检通过后打印的标记
  if (out.includes('SMOKE_OK')) {
    console.log('[verify-boot] ✅ Electron 启动自检通过');
    process.exit(0);
  }
  console.error(`[verify-boot] ❌ 启动自检未通过（exit=${code}）`);
  process.exit(code || 1);
});
