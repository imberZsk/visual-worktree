import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import SingleLineText from '../../src/ui/components/SingleLineText.tsx'

// SingleLineText 测试：确保单行省略能力由 Ant Design Typography 承接，而不是手写 Tooltip + CSS。

afterEach(() => cleanup())

describe('SingleLineText', () => {
  it('使用 Ant Design Typography 渲染普通单行省略文本', () => {
    render(<SingleLineText text="feature/PROJ-1001-very-long-branch-name" />)

    // textNode 存储普通文本节点，用于确认组件底层使用 antd Typography。
    const textNode = screen.getByText('feature/PROJ-1001-very-long-branch-name')
    expect(textNode).toHaveClass('ant-typography')
    expect(textNode).toHaveClass('single-line-tooltip-text')
  })

  it('使用 Ant Design Typography.Text 的 code 形态渲染代码文本', () => {
    render(<SingleLineText text="feature/demo" as="code" />)

    // codeNode 存储代码文本节点，用于确认 code 形态仍由 Typography 承接。
    const codeNode = screen.getByText('feature/demo')
    // typographyNode 存储 code 文本外层的 antd Typography 节点。
    const typographyNode = codeNode.closest('.ant-typography')
    expect(typographyNode).toBeInTheDocument()
    expect(typographyNode).toHaveClass('single-line-tooltip-text')
    expect(codeNode.tagName.toLowerCase()).toBe('code')
  })
})
