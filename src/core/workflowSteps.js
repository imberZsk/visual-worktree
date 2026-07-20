// 工作流默认步骤清单（纯数据，零依赖）。
//
// WHY 单独放在 core：config.js（主进程，打包后跑在 app.asar 内）需要这份默认清单做兜底配置。
// 若让 config.js 从 src/ui/workflowLogic.ts 取，会形成「core 依赖 ui」的反向分层依赖——
// 开发/测试时源码俱全能跑，但打包后 src/ui 被 Vite 编进 dist、不进 asar，主进程 import 会
// ERR_MODULE_NOT_FOUND 直接崩溃。把数据下沉到 core 后，core 与 ui 都从这里取，core 永不依赖 ui。
//
// 步骤模型 { key, label, command }：所有步骤都可勾选标记完成；command 非空的步骤额外可「执行」。

/**
 * 默认工作流步骤清单：用户从未配置过时的兜底，覆盖一个需求的典型研发流程。
 * key 为持久化/识别用的稳定标识（勾选态按 key 存储，改名不丢勾选），label 为展示名，
 * command 为可选的执行命令（空串表示该步骤仅可勾选、无执行按钮；用户可在设置里按需补命令）。
 */
export const DEFAULT_WORKFLOW_STEPS = [
  { key: 'requirements', label: '需求确认', command: '' },
  { key: 'implementation', label: '开发实现', command: '' },
  { key: 'verification', label: '测试验证', command: '' },
  { key: 'delivery', label: '提交交付', command: '' },
]
