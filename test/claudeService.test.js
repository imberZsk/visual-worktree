import { describe, it, expect } from 'vitest';
import {
  scanClaudeSessions,
  cwdToProjectDir,
  parseTokenUsage,
  calculateCost,
  usdToCny,
  getSessionsByTask,
  getTasksSummary,
} from '../src/core/claudeService.js';

// Claude Code 对话追踪服务测试：验证会话扫描、token 统计、费用计算等核心逻辑

describe('claudeService', () => {
  describe('cwdToProjectDir', () => {
    it('将 cwd 路径转换为 projects 子目录名', () => {
      // cwd 路径中的斜杠全部替换为连字符，开头添加连字符
      expect(cwdToProjectDir('/Users/alice/workspace')).toBe('-Users-alice-workspace');
      expect(cwdToProjectDir('/tmp/test')).toBe('-tmp-test');
      expect(cwdToProjectDir('/')).toBe('-');
    });

    it('中文路径中的非 ASCII 字符替换为连字符（与 Claude Code 的目录命名规则保持一致）', () => {
      // Claude Code 创建 projects 子目录时把中文等非 ASCII 字符替换为 -
      // 若不做此替换，JSONL 文件路径会对不上，导致 token 统计为 0
      const result = cwdToProjectDir('/Users/alice/worktrees/PROJ-2001-示例任务/web-app');
      // 示例任务 = 4 个中文字符，每个替换为 -
      expect(result).toBe('-Users-alice-worktrees-PROJ-2001------web-app');
    });
  });

  describe('scanClaudeSessions', () => {
    it('遍历 ~/.claude/projects 子目录，扫描主会话 jsonl 并提取元信息', () => {
      // mock 文件系统：模拟 projects 目录结构
      // ~/.claude/projects/
      //   -Users-alice-workspace/
      //     sess1.jsonl   (会话 1)
      //   -Users-alice-work/
      //     sess2.jsonl   (会话 2)
      const projectsDir = '/mock/home/.claude/projects';
      const sess1Path = `${projectsDir}/-Users-alice-workspace/sess1.jsonl`;
      const sess2Path = `${projectsDir}/-Users-alice-work/sess2.jsonl`;
      // sess1Content 为包含 cwd/timestamp/model/user 消息的 jsonl 内容
      const sess1Content = [
        JSON.stringify({ type: 'user', cwd: '/Users/alice/workspace', timestamp: '2026-06-24T10:00:00.000Z', message: { content: '帮我写一个功能' } }),
        JSON.stringify({ type: 'assistant', cwd: '/Users/alice/workspace', timestamp: '2026-06-24T10:00:01.000Z', message: { model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 50 } } }),
      ].join('\n');
      // sess2Content 为另一个会话的 jsonl
      const sess2Content = [
        JSON.stringify({ type: 'user', cwd: '/Users/alice/work', timestamp: '2026-06-23T09:00:00.000Z', message: { content: '修复 bug' } }),
        JSON.stringify({ type: 'assistant', cwd: '/Users/alice/work', timestamp: '2026-06-23T09:00:01.000Z', message: { model: 'claude-opus-4-8', usage: { input_tokens: 200, output_tokens: 80 } } }),
      ].join('\n');

      const mockHomedir = () => '/mock/home';
      const mockExistsSync = (p) => {
        const exist = [
          projectsDir,
          `${projectsDir}/-Users-alice-workspace`,
          `${projectsDir}/-Users-alice-work`,
          sess1Path, sess2Path,
        ];
        return exist.includes(p);
      };
      const mockReaddirSync = (p) => {
        if (p === projectsDir) return ['-Users-alice-workspace', '-Users-alice-work'];
        if (p === `${projectsDir}/-Users-alice-workspace`) return ['sess1.jsonl'];
        if (p === `${projectsDir}/-Users-alice-work`) return ['sess2.jsonl'];
        return [];
      };
      const mockReadFileSync = (p) => {
        if (p === sess1Path) return sess1Content;
        if (p === sess2Path) return sess2Content;
        throw new Error('not found');
      };

      const sessions = scanClaudeSessions({
        homedir: mockHomedir,
        existsSync: mockExistsSync,
        readdirSync: mockReaddirSync,
        readFileSync: mockReadFileSync,
        statSync: () => ({ isDirectory: () => false }),
      });

      // 应扫到 2 个会话
      expect(sessions).toHaveLength(2);
      // 会话字段验证
      const s1 = sessions.find((s) => s.sessionId === 'sess1');
      expect(s1).toBeDefined();
      expect(s1.cwd).toBe('/Users/alice/workspace');
      expect(s1.model).toBe('claude-sonnet-5');
      expect(s1.intent).toBe('帮我写一个功能');
    });

    it('projects 目录不存在时返回空数组', () => {
      const mockHomedir = () => '/mock/home';
      const mockExistsSync = () => false;
      const sessions = scanClaudeSessions({
        homedir: mockHomedir,
        existsSync: mockExistsSync,
      });
      expect(sessions).toEqual([]);
    });
  });

  describe('parseTokenUsage', () => {
    it('从 JSONL 统计 token 用量', () => {
      // mock JSONL 内容：包含 2 条 assistant 消息
      const jsonlContent = `
{"type":"user","message":"请帮忙创建配置"}
{"type":"assistant","message":{"model":"claude-sonnet-5","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":80,"cache_read_input_tokens":20}}}
{"type":"assistant","message":{"model":"claude-sonnet-5","usage":{"input_tokens":200,"output_tokens":100,"cache_creation_input_tokens":0,"cache_read_input_tokens":150}}}
      `.trim();

      const mockExistsSync = () => true;
      const mockReadFileSync = () => jsonlContent;

      const usage = parseTokenUsage('/mock/path.jsonl', {
        existsSync: mockExistsSync,
        readFileSync: mockReadFileSync,
      });

      // 累加结果
      expect(usage).toEqual({
        input: 300,         // 100 + 200
        output: 150,        // 50 + 100
        cacheWrite: 80,     // 80 + 0
        cacheRead: 170,     // 20 + 150
      });
    });

    it('跳过 <synthetic> 合成消息（不计费）', () => {
      const jsonlContent = [
        JSON.stringify({ type: 'assistant', message: { model: '<synthetic>', usage: { input_tokens: 9999, output_tokens: 9999 } } }),
        JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 50 } } }),
      ].join('\n');
      const usage = parseTokenUsage('/mock/path.jsonl', {
        existsSync: () => true,
        readFileSync: () => jsonlContent,
      });
      // 只统计真实模型的消息，synthetic 被跳过
      expect(usage.input).toBe(100);
      expect(usage.output).toBe(50);
    });

    it('文件不存在时返回零用量', () => {
      const mockExistsSync = () => false;
      const usage = parseTokenUsage('/mock/nonexistent.jsonl', {
        existsSync: mockExistsSync,
      });
      expect(usage).toEqual({
        input: 0,
        output: 0,
        cacheWrite: 0,
        cacheRead: 0,
      });
    });

    it('跳过损坏的 JSON 行', () => {
      const jsonlContent = `
{"type":"assistant","message":{"model":"claude-sonnet-5","usage":{"input_tokens":100,"output_tokens":50}}}
{this is broken json
{"type":"assistant","message":{"model":"claude-sonnet-5","usage":{"input_tokens":200,"output_tokens":100}}}
      `.trim();

      const mockExistsSync = () => true;
      const mockReadFileSync = () => jsonlContent;

      const usage = parseTokenUsage('/mock/path.jsonl', {
        existsSync: mockExistsSync,
        readFileSync: mockReadFileSync,
      });

      // 只统计 2 条有效的 assistant 消息
      expect(usage.input).toBe(300);
      expect(usage.output).toBe(150);
    });

    it('同一 message.id 的重复记录只计一次（Claude Code 流式落盘会重复写入同一响应）', () => {
      // WHY：Claude Code 会把同一次 API 响应（同一 message.id）追加成多条 jsonl 记录，
      //      usage 完全相同。若逐行累加会把 token 翻倍，导致展示费用远高于 statusline。
      const jsonlContent = [
        JSON.stringify({ type: 'assistant', message: { id: 'msg_dup', model: 'claude-opus-4-8', usage: { input_tokens: 3845, output_tokens: 81, cache_creation_input_tokens: 276, cache_read_input_tokens: 26259 } } }),
        // 同一 message.id 的重复落盘（usage 完全一致），应被去重
        JSON.stringify({ type: 'assistant', message: { id: 'msg_dup', model: 'claude-opus-4-8', usage: { input_tokens: 3845, output_tokens: 81, cache_creation_input_tokens: 276, cache_read_input_tokens: 26259 } } }),
      ].join('\n');

      const usage = parseTokenUsage('/mock/path.jsonl', {
        existsSync: () => true,
        readFileSync: () => jsonlContent,
      });

      // 去重后只计一次，而非翻倍
      expect(usage).toEqual({ input: 3845, output: 81, cacheWrite: 276, cacheRead: 26259 });
    });

    it('不同 message.id 正常各自计入（不误伤真实的多条响应）', () => {
      const jsonlContent = [
        JSON.stringify({ type: 'assistant', message: { id: 'msg_a', model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 50 } } }),
        JSON.stringify({ type: 'assistant', message: { id: 'msg_b', model: 'claude-sonnet-5', usage: { input_tokens: 200, output_tokens: 100 } } }),
      ].join('\n');

      const usage = parseTokenUsage('/mock/path.jsonl', {
        existsSync: () => true,
        readFileSync: () => jsonlContent,
      });

      // 两条不同响应全部计入
      expect(usage.input).toBe(300);
      expect(usage.output).toBe(150);
    });

    it('无 message.id 的记录不去重、照常各自计入（兼容缺失 id 的旧数据）', () => {
      const jsonlContent = [
        JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 50 } } }),
        JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 50 } } }),
      ].join('\n');

      const usage = parseTokenUsage('/mock/path.jsonl', {
        existsSync: () => true,
        readFileSync: () => jsonlContent,
      });

      // 无 id 无法判定重复，两条都计入
      expect(usage.input).toBe(200);
      expect(usage.output).toBe(100);
    });
  });

  describe('calculateCost', () => {
    it('按 sonnet-5 单价计算（3/15/3.75/0.3，默认档位）', () => {
      // 定价：input $3/M, output $15/M, cacheWrite $3.75/M, cacheRead $0.3/M
      const usage = {
        input: 10000,
        output: 1000,
        cacheWrite: 5000,
        cacheRead: 20000,
      };
      const cost = calculateCost(usage, 'claude-sonnet-5');
      // 预期：10K*3/M + 1K*15/M + 5K*3.75/M + 20K*0.3/M = 0.03+0.015+0.01875+0.006 = 0.06975
      expect(cost).toBeCloseTo(0.06975, 6);
    });

    it('按 opus-4-8 单价计算（5/25/6.25/0.5）', () => {
      const usage = { input: 10000, output: 1000, cacheWrite: 5000, cacheRead: 20000 };
      const cost = calculateCost(usage, 'claude-opus-4-8');
      // 预期：10K*5/M + 1K*25/M + 5K*6.25/M + 20K*0.5/M = 0.05+0.025+0.03125+0.01 = 0.11625
      expect(cost).toBeCloseTo(0.11625, 6);
    });

    it('未知模型回退 Sonnet 默认价', () => {
      const usage = { input: 1000000, output: 0, cacheWrite: 0, cacheRead: 0 };
      // 未知模型按 sonnet 默认价：1M * $3/M = $3
      expect(calculateCost(usage, 'claude-unknown-future')).toBeCloseTo(3, 4);
    });

    it('不传模型时同样用默认价', () => {
      const usage = { input: 1000000, output: 0, cacheWrite: 0, cacheRead: 0 };
      expect(calculateCost(usage)).toBeCloseTo(3, 4);
    });

    it('零用量时费用为 0', () => {
      const usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
      expect(calculateCost(usage, 'claude-sonnet-5')).toBe(0);
    });
  });

  describe('usdToCny', () => {
    it('将美元转换为人民币（汇率 7.2）', () => {
      expect(usdToCny(1)).toBe(7.2);
      expect(usdToCny(0.5)).toBe(3.6);
      expect(usdToCny(0)).toBe(0);
    });
  });

  describe('getSessionsByTask', () => {
    // buildMockDeps：构造用于 getSessionsByTask 测试的 mock 依赖
    function buildMockDeps({ sessions, subagentJsonl = null }) {
      // projectsDir 为 mock projects 根目录
      const projectsDir = '/mock/home/.claude/projects';
      // sessJsonls 映射 sessionId → jsonl 路径
      const sessJsonls = {};
      // sessContents 映射 jsonl 路径 → 内容
      const sessContents = {};
      // projectDirs 映射 projectDir → session list
      const projectDirs = {};

      for (const s of sessions) {
        const projDir = s.projectDir || ('-Users-mock-' + s.cwd.replace(/\//g, '-'));
        const jsonlPath = `${projectsDir}/${projDir}/${s.sessionId}.jsonl`;
        sessJsonls[s.sessionId] = { jsonlPath, projDir };
        // 组装 jsonl 内容：首行是 user 消息（含 cwd、timestamp），后续是 assistant 消息
        const rows = [
          JSON.stringify({ type: 'user', cwd: s.cwd, timestamp: s.createdAt || '2026-06-24T10:00:00.000Z', message: { content: s.intent || '' } }),
          ...(s.userMessages || []).map((txt) => JSON.stringify({ type: 'user', message: { content: txt } })),
          JSON.stringify({ type: 'assistant', message: { ...(s.messageId ? { id: s.messageId } : {}), model: 'claude-sonnet-5', usage: s.usage } }),
        ];
        sessContents[jsonlPath] = rows.join('\n');
        if (!projectDirs[projDir]) projectDirs[projDir] = [];
        projectDirs[projDir].push(s.sessionId + '.jsonl');
      }

      const mockHomedir = () => '/mock/home';
      const mockExistsSync = (p) => {
        if (p === projectsDir) return true;
        // 项目子目录
        if (Object.keys(projectDirs).some((d) => p === `${projectsDir}/${d}`)) return true;
        // jsonl 文件
        if (Object.values(sessContents).length > 0 && Object.keys(sessContents).includes(p)) return true;
        // 任务目录
        if (p.includes('/mock/worktrees/')) return p.endsWith('/task-A') || p.endsWith('/project1');
        // subagent 目录
        if (subagentJsonl && p === subagentJsonl.dir) return true;
        if (subagentJsonl && p === subagentJsonl.path) return true;
        return false;
      };
      const mockReaddirSync = (p) => {
        if (p === projectsDir) return Object.keys(projectDirs);
        for (const [d, files] of Object.entries(projectDirs)) {
          if (p === `${projectsDir}/${d}`) {
            // 若有 subagent 子目录也放进去
            const sessionId = files[0].replace('.jsonl', '');
            if (subagentJsonl && subagentJsonl.dir === `${projectsDir}/${d}/${sessionId}`) {
              return [...files, sessionId];
            }
            return files;
          }
          // subagent 子目录
          if (subagentJsonl && p === subagentJsonl.dir) return [subagentJsonl.name];
        }
        return [];
      };
      const mockReadFileSync = (p) => {
        if (sessContents[p]) return sessContents[p];
        if (subagentJsonl && p === subagentJsonl.path) return subagentJsonl.content;
        throw new Error('not found: ' + p);
      };
      const mockStatSync = (p) => {
        // subagent 目录本身是目录
        if (subagentJsonl && p === subagentJsonl.dir) return { isDirectory: () => true };
        return { isDirectory: () => false };
      };
      const mockRealpathSync = (p) => p;

      return {
        homedir: mockHomedir,
        existsSync: mockExistsSync,
        readdirSync: mockReaddirSync,
        readFileSync: mockReadFileSync,
        statSync: mockStatSync,
        realpathSync: mockRealpathSync,
      };
    }

    it('cwd 在任务目录下时命中', () => {
      const deps = buildMockDeps({
        sessions: [{
          sessionId: 'sess1',
          projectDir: '-mock-worktrees-task-A-project1',
          cwd: '/mock/worktrees/task-A/project1',
          intent: '开发功能',
          createdAt: '2026-06-24T10:00:00.000Z',
          usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 100, cache_read_input_tokens: 2000 },
        }],
      });

      const sessions = getSessionsByTask('task-A', '/mock/worktrees', deps);

      // 应返回 1 个会话，包含 token 用量和费用
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('sess1');
      expect(sessions[0].usage).toMatchObject({ input: 1000, output: 500, cacheWrite: 100, cacheRead: 2000 });
      expect(sessions[0].cost.usd).toBeGreaterThan(0);
      expect(sessions[0].cost.cny).toBeGreaterThan(0);
    });

    it('cwd 不在任务目录下的会话不匹配', () => {
      const deps = buildMockDeps({
        sessions: [{
          sessionId: 'sess-other',
          projectDir: '-other-path',
          cwd: '/other/path',
          intent: '无关任务',
          createdAt: '2026-06-24T10:00:00.000Z',
          usage: { input_tokens: 100, output_tokens: 50 },
        }],
      });

      const sessions = getSessionsByTask('task-A', '/mock/worktrees', deps);
      expect(sessions).toEqual([]);
    });

    it('intent 中包含任务目录路径时命中（cwd 为启动目录）', () => {
      const deps = buildMockDeps({
        sessions: [{
          sessionId: 'sess-intent',
          projectDir: '-Users-alice-workspace',
          cwd: '/Users/alice/workspace',
          // intent 里贴了 worktree 任务目录路径
          intent: '/mock/worktrees/task-A/project1 帮我改下这里',
          createdAt: '2026-06-24T10:00:00.000Z',
          usage: { input_tokens: 500, output_tokens: 200 },
        }],
      });

      const sessions = getSessionsByTask('task-A', '/mock/worktrees', deps);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('sess-intent');
    });

    it('用户文本中含 Jira 链接时命中（多 agent 工作流场景）', () => {
      // 模拟真实场景：cwd=/Users/alice（启动目录），但 slash 命令参数里含 Jira 链接
      const jiraUrl = 'https://issues.example.com/browse/PROJ-1001';
      const deps = buildMockDeps({
        sessions: [{
          sessionId: 'sess-workflow',
          projectDir: '-Users-alice',
          cwd: '/Users/alice',
          intent: '# 功能开发 Team Lead',
          userMessages: [jiraUrl],  // 第二条用户消息含 Jira 链接
          createdAt: '2026-07-01T10:00:00.000Z',
          usage: { input_tokens: 50000, output_tokens: 10000, cache_creation_input_tokens: 100000, cache_read_input_tokens: 500000 },
        }],
      });

      // 任务名含 PROJ-1001，headText 里有 /browse/PROJ-1001
      const sessions = getSessionsByTask('PROJ-1001-订单状态提醒', '/mock/worktrees', deps);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('sess-workflow');
      expect(sessions[0].cost.usd).toBeGreaterThan(0);
    });

    it('仅在用户文本中裸提任务号（无链接）时不命中（防讨论型会话误报）', () => {
      // 当前对话只是讨论 PROJ-1001，没有真正开发，不应被算进该任务费用
      const deps = buildMockDeps({
        sessions: [{
          sessionId: 'sess-discuss',
          projectDir: '-Users-alice-workspace-ai-lab',
          cwd: '/Users/alice/workspace/ai-lab',
          intent: '看看PROJ-1001-订单状态提醒这个任务，有没有产生费用',
          createdAt: '2026-07-02T06:00:00.000Z',
          usage: { input_tokens: 10000, output_tokens: 3000 },
        }],
      });

      const sessions = getSessionsByTask('PROJ-1001-订单状态提醒', '/mock/worktrees', deps);
      // intent 只含裸任务号，不含 /browse/... 链接，不命中
      expect(sessions).toEqual([]);
    });

    it('subagents 的 token 归并到主会话', () => {
      // 主会话 jsonl 有 100 token，subagent jsonl 有 500 token，合并后应为 600
      const subContent = JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-sonnet-5', usage: { input_tokens: 500, output_tokens: 200 } },
      });
      const deps = buildMockDeps({
        sessions: [{
          sessionId: 'sess-main',
          projectDir: '-mock-worktrees-task-A-project1',
          cwd: '/mock/worktrees/task-A/project1',
          intent: '开发功能',
          createdAt: '2026-06-25T10:00:00.000Z',
          usage: { input_tokens: 100, output_tokens: 50 },
        }],
        subagentJsonl: {
          // subagent 目录模拟：~/.claude/projects/<proj>/sess-main/subagent.jsonl
          dir: '/mock/home/.claude/projects/-mock-worktrees-task-A-project1/sess-main',
          path: '/mock/home/.claude/projects/-mock-worktrees-task-A-project1/sess-main/subagent.jsonl',
          name: 'subagent.jsonl',
          content: subContent,
        },
      });

      const sessions = getSessionsByTask('task-A', '/mock/worktrees', deps);
      expect(sessions).toHaveLength(1);
      // 主会话 input=100 + subagent input=500 = 600
      expect(sessions[0].usage.input).toBe(600);
      expect(sessions[0].usage.output).toBe(250);
    });

    it('主会话与 subagent 出现同一 message.id 时跨文件只计一次', () => {
      // WHY：去重集合需在主会话与 subagent 文件间共享，否则同一响应被两个文件各记一次会翻倍。
      // 主会话与 subagent 都含 message.id=msg_shared 的同一响应，另外 subagent 有一条独立响应。
      const mainUsage = { input_tokens: 100, output_tokens: 50 };
      const subContent = [
        // 与主会话重复的同一响应（应被去重）
        JSON.stringify({ type: 'assistant', message: { id: 'msg_shared', model: 'claude-sonnet-5', usage: mainUsage } }),
        // subagent 独有的响应（应计入）
        JSON.stringify({ type: 'assistant', message: { id: 'msg_sub', model: 'claude-sonnet-5', usage: { input_tokens: 500, output_tokens: 200 } } }),
      ].join('\n');
      const deps = buildMockDeps({
        sessions: [{
          sessionId: 'sess-main',
          projectDir: '-mock-worktrees-task-A-project1',
          cwd: '/mock/worktrees/task-A/project1',
          intent: '开发功能',
          createdAt: '2026-06-25T10:00:00.000Z',
          // 主会话这条响应带 message.id=msg_shared
          messageId: 'msg_shared',
          usage: mainUsage,
        }],
        subagentJsonl: {
          dir: '/mock/home/.claude/projects/-mock-worktrees-task-A-project1/sess-main',
          path: '/mock/home/.claude/projects/-mock-worktrees-task-A-project1/sess-main/subagent.jsonl',
          name: 'subagent.jsonl',
          content: subContent,
        },
      });

      const sessions = getSessionsByTask('task-A', '/mock/worktrees', deps);
      expect(sessions).toHaveLength(1);
      // 主会话 msg_shared(100) 计一次 + subagent msg_sub(500) = 600（重复的 msg_shared 不再加）
      expect(sessions[0].usage.input).toBe(600);
      expect(sessions[0].usage.output).toBe(250);
    });
  });

  describe('getTasksSummary', () => {
    it('一次扫描，多任务复用，返回各任务的汇总（无会话时为零）', () => {
      const projectsDir = '/mock/home/.claude/projects';
      const mockHomedir = () => '/mock/home';
      const mockExistsSync = (p) => p === projectsDir;
      const mockReaddirSync = (p) => p === projectsDir ? [] : [];
      const mockReadFileSync = () => { throw new Error('No files'); };

      const summary = getTasksSummary(['task-A', 'task-B'], '/mock/worktrees', {
        homedir: mockHomedir,
        existsSync: mockExistsSync,
        readdirSync: mockReaddirSync,
        readFileSync: mockReadFileSync,
        statSync: () => ({ isDirectory: () => false }),
        realpathSync: (p) => p,
      });

      // 应返回 2 个任务的汇总（无会话时为零用量）
      expect(summary).toHaveProperty('task-A');
      expect(summary).toHaveProperty('task-B');
      expect(summary['task-A'].sessionCount).toBe(0);
      expect(summary['task-B'].sessionCount).toBe(0);
      expect(summary['task-A'].usage).toEqual({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
    });

    it('多个会话的费用与 token 全部累加（跨模型）', () => {
      const projectsDir = '/mock/home/.claude/projects';
      // sess-A1 用 sonnet-5，sess-A2 用 opus-4-8，两个都归属 task-A
      const sess = [
        { id: 'sess-A1', proj: '-mock-worktrees-task-A-p1', cwd: '/mock/worktrees/task-A/p1', model: 'claude-sonnet-5', inp: 10000, out: 1000 },
        { id: 'sess-A2', proj: '-mock-worktrees-task-A-p2', cwd: '/mock/worktrees/task-A/p2', model: 'claude-opus-4-8', inp: 5000, out: 500 },
      ];
      const contents = {};
      const projDirs = {};
      for (const s of sess) {
        const p = `${projectsDir}/${s.proj}/${s.id}.jsonl`;
        contents[p] = JSON.stringify({ type: 'user', cwd: s.cwd, timestamp: '2026-06-24T10:00:00.000Z', message: { content: '任务' } }) + '\n' +
          JSON.stringify({ type: 'assistant', message: { model: s.model, usage: { input_tokens: s.inp, output_tokens: s.out } } });
        projDirs[s.proj] = [`${s.id}.jsonl`];
      }
      const deps = {
        homedir: () => '/mock/home',
        existsSync: (p) => p === projectsDir || !!contents[p] || Object.keys(projDirs).some((d) => p === `${projectsDir}/${d}`) || sess.some((s) => s.cwd === p || p.startsWith(s.cwd + '/')),
        readdirSync: (p) => {
          if (p === projectsDir) return Object.keys(projDirs);
          for (const [d, f] of Object.entries(projDirs)) { if (p === `${projectsDir}/${d}`) return f; }
          return [];
        },
        readFileSync: (p) => { if (contents[p]) return contents[p]; throw new Error('nf'); },
        statSync: () => ({ isDirectory: () => false }),
        realpathSync: (p) => p,
      };

      const summary = getTasksSummary(['task-A'], '/mock/worktrees', deps);
      expect(summary['task-A'].sessionCount).toBe(2);
      expect(summary['task-A'].usage.input).toBe(15000); // 10000 + 5000
      // 费用 = sonnet(10K*3/M+1K*15/M) + opus(5K*5/M+0.5K*25/M) = 0.045 + 0.0375 = 0.0825
      expect(summary['task-A'].cost.usd).toBeCloseTo(0.0825, 4);
    });
  });
});
