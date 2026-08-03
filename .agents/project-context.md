# 项目上下文

## 项目概述

Visual Worktree 是一个 Electron 桌面应用，用于可视化管理本地多个 Git 仓库。核心场景是一个需求跨多个仓库修改：worktree 按 `worktreesRoot/{任务名}/{项目名}` 组织，以任务为单位聚合展示与批量操作。

## 运行环境

- Node.js 版本要求为 `>=22.12.0`。
- 包管理器使用 `pnpm@11.13.0`。
- 应用调用系统 Git，不内置 Git；运行机器必须已经安装 `git`。
- 开发服务器使用固定端口 `5275`，Electron 开发窗口连接该端口。

## 常用命令

```bash
pnpm dev               # Vite 5275 端口 + Electron 热联调
pnpm test              # 全部 Vitest 测试
pnpm run test:watch    # Vitest watch 模式
pnpm run test:coverage # 测试与 src/core 覆盖率
pnpm run lint          # ESLint 检查
pnpm run typecheck     # TypeScript 检查
pnpm run format:check  # Prettier 检查
pnpm run verify:boot   # Electron 启动冒烟验证
pnpm run build:ui      # TypeScript 检查并构建前端到 dist/
pnpm start             # 构建并以生产模式启动
pnpm run dist          # macOS arm64 安装包
pnpm run dist:win      # Windows x64 安装包与便携版

npx vitest run test/gitService.ops.test.js
npx vitest run -t "部分用例名"
```
