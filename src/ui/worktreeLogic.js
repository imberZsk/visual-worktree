// Worktree 面板前端纯逻辑：与 React/antd 解耦，便于 vitest 单测。

/**
 * 为「复制路径」生成可直接粘贴到终端 cd 的字符串：始终用 POSIX 单引号包裹。
 * 业务场景：用户复制路径后绝大多数是粘贴到终端用，worktree 任务名常含空格、&、括号、中文等
 * （如 `物料发放&维修...`），裸路径会被 shell 拆词或当作后台执行符导致 cd 失败。统一加单引号后，
 * 任何路径都能粘贴即 `cd` 进入，无需用户手动补引号。内部单引号用 '\'' 序列转义（闭合→转义单引号→重开）。
 * @param {string} path - 原始绝对路径
 * @returns {string} 单引号包裹的路径；空路径返回空串（不产生无意义的 ''）
 */
export function quotePathForCopy(path) {
  // p 为规范化的字符串路径，空值兜底为空串避免后续报错
  const p = String(path ?? '');
  // 空路径直接返回空串：包裹成 '' 没有意义且会误导
  if (p === '') return '';
  // 始终用 POSIX 单引号包裹，内部单引号转义为 '\''，保证任意特殊字符路径都能粘贴即 cd
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

/**
 * 计算新建 worktree 成功后 Collapse 应展开的面板 key 集合
 * 业务场景：新建是「按任务批量创建」（同一个 task 名可能跨多个项目），
 * 创建成功后只展开这一个任务的面板、收起其余，便于用户立即定位刚建的内容。
 * @param {string} taskName - 刚新建的任务名（与面板 key、t.task 同值）
 * @returns {string[]} 受控 Collapse 的 activeKey 数组；taskName 为空时返回空数组（全部收起）
 */
export function computeActiveKeysAfterCreate(taskName) {
  // 任务名缺失时不展开任何面板，避免传入 [undefined] 这类无效 key
  if (!taskName) return [];
  return [taskName];
}

// ── 任务状态（人工标记） ──
// 业务场景：一个任务（跨多仓库的 worktree 分组）在协作中处于不同阶段，
// 用户需要手动标记「进行中 / 待发布 / 已完成」以便归类与追踪。该状态纯属前端展示，
// 不参与任何 git 操作，按任务名持久化到 localStorage。

// 任务状态定义列表（研发工作流）：key 为持久化标识，label 为展示名，color 对应 antd Tag 色
// 「未开始」作为默认/清除状态；其余六个对应完整研发流程阶段
export const TASK_STATUSES = [
  { key: 'not-started',     label: '未开始', color: 'default'     },
  { key: 'developing',      label: '开发中', color: 'processing'  },
  { key: 'self-testing',    label: '自测中', color: 'cyan'        },
  { key: 'pending-test',    label: '待提测', color: 'orange'      },
  { key: 'testing',         label: '测试中', color: 'purple'      },
  { key: 'pending-release', label: '待发布', color: 'gold'        },
  { key: 'released',        label: '已发布', color: 'success'     },
];

// 默认状态 key：任务从未手动标记时视为「未开始」，展示与存储均以此为兜底
export const DEFAULT_TASK_STATUS = 'not-started';

// 状态排序权重：按 TASK_STATUSES 数组下标派生，新增/调整状态时此映射自动同步
export const STATUS_SORT_ORDER = Object.fromEntries(TASK_STATUSES.map((s, i) => [s.key, i]));

// 状态 key → 状态定义 的索引，便于按 key 取 label/color，避免每次线性查找
const STATUS_BY_KEY = new Map(TASK_STATUSES.map((s) => [s.key, s]));

// 任务状态映射在 localStorage 中的存储键
export const TASK_STATUS_STORAGE_KEY = 'vw-task-status';

/**
 * 按状态 key 取状态定义（label/color），未设置/未知时回退到默认「未开始」
 * @param {string} statusKey - 状态标识
 * @returns {{key:string,label:string,color:string}} 状态定义（始终非空，兜底为未开始）
 */
export function getTaskStatusMeta(statusKey) {
  // 未设置或未知 key 一律回退默认状态「未开始」，保证任务总有可展示的状态
  return STATUS_BY_KEY.get(statusKey) || STATUS_BY_KEY.get(DEFAULT_TASK_STATUS);
}

/**
 * 在状态映射上设置/清除某任务的状态（纯函数，返回新对象，不修改入参）
 * @param {Record<string,string>} map - 现有「任务名 → 状态 key」映射
 * @param {string} taskName - 任务名
 * @param {string} [statusKey] - 目标状态 key；为空/未知/默认「未开始」时清除该任务状态
 * @returns {Record<string,string>} 更新后的新映射
 */
export function setTaskStatusInMap(map, taskName, statusKey) {
  // next 为入参的浅拷贝，保证不可变更新（便于 React/Zustand 触发重渲染）
  const next = { ...(map || {}) };
  // 任务名缺失直接原样返回，避免写入无效键
  if (!taskName) return next;
  // 目标为空/未知/默认「未开始」时删除该键：未开始即默认态，无需占用存储（缺失即视为未开始）
  if (!statusKey || !STATUS_BY_KEY.has(statusKey) || statusKey === DEFAULT_TASK_STATUS) {
    delete next[taskName];
  } else {
    next[taskName] = statusKey;
  }
  return next;
}

/**
 * 从 localStorage 读取任务状态映射（容错：缺失/损坏时回退空映射）
 * @returns {Record<string,string>} 任务名 → 状态 key 的映射
 */
export function loadTaskStatusMap() {
  try {
    // raw 为原始 JSON 字符串，可能为 null（从未写入）
    const raw = localStorage.getItem(TASK_STATUS_STORAGE_KEY);
    if (!raw) return {};
    // parsed 为解析结果，需校验为普通对象，防止存入了数组/标量导致后续出错
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    // localStorage 不可用或 JSON 损坏时回退空映射，避免阻塞面板渲染
    return {};
  }
}

/**
 * 将任务状态映射持久化到 localStorage
 * @param {Record<string,string>} map - 任务名 → 状态 key 的映射
 */
export function saveTaskStatusMap(map) {
  try {
    localStorage.setItem(TASK_STATUS_STORAGE_KEY, JSON.stringify(map || {}));
  } catch (e) {
    // localStorage 不可用时忽略持久化（不影响当前会话内的内存状态）
  }
}

/**
 * 规范化单个任务链接条目对象。
 * @param {object} raw - 原始链接条目，可能来自新版持久化或输入框草稿
 * @returns {{name:string,url:string}|null} 规范化后的链接条目；URL 为空时返回 null
 */
function normalizeTaskLinkObject(raw) {
  // name 存储用户给链接填写的展示名称；为空时展示层会回退到 URL。
  const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
  // url 存储用户填写的真实链接地址；持久化和打开浏览器均使用它。
  const url = typeof raw?.url === 'string' ? raw.url.trim() : '';
  if (!url) return null;
  return { name, url };
}

/**
 * 从旧版字符串或粘贴文本中解析链接条目。
 * @param {string} raw - 原始字符串，可能是单个 URL，也可能包含换行/逗号分隔的多个 URL
 * @returns {Array<{name:string,url:string}>} 解析出的无名称链接条目
 */
function parseTaskLinkString(raw) {
  // rawUrls 存储按换行/逗号拆分后的 URL 片段，兼容用户在任意链接框里粘贴多条链接。
  const rawUrls = raw.split(/[\n,]+/);
  // items 存储解析出的旧版链接条目；旧数据没有名称，因此 name 为空。
  const items = [];
  for (const rawUrl of rawUrls) {
    // url 存储清理空白后的单条链接地址。
    const url = rawUrl.trim();
    if (url) items.push({ name: '', url });
  }
  return items;
}

/**
 * 规范化某个任务的需求链接条目列表。
 * 兼容旧版「任务名 → 单个 URL 字符串」和「任务名 → URL[]」存储；新版返回 `{name,url}` 数组。
 * @param {string|string[]|Array<{name?:string,url?:string}>} value - 原始链接值，可能是旧版字符串、旧版数组或新版条目数组
 * @returns {Array<{name:string,url:string}>} 去空白、去空 URL、按 URL 去重后的链接条目数组
 */
export function normalizeTaskLinkItems(value) {
  // sourceLinks 存储待清洗的原始链接列表；非数组值按单项处理以兼容旧版单字符串。
  const sourceLinks = Array.isArray(value) ? value : [value];
  // seen 存储已加入结果的 URL，用于保持原顺序的同时按 URL 去重。
  const seen = new Set();
  // items 累积清洗后的链接条目数组。
  const items = [];
  for (const raw of sourceLinks) {
    // rawItems 存储当前原始项解析出的候选链接条目；字符串可能一次解析出多条。
    const rawItems = typeof raw === 'string'
      ? parseTaskLinkString(raw)
      : [normalizeTaskLinkObject(raw)].filter(Boolean);
    for (const item of rawItems) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      items.push(item);
    }
  }
  return items;
}

/**
 * 规范化某个任务的需求链接 URL 列表。
 * 兼容仍只需要 URL 数组的旧调用；新展示和持久化优先使用 normalizeTaskLinkItems。
 * @param {string|string[]|Array<{name?:string,url?:string}>} value - 原始链接值
 * @returns {string[]} 规范化后的 URL 数组
 */
export function normalizeTaskLinks(value) {
  // items 存储规范化后的完整链接条目；这里只取 URL 提供给旧调用。
  const items = normalizeTaskLinkItems(value);
  return items.map((item) => item.url);
}

/**
 * 规范化任务链接映射。
 * 业务场景：磁盘上可能已有旧版 `{任务名: "url"}` 或 `{任务名: ["url"]}`，加载进 UI 前统一升级为 `{任务名: [{name,url}]}`。
 * @param {Record<string,string|string[]|Array<{name?:string,url?:string}>>} map - 原始任务链接映射
 * @returns {Record<string,Array<{name:string,url:string}>>} 任务名到链接条目数组的映射
 */
export function normalizeTaskLinkMap(map) {
  // next 存储规范化后的新映射，避免修改入参。
  const next = {};
  // source 存储可遍历的原始映射；非普通对象回退为空对象。
  const source = map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  for (const [taskName, value] of Object.entries(source)) {
    // links 存储该任务清洗后的链接条目列表；空列表不写入，避免残留空键。
    const links = normalizeTaskLinkItems(value);
    if (links.length > 0) next[taskName] = links;
  }
  return next;
}

/**
 * 在任务链接映射上设置或清除某任务的链接条目数组。
 * @param {Record<string,string|string[]|Array<{name?:string,url?:string}>>} map - 现有任务链接映射
 * @param {string} taskName - 任务名
 * @param {string|string[]|Array<{name?:string,url?:string}>} linksValue - 要保存的链接值；空数组/空字符串会清除该任务
 * @returns {Record<string,Array<{name:string,url:string}>>} 更新后的任务链接映射
 */
export function setTaskLinksInMap(map, taskName, linksValue) {
  // next 存储基于旧映射规范化后的新对象，保证不可变更新。
  const next = normalizeTaskLinkMap(map);
  if (!taskName) return next;
  // links 存储待写入的规范化链接条目数组。
  const links = normalizeTaskLinkItems(linksValue);
  if (links.length > 0) next[taskName] = links;
  else delete next[taskName];
  return next;
}
