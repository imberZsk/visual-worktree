# Visual Worktree

Visual Worktree 是一个跨平台（macOS / Windows）桌面应用，用于可视化管理本地多个 Git 仓库，并按“任务/需求”组织跨仓库 worktree。它适合需要同时改多个仓库、频繁检查分支状态、批量拉取或清理 worktree 的开发者。

官网文档：<https://visual-worktree-docs.netlify.app>

## 主要功能

- **项目扫描**：扫描指定目录下的 Git 仓库，展示当前分支、未提交变更、领先/落后远程等状态。
- **批量操作**：批量切回主分支、拉取更新、暂存变更，并显示逐项进度。
- **任务化 worktree**：按 `worktreesRoot/{任务名}/{项目名}` 创建和聚合 worktree，适合一个需求跨多个仓库的场景。
- **任务工作流**：为每个任务记录流程步骤、任务状态、卡点备注、外部链接和执行输出。
- **环境健康检查**：检查依赖、端口、服务连通性和 Git 状态，辅助判断任务开发环境是否可用。
- **本地优先**：所有配置和任务状态默认保存在 `~/.visualWorktree`，应用不上传仓库内容或任务数据。

## 技术栈

- Electron + React + Vite
- Ant Design + Zustand
- simple-git
- Vitest + happy-dom
- electron-builder

## 系统要求

- macOS Apple Silicon（`pnpm run dist` 产出 arm64 DMG）或 Windows 10/11 x64（`pnpm run dist:win` 产出 NSIS 安装包 + 便携版）
- Node.js 20 或更高版本
- pnpm 11 或更高版本
- 系统已安装 Git；macOS 可通过 `xcode-select --install` 安装 Apple Command Line Tools，Windows 建议安装 [Git for Windows](https://git-scm.com/download/win)
- Windows 额外建议：
  - 安装 Git for Windows（自带 `bash.exe`）——「工作流步骤执行」优先用它跑命令模板，以保持与 macOS 一致的 POSIX 语义；未安装则回退到 `cmd`，此时 `.sh` 类命令可能无法运行
  - 「打开终端」默认使用 Windows Terminal（Win11 自带；Win10 可从 Microsoft Store 安装），未安装时自动回退 PowerShell/cmd

## 快速开始

```bash
pnpm install
pnpm dev
```

常用命令：

```bash
pnpm test               # 运行单元/集成测试
pnpm run test:coverage  # 生成覆盖率报告
pnpm run build:ui       # 构建渲染进程产物
pnpm start              # 构建后以生产模式启动 Electron
pnpm run verify:boot    # Electron headless 启动冒烟验证
pnpm run dist           # 打包 macOS arm64 DMG
pnpm run dist:win       # 打包 Windows x64 安装包 + 便携版（需在 Windows 上运行）
```

首次启动后，打开右上角设置并配置：

- **源项目根目录**：存放多个 Git 仓库的目录
- **Worktree 根目录**：按任务生成 worktree 的目录
- **主分支名**：默认识别 `master` 和 `main`
- **忽略列表**：不想扫描的目录名

## 打包说明

```bash
pnpm run dist       # macOS：arm64 DMG
pnpm run dist:win   # Windows：x64 NSIS 安装包 + 便携版（须在 Windows 上运行）
```

构建产物输出到 `release/`。

**macOS**：生成 arm64 DMG，`package.json` 中 `build.mac.identity` 为 `null`，表示应用未进行 Apple 开发者签名。首次打开未签名应用时，macOS 可能会提示安全拦截，可在 Finder 中右键应用选择“打开”，或自行签名/公证后分发。如需支持 Intel Mac 或 universal 包，可调整 `build.mac.target[].arch` 和 `dist` 脚本。

**Windows**：生成 x64 的 NSIS 安装包（`VisualWorktree-<版本>-Setup.exe`，支持自定义安装目录）与免安装便携版（`VisualWorktree-<版本>-portable.exe`）。electron-builder 需在 Windows 上原生打包 Windows 目标，跨平台从 macOS 直接打 Windows 包并不可靠；推荐用仓库内置的 GitHub Actions（`.github/workflows/ci.yml` 的 `build-win` job，在 `windows-latest` runner 上打包并上传产物）在 CI 里出包。Windows 包同样未做代码签名，首次运行可能触发 SmartScreen 提示，可选择“仍要运行”。

## 架构概览

```text
electron/          Electron 主进程层：窗口管理、CSP、IPC 转发
src/core/          纯 Node 业务逻辑：Git、配置、终端命令、环境检查
src/ui/            React 渲染进程：页面、组件、状态管理、UI 纯逻辑
test/              Vitest 测试：真实临时 Git 仓库集成测试 + UI 测试
scripts/           启动冒烟验证和辅助脚本
```

渲染进程调用链：

```text
组件 -> Zustand store -> src/ui/api.js -> preload -> ipcHandlers -> src/core
```

核心 Git 逻辑集中在 `src/core`，不依赖 Electron，因此可以直接用 Vitest 做真实 Git 仓库集成测试。

## 隐私与本地数据

- 应用读取的是你本机配置的仓库目录和 Git 状态。
- 配置、任务状态、工作流记录、任务链接等默认写入 `~/.visualWorktree`。
- AI 用量统计读取本机 Claude Code 会话数据，仅在本地汇总展示。
- 项目不会把仓库内容、任务状态或本地路径上传到远端服务。

## 贡献

欢迎提交 Issue 和 Pull Request。开始前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [SECURITY.md](SECURITY.md)。

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
