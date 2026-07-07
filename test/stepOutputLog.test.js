import { describe, it, expect } from 'vitest';
import { stepRunKey, isStepEventFor, appendStepChunk } from '../src/core/stepOutputLog.js';

// stepOutputLog 纯逻辑测试：路由 key 生成、事件归属判断、输出片段追加与截断。

describe('stepRunKey 生成步骤路由 key', () => {
  it('相同任务名+步骤 key 生成相同 key', () => {
    expect(stepRunKey('TASK-A', 'check')).toBe(stepRunKey('TASK-A', 'check'));
  });

  it('不同任务或步骤生成不同 key（避免并发执行互相串扰）', () => {
    expect(stepRunKey('TASK-A', 'check')).not.toBe(stepRunKey('TASK-B', 'check'));
    expect(stepRunKey('TASK-A', 'check')).not.toBe(stepRunKey('TASK-A', 'deploy'));
  });

  it('空值兜底为字符串，不抛错', () => {
    expect(typeof stepRunKey(undefined, undefined)).toBe('string');
  });
});

describe('isStepEventFor 判断事件归属', () => {
  it('任务名与步骤 key 都匹配时返回 true', () => {
    expect(isStepEventFor({ taskName: 'TASK-A', stepKey: 'check' }, 'TASK-A', 'check')).toBe(true);
  });

  it('任务名或步骤 key 不匹配时返回 false', () => {
    expect(isStepEventFor({ taskName: 'TASK-A', stepKey: 'check' }, 'TASK-B', 'check')).toBe(false);
    expect(isStepEventFor({ taskName: 'TASK-A', stepKey: 'check' }, 'TASK-A', 'deploy')).toBe(false);
  });

  it('事件为空时返回 false（不误判）', () => {
    expect(isStepEventFor(null, 'TASK-A', 'check')).toBe(false);
    expect(isStepEventFor(undefined, 'TASK-A', 'check')).toBe(false);
  });
});

describe('appendStepChunk 追加输出片段', () => {
  it('把新片段拼到已有内容尾部', () => {
    expect(appendStepChunk('abc', 'def')).toBe('abcdef');
  });

  it('空 buffer/空 chunk 兜底为字符串', () => {
    expect(appendStepChunk(undefined, 'x')).toBe('x');
    expect(appendStepChunk('x', undefined)).toBe('x');
    expect(appendStepChunk(null, null)).toBe('');
  });

  it('超过上限时只保留尾部（防止无限累积撑爆内存）', () => {
    // 用很小的上限验证截断：拼接后超过 maxChars 时丢弃头部
    const result = appendStepChunk('aaaa', 'bbbb', 5);
    expect(result.length).toBe(5);
    // 保留的是最新的尾部内容
    expect(result).toBe('abbbb');
  });

  it('未超上限时完整保留不截断', () => {
    expect(appendStepChunk('aa', 'bb', 100)).toBe('aabb');
  });
});
