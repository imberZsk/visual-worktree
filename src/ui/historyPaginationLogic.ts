// HISTORY_PAGE_SIZE_MIN 存储历史任务弹层最少每页条数，避免小窗口下分页过碎。
export const HISTORY_PAGE_SIZE_MIN = 4

// HISTORY_PAGE_SIZE_MAX 存储历史任务弹层最多每页条数，避免大屏下弹层一次塞入过多记录。
export const HISTORY_PAGE_SIZE_MAX = 12

// HISTORY_PAGE_SIZE_FALLBACK 存储 DOM 尺寸尚未测量完成时的默认每页条数，保持与旧版 10 条体验一致。
export const HISTORY_PAGE_SIZE_FALLBACK = 10

/**
 * 按历史任务弹层可用高度与单条记录高度计算 antd List 的 pageSize。
 * @param {{containerHeight?:number,itemHeight?:number,minPageSize?:number,maxPageSize?:number,fallbackPageSize?:number}} options - containerHeight 为列表可用高度，itemHeight 为单条历史记录高度，min/max/fallback 为条数边界
 * @returns {number} 适合当前容器的每页条数
 */
export function computeHistoryPageSize({
  containerHeight,
  itemHeight,
  minPageSize = HISTORY_PAGE_SIZE_MIN,
  maxPageSize = HISTORY_PAGE_SIZE_MAX,
  fallbackPageSize = HISTORY_PAGE_SIZE_FALLBACK,
} = {}) {
  // numericContainerHeight 存储归一化后的容器高度，非数字会转为 NaN。
  const numericContainerHeight = Number(containerHeight)
  // numericItemHeight 存储归一化后的单条记录高度，非数字会转为 NaN。
  const numericItemHeight = Number(itemHeight)
  // hasValidMeasurement 标记当前 DOM 测量是否足够计算 pageSize。
  const hasValidMeasurement =
    Number.isFinite(numericContainerHeight) &&
    Number.isFinite(numericItemHeight) &&
    numericContainerHeight > 0 &&
    numericItemHeight > 0

  if (!hasValidMeasurement) return fallbackPageSize

  // rawPageSize 存储不加边界保护时可容纳的完整历史记录条数。
  const rawPageSize = Math.floor(numericContainerHeight / numericItemHeight)
  // lowerBoundedPageSize 存储经过最小条数保护后的 pageSize。
  const lowerBoundedPageSize = Math.max(minPageSize, rawPageSize)

  return Math.min(maxPageSize, lowerBoundedPageSize)
}

/**
 * 把 antd List 当前页内下标换算成完整历史数组下标。
 * @param {{page?:number,pageSize?:number,pageIndex?:number}} options - page 为当前页码，pageSize 为每页条数，pageIndex 为当前页内下标
 * @returns {number} 对应完整历史数组的下标
 */
export function getHistoryGlobalIndex({ page, pageSize, pageIndex } = {}) {
  // safePage 存储容错后的页码，页码最小为 1。
  const safePage = Math.max(1, Number(page) || 1)
  // safePageSize 存储容错后的每页条数，至少为 1 以保证换算可用。
  const safePageSize = Math.max(
    1,
    Number(pageSize) || HISTORY_PAGE_SIZE_FALLBACK
  )
  // safePageIndex 存储容错后的页内下标，异常输入按第一页第一条处理。
  const safePageIndex = Math.max(0, Number(pageIndex) || 0)

  return (safePage - 1) * safePageSize + safePageIndex
}
