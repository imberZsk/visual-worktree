import React from 'react'
import { Button, Input, Space, Tooltip } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { normalizeTaskLinkItems } from '../worktreeLogic.ts'

// 需求链接名称输入框占位文案：创建弹窗、任务管理弹层和测试统一使用。
export const TASK_LINK_NAME_PLACEHOLDER = '链接名称'
// 需求链接地址输入框占位文案：创建弹窗、任务管理弹层和测试统一使用。
export const TASK_LINK_PLACEHOLDER = '如 Jira 地址、PRD'

/**
 * 将单个外部链接值转换为可编辑行。
 * @param {string|{name?:string,url?:string}} value - 外部传入的单个链接值
 * @returns {{name:string,url:string}} 可编辑的链接行；旧版字符串会转成无名称链接
 */
function toEditableLinkItem(value) {
  if (typeof value === 'string') return { name: '', url: value }
  // name 存储链接的展示名称；用户可留空，展示层会回退到 URL。
  const name = typeof value?.name === 'string' ? value.name : ''
  // url 存储真实链接地址；即使为空也保留，方便用户继续填写当前行。
  const url = typeof value?.url === 'string' ? value.url : ''
  return { name, url }
}

/**
 * 将外部链接值转换为可编辑行数组。
 * @param {string|string[]|Array<{name?:string,url?:string}>} value - 外部传入的链接值；数组保留空行，对象保留名称
 * @returns {Array<{name:string,url:string}>} 至少包含一个元素的输入框值数组
 */
function toEditableLinks(value) {
  // directLinks 存储受控组件传入的数组草稿；保留空 URL 行以便用户继续填写新增行。
  const directLinks = Array.isArray(value)
    ? value.map(toEditableLinkItem)
    : null
  if (directLinks)
    return directLinks.length > 0 ? directLinks : [{ name: '', url: '' }]
  // normalizedLinks 存储从旧版字符串或文本粘贴值中解析出的链接条目。
  const normalizedLinks = normalizeTaskLinkItems(value)
  return normalizedLinks.length > 0 ? normalizedLinks : [{ name: '', url: '' }]
}

/**
 * 多需求链接编辑器：默认展示一行「名称 + 链接」输入框，可按需添加/删除多条链接。
 * @param {object} props - 组件属性
 * @param {string|string[]|Array<{name?:string,url?:string}>} [props.value] - 当前链接草稿；可包含空 URL 行
 * @param {(value:Array<{name:string,url:string}>)=>void} [props.onChange] - 草稿变化回调，交给父级表单或状态保存
 * @param {number|string} [props.width] - 输入区宽度，弹层内可传固定宽度
 * @returns {JSX.Element} 多链接输入控件
 */
export default function TaskLinksEditor({ value, onChange, width = '100%' }) {
  // editableLinks 存储当前渲染的输入框行；至少一行，允许用户不填。
  const editableLinks = toEditableLinks(value)

  /**
   * 写回新的链接草稿数组。
   * @param {Array<{name:string,url:string}>} nextLinks - 下一版输入框值数组
   */
  const emitChange = (nextLinks) => {
    onChange?.(nextLinks)
  }

  /**
   * 处理名称输入变化。
   * @param {number} index - 当前输入框在链接数组中的下标
   * @returns {(event:React.ChangeEvent<HTMLInputElement>)=>void} antd Input onChange 处理函数
   */
  const handleNameChange = (index) => (event) => {
    // nextLinks 存储替换当前行后的草稿数组。
    const nextLinks = [...editableLinks]
    nextLinks[index] = { ...nextLinks[index], name: event.target.value }
    emitChange(nextLinks)
  }

  /**
   * 处理链接地址输入变化。
   * @param {number} index - 当前输入框在链接数组中的下标
   * @returns {(event:React.ChangeEvent<HTMLInputElement>)=>void} antd Input onChange 处理函数
   */
  const handleUrlChange = (index) => (event) => {
    // nextLinks 存储替换当前行后的草稿数组。
    const nextLinks = [...editableLinks]
    nextLinks[index] = { ...nextLinks[index], url: event.target.value }
    emitChange(nextLinks)
  }

  /**
   * 删除指定链接输入框；只剩一行时清空该行而不是移除，保持默认一个框。
   * @param {number} index - 要删除的输入框下标
   */
  const handleRemove = (index) => {
    // nextLinks 存储删除后的草稿数组；保留至少一个空输入框。
    const nextLinks =
      editableLinks.length > 1
        ? editableLinks.filter((_, i) => i !== index)
        : [{ name: '', url: '' }]
    emitChange(nextLinks)
  }

  /**
   * 追加一个新的空链接输入框。
   */
  const handleAdd = () => {
    // nextLinks 存储新增空行后的草稿数组。
    const nextLinks = [...editableLinks, { name: '', url: '' }]
    emitChange(nextLinks)
  }

  /**
   * 处理多链接粘贴：用户粘贴多行或逗号分隔内容时自动展开成多行输入框。
   * @param {number} index - 当前粘贴发生的输入框下标
   * @returns {(event:React.ClipboardEvent<HTMLInputElement>)=>void} antd Input onPaste 处理函数
   */
  const handlePaste = (index) => (event) => {
    // pastedLinks 存储从剪贴板文本中解析出的多条链接条目。
    const pastedLinks = normalizeTaskLinkItems(
      event.clipboardData?.getData('text') || ''
    )
    if (pastedLinks.length <= 1) return
    event.preventDefault()
    // nextLinks 存储把当前行替换为多条粘贴链接后的草稿数组。
    const nextLinks = [
      ...editableLinks.slice(0, index),
      ...pastedLinks,
      ...editableLinks.slice(index + 1),
    ]
    emitChange(nextLinks)
  }

  return (
    <Space orientation="vertical" size={6} style={{ width }}>
      {editableLinks.map((link, index) => (
        // 这里使用 index 作为 key：输入框是轻量顺序编辑行，没有独立业务 id；删除/追加只影响本地草稿。
        <Space.Compact key={index} style={{ width: '100%' }}>
          <Input
            value={link.name}
            onChange={handleNameChange(index)}
            placeholder={TASK_LINK_NAME_PLACEHOLDER}
            style={{ width: 132, flex: '0 0 132px' }}
          />
          <Input
            value={link.url}
            onChange={handleUrlChange(index)}
            onPaste={handlePaste(index)}
            placeholder={TASK_LINK_PLACEHOLDER}
            style={{ flex: '1 1 0%', minWidth: 0 }}
          />
          <Tooltip title={editableLinks.length > 1 ? '删除此链接' : '清空链接'}>
            <Button
              icon={<DeleteOutlined />}
              onClick={() => handleRemove(index)}
            />
          </Tooltip>
        </Space.Compact>
      ))}
      <Button
        type="dashed"
        size="small"
        icon={<PlusOutlined />}
        onClick={handleAdd}
      >
        添加链接
      </Button>
    </Space>
  )
}
