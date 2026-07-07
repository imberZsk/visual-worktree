import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import { scanProjects, getWorktrees } from '../src/core/gitService.js';
import { makeTempRoot, initRepo, git } from './helpers.js';

// 扫描目录与 worktree 解析测试

describe('scanProjects', () => {
  let ctx;
  beforeEach(() => {
    ctx = makeTempRoot();
  });
  afterEach(() => {
    ctx.cleanup();
  });

  it('scans only git repos under a directory', async () => {
    initRepo(join(ctx.root, 'repoA'), 'master');
    initRepo(join(ctx.root, 'repoB'), 'main');
    git(join(ctx.root, 'repoB'), 'checkout -q -b dev'); // non-main
    mkdirSync(join(ctx.root, 'not-a-repo'), { recursive: true });
    writeFileSync(join(ctx.root, 'not-a-repo', 'x.txt'), 'x');
    // a loose file at root should be ignored
    writeFileSync(join(ctx.root, 'loose.txt'), 'loose');

    const projects = await scanProjects(ctx.root);
    const names = projects.map((p) => p.name).sort();
    expect(names).toEqual(['repoA', 'repoB']);
    const repoB = projects.find((p) => p.name === 'repoB');
    expect(repoB.currentBranch).toBe('dev');
    expect(repoB.isMainBranch).toBe(false);
  });

  it('respects ignore list', async () => {
    initRepo(join(ctx.root, 'keep'), 'master');
    initRepo(join(ctx.root, 'skip'), 'master');
    const projects = await scanProjects(ctx.root, { ignore: ['skip'] });
    expect(projects.map((p) => p.name)).toEqual(['keep']);
  });

  it('returns empty array for non-existent path', async () => {
    const projects = await scanProjects(join(ctx.root, 'nope'));
    expect(projects).toEqual([]);
  });
});

describe('getWorktrees', () => {
  let ctx;
  beforeEach(() => {
    ctx = makeTempRoot();
  });
  afterEach(() => {
    ctx.cleanup();
  });

  it('lists the main worktree only when no extra worktrees', async () => {
    const repo = initRepo(join(ctx.root, 'solo'), 'master');
    const wts = await getWorktrees(repo);
    expect(wts.length).toBe(1);
    expect(wts[0].branch).toBe('master');
    expect(wts[0].isMain).toBe(true);
  });

  it('parses multiple worktrees with branches', async () => {
    const repo = initRepo(join(ctx.root, 'multi'), 'master');
    const wtPath = join(ctx.root, 'wt-feature');
    git(repo, `worktree add -q -b feature ${wtPath}`);
    const wts = await getWorktrees(repo);
    expect(wts.length).toBe(2);
    const feat = wts.find((w) => w.branch === 'feature');
    expect(feat).toBeTruthy();
    expect(feat.path).toContain('wt-feature');
    expect(feat.isMain).toBe(false);
  });
});
