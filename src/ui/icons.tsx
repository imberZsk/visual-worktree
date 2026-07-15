import React from 'react'

// 共享自定义 SVG 图标：统一在此定义，避免在多个组件中重复 SVG 代码。

/**
 * VSCode 图标：简化版 VSCode logo，用于「在 VSCode 中打开」按钮
 */
export function VscodeIcon() {
  return (
    <span className="anticon anticon-vscode" role="img" aria-label="vscode">
      <svg
        width="1em"
        height="1em"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M17.484 0.291l-8.082 7.952L4.18 4.503 0 6.875l5.263 5.125L0 17.126l4.18.372 5.222-3.742 8.082 7.952L24 19.237V4.763L17.484.291zM18 18.582l-6.667-6.582L18 5.418v13.164z" />
      </svg>
    </span>
  )
}
