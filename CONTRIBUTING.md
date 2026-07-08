# 贡献指南

感谢你愿意改进 Visual Worktree。这个项目是一个本地优先的 Electron 开发工具，贡献时请优先保证 Git 操作可靠、界面反馈清晰、测试可重复。

## 开发环境

```bash
pnpm install
pnpm dev
```

建议使用 Node.js 20 或更高版本、pnpm 11 或更高版本。应用依赖系统 `git`，本机需要先安装 Git。

## 提交前检查

```bash
pnpm test
pnpm run build:ui
```

涉及 Electron 启动链路、preload、IPC 或打包配置时，也请运行：

```bash
pnpm run verify:boot
```

## 代码约定

- 核心 Git 逻辑放在 `src/core`，保持纯 Node 模块，避免依赖 Electron。
- 新增跨进程能力时，同步更新 `electron/ipcChannels.js`、`electron/preload.cjs`、`electron/ipcHandlers.js` 和对应核心实现。
- 测试尽量使用真实临时 Git 仓库，不 mock `simple-git`。
- 前端优先复用 Ant Design 组件，耗时操作需要 loading 状态。
- 不提交 `dist/`、`coverage/`、`release/`、本地 AI 工具状态或个人配置文件。

## 分支与合并流程

`main` 是受保护分支，**任何人（包括仓库作者本人）都不能直接推送 `main`**，所有改动一律走 Pull Request：

1. 从最新 `main` 切出功能分支：`git switch main && git pull && git switch -c feat/xxx`（修复用 `fix/`、杂项用 `chore/`）。
2. 在分支上开发、提交，推送到远程：`git push -u origin feat/xxx`。
3. 用 `gh pr create` 建 PR。
4. 等 CI 三个必需检查全部通过后再合并：
   - `Test and build (macos-latest)`
   - `Test and build (windows-latest)`
   - `Build Windows package`
5. 合并后**务必确认 `main` 上 push 事件触发的 CI 也全绿**——PR 的 CI 绿不等于 `main` 的 CI 绿（例如 electron-builder 只在 push 事件下触发自动发布），必须在 `main` 上再验证一次才算真正完成。

> 说明：CI 会在 macOS 与 Windows 双平台跑测试，并分别原生打包 mac（DMG）与 Windows（安装包 + 便携版）产物上传为 artifact。打包不发布（`--publish never`），仅用于验证可打包性。

## Pull Request

提交 PR 时请说明：

- 改动目的和用户可见行为
- 主要实现思路
- 已运行的验证命令
- 是否涉及数据迁移、配置变更或平台限制

如果改动会影响已有工作流，请在 PR 描述中写明兼容性影响。
