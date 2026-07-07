import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// 环境检查结果持久化：按任务名保存上次检查状态，供应用重启后继续显示红/绿环境状态。

/**
 * 计算环境检查缓存文件路径。
 * @param {string} [baseDir] - 测试用配置目录；默认 ~/.visualWorktree
 * @returns {{dir:string,file:string}} 缓存目录与文件路径
 */
export function getTaskEnvHealthPaths(baseDir) {
  // dir 为统一持久化目录，与任务状态/卡点/流程勾选同处 ~/.visualWorktree
  const dir = baseDir || join(homedir(), '.visualWorktree');
  return { dir, file: join(dir, 'task-env-health.json') };
}

/**
 * 判断读取到的环境检查缓存是否为有效映射。
 * @param {any} value - 待读取值
 * @returns {boolean} 是否为对象映射
 */
function isEnvHealthMap(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 读取任务环境检查缓存。
 * @param {string} [baseDir] - 测试用配置目录；默认 ~/.visualWorktree
 * @returns {Record<string,object>} 任务名到环境检查缓存的映射
 */
export function loadTaskEnvHealth(baseDir) {
  // file 为环境检查缓存 JSON 文件
  const { file } = getTaskEnvHealthPaths(baseDir);
  try {
    if (!existsSync(file)) return {};
    // parsed 为缓存 JSON 内容，非对象时视为损坏并回退空对象
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return isEnvHealthMap(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

/**
 * 保存任务环境检查缓存。
 * @param {Record<string,object>} map - 任务名到环境检查缓存的映射
 * @param {string} [baseDir] - 测试用配置目录；默认 ~/.visualWorktree
 * @returns {boolean} 是否保存成功
 */
export function saveTaskEnvHealth(map, baseDir) {
  // dir/file 为环境检查缓存目标路径
  const { dir, file } = getTaskEnvHealthPaths(baseDir);
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(isEnvHealthMap(map) ? map : {}, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}
