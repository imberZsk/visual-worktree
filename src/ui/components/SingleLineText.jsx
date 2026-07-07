import React from 'react';
import { Typography } from 'antd';

/**
 * 单行省略文本：内容超出容器宽度时显示省略号，悬停时通过 AntD Tooltip 查看完整内容。
 * @param {object} props - 组件属性
 * @param {string|number} [props.text] - 要展示的文本内容
 * @param {React.ReactNode} [props.children] - 兼容 JSX 子内容；优先级高于 text
 * @param {React.ReactNode} [props.tooltip] - Tooltip 内容；不传时使用展示文本
 * @param {string} [props.as] - 渲染用的 HTML 标签名，如 span/code
 * @param {boolean} [props.inline] - 是否用 inline-block 展示，适合放在 Tag/Checkbox 内
 * @param {string} [props.className] - 追加样式类名
 * @param {React.CSSProperties} [props.style] - 追加内联样式
 * @param {import('antd/es/tooltip').TooltipPlacement} [props.tooltipPlacement] - Tooltip 展示位置
 * @param {(event:React.MouseEvent)=>void} [props.onClick] - 文本点击回调，链接场景可用于打开外部地址
 * @returns {JSX.Element} 带 Tooltip 的单行省略文本
 */
export default function SingleLineText({
  text = '',
  children,
  tooltip,
  as = 'span',
  inline = false,
  className = '',
  style = {},
  tooltipPlacement = 'top',
  onClick,
}) {
  // rawContent 存储最终用于展示的原始内容，children 优先以兼容 JSX 使用方式。
  const rawContent = children ?? text;
  // displayText 存储字符串化后的展示文案，避免 null/undefined 直接渲染。
  const displayText = rawContent === null || rawContent === undefined ? '' : String(rawContent);
  // tooltipTitle 存储悬停浮层内容；空文本不展示空浮层。
  const tooltipTitle = tooltip === undefined ? displayText : tooltip;
  // classNames 存储基础 class 与调用方 class 的组合，用于测试和统一样式定位。
  const classNames = ['single-line-tooltip-text', className].filter(Boolean).join(' ');
  // displayValue 存储块级/行内块展示模式；行内块可放进 Tag/Checkbox 不破坏行布局。
  const displayValue = inline ? 'inline-block' : 'block';
  // mergedStyle 存储单行文本尺寸约束；省略逻辑交给 Ant Design Typography 处理。
  const mergedStyle = {
    display: displayValue,
    maxWidth: '100%',
    minWidth: 0,
    verticalAlign: 'bottom',
    ...style,
  };
  // ellipsisConfig 存储 Ant Design Typography 的单行省略配置，保留原有 Tooltip 文案与方位。
  const ellipsisConfig = tooltipTitle
    ? { tooltip: { title: tooltipTitle, placement: tooltipPlacement } }
    : { tooltip: false };

  if (as === 'code') {
    return (
      <Typography.Text
        code
        className={classNames}
        ellipsis={ellipsisConfig}
        onClick={onClick}
        style={mergedStyle}
      >
        {displayText}
      </Typography.Text>
    );
  }

  if (as === Typography.Link) {
    return (
      <Typography.Link
        className={classNames}
        ellipsis={Boolean(tooltipTitle)}
        onClick={onClick}
        style={mergedStyle}
        title={typeof tooltipTitle === 'string' ? tooltipTitle : undefined}
      >
        {displayText}
      </Typography.Link>
    );
  }

  return (
    <Typography.Text
      className={classNames}
      ellipsis={ellipsisConfig}
      onClick={onClick}
      style={mergedStyle}
    >
      {displayText}
    </Typography.Text>
  );
}
