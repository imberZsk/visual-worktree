import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { makeTempRoot } from './helpers.js';
import {
  archiveTaskDocs,
  buildTaskDocsArchivePath,
  DEFAULT_WORK_DOCUMENT_TEMPLATES,
  ensureTaskDocsAssets,
  normalizeWorkDocumentTemplates,
} from '../src/core/taskDocsService.js';

// taskDocsService 测试：验证新增 worktree 的固定说明文件与工作文档初始化，以及删除任务前的工作文档归档。

describe('taskDocsService', () => {
  // ctx 存储每个用例独立的临时目录上下文。
  let ctx;

  beforeEach(() => {
    ctx = makeTempRoot();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('默认初始化固定说明文件和 docs 工作文档目录', () => {
    // worktreePath 存储模拟的新 worktree 根目录。
    const worktreePath = join(ctx.root, 'worktrees', 'TASK-1', 'projA');
    mkdirSync(worktreePath, { recursive: true });

    // result 存储初始化函数返回的关键文件路径。
    const result = ensureTaskDocsAssets(worktreePath);
    // claudePath 存储固定生成的 Claude 入口说明文件路径。
    const claudePath = join(worktreePath, 'CLAUDE.md');
    // agentsPath 存储固定生成的通用 Agent 说明文件路径。
    const agentsPath = join(worktreePath, 'AGENTS.md');
    // docsPath 存储默认工作文档目录路径。
    const docsPath = join(worktreePath, 'docs');

    expect(existsSync(docsPath)).toBe(true);
    expect(readFileSync(claudePath, 'utf8')).toContain('AGENTS.md');
    expect(readFileSync(agentsPath, 'utf8')).toContain('docs/');
    expect(result.created).toContain(claudePath);
    expect(result.created).toContain(agentsPath);
    expect(result.created).toContain(docsPath);
  });

  it('按模板初始化目录和文件且不覆盖已有文件', () => {
    // worktreePath 存储已存在工作文档文件的 worktree 根目录。
    const worktreePath = join(ctx.root, 'worktrees', 'TASK-2', 'projA');
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(join(worktreePath, 'notes.md'), 'user content');
    writeFileSync(join(worktreePath, 'CLAUDE.md'), 'custom claude');
    writeFileSync(join(worktreePath, 'AGENTS.md'), 'custom agents');
    // templates 存储用户配置的工作文档模板，包含一个目录和两个文件。
    const templates = [
      { type: 'directory', path: 'docs', content: '' },
      { type: 'file', path: 'notes.md', content: 'default notes' },
      { type: 'file', path: '.ai/plan.md', content: '# Plan\n' },
    ];

    const result = ensureTaskDocsAssets(worktreePath, templates);

    expect(existsSync(join(worktreePath, 'docs'))).toBe(true);
    expect(readFileSync(join(worktreePath, 'CLAUDE.md'), 'utf8')).toBe('custom claude');
    expect(readFileSync(join(worktreePath, 'AGENTS.md'), 'utf8')).toBe('custom agents');
    expect(readFileSync(join(worktreePath, 'notes.md'), 'utf8')).toBe('user content');
    expect(readFileSync(join(worktreePath, '.ai', 'plan.md'), 'utf8')).toBe('# Plan\n');
    expect(result.created).toContain(join(worktreePath, 'docs'));
    expect(result.created).toContain(join(worktreePath, '.ai', 'plan.md'));
    expect(result.skipped).toContain(join(worktreePath, 'CLAUDE.md'));
    expect(result.skipped).toContain(join(worktreePath, 'AGENTS.md'));
    expect(result.skipped).toContain(join(worktreePath, 'notes.md'));
  });

  it('过滤空路径、绝对路径和越界路径模板', () => {
    // templates 存储混合有效与危险路径的原始模板。
    const templates = normalizeWorkDocumentTemplates([
      { type: 'directory', path: 'docs', content: '' },
      { type: 'file', path: '../secret.md', content: 'secret' },
      { type: 'file', path: '/tmp/secret.md', content: 'secret' },
      { type: 'file', path: '', content: 'empty' },
      { type: 'file', path: '.ai/plan.md', content: 'plan' },
    ]);

    expect(templates).toEqual([
      { type: 'directory', path: 'docs', content: '' },
      { type: 'file', path: '.ai/plan.md', content: 'plan' },
    ]);
  });

  it('固定说明文件不会作为工作文档模板归档', () => {
    // templates 存储包含固定说明文件的错误配置，核心层应过滤这些路径。
    const templates = normalizeWorkDocumentTemplates([
      { type: 'file', path: 'CLAUDE.md', content: 'claude' },
      { type: 'file', path: 'AGENTS.md', content: 'agents' },
      { type: 'directory', path: 'docs', content: '' },
    ]);

    expect(templates).toEqual([
      { type: 'directory', path: 'docs', content: '' },
    ]);
  });

  it('按模板只归档任务根目录的工作文档', () => {
    // taskDir 存储一个任务目录，根目录工作文档会进入历史记录。
    const taskDir = join(ctx.root, 'worktrees', 'TASK-3');
    // archiveRoot 存储所有历史任务工作文档的归档根目录。
    const archiveRoot = join(ctx.root, 'visualWorktree', 'task-docs');
    // templates 存储要从任务根目录收集的工作文档模板。
    const templates = [
      { type: 'directory', path: 'docs', content: '' },
      { type: 'directory', path: 'records', content: '' },
      { type: 'file', path: '.ai/summary.md', content: '' },
    ];
    mkdirSync(join(taskDir, 'docs'), { recursive: true });
    mkdirSync(join(taskDir, 'records'), { recursive: true });
    mkdirSync(join(taskDir, '.ai'), { recursive: true });
    mkdirSync(join(taskDir, 'projA', 'docs'), { recursive: true });
    writeFileSync(join(taskDir, 'docs', 'task.md'), 'task docs');
    writeFileSync(join(taskDir, 'records', 'record.md'), 'task record');
    writeFileSync(join(taskDir, '.ai', 'summary.md'), 'task summary');
    writeFileSync(join(taskDir, 'projA', 'docs', 'project.md'), 'project docs');

    // result 存储归档结果，包含最终任务工作文档目录；项目级归档数量兼容字段固定为 0。
    const result = archiveTaskDocs(taskDir, 'TASK-3', archiveRoot, templates);

    expect(result.success).toBe(true);
    expect(result.docsPath).toBe(join(archiveRoot, 'TASK-3'));
    expect(result.archivedProjects).toBe(0);
    expect(readFileSync(join(archiveRoot, 'TASK-3', 'task.md'), 'utf8')).toBe('task docs');
    expect(readFileSync(join(archiveRoot, 'TASK-3', 'records', 'record.md'), 'utf8')).toBe('task record');
    expect(readFileSync(join(archiveRoot, 'TASK-3', '.ai', 'summary.md'), 'utf8')).toBe('task summary');
    expect(existsSync(join(archiveRoot, 'TASK-3', 'projA', 'project.md'))).toBe(false);
  });

  it('归档任务根目录工作文档到历史任务归档根', () => {
    // taskDir 存储待删除任务目录，根 docs 是任务级工作记录。
    const taskDir = join(ctx.root, 'worktrees', 'TASK-ROOT-DOCS');
    // archiveRoot 存储所有历史任务工作文档的归档根目录。
    const archiveRoot = join(ctx.root, 'visualWorktree', 'task-docs');
    // templates 存储根目录下要归档的工作文档。
    const templates = [
      ...DEFAULT_WORK_DOCUMENT_TEMPLATES,
      { type: 'file', path: '.ai/root.md', content: '' },
    ];
    mkdirSync(join(taskDir, 'docs'), { recursive: true });
    mkdirSync(join(taskDir, '.ai'), { recursive: true });
    writeFileSync(join(taskDir, 'docs', 'summary.md'), 'root summary');
    writeFileSync(join(taskDir, '.ai', 'root.md'), 'root ai');

    // result 存储归档结果，根工作文档文件应复制到任务归档目录根上。
    const result = archiveTaskDocs(taskDir, 'TASK-ROOT-DOCS', archiveRoot, templates);

    expect(result.success).toBe(true);
    expect(readFileSync(join(archiveRoot, 'TASK-ROOT-DOCS', 'summary.md'), 'utf8')).toBe('root summary');
    expect(readFileSync(join(archiveRoot, 'TASK-ROOT-DOCS', '.ai', 'root.md'), 'utf8')).toBe('root ai');
  });

  it('归档时不收集固定说明文件到历史记录', () => {
    // taskDir 存储待删除任务目录，包含任务级与项目级固定说明文件。
    const taskDir = join(ctx.root, 'worktrees', 'TASK-FIXED-DOCS');
    // archiveRoot 存储所有历史任务工作文档的归档根目录。
    const archiveRoot = join(ctx.root, 'visualWorktree', 'task-docs');
    mkdirSync(join(taskDir, 'docs'), { recursive: true });
    mkdirSync(join(taskDir, 'projA', 'docs'), { recursive: true });
    writeFileSync(join(taskDir, 'CLAUDE.md'), 'task claude');
    writeFileSync(join(taskDir, 'AGENTS.md'), 'task agents');
    writeFileSync(join(taskDir, 'docs', 'summary.md'), 'task summary');
    writeFileSync(join(taskDir, 'projA', 'CLAUDE.md'), 'project claude');
    writeFileSync(join(taskDir, 'projA', 'AGENTS.md'), 'project agents');
    writeFileSync(join(taskDir, 'projA', 'docs', 'note.md'), 'project note');

    // result 存储归档结果，固定说明文件和项目级工作文档都不应出现在历史目录中。
    const result = archiveTaskDocs(taskDir, 'TASK-FIXED-DOCS', archiveRoot);
    // archivedPath 存储当前任务最终归档目录。
    const archivedPath = join(archiveRoot, 'TASK-FIXED-DOCS');

    expect(result.success).toBe(true);
    expect(readFileSync(join(archivedPath, 'summary.md'), 'utf8')).toBe('task summary');
    expect(existsSync(join(archivedPath, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(archivedPath, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(archivedPath, 'projA', 'note.md'))).toBe(false);
    expect(existsSync(join(archivedPath, 'projA', 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(archivedPath, 'projA', 'AGENTS.md'))).toBe(false);
  });

  it('任务名包含路径分隔符时生成可读且安全的归档目录', () => {
    // archiveRoot 存储历史任务 docs 的归档根目录。
    const archiveRoot = join(ctx.root, 'visualWorktree', 'task-docs');

    // archivePath 存储对含斜杠任务名生成的安全归档路径。
    const archivePath = buildTaskDocsArchivePath(archiveRoot, 'feature/TASK-4');

    expect(archivePath).toBe(join(archiveRoot, 'feature__TASK-4'));
  });
});
