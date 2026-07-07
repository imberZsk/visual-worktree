import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as configModule from '../src/core/config.js';
import { loadConfig, saveConfig, getConfigPaths, getWorkflowStepsPaths, DEFAULT_CONFIG } from '../src/core/config.js';
import { makeTempRoot } from './helpers.js';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

// 配置读写测试，使用临时目录避免污染真实用户配置

describe('config', () => {
  let ctx;
  beforeEach(() => { ctx = makeTempRoot(); });
  afterEach(() => { ctx.cleanup(); });

  it('returns default config when file absent', () => {
    const cfg = loadConfig(join(ctx.root, 'cfgdir'));
    expect(cfg.mainBranches).toEqual(['master', 'main']);
    expect(cfg.sourceProjectsPath).toBe(DEFAULT_CONFIG.sourceProjectsPath);
  });

  it('default config only creates docs as working documents', () => {
    // cfg 存储默认配置，用来验证工作文档默认模板只包含会被归档的 docs 目录。
    const cfg = loadConfig(join(ctx.root, 'cfgdir'));
    expect(cfg.workDocumentTemplates).toEqual([
      { type: 'directory', path: 'docs', content: '' },
    ]);
  });

  it('saves and reloads config', () => {
    const dir = join(ctx.root, 'cfgdir');
    saveConfig({ sourceProjectsPath: '/tmp/x', ignoredProjects: ['a'] }, dir);
    const cfg = loadConfig(dir);
    expect(cfg.sourceProjectsPath).toBe('/tmp/x');
    expect(cfg.ignoredProjects).toEqual(['a']);
    // unspecified fields fall back to defaults
    expect(cfg.mainBranches).toEqual(['master', 'main']);
  });

  it('falls back to default on corrupted file', () => {
    const dir = join(ctx.root, 'cfgdir');
    const { file } = getConfigPaths(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, '{not valid json');
    const cfg = loadConfig(dir);
    expect(cfg.mainBranches).toEqual(['master', 'main']);
  });

  it('default config includes a non-empty workflowSteps list', () => {
    // 默认配置应带需求流程步骤清单，使功能开箱即用
    const cfg = loadConfig(join(ctx.root, 'cfgdir'));
    expect(Array.isArray(cfg.workflowSteps)).toBe(true);
    expect(cfg.workflowSteps.length).toBeGreaterThan(0);
    // 每个步骤具备 key/label/command 三要素（command 为可选执行命令，默认空串）
    for (const s of cfg.workflowSteps) {
      expect(s).toMatchObject({ key: expect.any(String), label: expect.any(String), command: expect.any(String) });
    }
  });

  it('saved workflowSteps override defaults and reload intact', () => {
    const dir = join(ctx.root, 'cfgdir');
    // 自定义两步：一个仅勾选（command 空）、一个配了执行命令
    const custom = [
      { key: 'kickoff', label: '启动', command: '' },
      { key: 'push-jira', label: '推送 Jira', command: './push-jira.sh {branch}' },
    ];
    saveConfig({ workflowSteps: custom }, dir);
    const cfg = loadConfig(dir);
    expect(cfg.workflowSteps).toEqual(custom);
  });

  it('saves workflowSteps inside ~/.visualWorktree config and reloads from there', () => {
    const dir = join(ctx.root, 'cfgdir');
    // custom 为用户在「设置 → 流程」里保存的步骤，需与普通配置一起落到统一配置目录
    const custom = [
      { key: 'review', label: '审查方案', command: 'node ./review.js {task}' },
      { key: 'jira', label: '同步 Jira', command: '' },
    ];

    saveConfig({ workflowSteps: custom }, dir);

    const { file } = getConfigPaths(dir);
    expect(getWorkflowStepsPaths(dir).file).toBe(file);
    expect(JSON.parse(readFileSync(file, 'utf8')).workflowSteps).toEqual(custom);
    expect(loadConfig(dir).workflowSteps).toEqual(custom);
  });

  it('preserves workflowSteps when saving unrelated config fields', () => {
    const dir = join(ctx.root, 'cfgdir');
    // custom 为已保存的自定义流程，后续普通设置保存不能把它覆盖回默认值
    const custom = [
      { key: 'review', label: '审查方案', command: 'node ./review.js {task}' },
    ];
    saveConfig({ workflowSteps: custom }, dir);

    saveConfig({ sourceProjectsPath: '/tmp/source-only' }, dir);

    const { file } = getConfigPaths(dir);
    expect(JSON.parse(readFileSync(file, 'utf8')).workflowSteps).toEqual(custom);
    expect(loadConfig(dir).workflowSteps).toEqual(custom);
  });

  it('resets saved config back to defaults without preserving previous fields', () => {
    // dir 存储本用例的临时配置目录，避免重置真实用户配置。
    const dir = join(ctx.root, 'cfgdir');
    // customSteps 存储用户已自定义的流程步骤，用来验证恢复默认时会被默认步骤覆盖。
    const customSteps = [
      { key: 'custom-review', label: '自定义审查', command: 'npm test' },
    ];
    saveConfig({
      sourceProjectsPath: '/custom/source',
      worktreesPath: '/custom/worktrees',
      mainBranches: ['develop'],
      ignoredProjects: ['legacy'],
      workflowSteps: customSteps,
      cicdLinks: { app: 'https://ci.example.com/app' },
    }, dir);

    expect(configModule.resetConfig).toBeTypeOf('function');
    // resetConfigResult 存储恢复默认设置后返回给调用方的完整默认配置。
    const resetConfigResult = configModule.resetConfig(dir);
    // file 存储配置文件路径，用于验证磁盘内容也已恢复为默认值。
    const { file } = getConfigPaths(dir);
    // diskConfig 存储磁盘上的配置 JSON，验证不是只改了内存返回值。
    const diskConfig = JSON.parse(readFileSync(file, 'utf8'));

    expect(resetConfigResult).toEqual(DEFAULT_CONFIG);
    expect(diskConfig).toEqual(DEFAULT_CONFIG);
    expect(loadConfig(dir)).toEqual(DEFAULT_CONFIG);
  });

  it('default config dir is unified ~/.visualWorktree (no hyphen)', () => {
    // 默认配置目录统一到 .visualWorktree，与 task-status/links/workflow 同目录
    const { dir, file } = getConfigPaths();
    // 归一化为正斜杠再断言：Windows 下 path.join 返回反斜杠，endsWith('/.visualWorktree') 会失败
    expect(dir.replace(/\\/g, '/').endsWith('/.visualWorktree')).toBe(true);
    expect(file.replace(/\\/g, '/').endsWith('/.visualWorktree/config.json')).toBe(true);
    // 不再使用带连字符的旧目录名
    expect(dir.includes('.visual-worktree')).toBe(false);
  });
});
