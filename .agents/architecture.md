# 架构约束

## 分层边界

- `src/core/` 是纯 Node 业务层，负责 Git、配置、终端命令构建、环境检查、AI 会话与任务文档等逻辑；不得依赖 React 或 Electron 渲染进程。
- `electron/` 是主进程与跨进程适配层，负责窗口、系统能力、CSP、自动更新和 IPC 转发；能测试的业务判断不得长期堆在 handler 中。
- `src/ui/` 是 React + TypeScript 渲染层；组件负责展示与交互，跨组件状态放 Zustand，复杂流程放 hooks，可独立验证的纯计算放相邻 `*Logic.ts`。
- `src/ui/api.ts` 是 UI 对 Electron preload API 的统一适配层，并为非 Electron 测试环境提供安全降级。
- 共享模块只承载多个调用方都成立的规则；页面专用逻辑留在页面组件或对应 hook，不得塞入公共组件。

## 数据流

跨进程调用遵循：`组件 -> hook/store -> src/ui/api.ts -> window.api -> preload.cjs -> ipcRenderer -> ipcHandlers.js -> src/core`。

主进程主动推送遵循：`src/core/ipcHandlers -> webContents.send -> preload 订阅 -> src/ui/api.ts -> hook/store`，订阅 API 必须返回取消订阅函数。

## 设计原则

- 副作用与纯逻辑分离：命令构建、数据规范化、状态计算应可注入依赖并单测；文件系统、进程、窗口和网络调用留在边界层。
- 只有存在实际复用时才抽离函数或组件；单一调用点的简单逻辑保持就地可读。
- 新功能优先沿用现有模块、数据模型和依赖注入方式，不并行建立第二套状态或持久化机制。
- 修改共享模块前必须搜索全部使用方并确认行为对每个调用方安全。
- 持久化配置统一通过 `src/core/config.js` 及现有存储模块管理，不在组件内新增散落的文件读写。

## 技术边界

- 项目整体使用 ESM；Electron preload 因运行环境要求保持 `preload.cjs` CommonJS。
- UI 源码使用 `.ts/.tsx`，核心层和 Electron 层目前使用 `.js/.cjs`；新增文件遵循所在目录现状。
- Vite 根目录为 `src/ui`，生产环境通过相对资源路径供 Electron `file://` 加载。
