import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { writeFileSync, existsSync } from 'fs';
import {
  checkoutBranch,
  checkoutMainBranch,
  pullUpdates,
  batchOperate,
  getProjectStatus,
} from '../src/core/gitService.js';
import { makeTempRoot, initRepo, makeRemoteAndClone, commitFile, git } from './helpers.js';

// git 写操作与批量操作测试

describe('checkoutBranch', () => {
  let ctx;
  beforeEach(() => { ctx = makeTempRoot(); });
  afterEach(() => { ctx.cleanup(); });

  it('switches to an existing branch', async () => {
    const repo = initRepo(join(ctx.root, 'co'), 'master');
    git(repo, 'branch dev');
    const res = await checkoutBranch(repo, 'dev');
    expect(res.success).toBe(true);
    const status = await getProjectStatus(repo);
    expect(status.currentBranch).toBe('dev');
  });

  it('fails gracefully on dirty working tree without force', async () => {
    const repo = initRepo(join(ctx.root, 'codirty'), 'master');
    git(repo, 'branch dev');
    writeFileSync(join(repo, 'README.md'), '# dirty\n'); // uncommitted change blocks checkout in some cases
    // create conflicting file so checkout would lose data
    git(repo, 'checkout -q dev');
    commitFile(repo, 'README.md', '# dev version\n', 'dev change');
    git(repo, 'checkout -q master');
    writeFileSync(join(repo, 'README.md'), '# local uncommitted\n');
    const res = await checkoutBranch(repo, 'dev');
    expect(res.success).toBe(false);
    expect(res.error).toBeTruthy();
  });
});

describe('checkoutMainBranch（master/main 兜底）', () => {
  let ctx;
  beforeEach(() => { ctx = makeTempRoot(); });
  afterEach(() => { ctx.cleanup(); });

  it('仓库主分支为 master 时切到 master', async () => {
    const repo = initRepo(join(ctx.root, 'm1'), 'master');
    git(repo, 'checkout -q -b feature');
    const res = await checkoutMainBranch(repo, ['master', 'main']);
    expect(res.success).toBe(true);
    expect(res.branch).toBe('master');
    expect((await getProjectStatus(repo)).currentBranch).toBe('master');
  });

  it('仓库主分支为 main（无 master）时兜底切到 main', async () => {
    // 用 main 作默认分支初始化，仓库不存在 master
    const repo = initRepo(join(ctx.root, 'm2'), 'main');
    git(repo, 'checkout -q -b feature');
    const res = await checkoutMainBranch(repo, ['master', 'main']);
    expect(res.success).toBe(true);
    // 不应报 pathspec 'master' did not match，而是兜底切到实际存在的 main
    expect(res.branch).toBe('main');
    expect((await getProjectStatus(repo)).currentBranch).toBe('main');
  });

  it('master 与 main 都存在时按候选顺序优先切 master', async () => {
    const repo = initRepo(join(ctx.root, 'm3'), 'master');
    git(repo, 'branch main');
    git(repo, 'checkout -q -b feature');
    const res = await checkoutMainBranch(repo, ['master', 'main']);
    expect(res.success).toBe(true);
    expect(res.branch).toBe('master');
  });

  it('候选主分支都不存在时返回失败并列出已尝试分支', async () => {
    // 仓库默认分支为 trunk，候选里没有
    const repo = initRepo(join(ctx.root, 'm4'), 'trunk');
    const res = await checkoutMainBranch(repo, ['master', 'main']);
    expect(res.success).toBe(false);
    expect(res.error).toContain('master');
    expect(res.error).toContain('main');
  });
});

describe('pullUpdates', () => {
  let ctx;
  beforeEach(() => { ctx = makeTempRoot(); });
  afterEach(() => { ctx.cleanup(); });

  it('pulls remote commits into local', async () => {
    const base = join(ctx.root, 'pull');
    const { local, seed } = makeRemoteAndClone(base, 'master');
    commitFile(seed, 'new.txt', 'content', 'remote new');
    git(seed, 'push -q origin master');
    const res = await pullUpdates(local);
    expect(res.success).toBe(true);
    expect(existsSync(join(local, 'new.txt'))).toBe(true);
  });
});

describe('batchOperate', () => {
  let ctx;
  beforeEach(() => { ctx = makeTempRoot(); });
  afterEach(() => { ctx.cleanup(); });

  it('runs checkout on multiple repos and reports per-item results', async () => {
    const r1 = initRepo(join(ctx.root, 'b1'), 'master');
    const r2 = initRepo(join(ctx.root, 'b2'), 'master');
    git(r1, 'branch dev');
    git(r2, 'checkout -q -b dev'); // r2 already on dev, target master exists
    const results = await batchOperate(
      [r1, r2],
      'checkout',
      { branch: 'master' },
    );
    expect(results.length).toBe(2);
    expect(results.every((r) => r.success)).toBe(true);
    expect((await getProjectStatus(r1)).currentBranch).toBe('master');
  });

  it('continues after a failure and marks the failed item', async () => {
    const good = initRepo(join(ctx.root, 'good'), 'master');
    git(good, 'branch dev');
    const bad = join(ctx.root, 'bad-nonexistent');
    const results = await batchOperate([good, bad], 'checkout', { branch: 'dev' });
    const goodRes = results.find((r) => r.path === good);
    const badRes = results.find((r) => r.path === bad);
    expect(goodRes.success).toBe(true);
    expect(badRes.success).toBe(false);
  });

  it('reports progress via callback', async () => {
    const r1 = initRepo(join(ctx.root, 'p1'), 'master');
    git(r1, 'branch dev');
    const seen = [];
    await batchOperate([r1], 'checkout', { branch: 'dev' }, (p) => seen.push(p));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1].done).toBe(1);
    expect(seen[seen.length - 1].total).toBe(1);
  });
});
