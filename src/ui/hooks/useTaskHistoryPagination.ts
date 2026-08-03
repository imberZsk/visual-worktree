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
  // listShellRef 指向历史任务列表可用高度容器。
  const listShellRef = useRef(null)
  // page 存储历史任务当前页码。
  const [page, setPage] = useState(1)
  // pageSize 存储根据弹窗可用高度计算出的每页条数。
  const [pageSize, setPageSize] = useState(HISTORY_PAGE_SIZE_FALLBACK)

  useEffect(() => {
    if (!open) return undefined

    /**
     * 测量历史任务弹窗可用高度并同步每页条数。
     */
    const measurePageSize = () => {
      // shellElement 存储历史任务列表外层容器。
      const shellElement = listShellRef.current
      // firstItemElement 存储第一页第一条历史记录。
      const firstItemElement = shellElement?.querySelector(
        '.history-task-list-item'
      )
      // itemRectHeight 存储浏览器布局计算出的列表项高度。
      const itemRectHeight =
        firstItemElement?.getBoundingClientRect?.().height || 0
      // itemHeight 存储最终用于分页计算的列表项高度。
      const itemHeight = itemRectHeight || firstItemElement?.offsetHeight || 0
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
