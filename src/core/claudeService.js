import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readdirSync, readFileSync, statSync, realpathSync } from 'fs';

/**
 * 跨平台 join：结果统一为正斜杠分隔符。
 * WHY：Windows 上 path.join 返回反斜杠，而测试 mock（以及 Claude Code 本身的
 * projects 目录命名）使用正斜杠风格路径。二者做字符串匹配时必然失配，
 * 导致 existsSync/readdirSync mock 查不到对应路径。用此函数替换所有内部路径拼接，
 * 保证字符串结果在两个平台都是正斜杠。macOS 上为恒等变换，零影响。
 * @param {...string} parts - 路径片段
 * @returns {string} 正斜杠分隔的路径
 */
function posixJoin(...parts) {
  // join 先做跨平台路径规范化（处理 .. / . 等），再统一换为正斜杠
  return join(...parts).replace(/\\/g, '/');
}

// Claude Code 对话追踪服务：读取本地 Claude Code 的会话数据，按任务统计 token 用量与费用。
// 数据来源：~/.claude/projects/{转义后的cwd}/{sessionId}.jsonl（主会话）
//           ~/.claude/projects/{转义后的cwd}/{sessionId}/**/*.jsonl（该会话派生的 subagent / workflow）
// 注意：历史实现只扫 ~/.claude/jobs（仅后台 job 会话有 state.json），漏掉了绝大多数普通交互式会话，
//      现改为直接遍历 projects 目录，覆盖全部会话。

/**
 * 各模型单价（美元/百万 token）。取自 litellm 官方定价表（ccusage 等工具同源），
 * 与 Claude Code statusline 展示的 cost 口径一致——中转场景下 Claude Code 仍按模型官方价计费，
 * 故用此表按模型逐条计价可复现 statusline 的费用。
 * WHY 按模型区分：历史实现对所有模型统一套用 Opus 旧价（15/75/18.75/1.5），
 * 而实际 opus-4-8 已降到 5/25/6.25/0.5、sonnet 系列为 3/15/3.75/0.3，统一计价会高估约 5 倍。
 */
const MODEL_PRICING = {
  // Sonnet 系列：输入 3 / 输出 15 / 缓存写 3.75 / 缓存读 0.3
  'claude-sonnet-5': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-sonnet-4': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  // Opus 4.5 及以后：降价后的 5 / 25 / 6.25 / 0.5
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  // Opus 4.1 及更早：旧价 15 / 75 / 18.75 / 1.5
  'claude-opus-4-1': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-opus-4': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  // Haiku 4.5：1 / 5 / 1.25 / 0.1
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

/**
 * 未知模型的回退单价：用 Sonnet 价作保守估计（当前最常用的模型档位）。
 */
const DEFAULT_PRICING = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };

/**
 * 人民币汇率（用于展示双币种）
 */
const USD_TO_CNY = 7.2;

/**
 * 提取 jsonl 头部时读取的最大行数：任务号/首条意图通常出现在会话开头，
 * 只读前若干行即可拿到 cwd/intent/model 与用于任务号匹配的用户文本，避免全量读文件拖慢扫描。
 */
const HEAD_LINES = 400;

/**
 * 根据模型名查其单价。先精确匹配，再按「已知 key 前缀」匹配（模型名可能带日期/版本后缀），
 * 前缀匹配按 key 长度降序，保证 `claude-opus-4-8` 优先于 `claude-opus-4` 命中。
 * @param {string} model - 模型名（如 claude-sonnet-5）
 * @returns {{input:number,output:number,cacheWrite:number,cacheRead:number}} 单价（美元/百万 token）
 */
function priceFor(model, customPricing) {
  // 自定义规则启用时统一覆盖模型价格；直接调用的异常字段按零处理，避免产生 NaN 费用。
  if (customPricing?.enabled) {
    return {
      input: Number(customPricing.input) || 0,
      output: Number(customPricing.output) || 0,
      cacheWrite: Number(customPricing.cacheWrite) || 0,
      cacheRead: Number(customPricing.cacheRead) || 0,
    };
  }
  // 无模型名时用默认价
  if (!model) return DEFAULT_PRICING;
  // 精确命中
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  // 前缀命中：长 key 优先，避免 4-8 被 4 抢先匹配
  const key = Object.keys(MODEL_PRICING)
    .sort((a, b) => b.length - a.length)
    .find((k) => model.startsWith(k));
  return key ? MODEL_PRICING[key] : DEFAULT_PRICING;
}

/**
 * 从任务名提取 Jira issue key（形如 PROJ-1001）。
 * @param {string} taskName - 任务目录名（如 PROJ-1001-订单状态提醒）
 * @returns {string} issue key（如 PROJ-1001），无则返回空串
 */
function extractIssueKey(taskName) {
  // 匹配「大写字母开头 + 可含数字 + 连字符 + 数字」的 Jira key
  const m = /([A-Z][A-Z0-9]*-\d+)/.exec(taskName || '');
  return m ? m[1] : '';
}

/**
 * 判断用户文本中是否含指定 Jira issue key 的「链接形式」（/browse/KEY 或其 URL 编码形式）。
 * WHY 只认链接而非裸编号：纯编号（如 PROJ-1001）在"讨论这个任务"的会话（git log、review 消息等）
 *      中随处可见，会把"调试该功能"的会话误算进任务费用；
 *      而 /browse/KEY 是开发者在真正打开/处理该任务时的操作路径，精确信号强得多。
 *      URL 编码形式（%2FPROJ-1001）同样视为命中，覆盖 slash command 参数里的 URL 场景。
 * @param {string} text - 待检索的用户文本（headText）
 * @param {string} issueKey - Jira issue key（如 PROJ-1001）
 * @returns {boolean} 是否含链接形式的任务引用
 */
function hasJiraLinkInText(text, issueKey) {
  if (!text || !issueKey) return false;
  // plainLink 为普通路径形式，如 /browse/PROJ-1001
  const plainLink = '/browse/' + issueKey;
  // encodedLink 为 URL 编码形式，如 %2Fbrowse%2FPROJ-1001
  const encodedLink = '%2Fbrowse%2F' + issueKey;
  return text.includes(plainLink) || text.includes(encodedLink);
}

/**
 * 从一条 user 记录中提取纯文本内容（含 slash 命令包装文本，如 <command-args>）。
 * content 可能是字符串，也可能是内容块数组（{type,text}）。
 * @param {object} record - 一条 jsonl 记录
 * @returns {string} 拼接后的文本
 */
function extractUserText(record) {
  // 用户消息体
  const c = record?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map((x) => (typeof x === 'string' ? x : x?.text || '')).join(' ');
  }
  return '';
}

/**
 * 将 cwd 路径转换为 projects 子目录名
 * 规则：去除开头斜杠，将所有非 ASCII 字母/数字/点/连字符的字符（含 / 和中文）替换为连字符。
 * Claude Code 创建 projects 子目录时使用相同规则——中文等非 ASCII 字符会被替换为 -，
 * 若此处只替换 / 而保留中文，会导致 JSONL 文件路径匹配失败（读不到 token 数据）。
 * 例如：/Users/alice/workspace → -Users-alice-workspace
 *       /worktrees/PROJ-5001-示例任务 → -worktrees-PROJ-5001------
 * @param {string} cwd - 工作目录路径
 * @returns {string} projects 子目录名
 */
export function cwdToProjectDir(cwd) {
  // 去除开头斜杠，再把所有非 [A-Za-z0-9._-] 字符（包括 / 和中文）统一替换为 -
  return '-' + cwd.replace(/^\//, '').replace(/[^A-Za-z0-9._-]/g, '-');
}

/**
 * 从主会话 jsonl 的头部提取元信息（cwd / 首条意图 / 创建时间 / 模型 / 用户文本聚合）。
 * 只读前 HEAD_LINES 行，兼顾性能与「任务号通常在开头」的事实。
 * @param {string} jsonlPath - 主会话 jsonl 路径
 * @param {object} deps - 依赖注入：{ existsSync, readFileSync }
 * @returns {{cwd:string,intent:string,createdAt:string,model:string,headText:string}} 元信息
 */
function extractSessionMeta(jsonlPath, deps = {}) {
  // 依赖注入
  const _existsSync = deps.existsSync || existsSync;
  const _readFileSync = deps.readFileSync || readFileSync;

  // meta 存储该会话的头部元信息
  const meta = { cwd: '', intent: '', createdAt: '', model: '', headText: '' };
  if (!_existsSync(jsonlPath)) return meta;

  // content 为文件全文（后续只遍历前 HEAD_LINES 行）
  let content;
  try {
    content = _readFileSync(jsonlPath, 'utf8');
  } catch (e) {
    return meta;
  }

  // lines 为按行切分的原始记录
  const lines = content.split('\n');
  // userTexts 收集用户输入文本，用于任务号匹配（含 slash 命令参数）
  const userTexts = [];

  for (let i = 0; i < lines.length && i < HEAD_LINES; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch (e) {
      continue;
    }
    // 首个带 cwd 的记录即会话工作目录
    if (!meta.cwd && d.cwd) meta.cwd = d.cwd;
    // 首个带时间戳的记录即创建时间
    if (!meta.createdAt && d.timestamp) meta.createdAt = d.timestamp;
    // 首个真实（非合成）assistant 模型即会话主模型（仅用于展示，计费仍按每条消息各自模型）
    if (d.type === 'assistant' && !meta.model) {
      const m = d.message?.model;
      if (m && m !== '<synthetic>') meta.model = m;
    }
    // 收集用户文本：既用于任务号匹配（headText），也用于首条意图（intent）
    if (d.type === 'user') {
      const txt = extractUserText(d);
      if (txt) {
        userTexts.push(txt);
        // intent 取首条「非命令包装」的用户文本（不以 < 开头），截断展示
        if (!meta.intent && !txt.trimStart().startsWith('<')) meta.intent = txt.trim().slice(0, 200);
      }
    }
  }

  meta.headText = userTexts.join('\n');
  return meta;
}

/**
 * 扫描所有 Claude Code 会话任务（遍历 ~/.claude/projects）。
 * 每个项目子目录下的顶层 `{sessionId}.jsonl` 视为一个会话；同名子目录（subagents/workflows）在统计时归并。
 * @param {object} deps - 依赖注入：{ homedir, existsSync, readdirSync, readFileSync, statSync }
 * @returns {Array<object>} 会话列表，每项：{ sessionId, projectDir, jsonlPath, cwd, intent, createdAt, model, headText }
 */
export function scanClaudeSessions(deps = {}) {
  // 依赖注入，便于测试
  const _homedir = deps.homedir || homedir;
  const _existsSync = deps.existsSync || existsSync;
  const _readdirSync = deps.readdirSync || readdirSync;
  const _readFileSync = deps.readFileSync || readFileSync;

  // projects 根目录，用 posixJoin 保证正斜杠（Windows 下 join 返回反斜杠，与 mock 路径不匹配）
  const projectsDir = posixJoin(_homedir(), '.claude', 'projects');
  if (!_existsSync(projectsDir)) return [];

  // sessions 存储扫描到的所有会话
  const sessions = [];

  // 项目子目录列表（目录名由 cwd 转义而来）
  let projectSubdirs;
  try {
    projectSubdirs = _readdirSync(projectsDir);
  } catch (e) {
    return [];
  }

  for (const sub of projectSubdirs) {
    // subPath 为单个项目子目录路径（posixJoin 保证正斜杠，与 mock 路径匹配）
    const subPath = posixJoin(projectsDir, sub);
    let entries;
    try {
      entries = _readdirSync(subPath);
    } catch (e) {
      // 非目录或无权限时跳过
      continue;
    }
    for (const entry of entries) {
      // 只取顶层会话文件（.jsonl）；子目录（subagents）在统计 token 时通过 sessionId 关联
      if (!entry.endsWith('.jsonl')) continue;
      // jsonlPath 为主会话文件路径（posixJoin 保证正斜杠）
      const jsonlPath = posixJoin(subPath, entry);
      // sessionId 为去掉扩展名的文件名
      const sessionId = entry.replace(/\.jsonl$/, '');
      // meta 为从头部提取的会话元信息
      const meta = extractSessionMeta(jsonlPath, { existsSync: _existsSync, readFileSync: _readFileSync });
      sessions.push({
        sessionId,
        projectDir: sub,
        jsonlPath,
        cwd: meta.cwd,
        intent: meta.intent,
        createdAt: meta.createdAt,
        model: meta.model,
        headText: meta.headText,
      });
    }
  }

  return sessions;
}

/**
 * 递归收集目录下所有 .jsonl 文件路径（用于归并某会话派生的 subagent / workflow 记录）。
 * @param {string} dir - 起始目录
 * @param {string[]} out - 结果累积数组（原地追加）
 * @param {object} deps - 依赖注入：{ existsSync, readdirSync, statSync }
 * @returns {void}
 */
function collectJsonlFiles(dir, out, deps = {}) {
  // 依赖注入
  const _existsSync = deps.existsSync || existsSync;
  const _readdirSync = deps.readdirSync || readdirSync;
  const _statSync = deps.statSync || statSync;

  if (!_existsSync(dir)) return;
  let entries;
  try {
    entries = _readdirSync(dir);
  } catch (e) {
    return;
  }
  for (const e of entries) {
    // p 为子条目完整路径（posixJoin 保证正斜杠一致性）
    const p = posixJoin(dir, e);
    let st;
    try {
      st = _statSync(p);
    } catch (err) {
      continue;
    }
    if (st.isDirectory()) {
      // 目录则递归深入（subagents/workflows 可能有多层）
      collectJsonlFiles(p, out, deps);
    } else if (e.endsWith('.jsonl')) {
      out.push(p);
    }
  }
}

/**
 * 构造某条 assistant 记录的去重键。
 * WHY 需要去重：Claude Code 的流式写入会把同一次 API 响应（同一 message.id）在 jsonl 里
 *      追加成 2~4 条记录，且每条的 usage 完全相同。若逐行累加会把 token/费用放大数倍，
 *      导致展示值远高于 statusline。去重口径与 ccusage 一致（messageId + requestId 组合，
 *      requestId 缺失时退化为仅 messageId）。
 * @param {object} d - 一条 jsonl 记录
 * @returns {string} 去重键；无 message.id 时返回空串（表示无法去重、照常计入）
 */
function usageDedupeKey(d) {
  // messageId 为该次 API 响应的唯一标识（同一响应多次落盘时保持一致）
  const messageId = d?.message?.id || '';
  if (!messageId) return '';
  // requestId 部分实现放在顶层，部分缺失；有则拼进键做更强区分，无则仅用 messageId
  const requestId = d?.requestId || '';
  return requestId ? `${messageId}:${requestId}` : messageId;
}

/**
 * 从单个 JSONL 文件累加 token 用量（按模型分组），结果原地写入 acc。
 * 只统计 assistant 消息的 usage；跳过 <synthetic> 合成消息（不计费）；
 * 按 message.id 跨文件去重，避免同一响应的重复落盘被多次累加。
 * @param {string} jsonlPath - JSONL 文件路径
 * @param {Record<string,object>} acc - 累加器：model → { input, output, cacheWrite, cacheRead }
 * @param {object} deps - 依赖注入：{ existsSync, readFileSync }
 * @param {Set<string>} [seen] - 已计入的去重键集合（跨文件共享，避免主会话与 subagent 间重复计数）
 * @returns {void}
 */
function accumulateUsageByModel(jsonlPath, acc, deps = {}, seen = new Set()) {
  // 依赖注入
  const _existsSync = deps.existsSync || existsSync;
  const _readFileSync = deps.readFileSync || readFileSync;

  if (!_existsSync(jsonlPath)) return;
  let content;
  try {
    content = _readFileSync(jsonlPath, 'utf8');
  } catch (e) {
    return;
  }

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch (e) {
      // 跳过损坏行
      continue;
    }
    // 只统计 assistant 消息的 usage
    if (d.type === 'assistant' && d.message?.usage) {
      // model 为该条消息实际使用的模型；合成消息无计费
      const model = d.message.model || 'unknown';
      if (model === '<synthetic>') continue;
      // dedupeKey 为该次响应的去重键；已见过则跳过，避免重复落盘导致 token/费用翻倍
      const dedupeKey = usageDedupeKey(d);
      if (dedupeKey) {
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
      }
      const u = d.message.usage;
      // b 为该模型的 token 累加桶
      const b = acc[model] || (acc[model] = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
      b.input += u.input_tokens || 0;
      b.output += u.output_tokens || 0;
      b.cacheWrite += u.cache_creation_input_tokens || 0;
      b.cacheRead += u.cache_read_input_tokens || 0;
    }
  }
}

/**
 * 从 JSONL 文件统计 token 用量（单文件、不分模型、不含 subagents）。
 * 保留此工具函数供底层调用与测试；会话级统计请用 scanClaudeSessions + getSessionsByTask。
 * @param {string} jsonlPath - JSONL 文件路径
 * @param {object} deps - 依赖注入：{ existsSync, readFileSync }
 * @returns {object} token 用量：{ input, output, cacheWrite, cacheRead }
 */
export function parseTokenUsage(jsonlPath, deps = {}) {
  // 复用按模型累加逻辑，再把各模型合并为总量
  const acc = {};
  accumulateUsageByModel(jsonlPath, acc, deps);
  const total = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  for (const u of Object.values(acc)) {
    total.input += u.input;
    total.output += u.output;
    total.cacheWrite += u.cacheWrite;
    total.cacheRead += u.cacheRead;
  }
  return total;
}

/**
 * 计算费用（美元）。按传入模型取单价；不传模型时用默认（Sonnet）价。
 * @param {object} usage - token 用量：{ input, output, cacheWrite, cacheRead }
 * @param {string} [model] - 模型名，用于选取单价
 * @param {object} [customPricing] - 可选的用户自定义统一计价规则
 * @returns {number} 费用（美元），保留 6 位小数
 */
export function calculateCost(usage, model, customPricing) {
  // p 存储当前模型最终采用的单价，自定义规则启用时覆盖内置模型价格。
  const p = priceFor(model, customPricing);
  const cost =
    (usage.input * p.input +
      usage.output * p.output +
      usage.cacheWrite * p.cacheWrite +
      usage.cacheRead * p.cacheRead) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000; // 保留 6 位小数
}

/**
 * 将美元转换为人民币
 * @param {number} usd - 美元金额
 * @param {number} [exchangeRate] - 美元兑人民币汇率
 * @returns {number} 人民币金额，保留 2 位小数
 */
export function usdToCny(usd, exchangeRate = USD_TO_CNY) {
  // safeExchangeRate 存储有效汇率，非法调用参数回退内置汇率。
  const safeExchangeRate = Number.isFinite(Number(exchangeRate)) && Number(exchangeRate) > 0
    ? Number(exchangeRate)
    : USD_TO_CNY;
  return Math.round(usd * safeExchangeRate * 100) / 100;
}

/**
 * 计算单个会话的完整用量与费用（含其派生的 subagent / workflow，按模型分别计价）。
 * @param {object} session - scanClaudeSessions 返回的会话对象
 * @param {object} deps - 依赖注入
 * @returns {{usage:object, cost:{usd:number,cny:number}, byModel:object}} 汇总结果
 */
function computeSessionUsageAndCost(session, deps = {}) {
  // 依赖注入
  const _homedir = deps.homedir || homedir;
  const _existsSync = deps.existsSync || existsSync;

  // files 收集主会话 jsonl + 同目录 {sessionId}/ 下所有 subagent / workflow jsonl
  const files = [];
  // mainPath 为主会话文件路径（优先用扫描时记录的路径，兜底按 projectDir 拼接）
  const mainPath =
    session.jsonlPath ||
    posixJoin(_homedir(), '.claude', 'projects', session.projectDir, `${session.sessionId}.jsonl`);
  if (_existsSync(mainPath)) files.push(mainPath);
  // subDir 为该会话派生记录的子目录（subagents/workflows），posixJoin 保证正斜杠与 mock 匹配
  const subDir = posixJoin(_homedir(), '.claude', 'projects', session.projectDir, session.sessionId);
  collectJsonlFiles(subDir, files, deps);

  // byModelUsage 为「模型 → token 用量」累加结果
  const byModelUsage = {};
  // seen 为跨文件共享的去重键集合：主会话与 subagent 可能重复记录同一响应，需统一去重
  const seen = new Set();
  for (const f of files) {
    accumulateUsageByModel(f, byModelUsage, deps, seen);
  }

  // usage 为该会话所有模型的 token 总和
  const usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  // usd 为该会话按模型分别计价后的费用总和
  let usd = 0;
  // byModel 为按模型拆分的用量与费用明细（供展示/排查）
  const byModel = {};
  for (const [model, u] of Object.entries(byModelUsage)) {
    usage.input += u.input;
    usage.output += u.output;
    usage.cacheWrite += u.cacheWrite;
    usage.cacheRead += u.cacheRead;
    // c 存储该模型按当前用户规则计算出的美元费用。
    const c = calculateCost(u, model, deps.tokenPricing);
    usd += c;
    byModel[model] = { usage: u, cost: { usd: c, cny: usdToCny(c, deps.tokenPricing?.usdToCny) } };
  }
  usd = Math.round(usd * 1_000_000) / 1_000_000;

  return { usage, cost: { usd, cny: usdToCny(usd, deps.tokenPricing?.usdToCny) }, byModel };
}

/**
 * 判断某会话是否归属指定任务，命中则返回带用量与费用的会话对象，否则返回 null。
 * 命中条件（满足其一）：
 *   1) cwd 是任务目录本身或其子目录；
 *   2) intent 中包含任务目录的绝对路径（cwd 为启动目录、用户把路径贴进首条消息的场景）；
 *   3) 会话的用户输入/命令参数（headText）中包含任务的 Jira issue key
 *      （任务在源项目或多 agent 工作流里开发、cwd 不落在 worktree 下的场景）。
 * @param {object} session - 会话对象
 * @param {string} taskDir - 任务目录原始路径
 * @param {string} taskDirReal - 任务目录规范化路径
 * @param {string} issueKey - 从任务名提取的 Jira key（可为空）
 * @param {object} deps - 依赖注入
 * @returns {object|null} 命中则为带 usage/cost 的会话，否则 null
 */
function matchSessionForTask(session, taskDir, taskDirReal, issueKey, deps = {}) {
  // 依赖注入
  const _existsSync = deps.existsSync || existsSync;
  const _realpathSync = deps.realpathSync || realpathSync;

  try {
    // cwdReal 为会话工作目录的规范化路径（规避 macOS /tmp→/private/tmp 等 symlink 差异）
    const cwdReal = session.cwd && _existsSync(session.cwd) ? _realpathSync(session.cwd) : session.cwd;
    // cwdNorm/taskNorm 归一化为正斜杠再比较：Windows 下 realpathSync 返回反斜杠，
    // 而 cwd 字段（来自 JSONL 或 mock）可能是正斜杠，须统一才能正确匹配
    const cwdNorm = (cwdReal || '').replace(/\\/g, '/');
    const taskNorm = taskDirReal.replace(/\\/g, '/');
    // 条件1：cwd 命中任务目录（本身或子目录）
    const cwdMatch = cwdNorm && (cwdNorm === taskNorm || cwdNorm.startsWith(taskNorm + '/'));
    // 条件2：intent 含任务目录完整路径（同时比对原始与规范化路径，覆盖 symlink 前后写法）
    const intent = session.intent || '';
    const intentMatch =
      intent.includes(taskDir) || (taskDirReal !== taskDir && intent.includes(taskDirReal));
    // 条件3：用户输入中含该任务的 Jira 链接（/browse/KEY 或其 URL 编码形式）。
    // WHY 只认链接而非裸编号：讨论型/调试型会话在文本里随手提任务编号但不算开发消耗，
    //      /browse/KEY 是真正打开或处理该任务时产生的精确信号，误报率更低。
    const keyMatch = hasJiraLinkInText(session.headText, issueKey);

    if (cwdMatch || intentMatch || keyMatch) {
      const { usage, cost, byModel } = computeSessionUsageAndCost(session, deps);
      return { ...session, usage, cost, byModel };
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * 在给定会话集合中筛选归属某任务的会话，并补充用量与费用。
 * @param {string} taskName - 任务名（worktree 任务目录名）
 * @param {string} worktreesRoot - worktree 根目录
 * @param {Array<object>} allSessions - scanClaudeSessions 的结果（复用，避免重复扫描）
 * @param {object} deps - 依赖注入
 * @returns {Array<object>} 命中会话列表（按创建时间倒序），每项含 usage、cost、byModel
 */
function selectSessionsForTask(taskName, worktreesRoot, allSessions, deps = {}) {
  // 依赖注入
  const _existsSync = deps.existsSync || existsSync;
  const _realpathSync = deps.realpathSync || realpathSync;

  // 任务 worktree 目录及其规范化路径，posixJoin 保证正斜杠以便与 cwd 字段做字符串匹配
  const taskDir = posixJoin(worktreesRoot, taskName);
  const taskDirReal = _existsSync(taskDir) ? _realpathSync(taskDir) : taskDir;
  // issueKey 为从任务名提取的 Jira 编号（用于跨目录关联）
  const issueKey = extractIssueKey(taskName);

  // matched 为命中并补充了用量/费用的会话
  const matched = [];
  for (const session of allSessions) {
    const hit = matchSessionForTask(session, taskDir, taskDirReal, issueKey, deps);
    if (hit) matched.push(hit);
  }

  // 按创建时间倒序（最新在前）
  matched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return matched;
}

/**
 * 根据任务名匹配关联的 Claude Code 会话，并统计各会话的 token 用量与费用。
 * @param {string} taskName - 任务名（Visual Worktree 中的任务目录名）
 * @param {string} worktreesRoot - worktree 根目录路径
 * @param {object} deps - 依赖注入
 * @returns {Array<object>} 关联会话列表，每项含 { sessionId, cwd, intent, createdAt, model, usage, cost, byModel }
 */
export function getSessionsByTask(taskName, worktreesRoot, deps = {}) {
  // 扫描全部会话后筛选归属该任务的
  const allSessions = scanClaudeSessions(deps);
  return selectSessionsForTask(taskName, worktreesRoot, allSessions, deps);
}

/**
 * 获取多个任务的 Claude Code 用量汇总。
 * 一次性扫描全部会话后对每个任务复用，避免逐任务重复遍历 projects（数据量可达数百 MB）。
 * 同一任务的多个会话、各会话的所有模型，token 与费用全部累加。
 * @param {Array<string>} taskNames - 任务名列表
 * @param {string} worktreesRoot - worktree 根目录路径
 * @param {object} deps - 依赖注入
 * @returns {object} 任务名 → { sessionCount, usage, cost } 的映射
 */
export function getTasksSummary(taskNames, worktreesRoot, deps = {}) {
  // 只扫描一次，供所有任务复用
  const allSessions = scanClaudeSessions(deps);
  // summary 为任务名 → 汇总数据
  const summary = {};

  for (const taskName of taskNames) {
    // 该任务命中的会话（已含各自 usage/cost）
    const sessions = selectSessionsForTask(taskName, worktreesRoot, allSessions, deps);

    // 累加所有会话的 token 用量（不分模型，全部相加）
    const totalUsage = sessions.reduce(
      (acc, session) => ({
        input: acc.input + session.usage.input,
        output: acc.output + session.usage.output,
        cacheWrite: acc.cacheWrite + session.usage.cacheWrite,
        cacheRead: acc.cacheRead + session.usage.cacheRead,
      }),
      { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }
    );

    // 费用直接累加各会话已按模型精确计算的 cost.usd（不能对 totalUsage 统一计价，会丢失模型差异）
    const totalUsd = Math.round(sessions.reduce((s, x) => s + (x.cost?.usd || 0), 0) * 1_000_000) / 1_000_000;

    summary[taskName] = {
      sessionCount: sessions.length,
      usage: totalUsage,
      cost: {
        usd: totalUsd,
        cny: usdToCny(totalUsd),
      },
    };
  }

  return summary;
}
