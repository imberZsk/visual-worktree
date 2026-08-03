import { useEffect, useRef, useState } from 'react'
import { api } from '../api.ts'
import { withConfirmDefaults } from '../modalDefaults.ts'
import useTaskHistoryPagination from './useTaskHistoryPagination.ts'

/**
 * 管理当前工作区的已删除任务历史、删除确认和自适应分页。
 * @param {object} options - 历史任务依赖。
 * @param {string} options.workspaceId - 当前工作区路径组合 id。
 * @param {object} options.modal - Ant Design modal API。
 * @returns {object} 历史弹窗状态、分页状态及操作。
 */
export default function useTaskHistory({ workspaceId, modal }) {
  // open 控制历史任务弹窗是否展示。
  const [open, setOpen] = useState(false)
  // items 存储当前工作区的已删除任务记录。
  const [items, setItems] = useState([])
  // loading 标记当前工作区历史记录是否正在读取。
  const [loading, setLoading] = useState(false)
  // historyRequestIdRef 存储最近一次历史读取请求编号，用于阻止旧工作区请求覆盖新数据。
  const historyRequestIdRef = useRef(0)
  // workspaceIdRef 存储最新工作区 id，供异步请求返回时校验所属工作区。
  const workspaceIdRef = useRef(workspaceId)
  workspaceIdRef.current = workspaceId
  // pagination 管理历史列表的自适应分页。
  const pagination = useTaskHistoryPagination({
    open,
    itemCount: items.length,
  })

  useEffect(() => {
    // 工作区切换时旧历史不再属于当前上下文，立即关闭并清空，避免下次打开闪现旧记录。
    historyRequestIdRef.current += 1
    setOpen(false)
    setItems([])
    setLoading(false)
  }, [workspaceId])

  /**
   * 打开历史弹窗并读取当前工作区的最新记录。
   */
  const show = async () => {
    // requestedWorkspaceId 存储本次请求所属工作区，防止切换后的旧响应写回。
    const requestedWorkspaceId = workspaceId || ''
    // requestId 存储本次请求编号，仅最后一次请求可以更新历史列表。
    const requestId = historyRequestIdRef.current + 1
    historyRequestIdRef.current = requestId
    setItems([])
    setLoading(true)
    setOpen(true)
    pagination.resetPage()
    try {
      // historyItems 存储主进程返回的历史任务数组。
      const historyItems = await api.loadTaskHistory(requestedWorkspaceId)
      if (
        historyRequestIdRef.current === requestId &&
        workspaceIdRef.current === requestedWorkspaceId
      ) {
        setItems(Array.isArray(historyItems) ? historyItems : [])
      }
    } finally {
      if (
        historyRequestIdRef.current === requestId &&
        workspaceIdRef.current === requestedWorkspaceId
      ) {
        setLoading(false)
      }
    }
  }

  /**
   * 删除指定下标的历史记录并同步本地列表。
   * @param {number} index - 历史记录下标。
   */
  const remove = async (index) => {
    await api.removeTaskHistory(index, workspaceId || '')
    setItems((currentItems) =>
      currentItems.filter((unusedItem, itemIndex) => itemIndex !== index)
    )
  }

  /**
   * 展示删除历史记录确认框。
   * @param {number} index - 历史记录下标。
   * @param {string} taskName - 历史记录中的任务名。
   */
  const requestRemove = (index, taskName) => {
    // displayName 存储确认框展示的安全任务名。
    const displayName = taskName || '未命名任务'
    modal.confirm(
      withConfirmDefaults({
        title: `移除历史任务「${displayName}」？`,
        content:
          '仅会从历史任务列表移除此记录，不会删除 worktree、分支或归档工作记录。',
        okType: 'danger',
        okText: '移除',
        cancelText: '取消',
        onOk: () => remove(index),
      })
    )
  }

  return {
    open,
    loading,
    items,
    pagination,
    show,
    close: () => setOpen(false),
    requestRemove,
  }
}
