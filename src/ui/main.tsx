import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, theme as antdTheme, App as AntApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App.tsx'
import { useStore } from './store/useStore.ts'
import './styles.css'

// 渲染进程入口：挂载 React 应用，配置 antd 中文语言与明暗主题。

// MESSAGE_CENTER_OFFSET 存储全局消息层相对视口顶部的居中偏移。
const MESSAGE_CENTER_OFFSET = '50%'
// MESSAGE_CENTER_TRANSFORM 存储消息列表按自身高度回退一半的位移，确保提示框几何中心对齐视口中心。
const MESSAGE_CENTER_TRANSFORM = 'translateY(-50%)'
// GLOBAL_MESSAGE_CONFIG 存储 Ant Design 全局消息层的居中配置，统一作用于成功、警告和错误提示。
const GLOBAL_MESSAGE_CONFIG = {
  top: MESSAGE_CENTER_OFFSET,
  styles: {
    listContent: {
      transform: MESSAGE_CENTER_TRANSFORM,
    },
  },
}

/**
 * 根组件：根据 store 中的主题选择 antd 算法（暗色/亮色），并同步 body 背景色
 * @returns {JSX.Element} 应用根节点
 */
function Root() {
  // theme 当前主题，来自全局 store
  const themeMode = useStore((s) => s.theme)
  // isDark 是否暗色
  const isDark = themeMode === 'dark'

  // 同步 body 背景，避免主题切换/首屏出现白底闪烁
  useEffect(() => {
    document.body.style.background = isDark ? '#141414' : '#ffffff'
    // 在根元素标记主题，供 styles.css 做少量自定义适配
    document.documentElement.setAttribute(
      'data-theme',
      isDark ? 'dark' : 'light'
    )
  }, [isDark])

  return (
    <ConfigProvider
      locale={zhCN}
      modal={{ centered: true }}
      theme={{
        algorithm: isDark
          ? antdTheme.darkAlgorithm
          : antdTheme.defaultAlgorithm,
      }}
    >
      {/* AntApp 提供 message/Modal 的主题上下文，使弹窗也跟随明暗 */}
      <AntApp message={GLOBAL_MESSAGE_CONFIG}>
        <App />
      </AntApp>
    </ConfigProvider>
  )
}

const container = document.getElementById('root')
const root = createRoot(container)
root.render(<Root />)
