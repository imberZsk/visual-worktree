# Changelog

本项目所有重要改动都记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [1.7.0] - 2026-07-15

### 新增

- 自动检查 GitHub Release，并支持先异步下载、下载完成后再安装重启。

## [1.6.0] - 2026-07-15

### 变更

- 统一升级至 React 19、Ant Design 6、Electron 43、Vite 8、TypeScript 6 与 pnpm 11.13；渲染层迁移为 TypeScript，并加入 `tsc` 构建门禁。
- 适配 Ant Design 6 的表单时序与语义 DOM，统一 macOS arm64 与 Windows x64 双平台构建、测试和打包口径。
- 统一 MIT 协议、安全策略与行为准则文档。

## [1.5.0] - 2026-07-14

### 新增

- **代码质量工具链**：接入 ESLint、Prettier、Husky、Commitlint 与 lint-staged，并在 CI 中执行完整代码检查。
- **CI 与测试日志优化**：GitHub Actions 从四个重复初始化的 job 合并为 macOS/Windows 两个「测试并打包」job，增加同 PR 旧运行自动取消、Electron 下载缓存并移除合并后 `main` push 的重复整套 CI；升级官方 actions 的 Node 运行时版本，并通过公开 npmmirror 加速 npm、Electron 与 electron-builder 二进制下载。修复 UI 测试中的 React `act(...)`、异步卸载更新和 antd `Empty` 废弃 API 警告，并增加测试期 warning 防回归检查。
- **项目同步更新**：项目 Tab 在「拉取」后新增「同步更新」按钮，二次确认后以通用提交信息 `feat: 优化` 提交当前项目全部 Git 变更并推送当前分支；工作区无新变更时跳过空提交，仍会推送已有本地提交。
- **Windows 平台支持**：应用现可在 Windows 上运行与打包。
  - 打开终端支持 Windows Terminal(`wt`)/PowerShell/cmd，按「主选 → 兜底」链依次尝试，未装某个终端时自动降级；设置页的「终端应用」下拉按运行平台展示对应选项。
  - 打开编辑器（VSCode）兼容 Windows：补充 `code.cmd` 常见安装路径，兜底命令由 macOS 的 `open -a` 换成 Windows 的 `start code`。
  - 工作流步骤执行优先复用 Git for Windows 自带的 `bash.exe`（保持 `.sh`/POSIX 命令模板与 macOS 一致），找不到才兜底 `cmd /c`。
  - 创建 worktree 时：跳过 hooks 的空设备路径按平台切换（Windows 用 `NUL`、类 Unix 用 `/dev/null`）；`node_modules` 复用链接在 Windows 上改用 junction，规避目录符号链接需管理员权限的限制。
  - worktree 扫描/删除的路径匹配统一按正斜杠归一化：Windows 上 `git worktree list` 返回正斜杠、而 Node 的 `join`/`realpathSync` 返回反斜杠，二者直接做前缀匹配、`split('/')` 切分或相等比较会失配，导致 worktree 扫不到、含斜杠的任务名被截断成第一层目录、幂等复用判断失效。新增 `toPosixPath` 归一化后再比较（类 Unix 平台为恒等变换，零影响），并补充针对反斜杠输入的单元测试。
  - worktree 扫描的路径真实化改用 `realpathSync.native`：Windows 上普通 `realpathSync` 不会把 8.3 短名（如 `RUNNER~1`）展开成长名（`runneradmin`），而 `git worktree list` 返回长名，导致前缀匹配失配、任务列表为空。`.native` 走操作系统 API 展开短名，与 git 输出对齐（类 Unix 平台与普通版等价，无副作用）。
  - Claude 会话追踪（`claudeService`）与环境健康检查（`envHealthService`）中所有拼接/切分本地路径的位置同样按正斜杠归一化，修复 Windows 上会话扫不到、项目名被整条路径取代的问题。
  - 修通 Windows CI 上约 50 个历史失败用例：macOS 专属的终端/编辑器命令构建与打开逻辑（Ghostty/Terminal.app/iTerm2、VSCode 单引号）测试统一注入 `platform` 参数，在 Windows runner 上验证 darwin 分支；`openInTerminal`/`runWorkflowStep` 补充 `platform` 注入点；Git Bash 探测的 AppData 候选路径改用正斜杠字面量以匹配注入探针；`config`/`cleanup` 等测试断言不再用 `join` 拼比较路径（避免分隔符差异）。
  - 打包新增 Windows target（`nsis` 安装包 + `portable` 便携版，x64）与 `dist:win` 脚本，配套 `build/icon.ico` 图标。
  - GitHub CI 扩为 macOS/Windows 双平台跑测试，并新增在 Windows runner 上原生打包并上传产物的 job。
  - 打包脚本 `dist`/`dist:win` 显式追加 `--publish never`：electron-builder 在「CI + push 事件」下会自动触发 publish 而要求 `GH_TOKEN`，缺失即在打包成功后仍报错退出（表现为 PR 事件通过、push 到 main 的 build-win job 失败）。显式关闭发布后打包只产出本地 artifact，不再尝试联网发布。
  - GitHub CI 新增 `build-mac` job：在 macOS runner 上原生打包 arm64 DMG 并上传为 artifact，与 Windows 打包对称，保证 macOS 打包链路也随 PR 持续验证。
- **正式发布流程**：新增 `release.yml` workflow，推送 `v*` 标签（如 `v1.3.0`）时自动在 macOS/Windows runner 上分别打包，并把 DMG、nsis 安装包、portable 便携版发布到以该标签命名的 GitHub Release 供公开下载。用内置 `secrets.GITHUB_TOKEN`（无需手动配置）+ `permissions: contents: write` 授权发布；`package.json` 的 `build.publish` 指向 `imberZsk/visual-worktree`。与日常 CI 分离：普通 push 只做测试与打包验证（`--publish never`），仅打 tag 才真正发布。
  - 发布采用「打包 / 发布分离」两阶段：各平台 job 仅 `--publish never` 打包并上传 artifact，最后由单个 `publish` job 汇总所有平台产物、用 `gh release create` 一次性创建公开 Release。WHY：若让多个平台 job 各自 `--publish` 并行发布，二者会同时检测到「Release 尚不存在」而各自创建，产生两个重复的草稿 Release（v1.3.0 实测踩坑）。只保留单一发布入口即根除竞态，且默认直接公开（非草稿），无需手动确认。
  - Release 说明的「下载与安装」段按本次实际产物动态生成：扫描 `dist-release` 里实际存在的 DMG/Setup/portable 文件，据此列出对应平台的下载项与首次打开提示（macOS Gatekeeper / Windows SmartScreen），文件名从实际文件读取。WHY：写死平台/文件名会随版本失真（历史 v1.1.2 说明写死了「仅 macOS arm64」）；动态生成保证说明永远与该版本真实产物一致。动态说明作为前缀，其后由 `--generate-notes` 追加自动变更记录。
- 补充 MIT 许可证、贡献指南、安全策略、行为准则与 GitHub CI，方便外部开发者安装、验证和参与。

### 变更

- 清理公开仓库边界：移除内网 `.npmrc` 配置，改用 pnpm 作为唯一锁文件来源，并忽略构建产物、覆盖率报告与本地 AI 工具状态。
- GitHub Release Assets 只上传用户需要下载的安装包（macOS `.dmg`、Windows `.exe`），不再展示 `.blockmap` 与 `latest*.yml` 等自动更新/差分元数据文件。
- 更新 README 的安装、打包、验证与隐私说明，使文档面向 GitHub 开源用户而非内部同事分发场景。
- **版本口径收敛**：`auto-tag-release.yml` 改为直接读取 `main` 上 `package.json` 的 `version` 作为 tag 号（原先基于上一个 tag 递增 patch，与手动提升的 `package.json` 版本长期脱节，导致 `v1.3.8` 指向的代码 `package.json` 已是 `1.5.0`）。现在 tag 恒等于 `package.json` 版本；该版本已发过 tag 则跳过，保证「package.json 版本 = git tag = GitHub Release」三者一致。

## [1.1.2] - 2026-07-03

### 修复

- **消除 pnpm dev 启动警告**：`package.json` 的 `dev`/`start`/`dist` 脚本原用 `concurrently` 的 `npm:xxx` 短语法及 `npm run`，会拉起 npm 子进程；pnpm 会把自身专属配置（`verify-deps-before-run`、`_jsr-registry`、`npm-globalconfig`）和 `.npmrc` 里的 electron 下划线配置导出为 `npm_config_*` 环境变量注入子进程，npm 不识别便逐条报 `Unknown env config/project config` 警告。改为统一用 `pnpm run` 跑子脚本，不再启动 npm 进程，警告清零

## [1.1.1] - 2026-07-02

### 性能/体验改进

- **主进程异步化**：`electron/main.js` 将启动期 `execSync('launchctl getenv SSH_AUTH_SOCK')` 改为 `execFile` 异步回调，消除 Electron 启动阶段主进程 JS 事件循环冻结
- **getDirSize 异步化**：`src/core/gitService.js` 的 `getDirSize` 改为 `async`/`await`（使用 `fs/promises`），并发 `lstat` 各子目录；之前同步递归遍历大 worktree（含 node_modules 软链接）会阻塞主进程数秒
- **IPC Handler 异步化**：`electron/ipcHandlers.js` 将 `LOAD_TASK_STATUS`、`SAVE_TASK_STATUS`、`LOAD/SAVE_TASK_LINKS`、`LOAD/SAVE_TASK_VISIBILITY`、`LOAD/SAVE_PROJECT_VISIBILITY`、`LOAD/SAVE_TASK_BLOCKERS`、`LOAD/SAVE_TASK_WORKFLOW`、`LOAD_TASK_HISTORY`、`APPEND/REMOVE_TASK_HISTORY` 等 handler 全部改用 `fs/promises` 异步 I/O，不再阻塞主进程事件循环；内部复用 `writeJsonFile` 辅助函数消除代码重复
- **「切主分支」「拉取」按钮 loading**：`ProjectTable` 新增 `loadingPaths: Set<string>` prop，操作期间按钮进入 loading+disabled 状态，防止重复点击；`App.jsx` 用 `projectLoadingPaths` state 管理每行的进行中状态
- **设置保存按钮 loading**：`SettingsModal` 保存按钮新增 `loading`/`disabled` 状态（`saving` state + try/finally 保证释放），防止重复提交

### 修复

- **Claude Code 用量统计**：修复四层 bug，现在能正确统计所有任务（包括在源项目或多 agent 工作流里开发的任务）的 token 消耗与费用
  - 数据源扩展：改为遍历 `~/.claude/projects`（515+ 会话），不再只扫 `~/.claude/jobs`（40 个）
  - Jira 链接匹配：新增对多 agent 工作流场景的支持——从任务名提取 Jira Key，在会话用户消息中匹配 `/browse/KEY` 链接（只认链接形式，排除纯讨论型会话误报）
  - Subagents 归并：统计 token 时同步累加 `{sessionId}/subagents/**/*.jsonl`，覆盖工作流派生会话
  - 多模型精准定价：建立 `MODEL_PRICING` 表，按每条消息的实际模型分别计价（claude-sonnet-5: $3/$15，claude-opus-4-8: $5/$25 等），替换原来对所有模型套用 Opus 旧价导致的 ~5 倍高估

## [1.0.1] - 2026-06-29

### 修复

- **项目视图刷新**：修复 Electron GUI 启动时不继承 `SSH_AUTH_SOCK` 导致 SSH 远程 git fetch 超时、项目误报"连不上远程"的问题；现在在 `main.js` 启动时通过 `launchctl` 注入 SSH agent socket，fetch 恢复正常

## [1.0.0] - 2026-06-27

首个正式版本，覆盖多仓库 Git 管理与按任务组织的 worktree 全流程。

### 新增

**项目视图**

- 项目扫描：扫描源目录下所有 Git 仓库，列出当前分支和状态
- 状态标签：区分主分支 / 非主分支 / 有变更 / 领先远程 / 落后远程
- 筛选搜索：按全部 / 非主分支 / 有变更 / 可拉取筛选，按名称搜索
- 单项操作：切主分支、拉更新、Finder/VSCode/终端打开
- 批量操作：勾选多仓库，一键批量切主分支 / 拉更新 / 暂存变更，带进度展示
- 项目详情：查看提交历史、变更文件列表、worktree 列表

**Worktree 视图（按任务组织）**

- 按任务分组：聚合展示一个任务涉及的所有项目 worktree 及各自分支、变更、领先/落后状态
- 按任务批量创建：填任务名 + 勾选多项目 + 分支名，一次性创建多个 worktree
- 打开：单个 worktree 或整个任务目录用 Finder / VSCode / 终端打开
- 删除：删除单个 worktree，有未提交改动时拒绝并询问是否强制
- 删除整个任务：连带删除任务目录树并记入历史
- 清理失效：一键 prune 掉目录已手删但 git 仍有引用的失效 worktree
- 智能清理建议：自动列出已合并且无未提交改动的可安全删除 worktree，批量删除

**研发工作流**

- 工作流步骤：内置一套需求研发步骤，支持自定义
- 勾选进度：按任务记录每个步骤的完成状态
- 执行命令：给步骤配 shell 命令后可在任务目录下直接执行
- 实时输出：执行过程 stdout/stderr 流式回推弹窗显示，按任务+步骤精准路由
- 任务状态：手动标记未开始 / 开发中 / 自测中 / 待提测 / 测试中 / 待发布 / 已发布
- 卡点备注：给卡住的任务记录卡点说明
- 任务链接：关联 Jira / 文档等外部 URL，一键浏览器打开

**看板视图**

- 三列看板：按人工状态分待启动 / 进行中 / 已完成展示任务卡片
- 进度条：卡片显示工作流勾选进度
- 快速跳转：点卡片跳转到 Worktree 视图对应任务

**AI 用量追踪**

- 用量统计：读取本地 Claude Code 会话数据，按任务统计 token 用量
- 费用换算：按 Opus 4.8 定价计算成本，展示美元 + 人民币双币种
- 任务标签：在任务标题栏展示该任务的 AI 成本

**环境健康检查**

- 依赖一致性：检查 package.json / lock / node_modules 是否齐备
- 端口占用：从 scripts 提取常用端口，探测是否被占用
- 服务连通性：从 .env 提取数据库/Redis/API 地址，TCP 探测可达性
- Git 状态：检查未提交改动、领先/落后远程

**设置与其它**

- 路径配置：自定义源项目根目录、worktree 根目录
- 主分支名：配置识别为主分支的分支名（默认 master/main）
- 忽略列表：排除不想扫描的目录
- 自动 fetch：刷新时自动 fetch，获取准确的落后远程数
- 任务历史：已删除任务留档，可查看和清除
- 终端适配：自动检测 Ghostty，没有则回退系统终端
- macOS arm64 DMG 打包分发
