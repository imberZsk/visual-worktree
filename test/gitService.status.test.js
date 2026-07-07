import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import {
  getProjectStatus,
  isMainBranch,
} from '../src/core/gitService.js';
import { makeTempRoot, initRepo, makeRemoteAndClone, commitFile, git } from './helpers.js';

// 核心 git 服务的状态检测测试。用真实 git 仓库验证 simple-git 行为。

describe('isMainBranch', () => {
  it('recognizes master and main as main branches', () => {
    expect(isMainBranch('master')).toBe(true);
    expect(isMainBranch('main')).toBe(true);
  });

  it('treats feature branches as non-main', () => {
    expect(isMainBranch('feat/x')).toBe(false);
    expect(isMainBranch('dev')).toBe(false);
  });

  it('supports custom main branch names', () => {
    expect(isMainBranch('trunk', ['trunk'])).toBe(true);
    expect(isMainBranch('master', ['trunk'])).toBe(false);
  });
});

describe('getProjectStatus', () => {
  let ctx;
  beforeEach(() => {
    ctx = makeTempRoot();
  });
  afterEach(() => {
    ctx.cleanup();
  });

  it('reports a clean repo on master', async () => {
    const repo = initRepo(join(ctx.root, 'clean'), 'master');
    const status = await getProjectStatus(repo);
    expect(status.name).toBe('clean');
    expect(status.path).toBe(repo);
    expect(status.currentBranch).toBe('master');
    expect(status.isMainBranch).toBe(true);
    expect(status.hasUncommittedChanges).toBe(false);
    expect(status.isGitRepo).toBe(true);
  });

  it('detects a non-main branch', async () => {
    const repo = initRepo(join(ctx.root, 'feat'), 'master');
    git(repo, 'checkout -q -b feat/awesome');
    const status = await getProjectStatus(repo);
    expect(status.currentBranch).toBe('feat/awesome');
    expect(status.isMainBranch).toBe(false);
  });

  it('detects uncommitted changes', async () => {
    const repo = initRepo(join(ctx.root, 'dirty'), 'master');
    commitFile(repo, 'README.md', '# changed\n', 'wont-run'); // committed change
    git(repo, 'checkout -q master');
    // now make a real uncommitted modification
    const { writeFileSync } = await import('fs');
    writeFileSync(join(repo, 'README.md'), '# uncommitted edit\n');
    const status = await getProjectStatus(repo);
    expect(status.hasUncommittedChanges).toBe(true);
    expect(status.changedFiles.length).toBeGreaterThan(0);
  });

  it('detects ahead commits (unpushed)', async () => {
    const { local } = makeRemoteAndClone(join(ctx.root, 'ahead'), 'master');
    commitFile(local, 'a.txt', 'a', 'local commit');
    const status = await getProjectStatus(local);
    expect(status.hasUnpushedCommits).toBe(true);
    expect(status.ahead).toBe(1);
  });

  it('detects behind commits (canPull) after fetch', async () => {
    const base = join(ctx.root, 'behind');
    const { local, seed } = makeRemoteAndClone(base, 'master');
    // advance remote via seed working copy
    commitFile(seed, 'b.txt', 'b', 'remote commit');
    git(seed, 'push -q origin master');
    const status = await getProjectStatus(local, { fetch: true });
    expect(status.behind).toBe(1);
    expect(status.canPull).toBe(true);
    // fetch 成功的仓库不应标记 fetchFailed
    expect(status.fetchFailed).toBe(false);
  });

  // Windows 上 git 对 HTTP 连接失败的处理与 macOS/Linux 不同（可能立即返回成功或不抛出异常），
  // 导致 fetchFailed 无法可靠被设为 true；核心属性「不挂起」在 Windows 上仍满足，跳过该用例。
  it.skipIf(process.platform === 'win32')('fetch 远程不可达时超时回退、标记 fetchFailed 而不挂起', async () => {
    // 克隆出本地仓库后，把 origin 指向一个不可达地址，模拟「连不上远程」
    const base = join(ctx.root, 'unreachable');
    const { local } = makeRemoteAndClone(base, 'master');
    // 指向本机一个不监听的端口 + 不存在路径，使 git fetch 无法完成
    git(local, 'remote set-url origin http://127.0.0.1:9/nonexistent.git');
    // 用很短的超时确保用例快速结束；即便底层 git 卡住，withTimeout 也会让上层返回
    const status = await getProjectStatus(local, { fetch: true, fetchTimeout: 1500 });
    // 关键：函数能正常返回（未挂起），且标记 fetch 失败
    expect(status.fetchFailed).toBe(true);
    // 本地状态仍正常可读
    expect(status.isGitRepo).toBe(true);
    expect(status.currentBranch).toBe('master');
  });

  it('未开启 fetch 时 fetchFailed 恒为 false', async () => {
    const repo = initRepo(join(ctx.root, 'no-fetch'), 'master');
    const status = await getProjectStatus(repo);
    expect(status.fetchFailed).toBe(false);
  });

  it('从 origin remote 推导 GitLab 项目网页地址', async () => {
    // repo 存储带 origin remote 的本地仓库路径。
    const repo = initRepo(join(ctx.root, 'gitlab-remote'), 'master');
    // remoteUrl 存储模拟公司 GitLab 常见的 SSH remote 地址。
    const remoteUrl = 'git@gitlab.example.com:team/sub/proj.git';
    git(repo, `remote add origin ${remoteUrl}`);

    // status 存储核心状态扫描结果，期望其中带上可直接打开的 GitLab 网页地址。
    const status = await getProjectStatus(repo);

    expect(status.remoteUrl).toBe(remoteUrl);
    expect(status.gitlabUrl).toBe('https://gitlab.example.com/team/sub/proj');
  });

  it('returns isGitRepo=false for a non-git directory', async () => {
    const { mkdirSync } = await import('fs');
    const dir = join(ctx.root, 'plain');
    mkdirSync(dir, { recursive: true });
    const status = await getProjectStatus(dir);
    expect(status.isGitRepo).toBe(false);
  });
});
