import { afterAll, beforeAll } from 'vitest'

/**
 * 为 happy-dom 补齐 Ant Design 6 依赖的尺寸观察 API。
 */
class TestResizeObserver {
  /** 测试环境不需要真实监听元素尺寸。 */
  observe() {}

  /** 测试环境不需要维护观察目标集合。 */
  unobserve() {}

  /** 测试环境不需要释放浏览器原生资源。 */
  disconnect() {}
}

// ResizeObserver 存储供 Ant Design 响应式组件使用的测试替身。
globalThis.ResizeObserver = TestResizeObserver
// IS_REACT_ACT_ENVIRONMENT 标记当前 DOM 环境由 Testing Library 驱动。
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// originalConsoleError 存储测试环境原始 console.error，非目标日志继续原样输出。
const originalConsoleError = console.error
// originalConsoleWarn 存储测试环境原始 console.warn，非目标日志继续原样输出。
const originalConsoleWarn = console.warn

/**
 * 判断控制台参数是否包含指定文本。
 * @param {unknown[]} args - console 方法收到的参数列表
 * @param {string} text - 需要识别的警告片段
 * @returns {boolean} 是否命中
 */
function includesConsoleText(args, text) {
  return args.some((arg) => String(arg).includes(text))
}

beforeAll(() => {
  console.error = (...args) => {
    // React 在调用 console.error 时可能保留 %s 模板，终端格式化后才把后续参数 act 填进去，两种形态都要拦截。
    if (
      includesConsoleText(args, 'not wrapped in act') ||
      includesConsoleText(args, 'not wrapped in %s')
    ) {
      throw new Error(
        `检测到未等待的 React 状态更新：${args.map(String).join(' ')}`
      )
    }
    if (includesConsoleText(args, '`imageStyle` is deprecated')) {
      throw new Error(
        `检测到已废弃的 antd Empty API：${args.map(String).join(' ')}`
      )
    }
    if (includesConsoleText(args, 'There may be circular references')) {
      // rc-util 5.44.4 会把表单 meta 中重复的基础值误判为循环引用；只抑制该精确已知误报。
      return
    }
    originalConsoleError(...args)
  }
  console.warn = (...args) => {
    if (includesConsoleText(args, '`imageStyle` is deprecated')) {
      throw new Error(
        `检测到已废弃的 antd Empty API：${args.map(String).join(' ')}`
      )
    }
    if (includesConsoleText(args, 'There may be circular references')) {
      // 兼容依赖通过 console.warn 输出同一已知误报的情况。
      return
    }
    originalConsoleWarn(...args)
  }
})

afterAll(() => {
  console.error = originalConsoleError
  console.warn = originalConsoleWarn
})
