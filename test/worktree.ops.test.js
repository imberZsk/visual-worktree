import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { existsSync, writeFileSync, mkdirSync, lstatSync, realpathSync, rmSync, readFileSync } from 'fs';
import {
  addWorktree,
  removeWorktree,
  pruneWorktrees,
  batchAddWorktree,
  getWorktrees,
  linkNodeModules,
  unlinkNodeModules,
} from '../src/core/gitService.js';
import { makeTempRoot, initRepo, git, makeRemoteAndClone, commitFile } from './helpers.js';

// worktree 增删 / prune / 批量创建测试

describe('addWorktree', () => {
  let ctx;
  beforeEach(() => { ctx = makeTempRoot(); });
  afterEach(() => ctx.cleanup());

  it('creates a worktree with a new branch', async () => {
    const repo = initRepo(join(ctx.root, 'projA'), 'master');
    const target = join(ctx.root, 'worktrees', 'TASK-1', 'projA');
    const res = await addWorktree(repo, target, 'feat/new', { newBranch: true });
    expect(res.success).toBe(true);
    expect(existsSync(target)).toBe(true);
    const wts = await getWorktrees(repo);
    expect(wts.some((w) => w.branch === 'feat/new')).toBe(true);
  });

  it('creates a worktree from an existing branch', async () => {
    const repo = initRepo(join(ctx.root, 'projB'), 'master');
    git(repo, 'branch existing');
    const target = join(ctx.root, 'worktrees', 'TASK-2', 'projB');
    const res = await addWorktree(repo, target, 'existing');
    expect(res.success).toBe(true);
    expect(existsSync(target)).toBe(true);
  });

  it('uses an existing branch even when that branch is already checked out by the source worktree', async () => {
    // repo 存储当前测试用的源仓库路径
    const repo = initRepo(join(ctx.root, 'projBranchUsed'), 'master');
    git(repo, 'checkout -q -b feat/in-use');
    // target 存储要新建的 worktree 目标路径
    const target = join(ctx.root, 'worktrees', 'TASK-IN-USE', 'projBranchUsed');
    // res 存储 addWorktree 对已被源工作区占用分支的创建结果
    const res = await addWorktree(repo, target, 'feat/in-use');
    expect(res.success).toBe(true);
    expect(existsSync(target)).toBe(true);
    // wts 存储当前仓库登记在册的 worktree 列表
    const wts = await getWorktrees(repo);
    expect(wts.some((w) => w.path === realpathSync(target) && w.branch === 'feat/in-use')).toBe(true);
  });

  it('reuses an existing worktree at the same path (idempotent) instead of failing', async () => {
    const repo = initRepo(join(ctx.root, 'projC'), 'master');
    const target = join(ctx.root, 'worktrees', 'TASK-3', 'projC');
    await addWorktree(repo, target, 'feat/a', { newBranch: true });
    // 第二次用同路径：目标已是合法 worktree，应幂等复用而非报失败
    const res = await addWorktree(repo, target, 'feat/b', { newBranch: true });
    expect(res.success).toBe(true);
    expect(res.reused).toBe(true);
  });

  it('创建 worktree 后默认初始化固定说明文件和 docs 工作文档目录', async () => {
    // repo 存储源项目路径。
    const repo = initRepo(join(ctx.root, 'projDocs'), 'master');
    // target 存储新建 worktree 的目标路径。
    const target = join(ctx.root, 'worktrees', 'TASK-DOCS', 'projDocs');

    // res 存储 addWorktree 创建结果。
    const res = await addWorktree(repo, target, 'feat/docs', { newBranch: true });

    expect(res.success).toBe(true);
    expect(existsSync(join(target, 'docs'))).toBe(true);
    expect(readFileSync(join(target, 'CLAUDE.md'), 'utf8')).toContain('AGENTS.md');
    expect(readFileSync(join(target, 'AGENTS.md'), 'utf8')).toContain('docs/');
  });

  it('工作文档不阻塞干净 worktree 的安全删除', async () => {
    // repo 存储源项目路径。
    const repo = initRepo(join(ctx.root, 'projCleanRemoveDocs'), 'master');
    // target 存储带自动工作文档的新 worktree 路径。
    const target = join(ctx.root, 'worktrees', 'TASK-CLEAN-REMOVE-DOCS', 'projCleanRemoveDocs');
    await addWorktree(repo, target, 'feat/clean-remove-docs', { newBranch: true });

    // res 存储非 force 删除结果；自动生成工作文档应被 git 忽略，不应导致 dirty 拦截。
    const res = await removeWorktree(repo, target);

    expect(res.success).toBe(true);
    expect(existsSync(target)).toBe(false);
  });

  it('复用已有 worktree 时补齐缺失的工作文档', async () => {
    // repo 存储源项目路径。
    const repo = initRepo(join(ctx.root, 'projReuseDocs'), 'master');
    // target 存储要复用的 worktree 目标路径。
    const target = join(ctx.root, 'worktrees', 'TASK-REUSE-DOCS', 'projReuseDocs');
    await addWorktree(repo, target, 'feat/reuse-docs', { newBranch: true });
    rmSync(join(target, 'docs'), { recursive: true, force: true });
    rmSync(join(target, 'CLAUDE.md'), { force: true });
    rmSync(join(target, 'AGENTS.md'), { force: true });

    // res 存储第二次同路径创建的幂等复用结果。
    const res = await addWorktree(repo, target, 'feat/reuse-docs', { newBranch: true });

    expect(res.success).toBe(true);
    expect(res.reused).toBe(true);
    expect(existsSync(join(target, 'docs'))).toBe(true);
    expect(existsSync(join(target, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(target, 'AGENTS.md'))).toBe(true);
  });

  it('创建 worktree 时按自定义工作文档模板初始化文件内容', async () => {
    // repo 存储源项目路径。
    const repo = initRepo(join(ctx.root, 'projCustomDocs'), 'master');
    // target 存储新建 worktree 的目标路径。
    const target = join(ctx.root, 'worktrees', 'TASK-CUSTOM-DOCS', 'projCustomDocs');
    // workDocumentTemplates 存储用户设置里的工作文档模板，包含目录和文件。
    const workDocumentTemplates = [
      { type: 'directory', path: 'records', content: '' },
      { type: 'file', path: '.ai/notes.md', content: '# Notes\n' },
    ];

    // res 存储 addWorktree 创建结果。
    const res = await addWorktree(repo, target, 'feat/custom-docs', { newBranch: true, workDocumentTemplates });

    expect(res.success).toBe(true);
    expect(existsSync(join(target, 'records'))).toBe(true);
    expect(readFileSync(join(target, '.ai', 'notes.md'), 'utf8')).toBe('# Notes\n');
  });

  it('新建分支基于主分支 master 而非源仓库当前所在分支（如 test）', async () => {
    // repo 源仓库，初始在 master
    const repo = initRepo(join(ctx.root, 'projMain'), 'master');
    // 在 test 分支上追加一个仅属于 test 的提交，制造与 master 的差异
    git(repo, 'checkout -q -b test');
    writeFileSync(join(repo, 'only-on-test.txt'), 'x');
    git(repo, 'add -A');
    git(repo, 'commit -q -m "test-only commit"');
    // testHead test 分支的 HEAD 提交哈希，用于断言新分支不应基于它
    const testHead = git(repo, 'rev-parse HEAD').trim();
    // masterHead master 分支的 HEAD 提交哈希，新分支应基于它
    const masterHead = git(repo, 'rev-parse master').trim();
    // 源仓库此刻仍停在 test 分支，模拟用户从 test worktree 发起创建
    const target = join(ctx.root, 'worktrees', 'TASK-MAIN', 'projMain');
    const res = await addWorktree(repo, target, 'feat/from-main', { newBranch: true });
    expect(res.success).toBe(true);
    // newHead 新建 worktree 的 HEAD：应等于 master 而非 test
    const newHead = git(target, 'rev-parse HEAD').trim();
    expect(newHead).toBe(masterHead);
    expect(newHead).not.toBe(testHead);
  });

  it('新建分支按配置的 mainBranches 解析起点（仓库用 main 而非 master）', async () => {
    // repo 源仓库默认分支为 main
    const repo = initRepo(join(ctx.root, 'projMainOnly'), 'main');
    // 切到非主分支并制造差异提交
    git(repo, 'checkout -q -b feature-x');
    writeFileSync(join(repo, 'only-on-feature.txt'), 'y');
    git(repo, 'add -A');
    git(repo, 'commit -q -m "feature commit"');
    // mainHead main 分支 HEAD，期望新分支基于它
    const mainHead = git(repo, 'rev-parse main').trim();
    const target = join(ctx.root, 'worktrees', 'TASK-MAIN2', 'projMainOnly');
    // 显式传入候选主分支 master/main，应命中实际存在的 main
    const res = await addWorktree(repo, target, 'feat/from-main2', { newBranch: true, mainBranches: ['master', 'main'] });
    expect(res.success).toBe(true);
    expect(git(target, 'rev-parse HEAD').trim()).toBe(mainHead);
  });

  it('新建分支前自动 fetch 主分支，起点为远程最新主分支提交', async () => {
    // 构造 remote + 本地克隆：local 即源仓库
    const { remote, local, seed } = makeRemoteAndClone(join(ctx.root, 'fetchcase'), 'master');
    // 克隆后，在 seed 工作区向远程 master 追加一个新提交（模拟克隆后远程主分支前进）
    commitFile(seed, 'new-on-remote.txt', 'remote-update', 'remote master advance');
    git(seed, 'push -q origin master');
    // remoteHead 远程 master 最新提交，期望新分支 fetch 后基于它
    const remoteHead = git(seed, 'rev-parse master').trim();
    // 本地克隆此刻的 origin/master 仍是旧提交，验证确实落后
    const localOriginHeadBefore = git(local, 'rev-parse origin/master').trim();
    expect(localOriginHeadBefore).not.toBe(remoteHead);
    const target = join(ctx.root, 'fetchcase', 'worktrees', 'TASK-FETCH', 'local');
    // fetchMain 默认开启：应先 fetch origin master 再以其最新提交为起点
    const res = await addWorktree(local, target, 'feat/fetched', { newBranch: true });
    expect(res.success).toBe(true);
    expect(git(target, 'rev-parse HEAD').trim()).toBe(remoteHead);
  });

  it('fetchMain:false 时不 fetch，起点回退本地已有的远程引用', async () => {
    // 构造 remote + 本地克隆
    const { local, seed } = makeRemoteAndClone(join(ctx.root, 'nofetchcase'), 'master');
    // 远程 master 前进，但本地不 fetch
    commitFile(seed, 'new2.txt', 'x', 'remote advance 2');
    git(seed, 'push -q origin master');
    const remoteHead = git(seed, 'rev-parse master').trim();
    // localOriginHead 本地克隆已有的 origin/master（旧提交）
    const localOriginHead = git(local, 'rev-parse origin/master').trim();
    const target = join(ctx.root, 'nofetchcase', 'worktrees', 'TASK-NOFETCH', 'local');
    // 关闭 fetchMain：起点应为本地旧的 origin/master，而非远程最新
    const res = await addWorktree(local, target, 'feat/nofetch', { newBranch: true, fetchMain: false });
    expect(res.success).toBe(true);
    expect(git(target, 'rev-parse HEAD').trim()).toBe(localOriginHead);
    expect(git(target, 'rev-parse HEAD').trim()).not.toBe(remoteHead);
  });
});

describe('removeWorktree', () => {
  let ctx;
  beforeEach(() => { ctx = makeTempRoot(); });
  afterEach(() => ctx.cleanup());

  it('removes a clean worktree', async () => {
    const repo = initRepo(join(ctx.root, 'projA'), 'master');
    const target = join(ctx.root, 'worktrees', 'TASK-1', 'projA');
    await addWorktree(repo, target, 'feat/x', { newBranch: true });
    const res = await removeWorktree(repo, target);
    expect(res.success).toBe(true);
    expect(existsSync(target)).toBe(false);
  });

  it('refuses to remove a dirty worktree without force', async () => {
    const repo = initRepo(join(ctx.root, 'projB'), 'master');
    const target = join(ctx.root, 'worktrees', 'TASK-2', 'projB');
    await addWorktree(repo, target, 'feat/y', { newBranch: true });
    // 在 worktree 内制造未提交变更
    writeFileSync(join(target, 'dirty.txt'), 'uncommitted');
    const res = await removeWorktree(repo, target);
    expect(res.success).toBe(false);
    // 目录仍存在
    expect(existsSync(target)).toBe(true);
  });

  it('removes a dirty worktree with force', async () => {
    const repo = initRepo(join(ctx.root, 'projC'), 'master');
    const target = join(ctx.root, 'worktrees', 'TASK-3', 'projC');
    await addWorktree(repo, target, 'feat/z', { newBranch: true });
    writeFileSync(join(target, 'dirty.txt'), 'uncommitted');
    const res = await removeWorktree(repo, target, { force: true });
    expect(res.success).toBe(true);
    expect(existsSync(target)).toBe(false);
  });
});

describe('pruneWorktrees', () => {
  let ctx;
  beforeEach(() => { ctx = makeTempRoot(); });
  afterEach(() => ctx.cleanup());

  it('prunes worktrees whose directories were removed manually', async () => {
    const repo = initRepo(join(ctx.root, 'projA'), 'master');
    const target = join(ctx.root, 'worktrees', 'TASK-1', 'projA');
    await addWorktree(repo, target, 'feat/p', { newBranch: true });
    // 手动删除 worktree 目录，制造 prunable 状态
    const { rmSync } = await import('fs');
    rmSync(target, { recursive: true, force: true });
    const res = await pruneWorktrees(repo);
    expect(res.success).toBe(true);
    // prune 后该 worktree 不再出现在列表
    const wts = await getWorktrees(repo);
    expect(wts.some((w) => w.path === target)).toBe(false);
  });
});

describe('batchAddWorktree', () => {
  let ctx;
  beforeEach(() => { ctx = makeTempRoot(); });
  afterEach(() => ctx.cleanup());

  it('creates worktrees for multiple projects under one task dir', async () => {
    const projA = initRepo(join(ctx.root, 'projects', 'projA'), 'master');
    const projB = initRepo(join(ctx.root, 'projects', 'projB'), 'master');
    const worktreesRoot = join(ctx.root, 'worktrees');
    const results = await batchAddWorktree({
      projectPaths: [projA, projB],
      worktreesRoot,
      task: 'PROJ-100',
      branch: 'feat/proj-100',
      newBranch: true,
    });
    expect(results.length).toBe(2);
    expect(results.every((r) => r.success)).toBe(true);
    expect(existsSync(join(worktreesRoot, 'PROJ-100', 'docs'))).toBe(true);
    expect(readFileSync(join(worktreesRoot, 'PROJ-100', 'CLAUDE.md'), 'utf8')).toContain('AGENTS.md');
    expect(readFileSync(join(worktreesRoot, 'PROJ-100', 'AGENTS.md'), 'utf8')).toContain('docs/');
    expect(existsSync(join(worktreesRoot, 'PROJ-100', 'projA'))).toBe(true);
    expect(existsSync(join(worktreesRoot, 'PROJ-100', 'projB'))).toBe(true);
  });

  it('批量创建 worktree 时按自定义工作文档模板初始化任务根目录', async () => {
    // projA 存储参与批量创建的源项目。
    const projA = initRepo(join(ctx.root, 'projects', 'projA'), 'master');
    // worktreesRoot 存储批量 worktree 根目录。
    const worktreesRoot = join(ctx.root, 'worktrees');
    // workDocumentTemplates 存储用户设置里的工作文档模板。
    const workDocumentTemplates = [
      { type: 'directory', path: 'records', content: '' },
      { type: 'file', path: '.ai/task.md', content: 'task notes' },
    ];

    // results 存储批量创建结果。
    const results = await batchAddWorktree({
      projectPaths: [projA],
      worktreesRoot,
      task: 'PROJ-101',
      branch: 'feat/proj-101',
      newBranch: true,
      workDocumentTemplates,
    });

    expect(results.every((r) => r.success)).toBe(true);
    expect(existsSync(join(worktreesRoot, 'PROJ-101', 'records'))).toBe(true);
    expect(readFileSync(join(worktreesRoot, 'PROJ-101', '.ai', 'task.md'), 'utf8')).toBe('task notes');
    expect(readFileSync(join(worktreesRoot, 'PROJ-101', 'projA', '.ai', 'task.md'), 'utf8')).toBe('task notes');
  });

  it('项目列表为空时仍创建任务根目录和工作文档', async () => {
    // worktreesRoot 存储批量 worktree 根目录。
    const worktreesRoot = join(ctx.root, 'worktrees');

    // results 存储空项目创建结果；没有项目 worktree，但任务目录应作为需求容器落地。
    const results = await batchAddWorktree({
      projectPaths: [],
      worktreesRoot,
      task: 'PROJ-EMPTY',
      branch: 'feat/empty',
      newBranch: true,
    });

    expect(results).toEqual([]);
    expect(existsSync(join(worktreesRoot, 'PROJ-EMPTY'))).toBe(true);
    expect(existsSync(join(worktreesRoot, 'PROJ-EMPTY', 'docs'))).toBe(true);
    expect(readFileSync(join(worktreesRoot, 'PROJ-EMPTY', 'AGENTS.md'), 'utf8')).toContain('docs/');
  });

  it('reports per-project failure without aborting the batch', async () => {
    const projA = initRepo(join(ctx.root, 'projects', 'projA'), 'master');
    const worktreesRoot = join(ctx.root, 'worktrees');
    // 预先在 projA 目标路径放文件使其非空，导致创建失败；projB 正常
    const projB = initRepo(join(ctx.root, 'projects', 'projB'), 'master');
    mkdirSync(join(worktreesRoot, 'PROJ-200', 'projA'), { recursive: true });
    writeFileSync(join(worktreesRoot, 'PROJ-200', 'projA', 'occupied.txt'), 'blocking');
    const results = await batchAddWorktree({
      projectPaths: [projA, projB],
      worktreesRoot,
      task: 'PROJ-200',
      branch: 'feat/x',
      newBranch: true,
    });
    const aRes = results.find((r) => r.project === 'projA');
    const bRes = results.find((r) => r.project === 'projB');
    expect(aRes.success).toBe(false);
    expect(bRes.success).toBe(true);
  });
});

// node_modules 软链接：创建 worktree 时复用源项目依赖，删除时清理链接
describe('node_modules 软链接', () => {
  let ctx;
  beforeEach(() => { ctx = makeTempRoot(); });
  afterEach(() => ctx.cleanup());

  it('linkNodeModules 在源项目有 node_modules 时创建指向它的软链接', () => {
    const repo = initRepo(join(ctx.root, 'projA'), 'master');
    // 在源项目放置已安装依赖目录
    mkdirSync(join(repo, 'node_modules', 'left-pad'), { recursive: true });
    const target = join(ctx.root, 'worktrees', 'TASK-1', 'projA');
    mkdirSync(target, { recursive: true });
    const res = linkNodeModules(repo, target);
    expect(res.linked).toBe(true);
    const linkPath = join(target, 'node_modules');
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    // 软链接指向源项目 node_modules，可读到其中已安装的包
    expect(existsSync(join(linkPath, 'left-pad'))).toBe(true);
    expect(realpathSync(linkPath)).toBe(realpathSync(join(repo, 'node_modules')));
  });

  it('linkNodeModules 在源项目无 node_modules 时跳过', () => {
    const repo = initRepo(join(ctx.root, 'projB'), 'master');
    const target = join(ctx.root, 'worktrees', 'TASK-2', 'projB');
    mkdirSync(target, { recursive: true });
    const res = linkNodeModules(repo, target);
    expect(res.linked).toBe(false);
    expect(res.reason).toBe('source-missing');
    expect(existsSync(join(target, 'node_modules'))).toBe(false);
  });

  it('linkNodeModules 在 worktree 已有 node_modules 时不覆盖', () => {
    const repo = initRepo(join(ctx.root, 'projC'), 'master');
    mkdirSync(join(repo, 'node_modules'), { recursive: true });
    const target = join(ctx.root, 'worktrees', 'TASK-3', 'projC');
    // worktree 内已有真实 node_modules 目录
    mkdirSync(join(target, 'node_modules'), { recursive: true });
    const res = linkNodeModules(repo, target);
    expect(res.linked).toBe(false);
    expect(res.reason).toBe('target-exists');
    // 仍是真实目录而非被替换为软链接
    expect(lstatSync(join(target, 'node_modules')).isSymbolicLink()).toBe(false);
  });

  it('addWorktree 默认自动软链接源项目 node_modules', async () => {
    const repo = initRepo(join(ctx.root, 'projA'), 'master');
    mkdirSync(join(repo, 'node_modules', 'react'), { recursive: true });
    const target = join(ctx.root, 'worktrees', 'TASK-1', 'projA');
    const res = await addWorktree(repo, target, 'feat/new', { newBranch: true });
    expect(res.success).toBe(true);
    expect(res.nodeModulesLinked).toBe(true);
    expect(lstatSync(join(target, 'node_modules')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(target, 'node_modules', 'react'))).toBe(true);
  });

  it('addWorktree 在 linkNodeModules:false 时不创建软链接', async () => {
    const repo = initRepo(join(ctx.root, 'projB'), 'master');
    mkdirSync(join(repo, 'node_modules'), { recursive: true });
    const target = join(ctx.root, 'worktrees', 'TASK-2', 'projB');
    const res = await addWorktree(repo, target, 'feat/x', { newBranch: true, linkNodeModules: false });
    expect(res.success).toBe(true);
    expect(res.nodeModulesLinked).toBe(false);
    expect(existsSync(join(target, 'node_modules'))).toBe(false);
  });

  it('unlinkNodeModules 删除软链接但不影响源项目依赖', () => {
    const repo = initRepo(join(ctx.root, 'projC'), 'master');
    mkdirSync(join(repo, 'node_modules', 'vue'), { recursive: true });
    const target = join(ctx.root, 'worktrees', 'TASK-3', 'projC');
    mkdirSync(target, { recursive: true });
    linkNodeModules(repo, target);
    const res = unlinkNodeModules(target);
    expect(res.unlinked).toBe(true);
    // worktree 内软链接已移除
    expect(existsSync(join(target, 'node_modules'))).toBe(false);
    // 源项目 node_modules 及其内容完好
    expect(existsSync(join(repo, 'node_modules', 'vue'))).toBe(true);
  });

  it('unlinkNodeModules 对真实目录（非软链接）不处理', () => {
    const target = join(ctx.root, 'worktrees', 'TASK-4', 'projD');
    mkdirSync(join(target, 'node_modules'), { recursive: true });
    const res = unlinkNodeModules(target);
    expect(res.unlinked).toBe(false);
    expect(res.reason).toBe('not-symlink');
    // 真实目录未被删除
    expect(existsSync(join(target, 'node_modules'))).toBe(true);
  });

  it('removeWorktree 删除前清理 node_modules 软链接且保留源项目依赖', async () => {
    const repo = initRepo(join(ctx.root, 'projE'), 'master');
    mkdirSync(join(repo, 'node_modules', 'lodash'), { recursive: true });
    const target = join(ctx.root, 'worktrees', 'TASK-5', 'projE');
    await addWorktree(repo, target, 'feat/z', { newBranch: true });
    expect(lstatSync(join(target, 'node_modules')).isSymbolicLink()).toBe(true);
    const res = await removeWorktree(repo, target);
    expect(res.success).toBe(true);
    expect(existsSync(target)).toBe(false);
    // 源项目依赖未被牵连删除
    expect(existsSync(join(repo, 'node_modules', 'lodash'))).toBe(true);
  });

  it('addWorktree 对已存在的 worktree 幂等补软链接而非报失败', async () => {
    const repo = initRepo(join(ctx.root, 'projF'), 'master');
    mkdirSync(join(repo, 'node_modules', 'react'), { recursive: true });
    const target = join(ctx.root, 'worktrees', 'TASK-6', 'projF');
    // 首次创建
    await addWorktree(repo, target, 'feat/a', { newBranch: true });
    // 模拟旧版本遗留：worktree 已存在但软链接缺失
    rmSync(join(target, 'node_modules'));
    expect(existsSync(join(target, 'node_modules'))).toBe(false);
    // 重新创建：应成功（reused）并补上软链接，而非报 "already exists" 失败
    const res = await addWorktree(repo, target, 'feat/a', { newBranch: true });
    expect(res.success).toBe(true);
    expect(res.reused).toBe(true);
    expect(res.nodeModulesLinked).toBe(true);
    expect(lstatSync(join(target, 'node_modules')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(target, 'node_modules', 'react'))).toBe(true);
  });

  it('addWorktree 对被无关文件占用的目标仍报失败', async () => {
    const repo = initRepo(join(ctx.root, 'projG'), 'master');
    const target = join(ctx.root, 'worktrees', 'TASK-7', 'projG');
    // 目标路径被非 worktree 的普通文件占用
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'occupied.txt'), 'blocking');
    const res = await addWorktree(repo, target, 'feat/b', { newBranch: true });
    expect(res.success).toBe(false);
    expect(res.error).toBeTruthy();
  });
});
