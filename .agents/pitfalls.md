# 踩坑记录

修改相关能力前必须先搜索现有实现和测试，确认以下历史原因仍成立；不要删掉看似多余的兼容逻辑。

## Electron 与系统能力

- macOS GUI 应用不一定继承登录 shell 的 `SSH_AUTH_SOCK`；主进程通过异步 `launchctl getenv` 补齐，避免 SSH fetch 被误判为网络失败。
- Terminal.app 使用 `open -a Terminal <path>` 有冷启动竞态，目标路径可能被吞掉；现有实现使用 AppleScript 显式 `cd`。
- Electron sandbox preload 中 `require('electron')` 不暴露所有主进程模块；clipboard 必须走 IPC。
- CSP 区分开发与生产：开发环境需要 Vite HMR 的 websocket/eval，生产环境保持严格；antd CSS-in-JS 仍需要 `style-src 'unsafe-inline'`。
- DevTools 只在显式环境变量开启时打开，不能恢复为每次开发启动自动弹出。

## Git、路径与持久化

- macOS `/tmp` 与 `/private/tmp`、Windows 8.3 短路径会导致同一路径字符串不同；worktree 比较依赖 realpath 与规范化。
- worktree 创建时 hooks 可能因新目录缺少依赖而失败，因此使用平台空设备跳过 hooks。
- `node_modules` 是复用链接；清理时必须只删链接，不得触碰源项目真实目录。
- 持久化目录统一为 `~/.visualWorktree`；旧 `~/.visual-worktree/config.json` 只在默认目录场景迁移，保留旧文件便于回滚，测试注入目录不得触发迁移。
- 项目名和任务名是用户真实目录名，搜索、路径、CI/CD 与 UI 不得自动分词或改写。

## 工作流与 UI

- 工作流步骤统一模型为 `{ key, label, command }`；旧 `type` 字段只用于兼容读取，不恢复互斥模型。
- 所有步骤都可勾选，`command` 非空时额外可执行；重命名步骤必须保留 `key`，避免丢失完成状态。
- 命令模板的 `{path}`、`{task}`、`{branch}` 替换值必须 shell 引用；auto 参数模式不能无脑给任意命令追加路径。
- 执行脚本可能打印明确错误却返回退出码 0，现有高置信错误输出判断用于避免 UI 误报成功。
- 长任务必须流式或异步反馈；同步文件遍历、同步子进程和黑盒等待会卡住 Electron 主线程。
- Ant Design 弹层、固定列、长任务名和徽标区已有针对布局与层级问题的修复，改样式前检查对应回归测试。

## 发布

- Git tag 存在不代表 Release 可下载，必须确认公开 Release 及完整 assets。
- 使用 `GITHUB_TOKEN` 推 tag 可能不会继续触发依赖 `push tags` 的工作流，排查“有 tag 无 Release”时先检查触发链。
- Release 由单一 publish job 汇总平台产物，不能让矩阵 job 分别创建 Release，否则会产生重复 Release 或草稿竞态。
