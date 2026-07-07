import { describe, it, expect } from 'vitest';
import { filterProjects, summarize, statusTags, FILTERS } from '../src/ui/projectLogic.js';

// 前端纯逻辑测试：筛选、统计、状态标签

// 构造测试用项目数据
const projects = [
  { name: 'alpha', isGitRepo: true, isMainBranch: true, hasUncommittedChanges: false, hasUnpushedCommits: false, canPull: false, ahead: 0, behind: 0 },
  { name: 'beta', isGitRepo: true, isMainBranch: false, hasUncommittedChanges: true, hasUnpushedCommits: false, canPull: false, ahead: 0, behind: 0 },
  { name: 'gamma', isGitRepo: true, isMainBranch: false, hasUncommittedChanges: false, hasUnpushedCommits: true, canPull: true, ahead: 2, behind: 3 },
];

describe('filterProjects', () => {
  it('returns all when filter is ALL', () => {
    expect(filterProjects(projects, FILTERS.ALL)).toHaveLength(3);
  });

  it('filters non-main branches', () => {
    const res = filterProjects(projects, FILTERS.NON_MAIN);
    expect(res.map((p) => p.name)).toEqual(['beta', 'gamma']);
  });

  it('filters projects with changes', () => {
    const res = filterProjects(projects, FILTERS.HAS_CHANGES);
    expect(res.map((p) => p.name)).toEqual(['beta']);
  });

  it('filters projects that can pull', () => {
    const res = filterProjects(projects, FILTERS.CAN_PULL);
    expect(res.map((p) => p.name)).toEqual(['gamma']);
  });

  it('searches by keyword case-insensitively', () => {
    const res = filterProjects(projects, FILTERS.ALL, 'BET');
    expect(res.map((p) => p.name)).toEqual(['beta']);
  });

  it('combines keyword and filter', () => {
    const res = filterProjects(projects, FILTERS.NON_MAIN, 'gamma');
    expect(res.map((p) => p.name)).toEqual(['gamma']);
  });
});

describe('summarize', () => {
  it('computes overview counts', () => {
    const s = summarize(projects);
    expect(s.total).toBe(3);
    expect(s.nonMain).toBe(2);
    expect(s.hasChanges).toBe(1);
    expect(s.canPull).toBe(1);
  });
});

describe('statusTags', () => {
  it('tags a clean main-branch repo', () => {
    const tags = statusTags(projects[0]);
    expect(tags.map((t) => t.text)).toEqual(['主分支']);
  });

  it('tags a non-main repo with changes', () => {
    const tags = statusTags(projects[1]);
    expect(tags.map((t) => t.text)).toContain('非主分支');
    expect(tags.map((t) => t.text)).toContain('有变更');
  });

  it('tags ahead/behind counts', () => {
    const tags = statusTags(projects[2]);
    const texts = tags.map((t) => t.text);
    expect(texts).toContain('领先 2');
    expect(texts).toContain('落后 3');
  });

  it('tags a non-git directory', () => {
    const tags = statusTags({ isGitRepo: false });
    expect(tags[0].text).toBe('非 Git 仓库');
  });
});
