import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { writeFileSync } from 'fs';
import { stashChanges, getCommits, getProjectStatus, batchOperate } from '../src/core/gitService.js';
import { makeTempRoot, initRepo, commitFile, git } from './helpers.js';

// 补充测试：stash、getCommits、批量 stash/pull、错误分支，提升覆盖率与边界保证

describe('stashChanges', () => {
  let ctx;
  beforeEach(() => { ctx = makeTempRoot(); });
  afterEach(() => { ctx.cleanup(); });

  it('stashes uncommitted changes and cleans working tree', async () => {
    const repo = initRepo(join(ctx.root, 'stash'), 'master');
    writeFileSync(join(repo, 'README.md'), '# dirty\n');
    const before = await getProjectStatus(repo);
    expect(before.hasUncommittedChanges).toBe(true);
    const res = await stashChanges(repo);
    expect(res.success).toBe(true);
    const after = await getProjectStatus(repo);
    expect(after.hasUncommittedChanges).toBe(false);
  });

  it('returns error for non-existent repo', async () => {
    const res = await stashChanges(join(ctx.root, 'nope'));
    expect(res.success).toBe(false);
    expect(res.error).toBeTruthy();
  });
});

describe('getCommits', () => {
  let ctx;
  beforeEach(() => { ctx = makeTempRoot(); });
  afterEach(() => { ctx.cleanup(); });

  it('returns commits in reverse chronological order limited by n', async () => {
    const repo = initRepo(join(ctx.root, 'log'), 'master');
    commitFile(repo, 'a.txt', 'a', 'second');
    commitFile(repo, 'b.txt', 'b', 'third');
    const commits = await getCommits(repo, 2);
    expect(commits.length).toBe(2);
    expect(commits[0].message).toBe('third');
    expect(commits[0].hash.length).toBe(9);
    expect(commits[0].author).toBeTruthy();
  });

  it('returns empty array for non-git directory', async () => {
    const { mkdirSync } = await import('fs');
    const dir = join(ctx.root, 'plain');
    mkdirSync(dir, { recursive: true });
    const commits = await getCommits(dir);
    expect(commits).toEqual([]);
  });
});

describe('batchOperate additional operations', () => {
  let ctx;
  beforeEach(() => { ctx = makeTempRoot(); });
  afterEach(() => { ctx.cleanup(); });

  it('runs stash across multiple repos', async () => {
    const r1 = initRepo(join(ctx.root, 's1'), 'master');
    const r2 = initRepo(join(ctx.root, 's2'), 'master');
    writeFileSync(join(r1, 'README.md'), '# d1\n');
    writeFileSync(join(r2, 'README.md'), '# d2\n');
    const results = await batchOperate([r1, r2], 'stash', {});
    expect(results.every((r) => r.success)).toBe(true);
    expect((await getProjectStatus(r1)).hasUncommittedChanges).toBe(false);
  });

  it('throws on unknown operation type', async () => {
    const r1 = initRepo(join(ctx.root, 'u1'), 'master');
    await expect(batchOperate([r1], 'frobnicate', {})).rejects.toThrow(/未知操作类型/);
  });
});
