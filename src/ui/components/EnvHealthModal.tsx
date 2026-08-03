import React from 'react'
import { Button, Modal, Space, Spin, Typography, theme } from 'antd'
import EnvHealthResultContent from './EnvHealthResultContent.tsx'

/**
 * 渲染环境健康检查结果弹窗及重新检查加载态。
 * @param {object} props - 组件属性
 * @param {boolean} props.open - 弹窗是否显示
 * @param {string} props.taskName - 当前检查的任务名
 * @param {string} props.taskDir - 当前检查的任务目录
 * @param {object|null} props.result - 最近一次环境检查结果
 * @param {boolean} props.loading - 是否正在执行环境检查
 * @param {() => void} props.onClose - 关闭弹窗回调
 * @param {(task:{task:string,path:string}) => void} props.onRefresh - 重新检查回调
 * @returns {JSX.Element} 环境健康检查弹窗
 */
export default function EnvHealthModal({
  open,
  taskName,
  taskDir,
  result,
  loading,
  onClose,
  onRefresh,
}) {
  // token 存储当前 antd 主题变量，用于错误色和刷新遮罩样式。
  const { token } = theme.useToken()

  return (
    <Modal
      title={taskName ? `环境检查 · ${taskName}` : '环境检查'}
      open={open}
      onCancel={onClose}
      className="env-health-modal"
      footer={[
        <Button
          key="refresh"
          loading={loading}
          onClick={() => onRefresh({ task: taskName, path: taskDir })}
          style={{ minWidth: 92 }}
        >
          重新检查
        </Button>,
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
      ]}
      width={720}
    >
      {/* 固定最小高度并在刷新时保留旧结果，避免弹窗内容发生明显布局跳动。 */}
      <div
        className="env-health-result-shell"
        style={{
          minHeight: 240,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: !result && loading ? 'center' : 'flex-start',
        }}
      >
        {result ? (
          <EnvHealthResultContent result={result} token={token} />
        ) : loading ? (
          <Space orientation="vertical" align="center" size={8}>
            <Spin />
            <Typography.Text type="secondary">检查中...</Typography.Text>
          </Space>
        ) : null}
        {loading && result ? (
          <div
            className="env-health-refresh-overlay"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: token.borderRadiusLG,
              zIndex: 1,
            }}
          >
            <Space orientation="vertical" align="center" size={8}>
              <Spin />
              <Typography.Text type="secondary">检查中...</Typography.Text>
            </Space>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
