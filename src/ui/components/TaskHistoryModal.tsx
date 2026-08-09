import React from 'react'
import {
  Button,
  Empty,
  Modal,
  Pagination,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { DeleteOutlined, FolderOpenOutlined } from '@ant-design/icons'
import { getTaskStatusMeta, normalizeTaskLinkItems } from '../worktreeLogic.ts'
import { getHistoryGlobalIndex } from '../historyPaginationLogic.ts'
import { VscodeIcon } from '../icons.tsx'
import HistorySingleLineText from './HistorySingleLineText.tsx'

/**
 * 渲染已删除任务的历史记录弹窗。
 * @param {object} props - 组件属性
 * @param {boolean} props.open - 弹窗是否显示
 * @param {boolean} props.loading - 是否正在加载当前工作区历史记录
 * @param {Array<object>} props.history - 历史任务列表
 * @param {object|false} props.pagination - antd List 分页配置
 * @param {number} props.page - 当前页码
 * @param {number} props.pageSize - 当前每页条数
 * @param {Array<object>} [props.taskStatuses] - 当前工作区动态任务状态定义列表
 * @param {React.RefObject<HTMLDivElement>} props.listShellRef - 历史列表可滚动视口的高度测量引用
 * @param {() => void} props.onClose - 关闭弹窗回调
 * @param {(path:string) => void} props.onOpenFinder - Finder 打开回调
 * @param {(path:string) => void} props.onOpenVscode - VSCode 打开回调
 * @param {(url:string) => void} props.onOpenUrl - 外链打开回调
 * @param {(index:number,taskName:string) => void} props.onRequestDelete - 删除确认回调
 * @returns {JSX.Element} 历史任务弹窗
 */
export default function TaskHistoryModal({
  open,
  loading,
  history,
  pagination,
  page,
  pageSize,
  taskStatuses = [],
  listShellRef,
  onClose,
  onOpenFinder,
  onOpenVscode,
  onOpenUrl,
  onRequestDelete,
}) {
  // visibleHistory 存储当前分页实际展示的历史记录。
  const visibleHistory = history.slice((page - 1) * pageSize, page * pageSize)

  return (
    <Modal
      title="历史任务"
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
    >
      <div
        className={`history-task-list-shell${
          pagination ? ' history-task-list-shell--paginated' : ''
        }`}
      >
        <div ref={listShellRef} className="history-task-list" role="list">
          {loading ? (
            <div className="history-task-loading">
              <Spin size="small" description="正在加载历史记录..." />
            </div>
          ) : visibleHistory.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无历史任务记录"
            />
          ) : (
            visibleHistory.map((item, pageIndex) => {
              // historyIndex 存储当前页内下标换算后的完整历史数组下标。
              const historyIndex = getHistoryGlobalIndex({
                page,
                pageSize,
                pageIndex,
              })
              // historyTaskName 存储当前历史记录的任务名。
              const historyTaskName = String(item.task || '')
              // historyLinks 存储归一化后的需求或工单链接列表。
              const historyLinks = normalizeTaskLinkItems(item.link)
              // hasDocsPath 标记该记录是否存在已归档工作记录目录。
              const hasDocsPath = Boolean(item.docsPath)
              // finderTitle 存储 Finder 操作的提示文案。
              const finderTitle = hasDocsPath
                ? '在 Finder 显示工作记录'
                : '暂无工作记录归档，无法在 Finder 显示'
              // vscodeTitle 存储 VSCode 操作的提示文案。
              const vscodeTitle = hasDocsPath
                ? '用 VSCode 打开工作记录'
                : '暂无工作记录归档，无法用 VSCode 打开'
              // statusMeta 存储历史任务人工状态的展示元信息。
              const statusMeta = item.status
                ? getTaskStatusMeta(item.status, taskStatuses)
                : null

              return (
                <div
                  key={`${historyTaskName}-${item.deletedAt || historyIndex}`}
                  className="history-task-list-item"
                  role="listitem"
                >
                  <div className="history-task-entry">
                    <div className="history-task-content">
                      <div className="history-task-title-row">
                        <HistorySingleLineText
                          text={historyTaskName}
                          className="history-task-name"
                          strong
                        />
                        {statusMeta && (
                          <Tag
                            color={statusMeta.color}
                            style={{ marginInlineEnd: 0 }}
                          >
                            {statusMeta.label}
                          </Tag>
                        )}
                      </div>
                      {historyLinks.map((link, linkIndex) => {
                        // linkText 存储列表中展示的链接文本。
                        const linkText = link.name || link.url
                        // linkKey 存储链接项的稳定 React key。
                        const linkKey = link.url || `${linkText}-${linkIndex}`
                        return (
                          <HistorySingleLineText
                            key={linkKey}
                            text={linkText}
                            className="history-task-link"
                            isLink
                            onClick={() => onOpenUrl(link.url)}
                          />
                        )
                      })}
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12 }}
                      >
                        删除于 {new Date(item.deletedAt).toLocaleString()}
                      </Typography.Text>
                    </div>
                    <div className="history-task-actions">
                      <Tooltip title={finderTitle}>
                        <span className="history-task-action-slot">
                          <Button
                            size="small"
                            type="text"
                            title={finderTitle}
                            aria-label={finderTitle}
                            disabled={!hasDocsPath}
                            icon={<FolderOpenOutlined />}
                            onClick={
                              hasDocsPath
                                ? () => onOpenFinder(item.docsPath)
                                : undefined
                            }
                          />
                        </span>
                      </Tooltip>
                      <Tooltip title={vscodeTitle}>
                        <span className="history-task-action-slot">
                          <Button
                            size="small"
                            type="text"
                            title={vscodeTitle}
                            aria-label={vscodeTitle}
                            disabled={!hasDocsPath}
                            icon={<VscodeIcon />}
                            onClick={
                              hasDocsPath
                                ? () => onOpenVscode(item.docsPath)
                                : undefined
                            }
                          />
                        </span>
                      </Tooltip>
                      <Tooltip title="从历史中移除">
                        <span className="history-task-action-slot">
                          <Button
                            size="small"
                            type="text"
                            danger
                            title="从历史中移除"
                            aria-label="从历史中移除"
                            icon={<DeleteOutlined />}
                            onClick={() =>
                              onRequestDelete(historyIndex, historyTaskName)
                            }
                          />
                        </span>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
        {pagination && (
          <Pagination
            className="history-task-pagination"
            {...pagination}
            total={history.length}
          />
        )}
      </div>
    </Modal>
  )
}
