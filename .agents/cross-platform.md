# 跨平台约束

目标平台为 macOS arm64 与 Windows x64。凡是路径、shell、外部命令、软链接、打包或系统应用相关的改动，都必须显式检查两个平台。

## 通用规则

- 平台差异集中在纯函数或副作用边界，并通过可注入的 `platform`、`existsSync` 等依赖测试；不要让平台判断散落到 UI。
- 路径操作使用 Node `path` API；不得用字符串拼接目录，也不得假设分隔符恒为 `/`。
- 传给 shell 的用户路径与任务名必须正确引用，覆盖空格、中文、`&`、括号和单引号。
- 测试 Windows 分支时注入 `win32`，测试 macOS 分支时注入 `darwin`；能在当前平台验证的纯逻辑不得以“没有另一平台机器”为由跳过。

## 已确定的平台行为

- `git worktree add` 跳过 hooks 时，Windows 空设备是 `NUL`，类 Unix 是 `/dev/null`。
- `node_modules` 复用链接在 Windows 使用 `junction`，类 Unix 使用目录符号链接；删除前只移除链接，不能碰真实依赖目录。
- Windows 工作流优先使用 Git for Windows 的 Bash，找不到时回退 `cmd /c` 并向 UI 暴露 `bashFound: false`。
- Windows 终端候选为 Windows Terminal、PowerShell、cmd；macOS 支持 Ghostty、iTerm2、Terminal，并保留现有兜底顺序。
- VSCode 必须使用新窗口语义 `-n`；只有用户模板已显式指定 `-n/-r` 时才尊重其选择。Windows CLI 路径和 `start` 语法不得套用 macOS `open -a`。
- macOS Terminal/iTerm2 继续使用现有 AppleScript 打开目录，避免冷启动吞掉目标路径；Ghostty 保留现有 working-directory 处理。
- `git worktree list` 路径比较前进行 realpath 与平台路径规范化，兼容 macOS `/tmp -> /private/tmp` 和 Windows 8.3 短路径差异。

## CI 与脚本

- GitHub Actions 的 Windows 默认 shell 是 PowerShell；使用 Bash 数组、heredoc、`shopt`、进程替换或 `$'...'` 时必须显式声明 `shell: bash`。
- 脚本处理带空格文件名时使用数组和带引号变量，不使用 `ls | xargs basename` 一类会拆词的管道。
- 跨平台行为变更至少增加相应的纯逻辑测试；涉及打包时同时检查 `.dmg` 与 `.exe` 产物规则。
