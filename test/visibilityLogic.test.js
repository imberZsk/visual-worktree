import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TASK_TITLE_BADGES,
  filterVisibleItems,
  normalizeTaskTitleBadges,
  normalizeVisibilityPrefs,
  setVisibilityKey,
  sortPinnedItems,
} from '../src/ui/visibilityLogic.js';

// 隐藏/置顶偏好的纯逻辑测试：项目和任务共用同一套数据结构与排序规则。

describe('visibilityLogic hidden/pinned prefs', () => {
  it('normalizes hidden and pinned keys with de-duplication', () => {
    // prefs 存储用户磁盘里的偏好内容，可能包含重复值、空值或非字符串值。
    const prefs = normalizeVisibilityPrefs({
      hidden: ['TASK-A', '', 'TASK-A', 42],
      pinned: ['TASK-B', 'TASK-B', null],
    });

    expect(prefs).toEqual({ hidden: ['TASK-A', '42'], pinned: ['TASK-B'] });
  });

  it('toggles hidden and pinned keys without mutating the input', () => {
    // original 存储切换前的偏好，后续断言它没有被修改。
    const original = { hidden: ['TASK-A'], pinned: [] };

    // hiddenPrefs 存储追加隐藏 TASK-B 后的新偏好。
    const hiddenPrefs = setVisibilityKey(original, 'hidden', 'TASK-B', true);
    // unhiddenPrefs 存储恢复 TASK-A 后的新偏好。
    const unhiddenPrefs = setVisibilityKey(hiddenPrefs, 'hidden', 'TASK-A', false);
    // pinnedPrefs 存储置顶 TASK-C 后的新偏好。
    const pinnedPrefs = setVisibilityKey(unhiddenPrefs, 'pinned', 'TASK-C', true);

    expect(hiddenPrefs.hidden).toEqual(['TASK-A', 'TASK-B']);
    expect(unhiddenPrefs.hidden).toEqual(['TASK-B']);
    expect(pinnedPrefs.pinned).toEqual(['TASK-C']);
    expect(original).toEqual({ hidden: ['TASK-A'], pinned: [] });
  });

  it('filters hidden items unless showHidden is enabled', () => {
    // tasks 存储按任务名标识的列表，模拟 Worktree tab 的任务数组。
    const tasks = [{ task: 'TASK-A' }, { task: 'TASK-B' }, { task: 'TASK-C' }];
    // prefs 存储隐藏 TASK-B 的用户偏好。
    const prefs = { hidden: ['TASK-B'], pinned: [] };

    expect(filterVisibleItems(tasks, prefs, (task) => task.task, false).map((task) => task.task)).toEqual(['TASK-A', 'TASK-C']);
    expect(filterVisibleItems(tasks, prefs, (task) => task.task, true).map((task) => task.task)).toEqual(['TASK-A', 'TASK-B', 'TASK-C']);
  });

  it('keeps pinned items before unpinned items while preserving the secondary comparator', () => {
    // projects 存储项目列表，顺序故意打乱以验证二级名称排序仍生效。
    const projects = [{ name: 'zeta' }, { name: 'alpha' }, { name: 'beta' }];
    // prefs 存储置顶 alpha 和 beta 的用户偏好。
    const prefs = { hidden: [], pinned: ['beta', 'alpha'] };

    const sorted = sortPinnedItems(projects, prefs, (project) => project.name, (a, b) => a.name.localeCompare(b.name));

    expect(sorted.map((project) => project.name)).toEqual(['alpha', 'beta', 'zeta']);
  });
});

describe('task title badge visibility', () => {
  it('defaults every task title badge to visible', () => {
    expect(normalizeTaskTitleBadges(undefined)).toEqual(DEFAULT_TASK_TITLE_BADGES);
  });

  it('respects explicit false values and fills missing keys with defaults', () => {
    // badges 存储用户在设置里关闭了环境与 token 后的展示配置。
    const badges = normalizeTaskTitleBadges({ envHealth: false, claudeUsage: false });

    expect(badges.projectCount).toBe(true);
    expect(badges.taskStatus).toBe(true);
    expect(badges.taskLinks).toBe(true);
    expect(badges.envHealth).toBe(false);
    expect(badges.claudeUsage).toBe(false);
  });
});
