import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as configModule from '../src/core/config.js'
import {
  loadConfig,
  saveConfig,
  resetConfig,
  getConfigPaths,
  getWorkflowStepsPaths,
  DEFAULT_CONFIG,
  SWITCH_WORKSPACE_ONLY_FIELD,
} from '../src/core/config.js'
import { makeTempRoot } from './helpers.js'
import { join } from 'path'
import { homedir } from 'os'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { DEFAULT_TASK_STATUSES } from '../src/core/taskStatuses.js'
import { DEFAULT_KANBAN_SETTINGS } from '../src/core/kanbanSettings.js'
import { DEFAULT_TASK_TAGS } from '../src/core/taskTags.js'

// 配置读写测试，使用临时目录避免污染真实用户配置

describe('config', () => {
  let ctx
  beforeEach(() => {
    ctx = makeTempRoot()
  })
  afterEach(() => {
    ctx.cleanup()
  })

  it('returns default config when file absent', () => {
    const cfg = loadConfig(join(ctx.root, 'cfgdir'))
    expect(cfg.onboardingCompleted).toBe(false)
    expect(cfg.mainBranches).toEqual(['master', 'main'])
    expect(cfg.gitlabMergeTargetBranch).toBe('test')
    expect(cfg.sourceProjectsPath).toBe(
      join(homedir(), 'Desktop', 'work', 'projects')
    )
    expect(cfg.worktreesPath).toBe(
      join(homedir(), 'Desktop', 'work', 'worktrees')
    )
    expect(cfg.tokenPricing.directCnyDisplay).toBe(true)
  })

  it('does not show onboarding when an existing user data directory remains', () => {
    // dir 存储没有 config.json、但已由旧版本留下其他数据的配置目录。
    const dir = join(ctx.root, 'cfgdir')
    mkdirSync(dir, { recursive: true })

    // cfg 存储老用户缺少配置文件时加载到的默认配置。
    const cfg = loadConfig(dir)

    expect(cfg.onboardingCompleted).toBe(true)
  })

  it('default config only creates docs as working documents', () => {
    // cfg 存储默认配置，用来验证工作文档默认模板只包含会被归档的 docs 目录。
    const cfg = loadConfig(join(ctx.root, 'cfgdir'))
    expect(cfg.workDocumentTemplates).toEqual([
      { type: 'directory', path: 'docs', content: '' },
    ])
  })

  it('default config includes the existing task status definitions', () => {
    // cfg 存储没有用户配置时的工作区默认设置。
    const cfg = loadConfig(join(ctx.root, 'task-status-label-defaults'))
    expect(cfg.taskStatuses).toEqual(DEFAULT_TASK_STATUSES)
    expect(cfg.kanbanSettings).toEqual(DEFAULT_KANBAN_SETTINGS)
    expect(cfg.taskTags).toEqual(DEFAULT_TASK_TAGS)
  })

  it('persists workspace task category definitions', () => {
    // dir 存储任务分类配置持久化测试的隔离目录。
    const dir = join(ctx.root, 'task-tags')
    // taskTags 存储用户调整后的分类定义。
    const taskTags = [
      { key: 'bug', label: '缺陷', color: 'volcano' },
      { key: 'research', label: '调研', color: 'purple' },
    ]
    saveConfig({ taskTags }, dir)
    expect(loadConfig(dir).taskTags).toEqual(taskTags)
  })

  it('persists workspace-specific kanban column visibility and removes legacy pinned column', () => {
    // dir 存储看板设置持久化测试使用的隔离配置目录。
    const dir = join(ctx.root, 'kanban-settings')
    saveConfig(
      {
        kanbanSettings: {
          hiddenStatusKeys: ['testing'],
          pinnedStatusKey: 'developing',
        },
      },
      dir
    )

    expect(loadConfig(dir).kanbanSettings).toEqual({
      hiddenStatusKeys: ['testing'],
    })
  })

  it('migrates persisted legacy task status labels into dynamic statuses', () => {
    // dir 存储旧版状态标签配置迁移测试使用的隔离目录。
    const dir = join(ctx.root, 'legacy-task-status-labels')
    // file 存储当前配置文件的完整路径。
    const { file } = getConfigPaths(dir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      file,
      JSON.stringify({
        activePathProfileId: 'default',
        pathProfiles: [
          {
            id: 'default',
            name: '工作路径',
            sourceProjectsPath: '/legacy/source',
            worktreesPath: '/legacy/worktrees',
            settings: {
              taskStatusLabels: { developing: '编码中' },
            },
          },
        ],
      }),
      'utf8'
    )

    // cfg 存储迁移后的运行时配置，应只暴露动态状态字段。
    const cfg = loadConfig(dir)
    expect(
      cfg.taskStatuses.find((status) => status.key === 'developing')?.label
    ).toBe('编码中')
    expect(cfg.taskStatusLabels).toBeUndefined()
  })

  it('persists normalized dynamic task statuses inside the active workspace', () => {
    // dir 存储动态任务状态持久化测试使用的隔离配置目录。
    const dir = join(ctx.root, 'task-status-labels')
    // taskStatuses 存储重命名、删除并新增状态后的用户配置。
    const taskStatuses = [
      DEFAULT_TASK_STATUSES[0],
      { ...DEFAULT_TASK_STATUSES[1], label: '  处理中  ' },
      {
        key: 'integrating',
        label: '联调中',
        color: 'magenta',
        kanbanColumn: 'inProgress',
      },
      { ...DEFAULT_TASK_STATUSES.at(-1), label: '已上线' },
    ]
    saveConfig(
      {
        taskStatuses,
      },
      dir
    )

    // savedStatuses 存储重新读取后的完整动态列表，验证顺序、自定义项和标签清洗同时生效。
    const savedStatuses = loadConfig(dir).taskStatuses
    expect(savedStatuses.map((status) => status.key)).toEqual([
      'not-started',
      'developing',
      'integrating',
      'released',
    ])
    expect(savedStatuses[1].label).toBe('处理中')
    expect(savedStatuses.at(-1).label).toBe('已上线')
  })

  it('saves and reloads config', () => {
    const dir = join(ctx.root, 'cfgdir')
    saveConfig({ sourceProjectsPath: '/tmp/x', ignoredProjects: ['a'] }, dir)
    const cfg = loadConfig(dir)
    expect(cfg.sourceProjectsPath).toBe('/tmp/x')
    expect(cfg.ignoredProjects).toEqual(['a'])
    // unspecified fields fall back to defaults
    expect(cfg.mainBranches).toEqual(['master', 'main'])
  })

  it('持久化 GitLab Merge Request 目标分支并清理首尾空白', () => {
    // dir 存储 GitLab MR 目标分支配置测试使用的隔离目录。
    const dir = join(ctx.root, 'gitlab-merge-target')
    saveConfig({ gitlabMergeTargetBranch: '  release/test  ' }, dir)

    expect(loadConfig(dir).gitlabMergeTargetBranch).toBe('release/test')
  })

  it('does not migrate the previous flat config structure', () => {
    // dir 存储本用例的临时配置目录。
    const dir = join(ctx.root, 'cfgdir')
    // file 存储配置文件路径，用于手写旧版配置结构。
    const { file } = getConfigPaths(dir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      file,
      JSON.stringify({
        sourceProjectsPath: '/legacy/source',
        worktreesPath: '/legacy/worktrees',
      }),
      'utf8'
    )

    // cfg 存储读取结果；旧扁平结构不参与新工作区配置迁移。
    const cfg = loadConfig(dir)

    expect(cfg.sourceProjectsPath).toBe(DEFAULT_CONFIG.sourceProjectsPath)
    expect(cfg.onboardingCompleted).toBe(false)
    expect(cfg.worktreesPath).toBe(DEFAULT_CONFIG.worktreesPath)
    expect(cfg.activePathProfileId).toBe('default')
    expect(cfg.pathProfiles).toEqual([
      {
        id: 'default',
        name: '工作路径',
        sourceProjectsPath: DEFAULT_CONFIG.sourceProjectsPath,
        worktreesPath: DEFAULT_CONFIG.worktreesPath,
      },
    ])
  })

  it('saves multiple path profiles and syncs active profile to top-level paths', () => {
    // dir 存储本用例的临时配置目录。
    const dir = join(ctx.root, 'cfgdir')
    // saved 存储保存多套路径组合后的完整配置。
    const saved = saveConfig(
      {
        activePathProfileId: 'personal',
        pathProfiles: [
          {
            id: 'work',
            name: '工作',
            sourceProjectsPath: '/work/source',
            worktreesPath: '/work/worktrees',
          },
          {
            id: 'personal',
            name: '个人',
            sourceProjectsPath: '/personal/source',
            worktreesPath: '/personal/worktrees',
          },
        ],
      },
      dir
    )

    expect(saved.sourceProjectsPath).toBe('/personal/source')
    expect(saved.worktreesPath).toBe('/personal/worktrees')
    expect(loadConfig(dir).sourceProjectsPath).toBe('/personal/source')
    expect(loadConfig(dir).pathProfiles.length).toBe(2)
  })

  it('falls back to default on corrupted file', () => {
    const dir = join(ctx.root, 'cfgdir')
    const { file } = getConfigPaths(dir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, '{not valid json')
    const cfg = loadConfig(dir)
    expect(cfg.onboardingCompleted).toBe(true)
    expect(cfg.mainBranches).toEqual(['master', 'main'])
  })

  it('default config includes a non-empty workflowSteps list', () => {
    // 默认配置应带需求流程步骤清单，使功能开箱即用
    const cfg = loadConfig(join(ctx.root, 'cfgdir'))
    expect(Array.isArray(cfg.workflowSteps)).toBe(true)
    expect(cfg.workflowSteps).toEqual([
      { key: 'requirements', label: '需求确认', command: '' },
      { key: 'implementation', label: '开发实现', command: '' },
      { key: 'verification', label: '测试验证', command: '' },
      { key: 'delivery', label: '提交交付', command: '' },
    ])
    // 每个步骤具备 key/label/command 三要素（command 为可选执行命令，默认空串）
    for (const s of cfg.workflowSteps) {
      expect(s).toMatchObject({
        key: expect.any(String),
        label: expect.any(String),
        command: expect.any(String),
      })
    }
  })

  it('saved workflowSteps override defaults and reload intact', () => {
    const dir = join(ctx.root, 'cfgdir')
    // 自定义两步：一个仅勾选（command 空）、一个配了执行命令
    const custom = [
      { key: 'kickoff', label: '启动', command: '' },
      {
        key: 'push-jira',
        label: '推送 Jira',
        command: './push-jira.sh {branch}',
      },
    ]
    saveConfig({ workflowSteps: custom }, dir)
    const cfg = loadConfig(dir)
    expect(cfg.workflowSteps).toEqual(custom)
  })

  it('saves workflowSteps inside ~/.visualWorktree config and reloads from there', () => {
    const dir = join(ctx.root, 'cfgdir')
    // custom 为用户在「设置 → 流程」里保存的步骤，需与普通配置一起落到统一配置目录
    const custom = [
      { key: 'review', label: '审查方案', command: 'node ./review.js {task}' },
      { key: 'jira', label: '同步 Jira', command: '' },
    ]

    saveConfig({ workflowSteps: custom }, dir)

    const { file } = getConfigPaths(dir)
    expect(getWorkflowStepsPaths(dir).file).toBe(file)
    // diskConfig 存储新的工作区嵌套磁盘结构。
    const diskConfig = JSON.parse(readFileSync(file, 'utf8'))
    expect(diskConfig.pathProfiles[0].settings.workflowSteps).toEqual(custom)
    expect(loadConfig(dir).workflowSteps).toEqual(custom)
  })

  it('preserves workflowSteps when saving unrelated config fields', () => {
    const dir = join(ctx.root, 'cfgdir')
    // custom 为已保存的自定义流程，后续普通设置保存不能把它覆盖回默认值
    const custom = [
      { key: 'review', label: '审查方案', command: 'node ./review.js {task}' },
    ]
    saveConfig({ workflowSteps: custom }, dir)

    saveConfig({ sourceProjectsPath: '/tmp/source-only' }, dir)

    const { file } = getConfigPaths(dir)
    // diskConfig 存储新的工作区嵌套磁盘结构。
    const diskConfig = JSON.parse(readFileSync(file, 'utf8'))
    expect(diskConfig.pathProfiles[0].settings.workflowSteps).toEqual(custom)
    expect(loadConfig(dir).workflowSteps).toEqual(custom)
  })

  it('persists project private workflows and preserves them on unrelated saves', () => {
    const dir = join(ctx.root, 'cfgdir')
    // projectWorkflowSteps 存储按源项目绝对路径隔离的私有流程配置。
    const projectWorkflowSteps = {
      '/src/projA': [
        { key: 'unit-test', label: '项目单测', command: 'pnpm test' },
      ],
    }
    saveConfig({ projectWorkflowSteps }, dir)
    saveConfig({ autoFetch: true }, dir)
    const { file } = getConfigPaths(dir)
    // diskConfig 存储新的工作区嵌套磁盘结构。
    const diskConfig = JSON.parse(readFileSync(file, 'utf8'))
    expect(diskConfig.pathProfiles[0].settings.projectWorkflowSteps).toEqual(
      projectWorkflowSteps
    )
    expect(loadConfig(dir).projectWorkflowSteps).toEqual(projectWorkflowSteps)
  })

  it('resets saved config back to defaults without preserving previous fields', () => {
    // dir 存储本用例的临时配置目录，避免重置真实用户配置。
    const dir = join(ctx.root, 'cfgdir')
    // customSteps 存储用户已自定义的流程步骤，用来验证恢复默认时会被默认步骤覆盖。
    const customSteps = [
      { key: 'custom-review', label: '自定义审查', command: 'npm test' },
    ]
    saveConfig(
      {
        sourceProjectsPath: '/custom/source',
        worktreesPath: '/custom/worktrees',
        mainBranches: ['develop'],
        ignoredProjects: ['legacy'],
        workflowSteps: customSteps,
        cicdLinks: { app: 'https://ci.example.com/app' },
      },
      dir
    )

    expect(configModule.resetConfig).toBeTypeOf('function')
    // resetConfigResult 存储恢复默认设置后返回给调用方的完整默认配置。
    const resetConfigResult = configModule.resetConfig(dir)
    // file 存储配置文件路径，用于验证磁盘内容也已恢复为默认值。
    const { file } = getConfigPaths(dir)
    // diskConfig 存储磁盘上的配置 JSON，验证不是只改了内存返回值。
    const diskConfig = JSON.parse(readFileSync(file, 'utf8'))

    // expectedResetConfig 存储恢复默认后的预期配置；用户已主动操作设置，因此初始化标识保持完成。
    const expectedResetConfig = {
      ...DEFAULT_CONFIG,
      onboardingCompleted: true,
    }
    expect(resetConfigResult).toEqual(expectedResetConfig)
    expect(diskConfig.activePathProfileId).toBe('default')
    expect(diskConfig.pathProfiles).toHaveLength(1)
    expect(diskConfig.pathProfiles[0]).toMatchObject({
      id: 'default',
      sourceProjectsPath: DEFAULT_CONFIG.sourceProjectsPath,
      worktreesPath: DEFAULT_CONFIG.worktreesPath,
      settings: {
        onboardingCompleted: true,
        workflowSteps: DEFAULT_CONFIG.workflowSteps,
      },
    })
    expect(diskConfig.workflowSteps).toBeUndefined()
    expect(loadConfig(dir)).toEqual(expectedResetConfig)
  })

  it('persists paths and complete settings independently for each workspace', () => {
    const dir = join(ctx.root, 'workspace-isolation')
    // pathProfiles 存储两个待隔离的工作区路径元数据。
    const pathProfiles = [
      {
        id: 'work',
        name: '工作',
        sourceProjectsPath: '/work/source',
        worktreesPath: '/work/worktrees',
      },
      {
        id: 'personal',
        name: '个人',
        sourceProjectsPath: '/personal/source',
        worktreesPath: '/personal/worktrees',
      },
    ]
    // workSteps 存储工作区专用流程。
    const workSteps = [{ key: 'work-review', label: '工作审查', command: '' }]
    saveConfig(
      {
        activePathProfileId: 'work',
        pathProfiles,
        sourceProjectsPath: '/work/source',
        worktreesPath: '/work/worktrees',
        workflowSteps: workSteps,
        terminalApp: 'iTerm2',
        ignoredProjects: ['legacy-work'],
        taskStatuses: DEFAULT_TASK_STATUSES.map((status) =>
          status.key === 'developing'
            ? { ...status, label: '编码中' }
            : { ...status }
        ),
      },
      dir
    )

    // personalConfig 存储仅切换后读取到的个人工作区默认设置。
    const personalConfig = saveConfig(
      {
        activePathProfileId: 'personal',
        pathProfiles,
        [SWITCH_WORKSPACE_ONLY_FIELD]: true,
      },
      dir
    )
    expect(personalConfig.workflowSteps).toEqual(DEFAULT_CONFIG.workflowSteps)
    expect(personalConfig.terminalApp).toBe(DEFAULT_CONFIG.terminalApp)
    expect(personalConfig.taskStatuses).toEqual(DEFAULT_TASK_STATUSES)

    // personalSteps 存储个人工作区专用流程。
    const personalSteps = [
      { key: 'personal-test', label: '个人测试', command: 'pnpm test' },
    ]
    saveConfig(
      {
        workflowSteps: personalSteps,
        terminalApp: 'Ghostty',
        ignoredProjects: ['private-archive'],
      },
      dir
    )

    // workConfig 存储切回工作区后的配置，必须恢复工作区原值。
    const workConfig = saveConfig(
      {
        activePathProfileId: 'work',
        pathProfiles,
        [SWITCH_WORKSPACE_ONLY_FIELD]: true,
      },
      dir
    )
    expect(workConfig.sourceProjectsPath).toBe('/work/source')
    expect(workConfig.workflowSteps).toEqual(workSteps)
    expect(workConfig.terminalApp).toBe('iTerm2')
    expect(workConfig.ignoredProjects).toEqual(['legacy-work'])
    expect(
      workConfig.taskStatuses.find((status) => status.key === 'developing')
        ?.label
    ).toBe('编码中')

    // diskConfig 存储两个工作区最终独立落盘的 settings。
    const { file } = getConfigPaths(dir)
    const diskConfig = JSON.parse(readFileSync(file, 'utf8'))
    const workProfile = diskConfig.pathProfiles.find(
      (profile) => profile.id === 'work'
    )
    const personalProfile = diskConfig.pathProfiles.find(
      (profile) => profile.id === 'personal'
    )
    expect(workProfile.settings.workflowSteps).toEqual(workSteps)
    expect(personalProfile.settings.workflowSteps).toEqual(personalSteps)
    expect(personalProfile.settings.ignoredProjects).toEqual([
      'private-archive',
    ])
  })

  it('resets only the active workspace', () => {
    const dir = join(ctx.root, 'workspace-reset')
    // pathProfiles 存储重置隔离测试使用的两个工作区。
    const pathProfiles = [
      {
        id: 'work',
        name: '工作',
        sourceProjectsPath: '/work/source',
        worktreesPath: '/work/worktrees',
      },
      {
        id: 'personal',
        name: '个人',
        sourceProjectsPath: '/personal/source',
        worktreesPath: '/personal/worktrees',
      },
    ]
    saveConfig(
      {
        activePathProfileId: 'work',
        pathProfiles,
        workflowSteps: [{ key: 'keep', label: '保留', command: '' }],
      },
      dir
    )
    saveConfig(
      {
        activePathProfileId: 'personal',
        pathProfiles,
        [SWITCH_WORKSPACE_ONLY_FIELD]: true,
      },
      dir
    )
    saveConfig(
      {
        workflowSteps: [{ key: 'reset', label: '待重置', command: '' }],
      },
      dir
    )
    resetConfig(dir)

    // workConfig 存储切回工作区后的配置，用于确认另一个工作区未被重置。
    const workConfig = saveConfig(
      {
        activePathProfileId: 'work',
        pathProfiles,
        [SWITCH_WORKSPACE_ONLY_FIELD]: true,
      },
      dir
    )
    expect(workConfig.workflowSteps).toEqual([
      { key: 'keep', label: '保留', command: '' },
    ])
    expect(workConfig.sourceProjectsPath).toBe('/work/source')
  })

  it('default config dir is unified ~/.visualWorktree (no hyphen)', () => {
    // 默认配置目录统一到 .visualWorktree，与 task-status/links/workflow 同目录
    const { dir, file } = getConfigPaths()
    // 归一化为正斜杠再断言：Windows 下 path.join 返回反斜杠，endsWith('/.visualWorktree') 会失败
    expect(dir.replace(/\\/g, '/').endsWith('/.visualWorktree')).toBe(true)
    expect(
      file.replace(/\\/g, '/').endsWith('/.visualWorktree/config.json')
    ).toBe(true)
    // 不再使用带连字符的旧目录名
    expect(dir.includes('.visual-worktree')).toBe(false)
  })

  it('saves and reloads custom token pricing', () => {
    // dir 存储本用例的独立配置目录。
    const dir = join(ctx.root, 'token-pricing-config')
    // tokenPricing 存储用户配置的统一 Token 计价规则。
    const tokenPricing = {
      enabled: true,
      input: 1.25,
      output: 6.5,
      cacheWrite: 2,
      cacheRead: 0.2,
      multiplier: 1,
      models: [
        {
          model: 'gpt-5.6-sol',
          input: 5,
          output: 30,
          cacheWrite: 0,
          cacheRead: 0.5,
          multiplier: 0.3,
        },
      ],
      usdToCny: 7.35,
      directCnyDisplay: true,
    }
    saveConfig(
      {
        tokenPricing,
        tokenPricingByTool: { codex: tokenPricing },
        aiUsageTool: 'codex',
        aiUsageTools: ['codex'],
      },
      dir
    )
    expect(loadConfig(dir).tokenPricing).toEqual(tokenPricing)
    expect(loadConfig(dir).aiUsageTool).toBe('codex')
    expect(loadConfig(dir).aiUsageTools).toEqual(['codex'])
    expect(loadConfig(dir).tokenPricingByTool.codex).toEqual(tokenPricing)
  })

  it('旧版单选统计工具和统一单价迁移到原工具', () => {
    // dir 存储旧版配置迁移测试的独立目录。
    const dir = join(ctx.root, 'legacy-token-pricing-config')
    // legacyPricing 存储旧版 Codex 单套计价配置。
    const legacyPricing = {
      enabled: true,
      input: 1,
      output: 2,
      cacheWrite: 3,
      cacheRead: 4,
      usdToCny: 1,
      directCnyDisplay: true,
    }

    saveConfig({ tokenPricing: legacyPricing, aiUsageTool: 'codex' }, dir)
    // migratedConfig 存储重新加载并完成兼容迁移后的配置。
    const migratedConfig = loadConfig(dir)

    expect(migratedConfig.aiUsageTools).toEqual(['codex'])
    expect(migratedConfig.tokenPricingByTool.codex).toEqual({
      ...legacyPricing,
      multiplier: 1,
      models: [],
    })
  })

  it('保存后保留任务绑定的 API key 专属模型价格', () => {
    // dir 存储任务级价格覆盖持久化测试的独立目录。
    const dir = join(ctx.root, 'task-pricing-overrides-config')
    // taskPricingOverrides 存储同模型不同 API key 的任务专属价格。
    const taskPricingOverrides = {
      测试价格3: {
        models: [
          {
            model: 'claude-sonnet-5',
            input: 2,
            output: 10,
            cacheWrite: 2.5,
            cacheRead: 0.2,
            multiplier: 0.4,
          },
        ],
      },
    }

    saveConfig(
      {
        tokenPricingByTool: {
          'claude-code': {
            enabled: true,
            taskPricingOverrides,
          },
        },
      },
      dir
    )

    expect(
      loadConfig(dir).tokenPricingByTool['claude-code'].taskPricingOverrides
    ).toEqual(taskPricingOverrides)
  })
})
