# 任务 4：集成 Claude Code 对话追踪 - 实现总结

## 已完成功能

### 1. 核心服务层 (`src/core/claudeService.js`)

实现了完整的 Claude Code 数据读取和统计功能：

**主要函数：**

- `scanClaudeSessions(deps)` - 扫描 `~/.claude/jobs/` 下的所有会话，提取 sessionId、cwd、name、intent、createdAt、model 等信息
- `cwdToProjectDir(cwd)` - 将工作目录路径转换为 projects 子目录名（如 `/Users/alice/workspace` → `-Users-alice-workspace`）
- `parseTokenUsage(jsonlPath, deps)` - 从 JSONL 文件统计 token 用量（input/output/cacheWrite/cacheRead）
- `calculateCost(usage)` - 根据 Claude Opus 4.8 定价计算费用（美元）
- `usdToCny(usd)` - 美元转人民币（汇率 7.2）
- `getSessionsByTask(taskName, worktreesRoot, deps)` - 根据任务名匹配关联的会话，并附加 token 用量和费用
- `getTasksSummary(taskNames, worktreesRoot, deps)` - 批量获取多个任务的用量汇总

**数据来源：**
- 会话元数据：`~/.claude/jobs/{jobId}/state.json`
- 对话记录：`~/.claude/projects/{cwdToProjectDir(cwd)}/{sessionId}.jsonl`

**定价（Claude Opus 4.8）：**
- Input tokens: $15/M
- Output tokens: $75/M
- Cache writes: $18.75/M
- Cache reads: $1.5/M

### 2. IPC 集成

**新增 IPC 通道（`electron/ipcChannels.js`）：**
- `GET_CLAUDE_SESSIONS_BY_TASK` - 获取任务关联的会话列表
- `GET_CLAUDE_TASKS_SUMMARY` - 获取所有任务的用量汇总

**IPC 处理器（`electron/ipcHandlers.js`）：**
- 注册了上述两个通道的 handler
- 自动读取配置中的 `worktreesPath` 作为根目录

**Preload 暴露（`electron/preload.cjs`）：**
- `window.api.getClaudeSessionsByTask(taskName)`
- `window.api.getClaudeTasksSummary(taskNames)`

### 3. 前端 API 层（`src/ui/api.js`）

添加了两个新 API：
- `getClaudeSessionsByTask(taskName)` - 获取单个任务的会话列表
- `getClaudeTasksSummary(taskNames)` - 批量获取多个任务的汇总

非 Electron 环境降级为空实现（返回 `[]` 或 `{}`）。

### 4. UI 组件

**新增组件（`src/ui/components/ClaudeUsageTag.jsx`）：**
- 显示任务的 Claude Code 用量标签
- 紫色标签显示总 token 数和费用（如 `45.1K · $0.893`）
- Tooltip 展示详细分项：会话数、Input/Output/Cache Write/Cache Read tokens、总费用（美元+人民币）
- 支持预加载数据（批量查询）或单独加载（降级）

**集成到 WorktreePanel（`src/ui/components/WorktreePanel.jsx`）：**
- 在任务标题栏显示 `<ClaudeUsageTag>` 组件
- 组件启动时批量预加载所有任务的用量汇总（通过 `useEffect`）
- 将汇总数据传递给各任务的标签，避免重复请求

### 5. 测试

**单元测试（`test/claudeService.test.js`）：**
- 测试覆盖率：12 个测试用例，全部通过
- 测试场景：
  - 路径转换（`cwdToProjectDir`）
  - 会话扫描（`scanClaudeSessions`）
  - Token 统计（`parseTokenUsage`）
  - 费用计算（`calculateCost`）
  - 汇率转换（`usdToCny`）
  - 任务关联（`getSessionsByTask`）
  - 批量汇总（`getTasksSummary`）

**手动验证脚本（`scripts/verify-claude-usage.js`）：**
- 扫描本地真实 Claude Code 数据
- 支持命令行参数测试任务关联
- 输出会话列表、token 分项、费用汇总

运行示例：
```bash
# 扫描所有会话
node scripts/verify-claude-usage.js

# 测试任务关联和用量统计
node scripts/verify-claude-usage.js "任务名" ~/Desktop/work/cyt/worktrees
```

## 实现亮点

### 1. 依赖注入设计
所有核心函数支持依赖注入，便于单元测试：
```javascript
scanClaudeSessions({ homedir, existsSync, readdirSync, readFileSync, statSync })
```

### 2. 路径规范化
使用 `realpathSync` 处理 macOS 的 symlink（如 `/tmp` → `/private/tmp`），避免路径匹配失败。

### 3. 容错处理
- JSONL 解析损坏行时跳过，不影响其余数据
- 文件不存在时返回零用量，不抛错
- state.json 解析失败时跳过该会话

### 4. 批量优化
前端一次性批量加载所有任务的汇总数据，避免 N 次请求。

### 5. 响应式设计
用量标签支持：
- Loading 状态（加载中显示 Spin）
- 无数据时不渲染（避免空标签占位）
- Tooltip 详细信息（hover 查看分项）

## 数据流

```
WorktreePanel (组件挂载)
  ↓
useEffect 批量加载
  ↓
api.getClaudeTasksSummary(taskNames)
  ↓
window.api.getClaudeTasksSummary (preload)
  ↓
ipcRenderer.invoke('get-claude-tasks-summary')
  ↓
ipcHandlers (主进程)
  ↓
claudeService.getTasksSummary(taskNames, worktreesPath)
  ↓
scanClaudeSessions() → 遍历 ~/.claude/jobs/*/state.json
  ↓
getSessionsByTask() → 按 cwd 或 intent 匹配任务目录
  ↓
parseTokenUsage() → 读取 ~/.claude/projects/.../{sessionId}.jsonl
  ↓
calculateCost() → 计算费用
  ↓
返回 { [taskName]: { sessionCount, usage, cost } }
  ↓
WorktreePanel 更新 state → ClaudeUsageTag 渲染
```

## 使用场景

### 场景 1：任务列表快速查看成本
在 Worktree 面板的任务列表中，每个任务标题栏显示紫色标签，一眼看出该任务花费了多少 token 和费用。

### 场景 2：成本对比
多个任务并列显示时，可以直观对比哪个任务的 AI 成本更高，辅助评估开发效率。

### 场景 3：历史追溯
通过 Tooltip 查看详细的会话数和 token 分项，了解 Cache 复用率（Cache Read 高说明复用好，成本低）。

### 场景 4：费用汇总
未来可扩展：在设置面板或统计页面展示所有任务的总费用、按时间范围筛选、导出 CSV 报表等。

## 已知限制

1. **模型定价硬编码**：当前只支持 Claude Opus 4.8 的定价，未来需根据 `model` 字段动态选择定价表。
2. **路径匹配规则**：优先用 `cwd` 字段匹配任务目录；但实际场景中 Claude Code 的 `cwd` 常是启动目录（如 `~/Desktop`）而非 worktree 目录，因此额外检查 `intent`（用户首条输入）中是否包含任务目录绝对路径作为兜底。若两者都不命中（如用户未在首条消息提及路径且在父目录启动），仍可能匹配不到。
3. **实时性**：用量数据需在会话结束后才完整，进行中的会话只能看到部分 token。
4. **多项目任务**：当前一个会话只对应一个 cwd，跨多个仓库的任务需按 cwd 分组（已实现，但 UI 未细分展示）。

## 未来扩展方向

1. **模型支持**：从 `model` 字段判断定价（Opus/Sonnet/Haiku），支持多模型混用场景。
2. **时间筛选**：按会话创建时间筛选，查看某时间段的费用。
3. **详细会话列表**：点击标签展开详细会话列表（含 intent、创建时间、token 分项）。
4. **费用报表**：导出 CSV/Excel，含任务名、会话数、token 分项、费用。
5. **预算告警**：设置任务预算，超出时提示。
6. **Cache 优化建议**：分析 Cache Read 比例，给出优化建议（如提前 prefill）。

## 文件清单

**新增文件：**
- `src/core/claudeService.js` - 核心服务（281 行）
- `src/ui/components/ClaudeUsageTag.jsx` - 用量标签组件（130 行）
- `test/claudeService.test.js` - 单元测试（318 行）
- `scripts/verify-claude-usage.js` - 手动验证脚本（103 行）
- `docs/claude-usage-implementation.md` - 本文档

**修改文件：**
- `electron/ipcChannels.js` - 新增 2 个 IPC 通道
- `electron/ipcHandlers.js` - 新增 2 个 handler，import claudeService
- `electron/preload.cjs` - 暴露 2 个 API
- `src/ui/api.js` - 新增 2 个 API，浏览器降级
- `src/ui/components/WorktreePanel.jsx` - 集成 ClaudeUsageTag，批量预加载

## 测试验证

```bash
# 运行单元测试
npm test -- test/claudeService.test.js

# 手动验证（扫描会话）
node scripts/verify-claude-usage.js

# 手动验证（任务关联）
node scripts/verify-claude-usage.js "任务名" ~/path/to/worktrees
```

## 总结

任务 4 已完整实现，核心功能包括：

✅ 扫描 Claude Code 本地会话数据  
✅ 统计 token 用量（input/output/cache write/cache read）  
✅ 计算费用（美元 + 人民币）  
✅ 按任务名关联会话（路径匹配）  
✅ 批量汇总多个任务的用量  
✅ 集成到 WorktreePanel UI（紫色标签 + Tooltip）  
✅ 单元测试覆盖（12 个测试用例，全部通过）  
✅ 手动验证脚本（读取真实数据）  

代码遵循项目规范：
- 纯 Node 核心逻辑（`src/core/`），不依赖 Electron
- 依赖注入设计，便于测试
- 所有函数和变量添加中文注释
- 容错处理，文件不存在不抛错
- 路径规范化（`realpathSync`）处理 symlink

UI 集成：
- 批量预加载优化性能
- Loading 状态友好
- 无数据时不显示（避免空标签）
- Tooltip 详细信息（会话数、token 分项、费用）
- 紫色标签醒目且不喧宾夺主

该功能为开发者提供了**透明的 AI 成本追踪**，有助于评估开发效率和优化 AI 使用策略。
