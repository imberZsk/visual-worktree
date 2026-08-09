import { useEffect, useRef, useState } from 'react'
import {
  computeHistoryPageSize,
  HISTORY_PAGE_SIZE_FALLBACK,
} from '../historyPaginationLogic.ts'

/**
 * 管理历史任务弹窗的自适应分页和容器尺寸监听。
 * @param {object} options - hook 参数
 * @param {boolean} options.open - 历史任务弹窗是否显示
 * @param {number} options.itemCount - 历史任务总数
 * @returns {{listShellRef:React.RefObject<HTMLDivElement>,page:number,pageSize:number,pagination:object|false,resetPage:() => void}} 分页状态
 */
export default function useTaskHistoryPagination({ open, itemCount }) {
  // listShellRef 指向历史任务列表的稳定可滚动视口，不包含底部分页器。
  const listShellRef = useRef(null)
  // page 存储历史任务当前页码。
  const [page, setPage] = useState(1)
  // pageSize 存储根据弹窗可用高度计算出的每页条数。
  const [pageSize, setPageSize] = useState(HISTORY_PAGE_SIZE_FALLBACK)
  // measuredItemHeightRef 缓存本次打开弹层首次测得的记录高度，删除后不再按当前页内容重新改变 pageSize。
  const measuredItemHeightRef = useRef(0)

  useEffect(() => {
    if (!open) {
      measuredItemHeightRef.current = 0
      return undefined
    }

    /**
     * 测量历史任务弹窗可用高度并同步每页条数。
     */
    const measurePageSize = () => {
      // shellElement 存储历史任务列表的可滚动视口；分页器在该元素外，避免占用记录高度。
      const shellElement = listShellRef.current
      // firstItemElement 存储第一页第一条历史记录。
      const firstItemElement = shellElement?.querySelector(
        '.history-task-list-item'
      )
      // itemRectHeight 存储尚未缓存时浏览器布局计算出的首条记录高度。
      const itemRectHeight =
        firstItemElement?.getBoundingClientRect?.().height || 0
      // measuredItemHeight 存储本次 DOM 测量得到的有效记录高度。
      const measuredItemHeight =
        itemRectHeight || firstItemElement?.offsetHeight || 0
      // 首次拿到真实记录后锁定基准高度，修复第三页删除时因下一条更矮而跳到第二页的问题。
      if (!measuredItemHeightRef.current && measuredItemHeight > 0) {
        measuredItemHeightRef.current = measuredItemHeight
      }
      // itemHeight 存储本次弹层稳定使用的记录高度。
      const itemHeight = measuredItemHeightRef.current
      // nextPageSize 存储当前弹窗尺寸可容纳的记录数。
      const nextPageSize = computeHistoryPageSize({
        containerHeight: shellElement?.clientHeight,
        itemHeight,
      })
      setPageSize((currentPageSize) =>
        currentPageSize === nextPageSize ? currentPageSize : nextPageSize
      )
    }

    measurePageSize()
    // ResizeObserverCtor 存储当前环境提供的尺寸观察器构造函数。
    const ResizeObserverCtor = globalThis.ResizeObserver
    if (ResizeObserverCtor && listShellRef.current) {
      // resizeObserver 监听历史列表容器尺寸变化。
      const resizeObserver = new ResizeObserverCtor(measurePageSize)
      resizeObserver.observe(listShellRef.current)
      return () => resizeObserver.disconnect()
    }

    globalThis.addEventListener?.('resize', measurePageSize)
    return () => globalThis.removeEventListener?.('resize', measurePageSize)
  }, [open, itemCount])

  useEffect(() => {
    // maxPage 存储当前记录数和每页条数下的最大页码。
    const maxPage = Math.max(1, Math.ceil(itemCount / pageSize))
    setPage((currentPage) => Math.min(currentPage, maxPage))
  }, [itemCount, pageSize])

  /**
   * 将历史任务列表恢复到第一页。
   */
  const resetPage = () => {
    setPage(1)
  }

  // pagination 存储传给 antd List 的受控分页配置。
  const pagination =
    itemCount > pageSize
      ? {
          current: page,
          pageSize,
          size: 'small',
          align: 'center',
          responsive: true,
          showSizeChanger: false,
          onChange: setPage,
        }
      : false

  return { listShellRef, page, pageSize, pagination, resetPage }
}
