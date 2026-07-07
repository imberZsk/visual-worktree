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

## Pull Request

提交 PR 时请说明：

- 改动目的和用户可见行为
- 主要实现思路
- 已运行的验证命令
- 是否涉及数据迁移、配置变更或平台限制

如果改动会影响已有工作流，请在 PR 描述中写明兼容性影响。
