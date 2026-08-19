import React, { useEffect, useRef, useState } from 'react'
import { Button, Drawer, Empty, Input, message, Select, Tooltip } from 'antd'
import {
  ArrowUpOutlined,
  CheckCircleOutlined,
  CloseOutlined,
  FileOutlined,
  LoadingOutlined,
  PlusOutlined,
  RobotOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import { api } from '../api.ts'
import './AiAssistant.css'

// ASSISTANT_DRAWER_SIZE 存储桌面端聊天抽屉尺寸，小屏由 CSS 最大宽度约束在视口内。
const ASSISTANT_DRAWER_SIZE = 620
// ASSISTANT_REQUEST_ERROR 存储无法从接口取得明确错误时展示的兜底文案。
const ASSISTANT_REQUEST_ERROR = 'AI 智能助手请求失败'
// NEW_CONVERSATION_TITLE 存储尚未发送消息的会话默认标题。
const NEW_CONVERSATION_TITLE = '新对话'
// CONVERSATION_TITLE_LENGTH 存储首条问题生成 Tab 标题时保留的最大字符数。
const CONVERSATION_TITLE_LENGTH = 18
// ELAPSED_TIMER_INTERVAL 存储请求期间刷新前端耗时显示的毫秒间隔。
const ELAPSED_TIMER_INTERVAL = 100
// DEFAULT_REASONING_EFFORT 存储新会话默认使用的模型思考强度。
const DEFAULT_REASONING_EFFORT = 'medium'
// MAX_ATTACHMENT_COUNT 存储单次消息允许选择的附件数量上限。
const MAX_ATTACHMENT_COUNT = 5
// MAX_ATTACHMENT_SIZE 存储单个附件允许的最大字节数。
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024
// MAX_TOTAL_ATTACHMENT_SIZE 存储单次消息全部附件允许的最大字节数。
const MAX_TOTAL_ATTACHMENT_SIZE = 20 * 1024 * 1024
// IS_DEVELOPMENT_LOG_ENABLED 标记是否输出学习调试日志；测试和生产构建不会打印。
const IS_DEVELOPMENT_LOG_ENABLED =
  import.meta.env.DEV && import.meta.env.MODE !== 'test'

// REASONING_EFFORT_OPTIONS 存储聊天输入区可选的请求级思考强度。
const REASONING_EFFORT_OPTIONS = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '极高' },
]

// TOOL_LABELS 存储后端工具标识对应的紧凑中文名称，未知工具仍展示原始名称。
const TOOL_LABELS: Record<string, string> = {
  get_assistant_status: '读取助手状态',
  get_workspace_summary: '读取工作区摘要',
  write_todos: '更新任务计划',
  task: '调用分析子智能体',
}

// AssistantMessage 描述当前前端会话中的一条消息。
type AssistantMessage = {
  id: string
  role: 'user' | 'assistant' | 'error'
  content: string
  elapsedMs?: number
  attachments?: Array<AssistantAttachmentSummary>
}

// AssistantAttachmentSummary 描述已经发送并展示在用户消息中的附件元信息。
type AssistantAttachmentSummary = {
  name: string
  mediaType: string
}

// AssistantAttachment 描述待发送附件及其仅驻留内存的 data URL 内容。
type AssistantAttachment = AssistantAttachmentSummary & {
  id: string
  size: number
  dataUrl: string
}

// AssistantActivity 描述一次模型请求中可公开展示的思考摘要或工具执行状态。
type AssistantActivity = {
  id: string
  kind: 'reasoning' | 'tool'
  label: string
  content?: string
  completed: boolean
}

// AssistantConversation 描述一个独立聊天 Tab 的消息、草稿与运行状态。
type AssistantConversation = {
  id: string
  title: string
  messages: Array<AssistantMessage>
  activities: Array<AssistantActivity>
  draft: string
  attachments: Array<AssistantAttachment>
  reasoningEffort: string
  sending: boolean
  startedAt?: number
  elapsedMs: number
  processExpanded: boolean
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
 * 创建一个具有独立上下文和默认思考强度的空聊天。
 * @returns {AssistantConversation} 可直接加入 Tab 列表的新会话
 */
function createConversation(): AssistantConversation {
  // conversationId 存储会话稳定标识，也用于关联该会话发起的流式请求。
  const conversationId = `conversation-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return {
    id: conversationId,
    title: NEW_CONVERSATION_TITLE,
    messages: [],
    activities: [],
    draft: '',
    attachments: [],
    reasoningEffort: DEFAULT_REASONING_EFFORT,
    sending: false,
    elapsedMs: 0,
    processExpanded: true,
  }
}

/**
 * 将毫秒耗时格式化为适合聊天元信息展示的秒数。
 * @param {number} elapsedMs - 已执行的毫秒数
 * @returns {string} 带秒单位的紧凑文本
 */
function formatElapsedTime(elapsedMs: number): string {
  return `${(Math.max(0, elapsedMs) / 1000).toFixed(1)} 秒`
}

/**
 * 返回工具标识对应的用户可读名称，未知工具保留原值便于排查。
 * @param {string} toolName - 后端返回的工具名称
 * @returns {string} 工具显示名称
 */
function getToolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] || toolName || '未知工具'
}

/**
 * 将浏览器 File 异步读取为可安全跨 IPC 传输的 data URL。
 * @param {File} file - 用户通过系统文件选择器选中的文件
 * @returns {Promise<string>} 包含 MIME 类型和 base64 数据的 URL
 */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    // reader 存储本次附件的异步文件读取器。
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('无法读取附件'))
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`))
    reader.readAsDataURL(file)
  })
}

/**
 * 渲染右下角 AI 助手入口与支持多会话的聊天抽屉。
 * @returns {JSX.Element} AI 助手浮动入口和聊天抽屉
 */
export default function AiAssistant({
  projects = [],
  worktreeTasks = [],
}: AiAssistantProps) {
  // initialConversationRef 存储组件首次渲染创建的会话，避免函数组件重渲染重复生成。
  const initialConversationRef = useRef<AssistantConversation | null>(null)
  if (!initialConversationRef.current) {
    initialConversationRef.current = createConversation()
  }
  // open 存储聊天抽屉是否展开。
  const [open, setOpen] = useState(false)
  // conversations 存储当前窗口内全部独立聊天 Tab。
  const [conversations, setConversations] = useState<
    Array<AssistantConversation>
  >([initialConversationRef.current])
  // activeConversationId 存储当前选中的聊天 Tab 标识。
  const [activeConversationId, setActiveConversationId] = useState(
    initialConversationRef.current.id
  )
  // currentTime 存储耗时计时器最近一次刷新的时间戳，用于计算发送中耗时。
  const [currentTime, setCurrentTime] = useState(() => Date.now())
  // composerRef 存储输入框实例，用于打开聊天框或切换会话后恢复键盘焦点。
  const composerRef = useRef<{ focus: () => void } | null>(null)
  // attachmentInputRef 存储隐藏文件输入框，用于由加号按钮打开系统文件选择器。
  const attachmentInputRef = useRef<HTMLInputElement | null>(null)
  // messagesEndRef 存储消息列表尾部锚点，使当前会话流式回答保持在可视区域内。
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  // requestConversationIdsRef 存储流式 requestId 与聊天 Tab 的关联，避免切换 Tab 后事件串线。
  const requestConversationIdsRef = useRef<Map<string, string>>(new Map())

  // activeConversation 存储当前选中 Tab 的完整状态；异常缺失时回退首个会话。
  const activeConversation =
    conversations.find(
      (conversation) => conversation.id === activeConversationId
    ) || conversations[0]
  // hasSendingConversation 标记是否至少一个 Tab 正在请求，用于启动唯一的耗时刷新计时器。
  const hasSendingConversation = conversations.some(
    (conversation) => conversation.sending
  )

  /**
   * 按会话标识原子更新指定 Tab，避免异步流事件覆盖其他会话状态。
   * @param {string} conversationId - 目标会话标识
   * @param {(conversation:AssistantConversation)=>AssistantConversation} updater - 会话状态更新函数
   */
  const updateConversation = (
    conversationId: string,
    updater: (conversation: AssistantConversation) => AssistantConversation
  ) => {
    setConversations((currentConversations) =>
      currentConversations.map((conversation) =>
        conversation.id === conversationId
          ? updater(conversation)
          : conversation
      )
    )
  }

  useEffect(() => {
    /**
     * 将后端公开的文本、工具和思考摘要事件更新到其原始聊天 Tab。
     * @param {{requestId?:string,type?:string,chunk?:string,content?:string,name?:string,elapsed_ms?:string}} event - 主进程推送的流式事件
     */
    const handleStreamEvent = (event) => {
      if (!event?.requestId) return
      // conversationId 存储发起该请求的聊天 Tab 标识。
      const conversationId = requestConversationIdsRef.current.get(
        event.requestId
      )
      if (!conversationId) return
      if (
        (event.type === 'delta' || !event.type) &&
        typeof event.chunk === 'string'
      ) {
        updateConversation(conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.id === `${event.requestId}-assistant`
              ? { ...message, content: message.content + event.chunk }
              : message
          ),
        }))
        return
      }
      if (event.type === 'reasoning' && typeof event.content === 'string') {
        updateConversation(conversationId, (conversation) => ({
          ...conversation,
          activities: [
            ...conversation.activities,
            {
              id: `${event.requestId}-reasoning-${conversation.activities.length}`,
              kind: 'reasoning',
              label: '思考摘要',
              content: event.content,
              completed: true,
            },
          ],
        }))
        return
      }
      if (event.type === 'tool_start' && typeof event.name === 'string') {
        updateConversation(conversationId, (conversation) => ({
          ...conversation,
          activities: [
            ...conversation.activities,
            {
              id: `${event.requestId}-tool-${event.name}`,
              kind: 'tool',
              label: getToolLabel(event.name),
              completed: false,
            },
          ],
        }))
        return
      }
      if (event.type === 'tool_end' && typeof event.name === 'string') {
        updateConversation(conversationId, (conversation) => {
          // activityId 存储同一请求下该工具的稳定执行项标识。
          const activityId = `${event.requestId}-tool-${event.name}`
          // hasStartedActivity 标记后端是否先发送过工具开始事件。
          const hasStartedActivity = conversation.activities.some(
            (activity) => activity.id === activityId
          )
          return {
            ...conversation,
            activities: hasStartedActivity
              ? conversation.activities.map((activity) =>
                  activity.id === activityId
                    ? { ...activity, completed: true }
                    : activity
                )
              : [
                  ...conversation.activities,
                  {
                    id: activityId,
                    kind: 'tool',
                    label: getToolLabel(event.name),
                    completed: true,
                  },
                ],
          }
        })
      }
    }

    // unsubscribe 存储当前组件的 AI 流式事件取消订阅函数；旧 preload 暂无该能力时安全降级。
    const unsubscribe = api.onAiAssistantStreamChunk?.(handleStreamEvent)
    return () => unsubscribe?.()
  }, [])

  useEffect(() => {
    if (!hasSendingConversation) return undefined
    // timerId 存储唯一耗时刷新定时器；请求全部结束或组件卸载时立即清理。
    const timerId = window.setInterval(
      () => setCurrentTime(Date.now()),
      ELAPSED_TIMER_INTERVAL
    )
    return () => window.clearInterval(timerId)
  }, [hasSendingConversation])

  useEffect(() => {
    // 流式片段只推动当前 Tab 的列表尾部，不改变页面级滚动位置。
    messagesEndRef.current?.scrollIntoView?.({ block: 'end' })
  }, [activeConversation?.messages, activeConversation?.activities])

  // currentElapsedMs 存储当前 Tab 实时或已完成的请求耗时。
  const currentElapsedMs =
    activeConversation?.sending && activeConversation.startedAt
      ? currentTime - activeConversation.startedAt
      : activeConversation?.elapsedMs || 0

  /**
   * 在抽屉展开动画结束后聚焦当前会话输入框。
   * @param {boolean} nextOpen - 抽屉动画结束后的展开状态
   */
  const handleDrawerOpenChange = (nextOpen: boolean) => {
    if (nextOpen) composerRef.current?.focus()
  }

  /**
   * 新建聊天 Tab 并立即切换过去。
   */
  const handleCreateConversation = () => {
    // conversation 存储本次用户新建的空聊天。
    const conversation = createConversation()
    setConversations((currentConversations) => [
      ...currentConversations,
      conversation,
    ])
    setActiveConversationId(conversation.id)
    window.setTimeout(() => composerRef.current?.focus(), 0)
  }

  /**
   * 关闭指定聊天 Tab；最后一个 Tab 被关闭时自动创建空聊天。
   * @param {string} conversationId - 需要关闭的会话标识
   */
  const handleCloseConversation = (conversationId: string) => {
    // closingConversation 存储关闭目标，发送中的会话不能关闭以免丢失流式结果。
    const closingConversation = conversations.find(
      (conversation) => conversation.id === conversationId
    )
    if (closingConversation?.sending) return
    // remainingConversations 存储移除目标后的 Tab 列表。
    const remainingConversations = conversations.filter(
      (conversation) => conversation.id !== conversationId
    )
    if (remainingConversations.length === 0) {
      // replacementConversation 存储关闭最后一个 Tab 后自动补充的空聊天。
      const replacementConversation = createConversation()
      setConversations([replacementConversation])
      setActiveConversationId(replacementConversation.id)
      return
    }
    setConversations(remainingConversations)
    if (activeConversationId === conversationId) {
      setActiveConversationId(remainingConversations[0].id)
    }
  }

  /**
   * 校验并读取当前用户新选择的图片或文件，然后加入当前 Tab 的待发送列表。
   * @param {React.ChangeEvent<HTMLInputElement>} event - 隐藏文件输入框的变更事件
   */
  const handleAttachmentSelection = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (!activeConversation) return
    // selectedFiles 存储本次系统选择器返回的文件列表。
    const selectedFiles = Array.from(event.target.files || [])
    event.target.value = ''
    if (selectedFiles.length === 0) return
    if (
      activeConversation.attachments.length + selectedFiles.length >
      MAX_ATTACHMENT_COUNT
    ) {
      message.warning(`每次最多上传 ${MAX_ATTACHMENT_COUNT} 个附件`)
      return
    }
    if (selectedFiles.some((file) => file.size > MAX_ATTACHMENT_SIZE)) {
      message.warning('单个附件不能超过 10MB')
      return
    }
    // existingTotalSize 存储当前 Tab 已选择附件的总字节数。
    const existingTotalSize = activeConversation.attachments.reduce(
      (totalSize, attachment) => totalSize + attachment.size,
      0
    )
    // selectedTotalSize 存储本次新选择附件的总字节数。
    const selectedTotalSize = selectedFiles.reduce(
      (totalSize, file) => totalSize + file.size,
      0
    )
    if (existingTotalSize + selectedTotalSize > MAX_TOTAL_ATTACHMENT_SIZE) {
      message.warning('单次消息附件总大小不能超过 20MB')
      return
    }
    try {
      // attachments 存储完成读取后可随请求发送的附件数据。
      const attachments = await Promise.all(
        selectedFiles.map(async (file, index) => ({
          id: `${Date.now()}-${index}-${file.name}`,
          name: file.name,
          mediaType: file.type || 'application/octet-stream',
          size: file.size,
          dataUrl: await readFileAsDataUrl(file),
        }))
      )
      updateConversation(activeConversation.id, (conversation) => ({
        ...conversation,
        attachments: [...conversation.attachments, ...attachments],
      }))
    } catch (error) {
      message.error(error?.message || '读取附件失败')
    }
  }

  /**
   * 从当前 Tab 的待发送列表移除指定附件。
   * @param {string} attachmentId - 待移除附件标识
   */
  const handleRemoveAttachment = (attachmentId: string) => {
    if (!activeConversation) return
    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      attachments: conversation.attachments.filter(
        (attachment) => attachment.id !== attachmentId
      ),
    }))
  }

  /**
   * 将当前 Tab 的非空草稿发送给主进程，并持续记录公开执行过程。
   */
  const handleSend = async () => {
    if (!activeConversation) return
    // content 存储去除首尾空白后的待发送消息。
    const content = activeConversation.draft.trim()
    if (
      (!content && activeConversation.attachments.length === 0) ||
      activeConversation.sending
    )
      return
    // requestId 存储本次请求的稳定标识，用于关联流式消息和活动状态。
    const requestId = `${activeConversation.id}-${Date.now()}`
    // conversationId 存储发送发生时的 Tab，用户随后切换 Tab 也不会改变事件归属。
    const conversationId = activeConversation.id
    // attachments 存储发送开始时的附件快照，后续切换 Tab 不会改变当前请求内容。
    const attachments = activeConversation.attachments
    // history 存储本次提问前已完成的用户与助手消息，错误消息不进入模型上下文。
    const history = activeConversation.messages
      .filter((message) => message.role !== 'error' && message.content.trim())
      .map((message) => ({
        role: message.role,
        content: message.content,
      }))
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
    requestConversationIdsRef.current.set(requestId, conversationId)
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      title:
        conversation.title === NEW_CONVERSATION_TITLE
          ? (content || attachments[0]?.name || NEW_CONVERSATION_TITLE).slice(
              0,
              CONVERSATION_TITLE_LENGTH
            )
          : conversation.title,
      draft: '',
      attachments: [],
      sending: true,
      startedAt: Date.now(),
      elapsedMs: 0,
      activities: [],
      processExpanded: true,
      messages: [
        ...conversation.messages,
        {
          id: `${requestId}-user`,
          role: 'user',
          content,
          attachments: attachments.map((attachment) => ({
            name: attachment.name,
            mediaType: attachment.mediaType,
          })),
        },
        { id: `${requestId}-assistant`, role: 'assistant', content: '' },
      ],
    }))
    try {
      if (IS_DEVELOPMENT_LOG_ENABLED) {
        console.log('[AI 前端] 准备发送聊天请求')
      }
      // result 存储 Electron 主进程完成流式 HTTP 调用后的最终状态。
      const result = await api.streamAiAssistantMessage({
        requestId,
        message: content,
        history,
        attachments: attachments.map((attachment) => ({
          name: attachment.name,
          media_type: attachment.mediaType,
          data_url: attachment.dataUrl,
        })),
        reasoningEffort: activeConversation.reasoningEffort,
        workspace,
      })
      if (!result?.success) {
        throw new Error(result?.error || ASSISTANT_REQUEST_ERROR)
      }
      updateConversation(conversationId, (conversation) => {
        // completedElapsedMs 存储从客户端提交到主进程返回的完整端到端耗时。
        const completedElapsedMs = conversation.startedAt
          ? Date.now() - conversation.startedAt
          : 0
        return {
          ...conversation,
          sending: false,
          startedAt: undefined,
          elapsedMs: completedElapsedMs,
          messages: conversation.messages.map((message) =>
            message.id === `${requestId}-assistant`
              ? {
                  ...message,
                  content: message.content || result.answer?.trim() || '',
                  elapsedMs: completedElapsedMs,
                }
              : message
          ),
        }
      })
    } catch (error) {
      // errorContent 存储当前请求最终展示给用户的错误信息。
      const errorContent = error?.message || ASSISTANT_REQUEST_ERROR
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        sending: false,
        startedAt: undefined,
        elapsedMs: conversation.startedAt
          ? Date.now() - conversation.startedAt
          : 0,
        messages: conversation.messages.map((message) =>
          message.id === `${requestId}-assistant`
            ? { ...message, role: 'error', content: errorContent }
            : message
        ),
      }))
    } finally {
      requestConversationIdsRef.current.delete(requestId)
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
        rootClassName="ai-assistant-drawer"
        title={null}
        closable={false}
        placement="right"
        size={ASSISTANT_DRAWER_SIZE}
        open={open}
        onClose={() => setOpen(false)}
        afterOpenChange={handleDrawerOpenChange}
        destroyOnHidden={false}
      >
        <div className="ai-assistant-chat">
          <div
            className="ai-assistant-tabs"
            role="tablist"
            aria-label="聊天列表"
          >
            <div className="ai-assistant-tabs-scroll">
              {conversations.map((conversation) => (
                <div
                  className={`ai-assistant-tab${
                    conversation.id === activeConversation?.id
                      ? ' is-active'
                      : ''
                  }`}
                  key={conversation.id}
                >
                  <button
                    className="ai-assistant-tab-select"
                    type="button"
                    role="tab"
                    aria-selected={conversation.id === activeConversation?.id}
                    onClick={() => setActiveConversationId(conversation.id)}
                  >
                    <span>{conversation.title}</span>
                    {conversation.sending && <LoadingOutlined spin />}
                  </button>
                  <button
                    className="ai-assistant-tab-close"
                    type="button"
                    aria-label={`关闭聊天：${conversation.title}`}
                    disabled={conversation.sending}
                    onClick={() => handleCloseConversation(conversation.id)}
                  >
                    <CloseOutlined />
                  </button>
                </div>
              ))}
            </div>
            <Tooltip title="新建聊天">
              <Button
                className="ai-assistant-new-tab"
                type="text"
                aria-label="新建对话"
                icon={<PlusOutlined />}
                onClick={handleCreateConversation}
              />
            </Tooltip>
            {/* Ant Design 运行时会给 text 按钮注入水平内边距，固定宽度下会裁掉关闭图标。 */}
            <Button
              className="ai-assistant-close"
              type="text"
              aria-label="关闭对话"
              icon={<CloseOutlined />}
              onClick={() => setOpen(false)}
            />
          </div>
          <div className="ai-assistant-messages" aria-live="polite">
            {!activeConversation || activeConversation.messages.length === 0 ? (
              <Empty image={<RobotOutlined />} description="有什么可以帮你？" />
            ) : (
              activeConversation.messages.map((message) =>
                message.content ? (
                  <div
                    className={`ai-assistant-message ai-assistant-message-${message.role}`}
                    key={message.id}
                  >
                    <div className="ai-assistant-message-content">
                      {message.content}
                    </div>
                    {message.attachments && message.attachments.length > 0 && (
                      <div className="ai-assistant-message-attachments">
                        {message.attachments.map((attachment) => (
                          <span key={`${message.id}-${attachment.name}`}>
                            <FileOutlined />
                            {attachment.name}
                          </span>
                        ))}
                      </div>
                    )}
                    {message.role === 'assistant' &&
                      message.elapsedMs !== undefined && (
                        <div className="ai-assistant-message-meta">
                          {formatElapsedTime(message.elapsedMs)}
                        </div>
                      )}
                  </div>
                ) : null
              )
            )}
            {activeConversation &&
              (activeConversation.sending ||
                activeConversation.activities.length > 0) && (
                <details
                  className="ai-assistant-process"
                  aria-label={
                    activeConversation.sending
                      ? 'AI 智能助手正在回复'
                      : 'AI 智能助手执行过程'
                  }
                  open={activeConversation.processExpanded}
                  onToggle={(event) =>
                    updateConversation(
                      activeConversation.id,
                      (conversation) => ({
                        ...conversation,
                        processExpanded: event.currentTarget.open,
                      })
                    )
                  }
                >
                  <summary>
                    <span className="ai-assistant-process-title">
                      {activeConversation.sending ? (
                        <LoadingOutlined spin />
                      ) : (
                        <CheckCircleOutlined />
                      )}
                      {activeConversation.sending
                        ? activeConversation.activities.some(
                            (activity) =>
                              activity.kind === 'tool' && !activity.completed
                          )
                          ? '正在调用工具'
                          : '正在思考'
                        : '执行过程'}
                    </span>
                    <span>{formatElapsedTime(currentElapsedMs)}</span>
                  </summary>
                  {activeConversation.activities.length > 0 && (
                    <div className="ai-assistant-activity-list">
                      {activeConversation.activities.map((activity) => (
                        <div
                          className="ai-assistant-activity"
                          key={activity.id}
                        >
                          <span className="ai-assistant-activity-icon">
                            {activity.kind === 'tool' ? (
                              activity.completed ? (
                                <CheckCircleOutlined />
                              ) : (
                                <ToolOutlined />
                              )
                            ) : (
                              <RobotOutlined />
                            )}
                          </span>
                          <div>
                            <div>{activity.label}</div>
                            {activity.content && <div>{activity.content}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </details>
              )}
            <div ref={messagesEndRef} aria-hidden="true" />
          </div>
          {activeConversation && (
            <div className="ai-assistant-composer">
              {activeConversation.attachments.length > 0 && (
                <div className="ai-assistant-attachment-list">
                  {activeConversation.attachments.map((attachment) => (
                    <span
                      className="ai-assistant-attachment"
                      key={attachment.id}
                    >
                      <FileOutlined />
                      <span>{attachment.name}</span>
                      <button
                        type="button"
                        aria-label={`移除附件：${attachment.name}`}
                        onClick={() => handleRemoveAttachment(attachment.id)}
                      >
                        <CloseOutlined />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <Input.TextArea
                ref={composerRef}
                variant="borderless"
                aria-label="向 AI 智能助手提问"
                value={activeConversation.draft}
                autoSize={{ minRows: 2, maxRows: 8 }}
                placeholder="向 AI 智能助手提问"
                onChange={(event) =>
                  updateConversation(activeConversation.id, (conversation) => ({
                    ...conversation,
                    draft: event.target.value,
                  }))
                }
                onPressEnter={(event) => {
                  if (event.shiftKey) return
                  event.preventDefault()
                  handleSend()
                }}
              />
              <div className="ai-assistant-composer-actions">
                <div>
                  <input
                    ref={attachmentInputRef}
                    className="ai-assistant-file-input"
                    type="file"
                    multiple
                    aria-label="选择图片或文件"
                    onChange={handleAttachmentSelection}
                  />
                  <Tooltip title="上传图片或文件">
                    <Button
                      type="text"
                      shape="circle"
                      aria-label="上传图片或文件"
                      icon={<PlusOutlined />}
                      disabled={activeConversation.sending}
                      onClick={() => attachmentInputRef.current?.click()}
                    />
                  </Tooltip>
                </div>
                <div className="ai-assistant-composer-submit">
                  <Select
                    className="ai-assistant-effort-select"
                    size="small"
                    aria-label="思考强度"
                    value={activeConversation.reasoningEffort}
                    options={REASONING_EFFORT_OPTIONS}
                    disabled={activeConversation.sending}
                    onChange={(reasoningEffort) =>
                      updateConversation(
                        activeConversation.id,
                        (conversation) => ({
                          ...conversation,
                          reasoningEffort,
                        })
                      )
                    }
                  />
                  <Tooltip title="发送">
                    <Button
                      type="primary"
                      shape="circle"
                      aria-label="发送消息"
                      icon={<ArrowUpOutlined />}
                      disabled={
                        (!activeConversation.draft.trim() &&
                          activeConversation.attachments.length === 0) ||
                        activeConversation.sending
                      }
                      loading={activeConversation.sending}
                      onClick={handleSend}
                    />
                  </Tooltip>
                </div>
              </div>
            </div>
          )}
        </div>
      </Drawer>
    </>
  )
}
