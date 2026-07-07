# AGENTS.md

本文件为 AI 编码助手在本仓库工作时提供指导。

## 项目概述

Visual Worktree 是一个 Electron 桌面应用，用于可视化管理本地多个 Git 仓库。核心场景：「一个需求(任务)要跨多个仓库改」——worktree 按 `worktreesRoot/{任务名}/{项目名}` 组织，以任务为单位聚合展示与批量操作。

## 常用命令

```bash
npm run dev            # 开发模式：vite dev server (端口 5273) + electron 热联调
npm test               # 跑全部测试 (vitest run)
npm run test:watch     # watch 模式
npm run test:coverage  # 测试 + 覆盖率 (仅统计 src/core)
npm run verify:boot    # Electron 启动冒烟验证 (headless，设置 PM_SMOKE=1)
npm run build:ui       # 仅构建前端产物到 dist/
npm start              # 生产模式：先 build:ui 再用 electron 加载本地文件
npm run dist           # 打包为 macOS arm64 DMG，产物在 release/

# 跑单个测试文件
npx vitest run test/gitService.ops.test.js
# 跑匹配名称的单个用例
npx vitest run -t "部分用例名"
```

## 架构

三层结构，**核心 Git 逻辑全部抽离为纯 Node 模块**，Electron 只做窗口与 IPC 转发：

```
src/core/          纯 Node 业务逻辑，不依赖 Electron，可被 vitest 直接 import
  gitService.js    所有 git 操作：扫描/状态检测/worktree 增删/checkout/pull/stash
  config.js        配置读写，持久化到 ~/.visualWorktree/config.json（与 task-status 等统一在同一目录）
electron/          主进程层（薄封装）
  main.js          入口：窗口管理、CSP 注入、PM_SMOKE 冒烟自检
  preload.cjs      contextBridge 暴露 window.api（必须是 .cjs）
  ipcChannels.js   IPC 通道名常量（与 preload.cjs 内联的常量须保持一致）
  ipcHandlers.js   registerIpcHandlers(ipcMain, deps)：转发到 gitService/config
src/ui/            React 渲染进程
  projectLogic.js  纯逻辑：筛选/统计/状态标签（可单测，UI 复用）
  api.js           API 适配层：非 Electron 环境降级为空实现
  store/useStore.js  Zustand 全局状态
  components/      ProjectTable / ProjectDetail / SettingsModal / WorktreePanel / CreateWorktreeModal
```

### 关键数据流

渲染进程调用链：`组件 → useStore → api.js → window.api (preload) → ipcRenderer.invoke → ipcHandlers → gitService`。

新增一个跨进程能力时，需同步改 **4 处**：`ipcChannels.js`（通道名）、`preload.cjs`（内联常量 + 暴露方法）、`ipcHandlers.js`（注册 handler）、`gitService.js`（核心实现）。preload 是 CommonJS，IPC 常量在其中内联，与 `ipcChannels.js` 保持同步是手动的。

### 批量操作进度

`batchOperate` / `batchAddWorktree` 通过 `onProgress` 回调逐项上报。主进程经 `getWindow().webContents.send(IPC.BATCH_PROGRESS, ...)` 推送，渲染进程用 `api.onBatchProgress(cb)` 订阅（返回取消订阅函数）。批量操作逐项执行、单项失败不阻断其余项，各自返回 `{success, error}`。

## 测试约定

- 测试**用真实临时 git 仓库做集成测试，不 mock simple-git**。`test/helpers.js` 提供 `initRepo` / `makeRemoteAndClone`（造 ahead/behind 场景）/ `commitFile`。
- 默认 node 环境跑真实 git；`test/ui/**` 自动切到 happy-dom 环境（见 `vitest.config.js` 的 `environmentMatchGlobs`）。
- `ipcHandlers.test.js` 用 mock 的 ipcMain 测 IPC 注册，无需启动 Electron。
- testTimeout 设为 20s，因真实 git 操作较慢。

## 实现要点（容易踩坑）

- **worktree 创建跳过 git hooks**：`addWorktree` 用 `-c core.hooksPath=/dev/null` 并开启 simple-git 的 `unsafe.allowUnsafeHooksPath`。原因是 husky 等 hook 在新 worktree 里常因依赖不可用而非零退出，导致 `git worktree add` 整体失败。
- **node_modules 软链接**：创建 worktree 时默认软链接源项目的 node_modules（`linkNodeModules`），避免重复安装；删除 worktree 前先移除该软链接（`unlinkNodeModules` 用 lstat 判定，只删链接不碰真实目录）。
- **路径 realpath 规范化**：macOS 下 `/tmp→/private/tmp`、`/var→/private/var` 等 symlink 差异会导致与 `git worktree list` 返回的绝对路径前缀匹配失败。`scanWorktreesByTask` 和 `isExistingWorktree` 都对路径做 `realpathSync` 后再比较。
- **addWorktree 幂等**：目标已是合法 worktree 时不报错，仅补齐缺失的 node_modules 软链接，返回 `reused: true`。
- **CSP 按环境区分**（`main.js` setupCSP）：dev 放开 `unsafe-eval` 与 ws 连接以支持 vite HMR，prod 严格策略；antd 的 CSS-in-JS 需要 `style-src 'unsafe-inline'`。
- **打包未签名**（`identity: null`）：同事首次打开会被 Gatekeeper 拦截，需「右键 → 打开」或 `xattr -cr`。目标仅 macOS arm64。
- **VSCode 用 `-n` 新窗口打开（不替换当前窗口）**：`buildVscodeCommand`（`ipcHandlers.js`）给 `code` 系命令注入 `-n`（`--new-window`）而非 `-r`（`--reuse-window`）。WHY：`-r` 会把目标目录开在「当前聚焦的窗口」里、替换掉用户正在看的内容（表现为「关掉旧窗口又开新窗口」）；`-n` 始终新开窗口、不动现有窗口，两者都不会在程序坞新建额外进程图标。仅当模板未显式带 `-n/--new-window/-r/--reuse-window` 时才注入（用户已选 `-r` 视为有意复用，尊重不改）；非 `code` 命令（如 cursor）原样不注入。
- **终端打开（优先 Ghostty）**：`src/core/terminalService.js` 抽出纯函数 `detectTerminal(existsSync)` 与 `buildTerminalCommand(path, kind)`，便于单测不拉起终端；`ipcHandlers.js` 的 `openInTerminal` 只做 `exec` 副作用，Ghostty 失败时自动兜底重试 Terminal。Ghostty 在 macOS 不能用 CLI 直接开窗，必须 `open -na Ghostty.app --args --working-directory=<path>`；注意 Ghostty 默认 `window-inherit-working-directory=true`，已有窗口时新窗口会继承旧目录——这是刻意保留的官方默认行为，未强制覆盖。**Terminal.app 用 AppleScript 而非 `open -a Terminal <path>`**：后者在 Terminal 未运行（首次点击）时有冷启动竞态——macOS 先拉起 Terminal 开一个 home 窗口，path 参数常被吞掉导致打不到目标目录。改用 `osascript -e 'tell application "Terminal" to do script "cd <path>"' -e '...activate'`，显式在窗口里 cd，无论 Terminal 是否已运行都可靠落到目标目录。路径转义两层：先 POSIX 单引号包裹（`shellSingleQuote`，内部 `'` 转义为 `'\''`），再嵌入 AppleScript 双引号串，最外层 osascript `-e` 参数用双引号。
- **持久化目录统一为 `~/.visualWorktree`（无连字符）**：历史上 `config.json` 存在 `~/.visual-worktree`（带连字符），而 task-status/links/workflow/history 存在 `~/.visualWorktree`，两者分裂。现 `config.js` 默认目录改为 `~/.visualWorktree`，`loadConfig` 在走默认目录（未注入 baseDir）时一次性把旧 `~/.visual-worktree/config.json` 迁移过来（`migrateLegacyConfig`，仅当新文件不存在且旧文件存在时复制，保留旧文件不删便于回滚）。测试注入 baseDir 不触发迁移，避免污染临时目录。
- **终端支持 Terminal / iTerm2 / Ghostty**：`buildTerminalCommand(path, kind)` 的 iTerm2 分支用 AppleScript `create window with default profile` + `write text "cd <path>"`（iTerm 的 API 与 Terminal 的 `do script` 不同）；与 Terminal 一样规避 `open -a` 首次冷启动目录竞态。`openInTerminal` 里 Ghostty/iTerm2 打开失败都兜底重试系统 Terminal。配置项 `terminalApp` 取值 `Terminal|iTerm2|Ghostty`。
- **复制路径始终加 POSIX 单引号**：`quotePathForCopy`（`src/ui/worktreeLogic.js`）把路径统一包裹为 `'...'`（内部单引号转义为 `'\''`）再写剪贴板。WHY：worktree 任务名含 `/` 时路径可含空格、`&`、括号、中文（如 `物料发放&维修...`），裸路径粘贴到终端会被 shell 拆词（`&` 把命令截成两半），`cd` 进不去。统一加引号后任意路径粘贴即可 `cd`。`handleCopyPath` 复制前调用它。
- **复制路径走主进程 clipboard（经 IPC）**：`copyText` 通过 `COPY_TEXT` 通道转发到主进程，由主进程注入的 Electron `clipboard.writeText` 写入。**不能在 preload 里直接 `require('electron').clipboard`**——Electron 33 默认 preload 开启 sandbox，沙箱下 `require('electron')` 不暴露 clipboard 模块（会得到 undefined 并抛错）。clipboard 与 shell 一样经 `registerIpcHandlers` 的 `deps` 注入，便于测试。
- **切主分支带 master/main 兜底**：`checkoutMainBranch` 检测仓库实际存在的候选主分支再切（优先本地已有的，否则逐个尝试 checkout），避免仓库用 `main` 时硬切 `master` 报 `pathspec did not match`。`CHECKOUT_BRANCH` handler 在目标分支属于配置 `mainBranches` 时自动走此兜底；批量操作用 `checkoutMain` 操作类型（区别于切指定分支的 `checkout`）。
- **新增 IPC 时的纯逻辑下沉**：`open-in-terminal` 是新增 IPC 的范例——可测的命令构建/检测逻辑放 `src/core`，Electron 层只留副作用与兜底。展开逻辑同理抽到 `src/ui/worktreeLogic.js` 的 `computeActiveKeysAfterCreate`。
- **任务需求流程（workflow）**：worktree 任务行的「流程」入口（`WorktreePanel` 的 `WorkflowControl`）聚合一组可配置步骤，点开 Popover 后逐步操作。**步骤统一模型** `{key,label,command}`：每个步骤都可打勾标记完成（按「任务名→已勾选 key 数组」持久化到 `~/.visualWorktree/task-workflow.json`）；`command` 非空的步骤额外渲染「执行」按钮，点击在任务目录下跑该 shell 命令（打勾与执行并存）。**历史模型迁移**：旧版用 `type:'checkbox'|'action'` 互斥模型，已废弃；`normalizeWorkflowSteps` 读到旧 `type` 步骤时忽略 type、按无 command 处理（仅可勾选，不丢步骤）。纯逻辑在 `src/ui/workflowLogic.js`（步骤规范化/勾选态读写/进度计算，含默认步骤清单 `DEFAULT_WORKFLOW_STEPS`），步骤清单存于 `config.workflowSteps`，在设置「流程」Tab 增删改（每行「步骤名 + 执行命令」两栏）。**进度计算**：`computeWorkflowProgress` 的 total 为全部步骤数（所有步骤都可勾选）。**进度徽标防撑长**：`WorktreePanel` 中步骤数 ≤`PROGRESS_DOT_MAX`(5) 用一排圆点展示，>5 改紧凑 `✓ N/M` 文字，全完成显绿勾。**改名不丢勾选态**：设置表单每行隐藏保留步骤 `key`，`normalizeWorkflowSteps` 保存时只对缺失 key 的新步骤补 key 并去重。**执行链路**：命令模板渲染（占位符 `{path}`任务目录/`{task}`任务名/`{branch}`分支，替换值用 shell 单引号包裹防拆词）在纯逻辑 `src/core/commandRunner.js` 的 `buildStepCommand`；真正 `exec` 在 `ipcHandlers.js` 的 `runWorkflowStep`（新增 `RUN_WORKFLOW_STEP` IPC，在 cwd=任务目录下执行，回传 `{success,code,stdout,stderr}`）；`App.jsx` 的 `handleRunStepAction` 落地，成败 message + stdout/stderr 输出弹窗反馈。`config.js` 的默认步骤从 `workflowLogic.js` import（该模块纯净无依赖，不会把 React/fs 带入对方）。
- app 调用系统 `git`，不内置；目标机器需安装 git。

## 规范

- 项目为 ESM（`"type": "module"`），唯一例外是 `preload.cjs`（Electron preload 要求 CommonJS）。
- 所有交流与文档用中文。代码注释规则见全局 AGENTS.md：函数/方法、变量必须加注释；复杂逻辑注释说明 WHY。现有代码注释密度很高，新代码须匹配这一风格。
- 小功能不要使用 worktree，直接当前分支开发，如果有必要再使用，使用了后需要合并到主分支并且删除worktree
- 容易阻塞的任务需要异步处理，需要增加loading，统一loading


## 开发

开发的时候，强制考虑 antd 是否有合适的组件，优先使用 antd 组件实现
