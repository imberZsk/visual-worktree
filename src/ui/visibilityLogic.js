// 隐藏/置顶与任务标题展示偏好的纯逻辑：项目 Tab 与 Worktree Tab 共用，便于单测覆盖。

// VISIBILITY_LIST_KEYS 存储可见性偏好中支持的列表字段名。
const VISIBILITY_LIST_KEYS = ['hidden', 'pinned'];

// EMPTY_VISIBILITY_PREFS 存储默认可见性偏好；所有项目/任务默认展示且不置顶。
export const EMPTY_VISIBILITY_PREFS = { hidden: [], pinned: [] };

// TASK_VISIBILITY_STORAGE_KEY 存储浏览器降级模式下任务可见性偏好的 localStorage key。
export const TASK_VISIBILITY_STORAGE_KEY = 'vw-task-visibility';

// PROJECT_VISIBILITY_STORAGE_KEY 存储浏览器降级模式下项目可见性偏好的 localStorage key。
export const PROJECT_VISIBILITY_STORAGE_KEY = 'vw-project-visibility';

// TASK_TITLE_BADGE_ITEMS 存储设置页可控制的任务标题徽标项及展示文案。
export const TASK_TITLE_BADGE_ITEMS = [
  { key: 'projectCount', label: '项目数量' },
  { key: 'taskStatus', label: '任务状态' },
  { key: 'taskLinks', label: '需求链接' },
  { key: 'envHealth', label: '环境状态' },
  { key: 'claudeUsage', label: 'Token 消耗' },
];

// DEFAULT_TASK_TITLE_BADGES 存储任务标题徽标默认展示配置；缺省时全部开启。
export const DEFAULT_TASK_TITLE_BADGES = Object.fromEntries(TASK_TITLE_BADGE_ITEMS.map((item) => [item.key, true]));

/**
 * 把任意值规范化成稳定的非空字符串 key。
 * @param {unknown} key - 原始 key，可能来自路径、任务名或损坏的持久化数据
 * @returns {string} 清理后的 key；空值返回空字符串
 */
function normalizeVisibilityKey(key) {
  // normalizedKey 存储去掉首尾空白后的字符串 key。
  const normalizedKey = String(key ?? '').trim();
  return normalizedKey;
}

/**
 * 规范化隐藏/置顶 key 列表，去空值并按首次出现顺序去重。
 * @param {unknown} list - 原始 key 列表
 * @returns {string[]} 规范化后的 key 列表
 */
function normalizeVisibilityList(list) {
  // sourceList 存储待规范化的数组；非数组按空数组处理。
  const sourceList = Array.isArray(list) ? list : [];
  // seen 存储已经加入结果的 key，用于去重且保留原顺序。
  const seen = new Set();
  // normalizedList 累积最终的有效 key。
  const normalizedList = [];

  for (const rawKey of sourceList) {
    // key 存储当前候选 key 的规范化结果。
    const key = normalizeVisibilityKey(rawKey);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalizedList.push(key);
  }

  return normalizedList;
}

/**
 * 规范化可见性偏好对象。
 * @param {unknown} prefs - 原始偏好对象
 * @returns {{hidden:string[],pinned:string[]}} 规范化后的隐藏/置顶偏好
 */
export function normalizeVisibilityPrefs(prefs) {
  // sourcePrefs 存储可读取字段的原始对象；数组/标量均视为损坏配置。
  const sourcePrefs = prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : {};
  return {
    hidden: normalizeVisibilityList(sourcePrefs.hidden),
    pinned: normalizeVisibilityList(sourcePrefs.pinned),
  };
}

/**
 * 从 localStorage 读取可见性偏好；Electron 环境启动后会被磁盘文件结果覆盖。
 * @param {string} storageKey - localStorage 存储键
 * @returns {{hidden:string[],pinned:string[]}} 可见性偏好
 */
export function loadVisibilityPrefsFromStorage(storageKey) {
  try {
    // raw 存储 localStorage 中的原始 JSON 字符串。
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { ...EMPTY_VISIBILITY_PREFS };
    return normalizeVisibilityPrefs(JSON.parse(raw));
  } catch (e) {
    return { ...EMPTY_VISIBILITY_PREFS };
  }
}

/**
 * 将可见性偏好保存到 localStorage；仅供浏览器降级模式使用。
 * @param {string} storageKey - localStorage 存储键
 * @param {object} prefs - 可见性偏好
 * @returns {boolean} 是否保存成功
 */
export function saveVisibilityPrefsToStorage(storageKey, prefs) {
  try {
    // normalizedPrefs 存储将要写入 localStorage 的规范化偏好。
    const normalizedPrefs = normalizeVisibilityPrefs(prefs);
    localStorage.setItem(storageKey, JSON.stringify(normalizedPrefs));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 判断某个 key 是否存在于指定可见性列表中。
 * @param {object} prefs - 可见性偏好
 * @param {'hidden'|'pinned'} listKey - 目标列表字段名
 * @param {string} key - 项目路径或任务名
 * @returns {boolean} 是否命中该列表
 */
export function hasVisibilityKey(prefs, listKey, key) {
  // normalizedPrefs 存储规范化后的偏好，避免调用方传入损坏对象时报错。
  const normalizedPrefs = normalizeVisibilityPrefs(prefs);
  // normalizedKey 存储待匹配的 key。
  const normalizedKey = normalizeVisibilityKey(key);
  if (!normalizedKey || !VISIBILITY_LIST_KEYS.includes(listKey)) return false;
  return normalizedPrefs[listKey].includes(normalizedKey);
}

/**
 * 设置或移除某个隐藏/置顶 key，返回新的偏好对象。
 * @param {object} prefs - 现有可见性偏好
 * @param {'hidden'|'pinned'} listKey - 要修改的列表字段名
 * @param {string} key - 项目路径或任务名
 * @param {boolean} enabled - true 表示加入列表，false 表示移出列表
 * @returns {{hidden:string[],pinned:string[]}} 更新后的偏好对象
 */
export function setVisibilityKey(prefs, listKey, key, enabled) {
  // normalizedPrefs 存储入参规范化后的副本，保证不会修改原对象。
  const normalizedPrefs = normalizeVisibilityPrefs(prefs);
  // normalizedKey 存储待写入或移除的 key。
  const normalizedKey = normalizeVisibilityKey(key);
  if (!normalizedKey || !VISIBILITY_LIST_KEYS.includes(listKey)) return normalizedPrefs;

  // sourceList 存储目标列表当前值。
  const sourceList = normalizedPrefs[listKey];
  // nextList 存储目标列表更新后的值。
  const nextList = enabled
    ? normalizeVisibilityList([...sourceList, normalizedKey])
    : sourceList.filter((item) => item !== normalizedKey);

  return { ...normalizedPrefs, [listKey]: nextList };
}

/**
 * 根据隐藏偏好过滤列表；showHidden 为 true 时保留隐藏项供用户恢复。
 * @param {Array<object>} items - 原始列表
 * @param {object} prefs - 可见性偏好
 * @param {(item:object)=>string} getKey - 从列表项取项目路径或任务名的函数
 * @param {boolean} showHidden - 是否展示隐藏项
 * @returns {Array<object>} 过滤后的列表
 */
export function filterVisibleItems(items, prefs, getKey, showHidden = false) {
  // sourceItems 存储待过滤的列表；非数组时按空数组处理。
  const sourceItems = Array.isArray(items) ? items : [];
  if (showHidden) return sourceItems;

  // normalizedPrefs 存储规范化后的偏好，用 Set 加速隐藏判断。
  const normalizedPrefs = normalizeVisibilityPrefs(prefs);
  // hiddenKeys 存储隐藏项 key 集合。
  const hiddenKeys = new Set(normalizedPrefs.hidden);

  return sourceItems.filter((item) => !hiddenKeys.has(normalizeVisibilityKey(getKey(item))));
}

/**
 * 将置顶项排在未置顶项之前，置顶组和普通组内部继续使用二级比较函数。
 * @param {Array<object>} items - 原始列表
 * @param {object} prefs - 可见性偏好
 * @param {(item:object)=>string} getKey - 从列表项取项目路径或任务名的函数
 * @param {(a:object,b:object)=>number} [compare] - 同组内部排序函数
 * @returns {Array<object>} 排序后的新列表
 */
export function sortPinnedItems(items, prefs, getKey, compare = () => 0) {
  // sourceItems 存储待排序的列表副本，避免修改入参数组。
  const sourceItems = Array.isArray(items) ? [...items] : [];
  // normalizedPrefs 存储规范化后的偏好，用 Set 加速置顶判断。
  const normalizedPrefs = normalizeVisibilityPrefs(prefs);
  // pinnedKeys 存储置顶项 key 集合。
  const pinnedKeys = new Set(normalizedPrefs.pinned);

  return sourceItems.sort((a, b) => {
    // aPinned/bPinned 标记两项是否置顶。
    const aPinned = pinnedKeys.has(normalizeVisibilityKey(getKey(a)));
    const bPinned = pinnedKeys.has(normalizeVisibilityKey(getKey(b)));
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    return compare(a, b);
  });
}

/**
 * 先按隐藏偏好过滤，再按置顶偏好排序。
 * @param {Array<object>} items - 原始列表
 * @param {object} prefs - 可见性偏好
 * @param {(item:object)=>string} getKey - 从列表项取项目路径或任务名的函数
 * @param {boolean} showHidden - 是否展示隐藏项
 * @param {(a:object,b:object)=>number} [compare] - 同组内部排序函数
 * @returns {Array<object>} 可展示列表
 */
export function prepareVisibleItems(items, prefs, getKey, showHidden = false, compare = () => 0) {
  // filteredItems 存储按隐藏规则过滤后的列表。
  const filteredItems = filterVisibleItems(items, prefs, getKey, showHidden);
  return sortPinnedItems(filteredItems, prefs, getKey, compare);
}

/**
 * 规范化任务标题徽标展示配置，缺失字段按默认开启补齐。
 * @param {unknown} value - 原始展示配置
 * @returns {Record<string,boolean>} 任务标题徽标展示配置
 */
export function normalizeTaskTitleBadges(value) {
  // sourceValue 存储可读取字段的原始对象；损坏配置回退为空对象。
  const sourceValue = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  // next 存储规范化后的展示开关。
  const next = {};

  for (const item of TASK_TITLE_BADGE_ITEMS) {
    // rawValue 存储当前展示项的原始布尔值；只有显式 false 才关闭，其余都默认开启。
    const rawValue = sourceValue[item.key];
    next[item.key] = rawValue === false ? false : true;
  }

  return next;
}
