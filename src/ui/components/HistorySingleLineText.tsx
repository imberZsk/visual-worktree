import React from 'react'
import { Typography } from 'antd'
import SingleLineText from './SingleLineText.tsx'

/**
 * 历史任务单行文本：内容过长时不撑高列表，悬停查看完整文案。
 * @param {object} props - 组件入参
 * @param {string} props.text - 列表中展示的完整文本
 * @param {string} props.className - 应用于列表文本元素的样式类名
 * @param {boolean} [props.strong] - 是否按粗体任务名展示
 * @param {boolean} [props.isLink] - 是否按链接样式展示
 * @param {() => void} [props.onClick] - 链接点击回调
 * @returns {JSX.Element} 历史任务单行文本
 */
export default function HistorySingleLineText({
  text,
  className,
  strong = false,
  isLink = false,
  onClick,
}) {
  // displayText 存储字符串化后的历史任务文本，兼容旧数据中的空值。
  const displayText = String(text || '')
  // Component 存储历史任务文本的渲染组件。
  const Component = isLink ? Typography.Link : 'span'
  // textStyle 存储历史任务文本的附加样式。
  const textStyle = {
    fontSize: isLink ? 12 : undefined,
    fontWeight: strong ? 600 : undefined,
  }

  /**
   * 阻止链接默认跳转后交给应用统一外链打开逻辑。
   * @param {React.MouseEvent} event - 链接点击事件
   */
  const handleClick = (event) => {
    if (!isLink) return
    event.preventDefault()
    onClick?.()
  }

  return (
    <SingleLineText
      text={displayText}
      className={className}
      as={Component}
      style={textStyle}
      tooltipPlacement="topLeft"
      onClick={isLink ? handleClick : undefined}
    />
  )
}
