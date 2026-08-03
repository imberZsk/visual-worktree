# 发布检查清单

只有用户明确要求发布时才执行提交、推送、打 tag 或创建 Release。

## 版本

- `package.json` 的 `version`、`CHANGELOG.md` 顶部版本和 Git tag 必须一致，tag 格式恒为 `v${version}`。
- 功能或修复按语义化版本提升版本号，并新增对应 CHANGELOG 条目；不要长期堆在 `[Unreleased]`。
- `auto-tag-release.yml` 从合并提交的 `package.json` 读取版本；版本对应 tag 已存在时会跳过，不得绕过校验制造同版本不同代码。
- Release workflow 从 tag 同步临时打包版本，最终安装包版本、文件名和 tag 必须一致。

## 合并前验证

- 运行 `pnpm run lint`、`pnpm test`、`pnpm run build:ui`，涉及 Electron 启动时再运行 `pnpm run verify:boot`。
- 发布链路修改需运行 `test/releaseWorkflow.test.js`，并检查 Windows Bash/PowerShell 语法边界。
- 检查 `package.json` 中产品名、图标、目标架构和 artifactName；应用展示名只改打包元数据，不改用户仓库目录名。
- 项目未配置签名：macOS Gatekeeper 与 Windows SmartScreen 的提示必须继续出现在发布说明中。

## 发布产物

- macOS 目标为 arm64 DMG；Windows 目标为 x64 NSIS Setup 与 portable EXE。
- build 矩阵只打包并上传 artifact，单一 publish job 汇总并创建公开 Release。
- 发布前精确验证 3 个用户资产：1 个 `.dmg`、1 个 Setup `.exe`、1 个 portable `.exe`；不得夹带技术产物。
- 文件名可能包含空格，生成发布说明与汇总资产时使用 Bash 数组和完整引用。

## 发布后验证

- 等待 Release workflow 的 publish job 完成，不以 tag 或 build job 成功代替发布成功。
- 执行 `gh release view <tag> --json assets,url`，确认 Release 可访问且 3 个目标资产齐全。
- 若 artifact 上传因临时网络问题失败，优先 `gh run rerun <run-id> --failed` 重跑失败 job，不手工拼接不完整 Release。
- 若出现“有 tag、无 Release”，检查工作流触发限制，并使用具备权限且受支持的手动触发入口恢复发布。
