import { describe, expect, it } from 'vitest';
import {
  getWorkflowStepRunStatus,
  getWorkflowTaskRunSummary,
  getRunnableWorkflowSteps,
  getWorkflowOutputPreview,
} from '../src/ui/workflowRunLogic.js';

// steps 为测试用流程步骤，覆盖无命令步骤与可执行命令步骤。
const steps = [
  { key: 'plan', label: '审查方案', command: '' },
  { key: 'test', label: '单测', command: 'npm test' },
  { key: 'build', label: '构建', command: 'npm run build' },
];

describe('workflowRunLogic', () => {
  it('derives running status before done or last output', () => {
    // status 存储当前步骤派生出的展示状态；running 应优先于历史失败和已勾选。
    const status = getWorkflowStepRunStatus(
      steps[1],
      'TASK-A',
      { 'TASK-A': ['test'] },
      { 'TASK-A::test': true },
      { 'TASK-A::test': { status: 'error' } }
    );

    expect(status).toBe('running');
  });

  it('derives failed status from last output snapshot', () => {
    // status 存储当前步骤派生出的展示状态；历史输出失败时应提示用户可重试。
    const status = getWorkflowStepRunStatus(
      steps[1],
      'TASK-A',
      {},
      {},
      { 'TASK-A::test': { status: 'error' } }
    );

    expect(status).toBe('failed');
  });

  it('derives success status from checked workflow map', () => {
    // status 存储当前步骤派生出的展示状态；勾选态对应成功/完成。
    const status = getWorkflowStepRunStatus(
      steps[1],
      'TASK-A',
      { 'TASK-A': ['test'] },
      {},
      {}
    );

    expect(status).toBe('success');
  });

  it('derives success status when a user manually checks a step after a failed run', () => {
    // status 存储用户手动勾选后的展示状态；手动完成应覆盖最近一次失败输出。
    const status = getWorkflowStepRunStatus(
      steps[1],
      'TASK-A',
      { 'TASK-A': ['test'] },
      {},
      { 'TASK-A::test': { status: 'error' } }
    );

    expect(status).toBe('success');
  });

  it('summarizes failed and running task state for the row entry', () => {
    // summary 存储任务级流程摘要，用于任务行入口展示失败/执行中提示。
    const summary = getWorkflowTaskRunSummary(
      steps,
      'TASK-A',
      {},
      { 'TASK-A::build': true },
      { 'TASK-A::test': { status: 'error', label: '单测' } }
    );

    expect(summary).toEqual({
      hasRunning: true,
      hasFailed: true,
      failedCount: 1,
      runningCount: 1,
      lastFailedStepLabel: '单测',
    });
  });

  it('returns only command steps, optionally starting at a step key', () => {
    expect(getRunnableWorkflowSteps(steps).map((s) => s.key)).toEqual(['test', 'build']);
    expect(getRunnableWorkflowSteps(steps, 'test').map((s) => s.key)).toEqual(['test', 'build']);
    expect(getRunnableWorkflowSteps(steps, 'build').map((s) => s.key)).toEqual(['build']);
    expect(getRunnableWorkflowSteps(steps, 'missing').map((s) => s.key)).toEqual(['test', 'build']);
  });

  it('truncates long output previews without losing the fact that truncation happened', () => {
    // result 存储截断后的输出预览和截断标记。
    const result = getWorkflowOutputPreview('abcdef', 4);

    expect(result).toEqual({ text: 'abcd', truncated: true });
  });
});
