import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { getSafeToRemoveWorktrees } from '../src/core/gitService.js';
import { makeTempRoot, initRepo, git } from './helpers.js';

// getSafeToRemoveWorktrees 测试：覆盖「已合并+无改动可删 / 未合并不可删 / 有改动不可删 / 主分支不删」。
// 用真实临时 git 仓库走完整运行路径，避免假验证。

describe('getSafeToRemoveWorktrees', () => {
  let ctx;
  // projectsRoot 源项目根目录
  let projectsRoot;
  // worktreesRoot worktree 任务根目录
  let worktreesRoot;

  beforeEach(() => {
    ctx = makeTempRoot();
    projectsRoot = join(ctx.root, 'projects');
    worktreesRoot = join(ctx.root, 'worktrees');
    mkdirSync(projectsRoot, { recursive: true });
    mkdirSync(worktreesRoot, { recursive: true });
  });
  afterEach(() => ctx.cleanup());

  it('returns a worktree whose branch is merged into main and has no uncommitted changes', async () => {
    // proj 为源项目；建分支 feat/done 并合并回 master 后，其 worktree 应判定为可安全删除
    const proj = initRepo(join(projectsRoot, 'projA'), 'master');
    const wtPath = join(worktreesRoot, 'TASK-1', 'projA');
    git(proj, `worktree add -q -b feat/done ${wtPath}`);
    // 把 feat/done 合并回 master（无新增提交，fast-forward 即已合并）
    git(proj, 'branch --merged master'); // 触发一次确保命令可用
    // feat/done 与 master 同提交 → 已合并
    const list = await getSafeToRemoveWorktrees(projectsRoot, worktreesRoot, ['master', 'main']);
    const found = list.find((w) => w.path.endsWith(join('TASK-1', 'projA')));
    expect(found).toBeTruthy();
    expect(found.taskName).toBe('TASK-1');
    expect(found.projectName).toBe('projA');
    expect(found.branch).toBe('feat/done');
    expect(found.projectPath).toBe(proj);
  });

  it('excludes a worktree with uncommitted changes', async () => {
    const proj = initRepo(join(projectsRoot, 'projB'), 'master');
    const wtPath = join(worktreesRoot, 'TASK-2', 'projB');
    git(proj, `worktree add -q -b feat/dirty ${wtPath}`);
    // 在 worktree 内制造未提交改动
    writeFileSync(join(wtPath, 'dirty.txt'), 'uncommitted');
    const list = await getSafeToRemoveWorktrees(projectsRoot, worktreesRoot, ['master', 'main']);
    expect(list.find((w) => w.path === wtPath)).toBeFalsy();
  });

  it('excludes a worktree whose branch is NOT merged into main', async () => {
    const proj = initRepo(join(projectsRoot, 'projC'), 'master');
    const wtPath = join(worktreesRoot, 'TASK-3', 'projC');
    git(proj, `worktree add -q -b feat/unmerged ${wtPath}`);
    // 在分支上新增一个未合并到 master 的提交
    writeFileSync(join(wtPath, 'new.txt'), 'feature work');
    git(wtPath, 'add -A');
    git(wtPath, 'commit -q -m "unmerged work"');
    const list = await getSafeToRemoveWorktrees(projectsRoot, worktreesRoot, ['master', 'main']);
    expect(list.find((w) => w.path === wtPath)).toBeFalsy();
  });

  it('returns empty when projectsRoot does not exist', async () => {
    const list = await getSafeToRemoveWorktrees(join(ctx.root, 'nonexistent'), worktreesRoot, ['master']);
    expect(list).toEqual([]);
  });
});
