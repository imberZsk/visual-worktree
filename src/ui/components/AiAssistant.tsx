import React, { useEffect, useState } from 'react'
import { Button, Drawer, Empty, Input, Spin, Tooltip } from 'antd'
import { RobotOutlined, SendOutlined } from '@ant-design/icons'
import { api } from '../api.ts'

// ASSISTANT_DRAWER_SIZE 存储桌面端聊天抽屉尺寸，小屏由 CSS 最大宽度约束在视口内。
const ASSISTANT_DRAWER_SIZE = 380
// ASSISTANT_REQUEST_ERROR 存储无法从接口取得明确错误时展示的兜底文案。
const ASSISTANT_REQUEST_ERROR = 'AI 智能助手请求失败'
// IS_DEVELOPMENT_LOG_ENABLED 标记是否输出学习调试日志；测试和生产构建不会打印。
const IS_DEVELOPMENT_LOG_ENABLED =
  import.meta.env.DEV && import.meta.env.MODE !== 'test'

// AssistantMessage 描述当前前端会话中的一条消息。
type AssistantMessage = {
  id: string
  role: 'user' | 'assistant' | 'error'
  content: string
}

// AiAssistantProps 描述生成安全工作区快照所需的现有页面状态。
type AiAssistantProps = {
  projects?: Array<{
    name?: string
    currentBranch?: string
    isMainBranch?: boolean
    hasUncommittedChanges?: boolean
    ahead?: number
    behind?: number
  }>
  worktreeTasks?: Array<{
    task?: string
    worktrees?: Array<{
      project?: string
      branch?: string
      hasUncommittedChanges?: boolean
      ahead?: number
      behind?: number
    }>
  }>
}

/**
 * 渲染右下角 AI 助手入口与前端聊天框。
 * @returns {JSX.Element} AI 助手浮动入口和聊天抽屉
 */
export default function AiAssistant({
  projects = [],
  worktreeTasks = [],
}: AiAssistantProps) {
  // open 存储聊天抽屉是否展开。
  const [open, setOpen] = useState(false)
  // draft 存储输入框中尚未发送的用户文本。
  const [draft, setDraft] = useState('')
  // messages 存储当前前端会话中的用户消息、智能体回答与错误信息。
  const [messages, setMessages] = useState<Array<AssistantMessage>>([])
  // sending 存储当前是否正在等待 AI 后端返回，避免重复提交。
  const [sending, setSending] = useState(false)

  useEffect(() => {
    /**
     * 将属于当前请求的文本片段追加到对应的助手消息。
     * @param {{requestId?:string,chunk?:string}} event - 主进程推送的流式文本事件
     */
    const handleStreamChunk = (event) => {
      if (!event?.requestId || typeof event.chunk !== 'string') return
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === `${event.requestId}-assistant`
            ? { ...message, content: message.content + event.chunk }
            : message
        )
      )
    }

    // unsubscribe 存储当前组件的 AI 流式事件取消订阅函数；旧 preload 暂无该能力时安全降级。
    const unsubscribe = api.onAiAssistantStreamChunk?.(handleStreamChunk)
    return () => unsubscribe?.()
  }, [])

  /**
   * 将非空草稿发送给主进程，并把用户消息与智能体回答追加到当前会话。
   */
  const handleSend = async () => {
    // 前端第 1 步（建议在下一行打断点）：读取输入框文字。执行到这里说明用户已经点击发送。
    // content 存储去除首尾空白后的待发送消息。
    const content = draft.trim()
    if (!content || sending) return
    // requestId 存储本次请求的稳定标识，用于生成关联消息 id。
    const requestId = `${Date.now()}-${messages.length}`
    if (IS_DEVELOPMENT_LOG_ENABLED) {
      console.log('[AI 前端第 1 步] 用户点击发送')
    }
    // 前端第 2 步（建议在下一行打断点）：把页面当前数据整理成安全快照；重点查看 projects 和 tasks。
    // workspace 只存储允许发给后端的字段，主动排除本地路径、远程地址和文件内容。
    const workspace = {
      projects: projects.map((project) => ({
        name: project?.name || '',
        current_branch: project?.currentBranch || '',
        is_main_branch: Boolean(project?.isMainBranch),
        has_uncommitted_changes: Boolean(project?.hasUncommittedChanges),
        ahead: Number.isFinite(project?.ahead) ? project.ahead : 0,
        behind: Number.isFinite(project?.behind) ? project.behind : 0,
      })),
      tasks: worktreeTasks.map((task) => ({
        task: task?.task || '',
        worktrees: (task?.worktrees || []).map((worktree) => ({
          project: worktree?.project || '',
          branch: worktree?.branch || '',
          has_uncommitted_changes: Boolean(worktree?.hasUncommittedChanges),
          ahead: Number.isFinite(worktree?.ahead) ? worktree.ahead : 0,
          behind: Number.isFinite(worktree?.behind) ? worktree.behind : 0,
        })),
      })),
    }
    if (IS_DEVELOPMENT_LOG_ENABLED) {
      console.log('[AI 前端第 2 步] 已生成安全工作区快照')
    }
    setMessages((currentMessages) => [
      ...currentMessages,
      { id: `${requestId}-user`, role: 'user', content },
      { id: `${requestId}-assistant`, role: 'assistant', content: '' },
    ])
    setDraft('')
    setSending(true)
    try {
      // 前端第 3 步（建议在下一行打断点）：通过 preload API 把消息和快照交给 Electron 主进程。
      if (IS_DEVELOPMENT_LOG_ENABLED) {
        console.log('[AI 前端第 3 步] 准备发送给主进程')
      }
      // result 存储 Electron 主进程完成流式 HTTP 调用后的最终状态。
      const result = await api.streamAiAssistantMessage({
        requestId,
        message: content,
        workspace,
      })
      if (!result?.success) {
        throw new Error(result?.error || ASSISTANT_REQUEST_ERROR)
      }
      // 测试替身或异常传输未触发片段事件时，使用最终回答补齐空消息。
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === `${requestId}-assistant` && !message.content
            ? { ...message, content: result.answer?.trim() || '' }
            : message
        )
      )
    } catch (error) {
      // errorContent 存储当前请求最终展示给用户的错误信息。
      const errorContent = error?.message || ASSISTANT_REQUEST_ERROR
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === `${requestId}-assistant`
            ? { ...message, role: 'error', content: errorContent }
            : message
        )
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <Tooltip title="AI 智能助手" placement="left">
        <Button
          className="ai-assistant-trigger"
          type="primary"
          shape="circle"
          size="large"
          aria-label="打开 AI 智能助手"
          icon={<RobotOutlined />}
          onClick={() => setOpen(true)}
        />
      </Tooltip>
      <Drawer
        className="ai-assistant-drawer"
        title="AI 智能助手"
        placement="right"
        size={ASSISTANT_DRAWER_SIZE}
        open={open}
        onClose={() => setOpen(false)}
        destroyOnHidden={false}
        styles={{ body: { height: '100%', minHeight: 0 } }}
      >
        <div className="ai-assistant-chat">
          <div className="ai-assistant-messages" aria-live="polite">
            {messages.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无消息"
              />
            ) : (
              messages.map((message) => (
                <div
                  className={`ai-assistant-message ai-assistant-message-${message.role}`}
                  key={message.id}
                >
                  {message.content}
                </div>
              ))
            )}
            {sending && (
              <div
                className="ai-assistant-message ai-assistant-message-assistant ai-assistant-message-loading"
                aria-label="AI 智能助手正在回复"
              >
                <Spin size="small" />
              </div>
            )}
          </div>
          <div className="ai-assistant-composer">
            <Input.TextArea
              aria-label="向 AI 智能助手提问"
              value={draft}
              autoSize={{ minRows: 2, maxRows: 5 }}
              placeholder="输入问题"
              onChange={(event) => setDraft(event.target.value)}
              onPressEnter={(event) => {
                if (event.shiftKey) return
                event.preventDefault()
                handleSend()
              }}
            />
            <Tooltip title="发送">
              <Button
                type="primary"
                aria-label="发送消息"
                icon={<SendOutlined />}
                disabled={!draft.trim() || sending}
                loading={sending}
                onClick={handleSend}
              />
            </Tooltip>
          </div>
        </div>
      </Drawer>
    </>
  )
}
