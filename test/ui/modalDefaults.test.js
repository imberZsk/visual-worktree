import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { withConfirmDefaults } from '../../src/ui/modalDefaults.ts'

describe('弹层默认行为', () => {
  it('确认弹层默认居中且允许点击遮罩关闭', () => {
    // options 存储调用方传入的确认弹层配置，用于验证默认值不会覆盖显式业务字段。
    const options = { title: '删除任务', okType: 'danger' }

    // result 存储合并默认值后的确认弹层配置。
    const result = withConfirmDefaults(options)

    expect(result).toMatchObject({
      title: '删除任务',
      okType: 'danger',
      centered: true,
      mask: { closable: true },
    })
  })

  it('调用方显式配置可覆盖确认弹层默认值', () => {
    // result 存储调用方显式关闭遮罩关闭后的确认弹层配置。
    const result = withConfirmDefaults({ mask: { closable: false } })

    expect(result.mask.closable).toBe(false)
  })

  it('根入口全局配置普通 Modal 居中', () => {
    // source 存储渲染入口源码，用于验证 ConfigProvider 已给普通 Modal 设置全局居中。
    const source = readFileSync(join(process.cwd(), 'src/ui/main.tsx'), 'utf8')

    expect(source).toMatch(/modal=\{\{\s*centered:\s*true\s*\}\}/)
  })

  it('根入口全局配置消息提示在视口内居中', () => {
    // source 存储渲染入口源码，用于验证所有 Ant Design message 共用同一份居中配置。
    const source = readFileSync(join(process.cwd(), 'src/ui/main.tsx'), 'utf8')

    expect(source).toContain("const MESSAGE_CENTER_OFFSET = '50%'")
    expect(source).toContain("const MESSAGE_CENTER_TRANSFORM = 'translateY(-50%)'")
    expect(source).toMatch(/<AntApp\s+message=\{GLOBAL_MESSAGE_CONFIG\}>/)
  })
})
