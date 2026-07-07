// 想法工作流核心逻辑：负责工作流定义与运行历史的持久化读写。
// 纯 Node 模块，不依赖 Electron，便于 vitest 直接单测。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * 惰性计算配置目录路径（~/.visualWorktree）。
 * WHY 不用模块级常量：测试时 os.homedir 会被 mock，若在模块加载期就求值，
 * mock 尚未生效（tmpHome 为 undefined），会写入真实用户目录造成污染；
 * 改为每次函数调用时求值，保证测试隔离。
 * @returns {string} 配置目录绝对路径
 */
function configDir() {
  return join(homedir(), '.visualWorktree');
}

/**
 * 惰性获取工作流定义文件绝对路径。
 * @returns {string} 文件路径
 */
function workflowsFile() {
  return join(configDir(), 'idea-workflows.json');
}

/**
 * 惰性获取运行历史文件绝对路径。
 * @returns {string} 文件路径
 */
function runsFile() {
  return join(configDir(), 'idea-runs.json');
}

/** 运行历史最大保留条数 */
const MAX_RUNS = 50;

/**
 * 内置默认工作流定义列表，文件不存在时作为初始值返回。
 * 每条定义包含 id、名称、描述和步骤数组。
 */
const DEFAULT_WORKFLOWS = [
  {
    id: 'quick-impl',                       // 工作流唯一标识
    name: '快速实现',                        // 工作流显示名称
    description: '快速将想法落地为代码分支', // 工作流描述
    steps: [
      { key: 'create-branch', label: '新建分支', command: 'git checkout -b idea/{idea}' },
      { key: 'run-dev',       label: '启动开发', command: 'npm run dev'                  },
    ],
  },
  {
    id: 'full-flow',                            // 工作流唯一标识
    name: '完整流程',                            // 工作流显示名称
    description: '从想法到测试的完整研发流程',   // 工作流描述
    steps: [
      { key: 'create-branch', label: '新建分支',   command: 'git checkout -b idea/{idea}'  },
      { key: 'install',       label: '安装依赖',   command: 'npm install'                   },
      { key: 'test',          label: '运行测试',   command: 'npm test'                      },
      { key: 'build',         label: '构建产物',   command: 'npm run build'                 },
    ],
  },
];

/**
 * 确保配置目录存在，不存在时递归创建。
 * 集中处理目录创建，避免每个读写函数重复判断。
 */
function ensureConfigDir() {
  // dir 为本次解析出的配置目录路径
  const dir = configDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * 从 JSON 文件读取数据，文件不存在或解析失败时返回 fallback。
 * @param {string} filePath - 要读取的 JSON 文件绝对路径
 * @param {*} fallback - 文件不存在或解析失败时的默认返回值
 * @returns {*} 解析后的数据或 fallback
 */
function readJson(filePath, fallback) {
  // 文件不存在直接返回默认值，避免抛出 ENOENT 错误
  if (!existsSync(filePath)) return fallback;
  try {
    // rawContent 为文件原始字符串内容
    const rawContent = readFileSync(filePath, 'utf8');
    return JSON.parse(rawContent);
  } catch {
    // 文件损坏或格式错误时返回默认值，保证程序可继续运行
    return fallback;
  }
}

/**
 * 将数据序列化为 JSON 并写入文件（覆盖写）。
 * @param {string} filePath - 目标文件绝对路径
 * @param {*} data - 要持久化的数据
 */
function writeJson(filePath, data) {
  ensureConfigDir();
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * 加载工作流定义列表。
 * 文件不存在时返回内置的两条默认定义。
 * @returns {{ id:string, name:string, description:string, steps:{key,label,command}[] }[]} 定义数组
 */
export function loadIdeaWorkflows() {
  // workflows 为从文件读取的定义数组，或内置默认值
  const workflows = readJson(workflowsFile(), null);
  return Array.isArray(workflows) ? workflows : [...DEFAULT_WORKFLOWS];
}

/**
 * 保存工作流定义列表到持久化文件。
 * @param {{ id:string, name:string, description:string, steps:{key,label,command}[] }[]} defs - 要保存的定义数组
 */
export function saveIdeaWorkflows(defs) {
  writeJson(workflowsFile(), defs);
}

/**
 * 加载运行历史列表（最多返回 50 条）。
 * 文件不存在时返回空数组。
 * @returns {{ id,workflowId,workflowName,idea,targetDir,startedAt,finishedAt,status,steps }[]} 运行历史数组
 */
export function loadIdeaRuns() {
  // runs 为从文件读取的运行历史数组，或空数组
  const runs = readJson(runsFile(), []);
  return Array.isArray(runs) ? runs : [];
}

/**
 * 向运行历史头部插入一条新记录，并截断到最多 50 条后持久化。
 * @param {{ id,workflowId,workflowName,idea,targetDir,startedAt,finishedAt,status,steps }} run - 新的运行记录
 */
export function appendIdeaRun(run) {
  // existing 为当前已有的运行历史
  const existing = loadIdeaRuns();
  // updated 为插入新记录后截断到 MAX_RUNS 条的最终列表
  const updated = [run, ...existing].slice(0, MAX_RUNS);
  writeJson(runsFile(), updated);
}
