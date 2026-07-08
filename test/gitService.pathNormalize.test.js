import { describe, it, expect } from 'vitest';
import { toPosixPath, getTaskNameFromWorktreeRelativePath } from '../src/core/gitService.js';

// 跨平台路径归一化测试。
// WHY：Windows 上 `git worktree list --porcelain` 返回正斜杠路径，而 Node 的 realpathSync/join
// 返回反斜杠路径，二者做前缀匹配/切分会失配。这里用反斜杠输入模拟 Windows 场景，在 macOS 上即可
// 验证归一化逻辑，无需真机（真实 git 集成测试在 macOS 上永远拿不到反斜杠路径，故盖不到该分支）。

describe('toPosixPath', () => {
  it('把 Windows 反斜杠分隔符全部替换为正斜杠', () => {
    // input 存储典型的 Windows 绝对路径（含盘符与反斜杠）
    const input = 'C:\\Users\\me\\worktrees\\TASK-1\\projA';
    expect(toPosixPath(input)).toBe('C:/Users/me/worktrees/TASK-1/projA');
  });

  it('对已是正斜杠的类 Unix 路径为恒等变换', () => {
    // input 存储类 Unix 绝对路径，归一化后应保持原样
    const input = '/Users/me/worktrees/TASK-1/projA';
    expect(toPosixPath(input)).toBe(input);
  });

  it('对混合分隔符路径统一为正斜杠', () => {
    // input 存储正反斜杠混用的路径，模拟 realWtRoot + 硬拼 '/' 的历史写法
    const input = 'C:\\Users\\me/worktrees\\TASK-1';
    expect(toPosixPath(input)).toBe('C:/Users/me/worktrees/TASK-1');
  });

  it('空值兜底：非字符串或空串原样返回不抛错', () => {
    expect(toPosixPath('')).toBe('');
    expect(toPosixPath(undefined)).toBe(undefined);
    expect(toPosixPath(null)).toBe(null);
  });
});

describe('getTaskNameFromWorktreeRelativePath 跨平台切分', () => {
  it('正斜杠相对路径取项目名前的全部路径为任务名', () => {
    // 单层任务名：TASK-1/projA → TASK-1
    expect(getTaskNameFromWorktreeRelativePath('TASK-1/projA')).toBe('TASK-1');
  });

  it('含斜杠的多层任务名完整保留（正斜杠输入）', () => {
    // 分支风格任务名：alice/bugfix/PROJ-5001/projA → alice/bugfix/PROJ-5001
    expect(getTaskNameFromWorktreeRelativePath('alice/bugfix/PROJ-5001/projA')).toBe('alice/bugfix/PROJ-5001');
  });

  it('Windows 反斜杠相对路径也能正确切分（回归 CI 抓到的 bug）', () => {
    // WHY：修复前 split('/') 切不开反斜杠，alice\bugfix\... 会被整体当成任务名（截断为 alice 的反面）
    expect(getTaskNameFromWorktreeRelativePath('TASK-1\\projA')).toBe('TASK-1');
    expect(getTaskNameFromWorktreeRelativePath('alice\\bugfix\\PROJ-5001\\projA')).toBe('alice/bugfix/PROJ-5001');
  });

  it('反斜杠单层路径（worktree 直接在根下）沿用目录名', () => {
    // 兼容旧数据：只有一层时该层即任务名
    expect(getTaskNameFromWorktreeRelativePath('TASK-ONLY')).toBe('TASK-ONLY');
  });

  it('空路径返回空串', () => {
    expect(getTaskNameFromWorktreeRelativePath('')).toBe('');
  });

  it('任务名含中文与特殊字符时完整保留', () => {
    // 真实场景：任务名可含中文（如 PROJ-5001-订单批量导入页面异常）
    expect(getTaskNameFromWorktreeRelativePath('alice\\bugfix\\PROJ-5001-订单批量导入页面异常\\projA')).toBe(
      'alice/bugfix/PROJ-5001-订单批量导入页面异常'
    );
  });
});
