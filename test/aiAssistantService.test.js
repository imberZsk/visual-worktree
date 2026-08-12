import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AI_ASSISTANT_API_URL,
  getAiModelSettings,
  sendAiAssistantMessage,
  streamAiAssistantMessage,
  updateAiModelSettings,
} from '../src/core/aiAssistantService.js'

describe('AI model settings', () => {
  it('updates settings without exposing API key in result', async () => {
    // fetchImpl 模拟 FastAPI 模型设置接口并返回脱敏状态。
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'custom-model',
        base_url: 'https://gateway.example.com/v1',
        api_key_configured: true,
      }),
    })

    // result 存储后端返回给 Electron 的安全设置投影。
    const result = await updateAiModelSettings(
      {
        model: 'custom-model',
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'secret-key',
      },
      { fetchImpl }
    )

    expect(fetchImpl).toHaveBeenCalledWith(
      `${DEFAULT_AI_ASSISTANT_API_URL}/settings/model`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          model: 'custom-model',
          base_url: 'https://gateway.example.com/v1',
          clear_api_key: false,
          api_key: 'secret-key',
        }),
      })
    )
    expect(result).toEqual({
      model: 'custom-model',
      baseUrl: 'https://gateway.example.com/v1',
      apiKeyConfigured: true,
    })
    expect(JSON.stringify(result)).not.toContain('secret-key')
  })

  it('reads safe settings projection', async () => {
    // fetchImpl 模拟不返回 Key 明文的设置查询接口。
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'gpt-5.6-sol',
        base_url: '',
        api_key_configured: false,
      }),
    })

    await expect(getAiModelSettings({ fetchImpl })).resolves.toEqual({
      model: 'gpt-5.6-sol',
      baseUrl: '',
      apiKeyConfigured: false,
    })
  })
})

describe('sendAiAssistantMessage', () => {
  it('向 FastAPI 聊天接口发送消息并返回回答', async () => {
    // fetchImpl 模拟 FastAPI 返回成功 JSON 的 HTTP 请求函数。
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ answer: '这是智能体回答' }),
    })

    // answer 存储 HTTP 服务函数返回的最终文本。
    const answer = await sendAiAssistantMessage(' 你好 ', { fetchImpl })

    expect(answer).toBe('这是智能体回答')
    expect(fetchImpl).toHaveBeenCalledWith(
      `${DEFAULT_AI_ASSISTANT_API_URL}/chat`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: '你好' }),
      })
    )
  })

  it('透传 FastAPI 返回的业务错误', async () => {
    // fetchImpl 模拟 FastAPI 返回业务错误的 HTTP 请求函数。
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ detail: '模型服务调用失败' }),
    })

    await expect(sendAiAssistantMessage('你好', { fetchImpl })).rejects.toThrow(
      '模型服务调用失败'
    )
  })

  it('非 JSON 错误响应回退 HTTP 状态提示', async () => {
    // fetchImpl 模拟网关返回无法解析为 JSON 的错误页面。
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })

    await expect(sendAiAssistantMessage('你好', { fetchImpl })).rejects.toThrow(
      'AI 助手后端请求失败（HTTP 503）'
    )
  })

  it('拒绝空白消息且不发送 HTTP 请求', async () => {
    // fetchImpl 记录空白消息是否错误触发了网络请求。
    const fetchImpl = vi.fn()

    await expect(sendAiAssistantMessage('   ', { fetchImpl })).rejects.toThrow(
      '消息不能为空'
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('streamAiAssistantMessage', () => {
  it('逐行解析文本片段并返回完整回答', async () => {
    // encoder 存储将 NDJSON 测试文本编码为响应字节的编码器。
    const encoder = new TextEncoder()
    // responseBody 存储刻意跨行边界切分的模拟网络响应流。
    const responseBody = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"delta","content":"你'))
        controller.enqueue(
          encoder.encode('好"}\n{"type":"delta","content":"！"}\n')
        )
        controller.enqueue(encoder.encode('{"type":"done"}\n'))
        controller.close()
      },
    })
    // fetchImpl 模拟返回 NDJSON 响应体的后端请求函数。
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: responseBody,
    })
    // chunks 存储调用方收到的每个流式文本片段。
    const chunks = []
    // workspace 存储本用例验证透传的安全工作区快照。
    const workspace = {
      projects: [{ name: 'visual-worktree', current_branch: 'main' }],
      tasks: [],
    }

    // answer 存储流式服务拼接出的最终回答。
    const answer = await streamAiAssistantMessage(' 你好 ', {
      fetchImpl,
      workspace,
      onChunk: (chunk) => chunks.push(chunk),
    })

    expect(answer).toBe('你好！')
    expect(chunks).toEqual(['你好', '！'])
    expect(fetchImpl).toHaveBeenCalledWith(
      `${DEFAULT_AI_ASSISTANT_API_URL}/chat/stream`,
      expect.objectContaining({
        body: JSON.stringify({ message: '你好', workspace }),
      })
    )
  })

  it('转发工具事件并携带会话历史和思考强度', async () => {
    // encoder 存储将工具与文本事件编码为响应字节的编码器。
    const encoder = new TextEncoder()
    // responseBody 存储包含工具开始、完成、文本和结束事件的模拟流。
    const responseBody = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            '{"type":"tool_start","name":"get_workspace_summary"}\n' +
              '{"type":"tool_end","name":"get_workspace_summary"}\n' +
              '{"type":"delta","content":"完成"}\n' +
              '{"type":"done","elapsed_ms":12}\n'
          )
        )
        controller.close()
      },
    })
    // fetchImpl 模拟返回完整公开执行事件的后端请求。
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: responseBody,
    })
    // events 存储调用方接收到的全部公开流式事件。
    const events = []
    // history 存储当前 Tab 此前的独立聊天上下文。
    const history = [{ role: 'user', content: '上一问' }]

    await streamAiAssistantMessage('下一问', {
      fetchImpl,
      history,
      reasoningEffort: 'high',
      onEvent: (event) => events.push(event),
    })

    expect(events.map((event) => event.type)).toEqual([
      'tool_start',
      'tool_end',
      'delta',
      'done',
    ])
    expect(fetchImpl).toHaveBeenCalledWith(
      `${DEFAULT_AI_ASSISTANT_API_URL}/chat/stream`,
      expect.objectContaining({
        body: JSON.stringify({
          message: '下一问',
          history,
          reasoning_effort: 'high',
        }),
      })
    )
  })

  it('把流内错误事件转换为稳定异常', async () => {
    // encoder 存储测试错误事件的 UTF-8 编码器。
    const encoder = new TextEncoder()
    // responseBody 存储只包含错误事件的模拟响应流。
    const responseBody = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('{"type":"error","message":"模型服务调用失败"}\n')
        )
        controller.close()
      },
    })
    // fetchImpl 模拟已开始响应但模型随后失败的请求。
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: responseBody,
    })

    await expect(
      streamAiAssistantMessage('你好', { fetchImpl })
    ).rejects.toThrow('模型服务调用失败')
  })
})
