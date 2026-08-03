# IPC 规范

## 新增或修改 IPC

跨进程能力通常需要同步检查以下位置，不得只改其中一处：

1. `electron/ipcChannels.js`：定义唯一通道常量。
2. `electron/preload.cjs`：同步内联通道名，并通过 `contextBridge` 暴露最小 API。
3. `electron/ipcHandlers.js`：注册 handler 或主进程推送逻辑。
4. `src/core/`：放置可测试的核心实现或纯逻辑。
5. `src/ui/api.ts`：补齐渲染层类型/适配与非 Electron 降级。
6. 调用方 hook、store 或组件：处理 loading、成功、失败与取消。
7. `test/ipcHandlers.test.js` 及相关 UI/核心测试：验证通道注册和行为。

## 安全边界

- 保持 `contextIsolation: true` 与 `nodeIntegration: false`；不得为了方便把 Node 或整个 `ipcRenderer` 暴露给渲染进程。
- preload 只暴露命名明确、参数最小的业务 API；系统 `shell`、`clipboard`、文件系统等能力通过主进程 handler 和依赖注入使用。
- handler 对来自渲染进程的路径、URL、命令和对象参数进行类型、空值和边界校验，不能信任 UI 已经校验。
- 文件删除、目录清理和外部命令执行必须验证目标位于允许根目录，避免路径穿越或越界操作。

## 事件与返回值

- `ipcMain.handle` 返回稳定的可序列化结构，不把 Error、函数、Electron 对象直接跨进程传输。
- 主进程推送事件在窗口为空或已销毁时安全降级；访问 `getWindow()` 返回值前必须判空。
- preload 事件订阅包装内部 listener，并返回精确移除该 listener 的取消函数。
- 流式输出、批量进度等事件必须带足够的任务标识，避免并发任务串流或覆盖。
- 新增通道名时检查 `ipcChannels.js` 与 `preload.cjs` 一致；preload 是 CommonJS，不能直接导入 ESM 常量。

## 既有约束

- 剪贴板继续通过 `COPY_TEXT` 进入主进程；Electron sandbox 下不得在 preload 直接获取 `clipboard`。
- 可测试的命令构建、平台选择和数据转换下沉到核心层；`ipcHandlers.js` 只保留系统副作用、依赖注入与兜底编排。
