#!/usr/bin/env node

// Claude Code 用量统计验证脚本：读取本地真实数据，测试 claudeService 功能

import { scanClaudeSessions, getSessionsByTask, cwdToProjectDir } from '../src/core/claudeService.js';
import { loadConfig } from '../src/core/config.js';
import { homedir } from 'os';
import { join } from 'path';

console.log('🔍 扫描 Claude Code 会话...\n');

// 扫描所有会话
const sessions = scanClaudeSessions();
console.log(`找到 ${sessions.length} 个会话\n`);

// 显示前 5 个会话
sessions.slice(0, 5).forEach((session, idx) => {
  console.log(`会话 ${idx + 1}:`);
  console.log(`  会话 ID: ${session.sessionId}`);
  console.log(`  工作目录: ${session.cwd || '(无)'}`);
  console.log(`  模型: ${session.model || '(未知)'}`);
  console.log(`  创建时间: ${session.createdAt ? new Date(session.createdAt).toLocaleString('zh-CN') : '(无)'}`);
  console.log(`  意图: ${session.intent?.substring(0, 50) || '(无)'}${session.intent?.length > 50 ? '...' : ''}`);
  console.log();
});

// 测试 cwdToProjectDir 转换
console.log('📁 测试路径转换:');
const testCwd = sessions[0]?.cwd || '/Users/test/Desktop';
const projectDir = cwdToProjectDir(testCwd);
console.log(`  cwd: ${testCwd}`);
console.log(`  → projects 子目录: ${projectDir}`);
console.log(`  → 完整路径: ${join(homedir(), '.claude', 'projects', projectDir)}`);
console.log();

// 从用户配置读取 worktree 根目录（~/.visualWorktree/config.json 的 worktreesPath）。
// 该路径由用户在设置中动态配置，脚本默认复用它，避免硬编码。
const configuredWorktreesRoot = loadConfig().worktreesPath;

// 测试任务关联（默认用配置里的 worktree 根目录，也可命令行覆盖）
console.log('💡 提示：');
console.log(`  当前配置的 worktree 根目录: ${configuredWorktreesRoot}`);
console.log('  要测试任务关联功能，请运行（第二个参数可选，省略则用上面的配置路径）：');
console.log('  node scripts/verify-claude-usage.js <任务名> [worktree根目录]');
console.log();
console.log('  例如：');
console.log('  node scripts/verify-claude-usage.js "PROJ-1001-订单状态提醒"');

// 提供了任务名参数时执行任务关联测试；worktree 根目录优先取命令行参数，否则用配置值
if (process.argv.length >= 3) {
  const taskName = process.argv[2];
  const worktreesRoot = process.argv[3] || configuredWorktreesRoot;

  console.log(`\n🔗 测试任务关联: ${taskName}`);
  console.log(`   worktree 根目录: ${worktreesRoot}\n`);

  const taskSessions = getSessionsByTask(taskName, worktreesRoot);
  console.log(`找到 ${taskSessions.length} 个关联会话\n`);

  taskSessions.forEach((session, idx) => {
    console.log(`会话 ${idx + 1}:`);
    console.log(`  会话 ID: ${session.sessionId}`);
    console.log(`  工作目录: ${session.cwd || '(无)'}`);
    console.log(`  Token 用量:`);
    console.log(`    Input: ${session.usage.input.toLocaleString()}`);
    console.log(`    Output: ${session.usage.output.toLocaleString()}`);
    console.log(`    Cache Write: ${session.usage.cacheWrite.toLocaleString()}`);
    console.log(`    Cache Read: ${session.usage.cacheRead.toLocaleString()}`);
    console.log(`  费用:`);
    console.log(`    USD: $${session.cost.usd.toFixed(4)}`);
    console.log(`    CNY: ¥${session.cost.cny.toFixed(2)}`);
    // 按模型拆分的费用明细（多 agent 工作流常跨模型，逐项展示便于核对）
    if (session.byModel && Object.keys(session.byModel).length > 0) {
      console.log(`  按模型明细:`);
      Object.entries(session.byModel).forEach(([model, detail]) => {
        console.log(`    ${model}: $${detail.cost.usd.toFixed(4)} (¥${detail.cost.cny.toFixed(2)})`);
      });
    }
    console.log();
  });

  // 汇总
  const totalUsage = taskSessions.reduce(
    (acc, s) => ({
      input: acc.input + s.usage.input,
      output: acc.output + s.usage.output,
      cacheWrite: acc.cacheWrite + s.usage.cacheWrite,
      cacheRead: acc.cacheRead + s.usage.cacheRead,
    }),
    { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }
  );
  const totalCost = taskSessions.reduce((sum, s) => sum + s.cost.usd, 0);

  console.log('📊 汇总:');
  console.log(`  会话数: ${taskSessions.length}`);
  console.log(`  总 Token: ${Object.values(totalUsage).reduce((a, b) => a + b, 0).toLocaleString()}`);
  console.log(`  总费用: $${totalCost.toFixed(4)} (¥${(totalCost * 7.2).toFixed(2)})`);
}
