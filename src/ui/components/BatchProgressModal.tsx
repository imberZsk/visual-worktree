import React from 'react'
import { Modal, Progress, theme } from 'antd'

/**
 * 渲染不可手动关闭的批量操作进度弹窗。
 * @param {object} props - 组件属性
 * @param {object|null} props.progress - 批量操作进度
 * @param {string} [props.title] - 进度弹窗标题
 * @returns {JSX.Element} 批量操作进度弹窗
 */
export default function BatchProgressModal({ progress, title = '批量处理中' }) {
  // token 存储当前 antd 主题变量，用于进度说明文字颜色。
  const { token } = theme.useToken()
  // percent 存储批量操作完成百分比；异常总数按零处理以避免无效数值。
  const percent = progress?.total
    ? Math.round((progress.done / progress.total) * 100)
    : 0

  return (
    <Modal
      title={title}
      open={Boolean(progress)}
      footer={null}
      closable={false}
    >
      {progress && (
        <>
          <Progress percent={percent} />
          <div
            style={{
              marginTop: 8,
              color: token.colorTextSecondary,
              fontSize: 12,
            }}
          >
            {progress.done}/{progress.total} · {progress.current}
          </div>
        </>
      )}
    </Modal>
  )
}
