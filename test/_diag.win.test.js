import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { mkdirSync, realpathSync } from 'fs';
import { getWorktrees } from '../src/core/gitService.js';
import { makeTempRoot, initRepo, git } from './helpers.js';

// 临时诊断：把 Windows 上「git worktree list 返回路径」与「realpathSync(worktreesRoot)」的真实形态
// 塞进断言失败消息里强制输出（console.log 会被 vitest 吞），用于定位 scanWorktreesByTask 前缀匹配
// 失配的根因（短名/长名、盘符大小写、分隔符）。跑完即删。

describe('WIN-DIAG', () => {
  it('dump path shapes', async () => {
    // ctx 存储临时根目录及清理器
    const ctx = makeTempRoot();
    // projectsRoot 存储源项目根目录
    const projectsRoot = join(ctx.root, 'projects');
    // worktreesRoot 存储 worktree 任务根目录
    const worktreesRoot = join(ctx.root, 'worktrees');
    mkdirSync(projectsRoot, { recursive: true });
    mkdirSync(worktreesRoot, { recursive: true });
    // projA 存储源项目路径
    const projA = initRepo(join(projectsRoot, 'projA'), 'master');
    // wtTarget 存储要创建的 worktree 目标路径
    const wtTarget = join(worktreesRoot, 'TASK-1', 'projA');
    git(projA, `worktree add -q -b feat/t1 ${wtTarget}`);

    // wts 存储 git worktree list --porcelain 解析出的 worktree 列表
    const wts = await getWorktrees(projA);
    // dump 汇总所有关键路径形态，通过断言失败强制打印到 CI 日志
    const dump = {
      worktreesRoot_join: worktreesRoot,
      worktreesRoot_realpath: realpathSync(worktreesRoot),
      wtTarget_join: wtTarget,
      wtTarget_realpath: realpathSync(wtTarget),
      git_worktree_paths: wts.map((w) => w.path),
    };

    ctx.cleanup();
    // 故意失败以打印 dump（诊断用）
    expect(JSON.stringify(dump, null, 2)).toBe('__DIAG__');
  });
});
