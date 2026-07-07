import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  computeActiveKeysAfterCreate,
  TASK_STATUSES,
  TASK_STATUS_STORAGE_KEY,
  DEFAULT_TASK_STATUS,
  getTaskStatusMeta,
  setTaskStatusInMap,
  loadTaskStatusMap,
  saveTaskStatusMap,
  quotePathForCopy,
  normalizeTaskLinks,
  normalizeTaskLinkItems,
  normalizeTaskLinkMap,
  setTaskLinksInMap,
} from '../src/ui/worktreeLogic.js';

// Worktree 面板展开逻辑测试：新建后只展开刚创建的任务面板。

describe('quotePathForCopy（始终加单引号，便于粘贴到终端 cd）', () => {
  it('纯英文路径也加单引号', () => {
    expect(quotePathForCopy('/Users/a/work/proj')).toBe("'/Users/a/work/proj'");
  });

  it('中文路径加单引号', () => {
    const p = '/Users/a/worktrees/PROJ-5001-订单批量导入页面异常/web-app';
    expect(quotePathForCopy(p)).toBe(`'${p}'`);
  });

  it('含 & 的路径加单引号（避免 cd 被拆词）', () => {
    const p = '/Users/a/物料发放&维修页面/logistics';
    expect(quotePathForCopy(p)).toBe(`'${p}'`);
  });

  it('含空格的路径加单引号', () => {
    expect(quotePathForCopy('/Users/a/my work/proj')).toBe("'/Users/a/my work/proj'");
  });

  it('含括号的路径加单引号', () => {
    expect(quotePathForCopy('/Users/a/proj(1)')).toBe("'/Users/a/proj(1)'");
  });

  it('含单引号的路径用 \'\\\'\' 序列转义', () => {
    // /a/it's/proj → 'a/it'\''s/proj'，粘贴到终端可正确 cd
    expect(quotePathForCopy("/a/it's/proj")).toBe("'/a/it'\\''s/proj'");
  });

  it('空值返回空串（不产生无意义的 \'\'）', () => {
    expect(quotePathForCopy(undefined)).toBe('');
    expect(quotePathForCopy(null)).toBe('');
    expect(quotePathForCopy('')).toBe('');
  });
});

describe('computeActiveKeysAfterCreate', () => {
  it('returns only the newly created task name', () => {
    expect(computeActiveKeysAfterCreate('PROJ-1')).toEqual(['PROJ-1']);
  });

  it('returns empty array when task name is missing', () => {
    // 任务名为空/未定义时不展开任何面板，避免传入无效 key
    expect(computeActiveKeysAfterCreate('')).toEqual([]);
    expect(computeActiveKeysAfterCreate(undefined)).toEqual([]);
  });
});

// 任务状态（人工标记）纯逻辑测试

describe('getTaskStatusMeta', () => {
  it('returns meta for a known status key', () => {
    // 已知状态返回带 label/color 的定义
    const meta = getTaskStatusMeta('released');
    expect(meta).toMatchObject({ key: 'released', label: '已发布' });
    expect(typeof meta.color).toBe('string');
  });

  it('falls back to the default "未开始" status for unknown or empty input', () => {
    // 未知/未设置状态回退默认「未开始」，保证任务总有可展示的状态
    expect(getTaskStatusMeta('nope')).toMatchObject({ key: DEFAULT_TASK_STATUS, label: '未开始' });
    expect(getTaskStatusMeta(undefined)).toMatchObject({ key: DEFAULT_TASK_STATUS, label: '未开始' });
  });

  it('default status "未开始" is the first item in the list', () => {
    // 「未开始」作为默认态排在下拉首位
    expect(TASK_STATUSES[0].key).toBe(DEFAULT_TASK_STATUS);
  });

  it('every defined status has a resolvable meta', () => {
    // 保证状态定义自洽：列表里每个 key 都能查回自身
    for (const s of TASK_STATUSES) {
      expect(getTaskStatusMeta(s.key)).toEqual(s);
    }
  });
});

describe('setTaskStatusInMap', () => {
  it('sets a status for a task without mutating the input', () => {
    // 原映射不被修改，返回新对象
    const orig = {};
    const next = setTaskStatusInMap(orig, 'TASK-1', 'developing');
    expect(next).toEqual({ 'TASK-1': 'developing' });
    expect(orig).toEqual({});
  });

  it('overwrites an existing status', () => {
    const next = setTaskStatusInMap({ 'TASK-1': 'developing' }, 'TASK-1', 'released');
    expect(next['TASK-1']).toBe('released');
  });

  it('clears the status when key is empty, unknown, or the default "未开始"', () => {
    // 传空/未知/默认「未开始」均视为清除（缺失即默认态，无需占用存储）
    expect(setTaskStatusInMap({ 'TASK-1': 'released' }, 'TASK-1', undefined)).toEqual({});
    expect(setTaskStatusInMap({ 'TASK-1': 'released' }, 'TASK-1', 'bogus')).toEqual({});
    expect(setTaskStatusInMap({ 'TASK-1': 'released' }, 'TASK-1', DEFAULT_TASK_STATUS)).toEqual({});
  });

  it('returns a copy unchanged when task name is missing', () => {
    expect(setTaskStatusInMap({ 'TASK-1': 'released' }, '', 'developing')).toEqual({ 'TASK-1': 'released' });
  });

  it('tolerates a null/undefined map', () => {
    expect(setTaskStatusInMap(undefined, 'TASK-1', 'released')).toEqual({ 'TASK-1': 'released' });
  });
});

describe('loadTaskStatusMap / saveTaskStatusMap', () => {
  // 每个用例前重置 localStorage stub，避免相互污染
  beforeEach(() => {
    // store 模拟 localStorage 的底层存储
    const store = {};
    vi.stubGlobal('localStorage', {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    });
  });

  it('round-trips a status map through localStorage', () => {
    saveTaskStatusMap({ 'TASK-1': 'released' });
    expect(localStorage.getItem(TASK_STATUS_STORAGE_KEY)).toBe('{"TASK-1":"released"}');
    expect(loadTaskStatusMap()).toEqual({ 'TASK-1': 'released' });
  });

  it('returns empty object when nothing is stored', () => {
    expect(loadTaskStatusMap()).toEqual({});
  });

  it('falls back to empty object on corrupted JSON', () => {
    // 存入损坏内容时不抛错，回退空映射
    localStorage.setItem(TASK_STATUS_STORAGE_KEY, '{not json');
    expect(loadTaskStatusMap()).toEqual({});
  });

  it('rejects non-object stored values (array/scalar)', () => {
    // 存入数组/标量时视为无效，回退空映射
    localStorage.setItem(TASK_STATUS_STORAGE_KEY, '[1,2,3]');
    expect(loadTaskStatusMap()).toEqual({});
    localStorage.setItem(TASK_STATUS_STORAGE_KEY, '42');
    expect(loadTaskStatusMap()).toEqual({});
  });
});

describe('任务链接多值纯逻辑', () => {
  it('normalizeTaskLinks 兼容旧版单字符串链接', () => {
    expect(normalizeTaskLinks(' https://jira.example.com/TASK-1 ')).toEqual(['https://jira.example.com/TASK-1']);
  });

  it('normalizeTaskLinks 将普通文本输入按换行和逗号拆成多条链接', () => {
    // rawText 模拟用户在普通文本域中粘贴/输入多条需求链接。
    const rawText = ' https://jira.example.com/TASK-1\nhttps://larksuite.example.com/docx/abc, https://ticket.example.com/1 ';

    expect(normalizeTaskLinks(rawText)).toEqual([
      'https://jira.example.com/TASK-1',
      'https://larksuite.example.com/docx/abc',
      'https://ticket.example.com/1',
    ]);
  });

  it('normalizeTaskLinks 清理数组里的空值并去重', () => {
    expect(normalizeTaskLinks([
      'https://jira.example.com/TASK-1',
      '',
      ' https://larksuite.example.com/docx/abc ',
      'https://jira.example.com/TASK-1',
    ])).toEqual([
      'https://jira.example.com/TASK-1',
      'https://larksuite.example.com/docx/abc',
    ]);
  });

  it('normalizeTaskLinkItems 支持链接名称并兼容旧版字符串', () => {
    expect(normalizeTaskLinkItems([
      { name: 'Jira', url: ' https://jira.example.com/TASK-1 ' },
      'https://larksuite.example.com/docx/abc',
      { name: '空链接', url: '' },
    ])).toEqual([
      { name: 'Jira', url: 'https://jira.example.com/TASK-1' },
      { name: '', url: 'https://larksuite.example.com/docx/abc' },
    ]);
  });

  it('normalizeTaskLinkItems 按 URL 去重并保留首个名称', () => {
    expect(normalizeTaskLinkItems([
      { name: 'Jira', url: 'https://jira.example.com/TASK-1' },
      { name: '重复 Jira', url: ' https://jira.example.com/TASK-1 ' },
    ])).toEqual([
      { name: 'Jira', url: 'https://jira.example.com/TASK-1' },
    ]);
  });

  it('normalizeTaskLinkMap 将旧映射升级成任务名到链接条目数组', () => {
    expect(normalizeTaskLinkMap({
      'TASK-1': 'https://jira.example.com/TASK-1',
      'TASK-2': [{ name: '需求文档', url: 'https://larksuite.example.com/docx/abc' }],
      'TASK-EMPTY': '',
    })).toEqual({
      'TASK-1': [{ name: '', url: 'https://jira.example.com/TASK-1' }],
      'TASK-2': [{ name: '需求文档', url: 'https://larksuite.example.com/docx/abc' }],
    });
  });

  it('setTaskLinksInMap 写入多条带名称链接且不修改原映射', () => {
    const orig = { 'TASK-OLD': ['https://old.example.com'] };
    const next = setTaskLinksInMap(orig, 'TASK-1', [
      { name: 'Jira', url: 'https://jira.example.com/TASK-1' },
      { name: '需求文档', url: 'https://larksuite.example.com/docx/abc' },
    ]);

    expect(next).toEqual({
      'TASK-OLD': [{ name: '', url: 'https://old.example.com' }],
      'TASK-1': [
        { name: 'Jira', url: 'https://jira.example.com/TASK-1' },
        { name: '需求文档', url: 'https://larksuite.example.com/docx/abc' },
      ],
    });
    expect(orig).toEqual({ 'TASK-OLD': ['https://old.example.com'] });
  });

  it('setTaskLinksInMap 传空链接时清除该任务链接', () => {
    expect(setTaskLinksInMap({ 'TASK-1': ['https://jira.example.com/TASK-1'] }, 'TASK-1', [])).toEqual({});
  });
});
