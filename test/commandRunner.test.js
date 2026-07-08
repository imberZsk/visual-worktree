import { describe, it, expect } from 'vitest';
import { buildStepCommand, resolveShell } from '../src/core/commandRunner.js';

// 工作流步骤执行命令渲染的纯逻辑测试：验证占位符替换与 shell 引号包裹。

describe('buildStepCommand（占位符渲染 + shell 引号包裹）', () => {
  it('替换 {path} 为带单引号的任务目录', () => {
    const cmd = buildStepCommand('./deploy.sh {path}', { path: '/wt/TASK-A' });
    expect(cmd).toBe("./deploy.sh '/wt/TASK-A'");
  });

  it('同时替换 {path} {task} {branch}', () => {
    const cmd = buildStepCommand('run {task} {branch} in {path}', {
      path: '/wt/T',
      task: 'TASK-1',
      branch: 'feature/x',
    });
    expect(cmd).toBe("run 'TASK-1' 'feature/x' in '/wt/T'");
  });

  it('含空格/中文/& 的替换值被单引号包裹，不会被 shell 拆词', () => {
    // 任务名含 & 时若不加引号会被 shell 当作后台执行符，命令被截断
    const cmd = buildStepCommand('echo {task}', { task: '物料发放&维修页面' });
    expect(cmd).toBe("echo '物料发放&维修页面'");
  });

  it('同一占位符出现多次时全部替换', () => {
    const cmd = buildStepCommand('{path} && cd {path}', { path: '/wt/T' });
    expect(cmd).toBe("'/wt/T' && cd '/wt/T'");
  });

  it('替换值含单引号时用 \'\\\'\' 序列转义', () => {
    const cmd = buildStepCommand('echo {task}', { task: "it's" });
    expect(cmd).toBe("echo 'it'\\''s'");
  });

  it('缺失的上下文字段替换为空字符串字面量', () => {
    // 模板用了 {branch} 但 ctx 未提供，替换为 ''（空单引号），不残留占位符
    const cmd = buildStepCommand('checkout {branch}', { path: '/wt/T' });
    expect(cmd).toBe("checkout ''");
  });

  it('空命令/全空白返回空串（调用方据此判定无命令、跳过执行）', () => {
    expect(buildStepCommand('', { path: '/wt/T' })).toBe('');
    expect(buildStepCommand('   ', { path: '/wt/T' })).toBe('');
    expect(buildStepCommand(undefined)).toBe('');
    expect(buildStepCommand(null)).toBe('');
  });

  it('无占位符的命令原样返回（仅去首尾空白）', () => {
    expect(buildStepCommand('  npm test  ', {})).toBe('npm test');
  });

  it('auto 模式下脚本命令缺少占位符时自动追加任务目录参数', () => {
    // cmd 存储自动补齐后的命令，模拟用户在设置里只填 bash check-unit-test.sh。
    const cmd = buildStepCommand('bash check-unit-test.sh', { path: '/wt/TASK-A' }, { taskArgMode: 'auto' });
    expect(cmd).toBe("bash check-unit-test.sh '/wt/TASK-A'");
  });

  it('auto 模式下普通命令不自动追加任务目录，避免破坏 npm test 等命令语义', () => {
    // cmd 存储普通命令渲染结果，auto 不应无脑追加路径参数。
    const cmd = buildStepCommand('npm test', { path: '/wt/TASK-A' }, { taskArgMode: 'auto' });
    expect(cmd).toBe('npm test');
  });

  it('auto 模式下 bash -c 命令不自动追加任务目录，避免把路径误当 bash 位置参数', () => {
    // cmd 存储 bash -c 命令渲染结果，auto 应保守跳过。
    const cmd = buildStepCommand('bash -c check-unit-test.sh', { path: '/wt/TASK-A' }, { taskArgMode: 'auto' });
    expect(cmd).toBe('bash -c check-unit-test.sh');
  });

  it('appendPath 模式下强制追加任务目录，none 模式下不追加', () => {
    // forced 存储用户显式选择「总是追加」后的命令。
    const forced = buildStepCommand('npm test', { path: '/wt/TASK-A' }, { taskArgMode: 'appendPath' });
    // skipped 存储用户显式选择「不追加」后的命令。
    const skipped = buildStepCommand('bash check-unit-test.sh', { path: '/wt/TASK-A' }, { taskArgMode: 'none' });
    expect(forced).toBe("npm test '/wt/TASK-A'");
    expect(skipped).toBe('bash check-unit-test.sh');
  });

  it('命令已显式使用 {path} 时不再重复自动追加任务目录', () => {
    // cmd 存储含显式占位符的命令，避免出现两个任务目录参数。
    const cmd = buildStepCommand('bash check-unit-test.sh {path}', { path: '/wt/TASK-A' }, { taskArgMode: 'appendPath' });
    expect(cmd).toBe("bash check-unit-test.sh '/wt/TASK-A'");
  });
});

describe('resolveShell（按平台解析执行 shell）', () => {
  it('macOS/Linux 用 bash -c 执行', () => {
    // 非 Windows 平台直接用 bash -c，保持原有 POSIX 行为
    const shell = resolveShell('darwin', () => false);
    expect(shell).toEqual({ cmd: 'bash', args: ['-c'], shell: 'bash', bashFound: true });
    // linux 同样走 bash
    expect(resolveShell('linux', () => false).cmd).toBe('bash');
  });

  it('Windows 探测到 Git Bash 时用其绝对路径 -c 执行（保持 POSIX 语义）', () => {
    // 模拟第一个候选 Git Bash 路径存在
    const shell = resolveShell('win32', (p) => p === 'C:/Program Files/Git/bin/bash.exe');
    expect(shell.cmd).toBe('C:/Program Files/Git/bin/bash.exe');
    expect(shell.args).toEqual(['-c']);
    expect(shell.shell).toBe('bash');
    expect(shell.bashFound).toBe(true);
  });

  it('Windows 未找到 Git Bash 时兜底 cmd /c，并标记 bashFound=false 供 UI 提示', () => {
    // 所有 Git Bash 候选路径都不存在 → 兜底 cmd
    const shell = resolveShell('win32', () => false);
    expect(shell).toEqual({ cmd: 'cmd', args: ['/c'], shell: 'cmd', bashFound: false });
  });

  it('Windows 探测用户级安装的 Git Bash（AppData 路径）', () => {
    // 模拟只有 AppData 下的用户级 Git 安装存在（路径以 bash.exe 结尾）
    const shell = resolveShell('win32', (p) => p.endsWith('AppData/Local/Programs/Git/bin/bash.exe'));
    expect(shell.shell).toBe('bash');
    expect(shell.bashFound).toBe(true);
    expect(shell.cmd).toContain('bash.exe');
  });
});
