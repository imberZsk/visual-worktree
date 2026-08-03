# 测试规范

## 范围

- 新增测试只覆盖本次新增或修改行为；历史代码不补无关覆盖率，除非本次修复其缺陷。
- Bug 修复先增加能够复现现象的失败用例，再验证修复后通过。
- 测试优先覆盖公开行为、输入输出和副作用边界，不断言无业务意义的内部实现细节。
- 测试名称使用中文描述业务场景和预期结果，与现有文件风格一致。

## 测试环境

- 核心 Git 测试使用真实临时 Git 仓库，不 mock `simple-git`；复用 `test/helpers.js` 的仓库构造工具。
- Node 项目测试位于 `test/**/*.{test,spec}.{js,jsx,mjs}`，排除 `test/ui/**`，环境为 Node。
- UI 测试位于 `test/ui/**`，使用 happy-dom、Testing Library 和 `test/ui/setup.js`。
- IPC 测试 mock `ipcMain` 与注入依赖，不启动完整 Electron；真正启动链路由 `verify:boot` 覆盖。
- 测试临时文件放入独立临时目录并在结束时清理，不读取或污染用户真实 `~/.visualWorktree`。

## 编写要求

- 每个用例自行建立必要状态，避免依赖测试执行顺序或其他用例留下的数据。
- 平台逻辑通过注入 `platform`、路径和系统函数验证 macOS/Windows 分支。
- 异步 UI 用 `findBy*`、`waitFor` 或明确事件等待，不使用任意固定 sleep 消除竞态。
- mock 在每个用例前重置并在结束后恢复；全局 `window.api` 等对象不得泄漏到其他测试。
- 测试失败信息应能定位业务问题，必要时断言结构化错误、任务标识和清理行为。

## 执行顺序

1. 修改期间运行最接近改动的单文件或单用例测试。
2. 完成后运行受影响模块测试及 `pnpm run lint`、`pnpm run typecheck`。
3. 共享逻辑、配置、IPC 或关键工作流变更扩大到 `pnpm test`。
4. UI 构建相关变更运行 `pnpm run build:ui`；Electron 入口相关变更运行 `pnpm run verify:boot`。

Vitest 当前项目超时为 30 秒，真实 Git 测试可能较慢；不得仅为掩盖死锁或未清理进程而继续提高超时。
