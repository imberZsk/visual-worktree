import React from 'react'
import { Button, Modal, Spin, theme } from 'antd'

// STEP_OUTPUT_MODAL_Z_INDEX 存储输出弹窗层级，确保它高于流程操作浮层。
const STEP_OUTPUT_MODAL_Z_INDEX = 1400

/**
 * 渲染工作流步骤的实时或历史输出弹窗。
 * @param {object} props - 组件属性
 * @param {object|null} props.output - 当前步骤输出状态
 * @param {() => void} props.onClose - 关闭弹窗回调
 * @returns {JSX.Element} 工作流步骤输出弹窗
 */
export default function StepOutputModal({ output, onClose }) {
  // token 存储当前 antd 主题变量，用于输出状态和代码区域样式。
  const { token } = theme.useToken()
  // isRunning 标记当前步骤是否仍在后台执行。
  const isRunning = output?.status === 'running'

  return (
    <Modal
      title={
        output ? `「${output.label}」执行${isRunning ? '中…' : '输出'}` : ''
      }
      open={Boolean(output)}
      width={720}
      zIndex={STEP_OUTPUT_MODAL_Z_INDEX}
      closable
      mask={{ closable: true }}
      keyboard
      onCancel={onClose}
      footer={
        isRunning
          ? [
              <span
                key="hint"
                style={{
                  marginRight: 12,
                  color: token.colorTextSecondary,
                  fontSize: 12,
                }}
              >
                关闭不会中断执行，可稍后重新查看
              </span>,
              <Button key="close" onClick={onClose}>
                关闭
              </Button>,
            ]
          : [
              <Button key="close" onClick={onClose}>
                关闭
              </Button>,
            ]
      }
    >
      {output && (
        <>
          <div style={{ marginBottom: 8, fontSize: 12 }}>
            {isRunning && (
              <span style={{ color: token.colorPrimary }}>
                <Spin size="small" /> 正在执行，实时输出如下…
              </span>
            )}
            {output.status === 'success' && (
              <span style={{ color: token.colorSuccess }}>
                执行成功（退出码 0）
              </span>
            )}
            {output.status === 'error' && (
              <span style={{ color: token.colorError }}>
                执行失败
                {output.code != null ? `（退出码 ${output.code}）` : ''}
              </span>
            )}
          </div>
          <pre
            ref={(element) => {
              if (element) element.scrollTop = element.scrollHeight
            }}
            style={{
              maxHeight: 420,
              minHeight: 120,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              fontSize: 12,
              margin: 0,
              background: token.colorFillQuaternary,
              padding: 8,
              borderRadius: 4,
            }}
          >
            {output.content || (isRunning ? '（等待输出…）' : '（无输出）')}
          </pre>
        </>
      )}
    </Modal>
  )
}
