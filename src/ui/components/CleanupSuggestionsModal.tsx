import {
  App as AntApp,
  Modal,
  Table,
  Button,
  Checkbox,
  Space,
  Typography,
} from 'antd'
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons'
import { useCallback, useState, useEffect } from 'react'
import { withConfirmDefaults } from '../modalDefaults.ts'
import SingleLineText from './SingleLineText.tsx'

const { Text } = Typography

/**
 * Worktree 智能清理建议模态框：展示可安全删除的 worktree 列表（已合并+无未提交改动）
 * @param {boolean} open - 是否显示模态框
 * @param {() => void} onClose - 关闭回调
 * @param {() => Promise<void>} onDeleted - 删除成功后的回调（刷新列表）
 */
export default function CleanupSuggestionsModal({ open, onClose, onDeleted }) {
  // message 和 modal 存储当前 Ant Design App 上下文实例，确保通知生命周期跟随组件测试与主题。
  const { message, modal } = AntApp.useApp()
  // list 可删除的 worktree 列表
  const [list, setList] = useState([])
  // selected 选中的 worktree 路径集合
  const [selected, setSelected] = useState(new Set())
  // loading 是否正在加载列表
  const [loading, setLoading] = useState(false)
  // deleting 是否正在删除
  const [deleting, setDeleting] = useState(false)

  // 加载可删除列表
  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.getSafeToRemoveWorktrees()
      setList(result)
      setSelected(new Set())
    } catch (e) {
      message.error('加载失败: ' + e.message)
    } finally {
      setLoading(false)
    }
  }, [message])

  // 模态框打开时自动加载
  useEffect(() => {
    if (open) loadList()
  }, [open, loadList])

  // 删除选中的 worktree（二次确认）
  const handleDelete = () => {
    if (selected.size === 0) {
      message.warning('请先勾选要删除的 worktree')
      return
    }

    modal.confirm(
      withConfirmDefaults({
        title: '确认删除',
        content: `即将删除 ${selected.size} 个 worktree，此操作不可恢复。确定继续吗？`,
        okText: '确定删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          setDeleting(true)
          // successCount 记录本次确认删除中成功删除的 worktree 数量。
          let successCount = 0
          // failCount 记录本次确认删除中删除失败的 worktree 数量。
          let failCount = 0
          // skippedCount 记录删除前重新扫描后已不再安全的选中项数量。
          let skippedCount

          try {
            // selectedPaths 存储用户在确认前勾选的 worktree 路径快照。
            const selectedPaths = [...selected]
            // latestList 存储删除前重新扫描得到的最新安全候选，避免扫描后用户又改文件还被强删。
            const latestList = await window.api.getSafeToRemoveWorktrees()
            // latestMap 用路径索引最新候选项，后续删除使用最新 projectPath/path 信息。
            const latestMap = new Map(
              latestList.map((item) => [item.path, item])
            )
            // itemsToDelete 存储仍然在最新安全候选中的选中项。
            const itemsToDelete = selectedPaths
              .map((path) => latestMap.get(path))
              .filter(Boolean)
            skippedCount = selectedPaths.length - itemsToDelete.length

            if (itemsToDelete.length === 0) {
              setList(latestList)
              setSelected(new Set())
            } else {
              for (const item of itemsToDelete) {
                try {
                  // removeWorktree 第一参数是源项目路径，第二参数是 worktree 路径；不传 force，让 git 在竞态改动时继续保护工作区。
                  const result = await window.api.removeWorktree(
                    item.projectPath,
                    item.path,
                    {}
                  )
                  if (result.success) successCount++
                  else failCount++
                } catch (e) {
                  failCount++
                }
              }
            }
          } finally {
            setDeleting(false)
          }

          if (skippedCount > 0) {
            message.warning(`${skippedCount} 个 worktree 状态已变化，已跳过`)
          }
          if (successCount > 0) {
            message.success(`成功删除 ${successCount} 个 worktree`)
            if (onDeleted) await onDeleted()
            await loadList()
          }
          if (failCount > 0) {
            message.error(`${failCount} 个删除失败`)
          }
        },
      })
    )
  }

  // 格式化文件大小
  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  }

  // 格式化时间
  const formatTime = (ms) => {
    if (!ms) return '-'
    const d = new Date(ms)
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // totalSize 选中项的总大小
  const totalSize = list.reduce(
    (sum, item) => (selected.has(item.path) ? sum + item.sizeBytes : sum),
    0
  )

  // columns 表格列定义
  const columns = [
    {
      title: '选择',
      width: 60,
      ellipsis: { showTitle: false },
      render: (_, record) => (
        <Checkbox
          checked={selected.has(record.path)}
          onChange={(e) => {
            const newSet = new Set(selected)
            if (e.target.checked) newSet.add(record.path)
            else newSet.delete(record.path)
            setSelected(newSet)
          }}
        />
      ),
    },
    {
      title: '任务名',
      dataIndex: 'taskName',
      width: 220,
      ellipsis: { showTitle: false },
      render: (taskName) => <SingleLineText text={taskName} />,
    },
    {
      title: '项目',
      dataIndex: 'projectName',
      width: 170,
      ellipsis: { showTitle: false },
      render: (projectName) => <SingleLineText text={projectName} />,
    },
    {
      title: '分支',
      dataIndex: 'branch',
      width: 210,
      ellipsis: { showTitle: false },
      render: (branch) => (
        <SingleLineText text={branch || '(detached)'} as="code" />
      ),
    },
    { title: '大小', dataIndex: 'sizeBytes', width: 100, render: formatSize },
    {
      title: '最后修改',
      dataIndex: 'lastModified',
      width: 160,
      render: formatTime,
    },
  ]

  return (
    <Modal
      title={
        <Space size={8} align="baseline" wrap>
          <span>Worktree 清理建议</span>
          <Text type="secondary" style={{ fontSize: 12 }}>
            当前扫描结果：仅统计已合并到主分支且无未提交改动的
            worktree，删除前会重新检查。
          </Text>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={1000}
      footer={
        <Space>
          <Text type="secondary">
            已选中 {selected.size} 项，共 {formatSize(totalSize)}
          </Text>
          <Button onClick={onClose}>取消</Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={loadList}
            loading={loading}
          >
            刷新
          </Button>
          <Button
            type="primary"
            danger
            icon={<DeleteOutlined />}
            onClick={handleDelete}
            loading={deleting}
            disabled={selected.size === 0}
          >
            删除选中
          </Button>
        </Space>
      }
    >
      <Table
        columns={columns}
        dataSource={list}
        rowKey="path"
        loading={loading}
        pagination={false}
        scroll={{ y: 400 }}
        size="small"
        locale={{ emptyText: '没有可安全删除的 worktree' }}
      />
    </Modal>
  )
}
