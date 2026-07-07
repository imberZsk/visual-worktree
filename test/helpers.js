import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

// 测试辅助：在临时目录创建真实 git 仓库，用于核心模块的集成测试。
// 用真实 git 而非 mock，确保对 simple-git 行为的断言可靠。

/**
 * 在指定目录执行 git 命令（同步），statusError 时抛出便于调试
 * @param {string} cwd - 执行目录
 * @param {string} cmd - git 子命令（不含 git 前缀）
 * @returns {string} 命令标准输出
 */
export function git(cwd, cmd) {
  return execSync(`git ${cmd}`, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 't@t.co', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 't@t.co' },
  }).toString();
}

/**
 * 创建一个临时根目录，测试结束时统一清理
 * @returns {{ root: string, cleanup: () => void }} 根目录路径与清理函数
 */
export function makeTempRoot() {
  // tmpRoot 存放本次测试用的所有临时仓库
  const tmpRoot = mkdtempSync(join(tmpdir(), 'pm-test-'));
  return {
    root: tmpRoot,
    cleanup: () => rmSync(tmpRoot, { recursive: true, force: true }),
  };
}

/**
 * 初始化一个带初始提交的本地仓库
 * @param {string} dir - 仓库目录（会被创建）
 * @param {string} defaultBranch - 默认分支名
 * @returns {string} 仓库路径
 */
export function initRepo(dir, defaultBranch = 'master') {
  mkdirSync(dir, { recursive: true });
  git(dir, `init -q -b ${defaultBranch}`);
  git(dir, 'config commit.gpgsign false');
  writeFileSync(join(dir, 'README.md'), '# repo\n');
  git(dir, 'add -A');
  git(dir, 'commit -q -m "init"');
  return dir;
}

/**
 * 创建一个"远程 + 本地克隆"的配对，用于测试 ahead/behind/pull 场景
 * @param {string} baseDir - 存放 remote.git 和 local 的父目录
 * @param {string} defaultBranch - 默认分支名
 * @returns {{ remote: string, local: string }} 裸远程仓库路径与本地克隆路径
 */
export function makeRemoteAndClone(baseDir, defaultBranch = 'master') {
  // remote 是裸仓库，模拟 origin
  const remote = join(baseDir, 'remote.git');
  // seed 是用于初始化远程内容的临时工作区
  const seed = join(baseDir, 'seed');
  mkdirSync(remote, { recursive: true });
  git(remote, `init -q --bare -b ${defaultBranch}`);
  initRepo(seed, defaultBranch);
  git(seed, `remote add origin ${remote}`);
  git(seed, `push -q -u origin ${defaultBranch}`);
  // local 是被测仓库，从 remote 克隆
  const local = join(baseDir, 'local');
  git(baseDir, `clone -q ${remote} local`);
  git(local, 'config commit.gpgsign false');
  return { remote, local, seed };
}

/**
 * 在仓库中写入文件并产生一个提交
 * @param {string} dir - 仓库目录
 * @param {string} file - 文件名
 * @param {string} content - 文件内容
 * @param {string} msg - 提交信息
 */
export function commitFile(dir, file, content, msg) {
  writeFileSync(join(dir, file), content);
  git(dir, 'add -A');
  git(dir, `commit -q -m "${msg}"`);
}
