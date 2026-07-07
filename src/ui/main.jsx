import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme as antdTheme, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App.jsx';
import { useStore } from './store/useStore.js';
import './styles.css';

// 渲染进程入口：挂载 React 应用，配置 antd 中文语言与明暗主题。

/**
 * 根组件：根据 store 中的主题选择 antd 算法（暗色/亮色），并同步 body 背景色
 * @returns {JSX.Element} 应用根节点
 */
function Root() {
  // theme 当前主题，来自全局 store
  const themeMode = useStore((s) => s.theme);
  // isDark 是否暗色
  const isDark = themeMode === 'dark';

  // 同步 body 背景，避免主题切换/首屏出现白底闪烁
  useEffect(() => {
    document.body.style.background = isDark ? '#141414' : '#ffffff';
    // 在根元素标记主题，供 styles.css 做少量自定义适配
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  return (
    <ConfigProvider
      locale={zhCN}
      modal={{ centered: true }}
      theme={{
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      }}
    >
      {/* AntApp 提供 message/Modal 的主题上下文，使弹窗也跟随明暗 */}
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  );
}

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<Root />);
