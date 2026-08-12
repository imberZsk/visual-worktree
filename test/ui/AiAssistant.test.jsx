import React from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AiAssistant from '../../src/ui/components/AiAssistant.tsx'
import { api } from '../../src/ui/api.ts'

describe('AiAssistant', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('通过主进程发送消息并展示智能体回答', async () => {
    // streamListener 存储组件注册的 AI 流式文本监听器。
    let streamListener
    vi.spyOn(api, 'onAiAssistantStreamChunk').mockImplementation((listener) => {
      streamListener = listener
      return vi.fn()
    })
    vi.spyOn(api, 'streamAiAssistantMessage').mockImplementation(
      async ({ requestId }) => {
        streamListener({
          requestId,
          type: 'tool_start',
          name: 'get_workspace_summary',
        })
        streamListener({
          requestId,
          type: 'tool_end',
          name: 'get_workspace_summary',
        })
        streamListener({ requestId, chunk: '可以先' })
        streamListener({ requestId, chunk: '查看项目状态。' })
        return { success: true, answer: '可以先查看项目状态。' }
      }
    )
    render(
      <AiAssistant
        projects={[
          {
            name: 'visual-worktree',
            path: '/private/project',
            currentBranch: 'main',
            isMainBranch: true,
            hasUncommittedChanges: false,
            ahead: 1,
            behind: 0,
          },
        ]}
        worktreeTasks={[
          {
            task: 'feat-ai-assistant',
            path: '/private/worktree',
            worktrees: [
              {
                project: 'visual-worktree',
                branch: 'feat/ai-assistant',
                path: '/private/worktree/visual-worktree',
                hasUncommittedChanges: true,
                ahead: 2,
                behind: 0,
              },
            ],
          },
        ]}
      />
    )
    fireEvent.click(screen.getByLabelText('打开 AI 智能助手'))
    expect(screen.getByText('AI 智能助手')).toBeTruthy()
    // input 存储聊天框文本输入节点。
    const input = screen.getByLabelText('向 AI 智能助手提问')
    fireEvent.change(input, { target: { value: '如何创建 Worktree？' } })
    fireEvent.click(screen.getByLabelText('发送消息'))

    expect(screen.getAllByText('如何创建 Worktree？')).toHaveLength(2)
    expect(input.value).toBe('')
    expect(screen.getByLabelText('AI 智能助手正在回复')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('可以先查看项目状态。')).toBeTruthy()
    })
    expect(screen.getByText('读取工作区摘要')).toBeTruthy()
    expect(screen.getByLabelText('AI 智能助手执行过程')).toBeTruthy()
    expect(api.streamAiAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '如何创建 Worktree？',
        history: [],
        reasoningEffort: 'medium',
        workspace: {
          projects: [
            {
              name: 'visual-worktree',
              current_branch: 'main',
              is_main_branch: true,
              has_uncommitted_changes: false,
              ahead: 1,
              behind: 0,
            },
          ],
          tasks: [
            {
              task: 'feat-ai-assistant',
              worktrees: [
                {
                  project: 'visual-worktree',
                  branch: 'feat/ai-assistant',
                  has_uncommitted_changes: true,
                  ahead: 2,
                  behind: 0,
                },
              ],
            },
          ],
        },
      })
    )
  })

  it('后端请求失败时在会话中展示错误', async () => {
    vi.spyOn(api, 'onAiAssistantStreamChunk').mockReturnValue(vi.fn())
    vi.spyOn(api, 'streamAiAssistantMessage').mockResolvedValue({
      success: false,
      error: '无法连接 AI 后端',
    })
    render(<AiAssistant />)
    fireEvent.click(screen.getByLabelText('打开 AI 智能助手'))
    // input 存储聊天框文本输入节点。
    const input = screen.getByLabelText('向 AI 智能助手提问')
    fireEvent.change(input, { target: { value: '你好' } })
    fireEvent.click(screen.getByLabelText('发送消息'))

    await waitFor(() => {
      expect(screen.getByText('无法连接 AI 后端')).toBeTruthy()
    })
  })

  it('新建对话时保留原聊天并切换到独立空 Tab', async () => {
    vi.spyOn(api, 'onAiAssistantStreamChunk').mockReturnValue(vi.fn())
    vi.spyOn(api, 'streamAiAssistantMessage').mockResolvedValue({
      success: true,
      answer: '这是上一轮回答',
    })
    render(<AiAssistant />)
    fireEvent.click(screen.getByLabelText('打开 AI 智能助手'))
    // input 存储当前对话的消息输入框。
    const input = screen.getByLabelText('向 AI 智能助手提问')
    fireEvent.change(input, { target: { value: '上一轮问题' } })
    fireEvent.click(screen.getByLabelText('发送消息'))

    await waitFor(() => {
      expect(screen.getByText('这是上一轮回答')).toBeTruthy()
    })
    fireEvent.click(screen.getByLabelText('新建对话'))

    expect(screen.getAllByText('上一轮问题')).toHaveLength(1)
    expect(screen.queryByText('这是上一轮回答')).toBeNull()
    expect(screen.getByText('有什么可以帮你？')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: '上一轮问题' }))
    expect(screen.getAllByText('上一轮问题')).toHaveLength(2)
    expect(screen.getByText('这是上一轮回答')).toBeTruthy()
  })

  it('组件卸载时取消 AI 流式事件订阅', () => {
    // unsubscribe 存储预期在组件卸载时执行的取消订阅函数。
    const unsubscribe = vi.fn()
    vi.spyOn(api, 'onAiAssistantStreamChunk').mockReturnValue(unsubscribe)
    // view 存储当前组件测试渲染结果。
    const view = render(<AiAssistant />)

    view.unmount()

    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('选择附件后可移除并随消息发送', async () => {
    vi.spyOn(api, 'onAiAssistantStreamChunk').mockReturnValue(vi.fn())
    vi.spyOn(api, 'streamAiAssistantMessage').mockResolvedValue({
      success: true,
      answer: '已读取附件',
    })
    render(<AiAssistant />)
    fireEvent.click(screen.getByLabelText('打开 AI 智能助手'))
    // attachmentInput 存储隐藏的原生多文件输入框。
    const attachmentInput = screen.getByLabelText('选择图片或文件')
    // imageFile 存储本用例模拟上传的图片附件。
    const imageFile = new File(['image-data'], 'screen.png', {
      type: 'image/png',
    })

    fireEvent.change(attachmentInput, { target: { files: [imageFile] } })
    await waitFor(() => {
      expect(screen.getByText('screen.png')).toBeTruthy()
    })
    expect(screen.getByLabelText('发送消息').disabled).toBe(false)
    fireEvent.click(screen.getByLabelText('发送消息'))

    await waitFor(() => {
      expect(screen.getByText('已读取附件')).toBeTruthy()
    })
    expect(api.streamAiAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '',
        attachments: [
          expect.objectContaining({
            name: 'screen.png',
            media_type: 'image/png',
            data_url: expect.stringMatching(/^data:image\/png;base64,/),
          }),
        ],
      })
    )
  })
})
