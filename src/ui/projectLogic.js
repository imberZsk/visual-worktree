// 项目列表的纯逻辑：筛选、搜索、统计。抽离为纯函数便于单元测试，UI 组件直接复用。

// 筛选类型常量
export const FILTERS = {
  ALL: 'all',
  NON_MAIN: 'non-main',
  HAS_CHANGES: 'has-changes',
  CAN_PULL: 'can-pull',
};

/**
 * 根据筛选条件与搜索词过滤项目列表
 * @param {Array<object>} projects - 项目状态数组
 * @param {string} filter - 筛选类型（FILTERS 之一）
 * @param {string} keyword - 搜索关键词（按名称模糊匹配）
 * @returns {Array<object>} 过滤后的项目数组
 */
export function filterProjects(projects, filter, keyword = '') {
  // kw 为标准化后的关键词
  const kw = keyword.trim().toLowerCase();
  return projects.filter((p) => {
    // 关键词不匹配则排除
    if (kw && !p.name.toLowerCase().includes(kw)) return false;
    // 按筛选类型判断
    switch (filter) {
      case FILTERS.NON_MAIN:
        // 仅显示非主分支
        return p.isGitRepo && !p.isMainBranch;
      case FILTERS.HAS_CHANGES:
        // 仅显示有未提交变更
        return p.hasUncommittedChanges;
      case FILTERS.CAN_PULL:
        // 仅显示可拉取更新
        return p.canPull;
      case FILTERS.ALL:
      default:
        return true;
    }
  });
}

/**
 * 统计项目概览数据，用于顶部展示
 * @param {Array<object>} projects - 项目状态数组
 * @returns {{total:number, nonMain:number, hasChanges:number, canPull:number}} 统计结果
 */
export function summarize(projects) {
  return {
    // 项目总数
    total: projects.length,
    // 非主分支数量
    nonMain: projects.filter((p) => p.isGitRepo && !p.isMainBranch).length,
    // 有未提交变更数量
    hasChanges: projects.filter((p) => p.hasUncommittedChanges).length,
    // 可拉取更新数量
    canPull: projects.filter((p) => p.canPull).length,
  };
}

/**
 * 计算项目状态标签列表，用于表格展示
 * @param {object} p - 单个项目状态
 * @returns {Array<{text:string, color:string}>} 标签数组
 */
export function statusTags(p) {
  // tags 累积该项目的所有状态标签
  const tags = [];
  if (!p.isGitRepo) {
    tags.push({ text: '非 Git 仓库', color: 'default' });
    return tags;
  }
  // 主分支 / 非主分支
  if (p.isMainBranch) {
    tags.push({ text: '主分支', color: 'green' });
  } else {
    tags.push({ text: '非主分支', color: 'orange' });
  }
  // 未提交变更
  if (p.hasTrackedChanges || (p.hasUncommittedChanges && !p.hasUntrackedChanges)) tags.push({ text: '有变更', color: 'red' });
  // 未跟踪文件单独展示，避免只有新增未纳管目录时被误解为已有文件 diff。
  if (p.hasUntrackedChanges) tags.push({ text: `未跟踪${p.untrackedFilesCount ? ` ${p.untrackedFilesCount}` : ''}`, color: 'volcano' });
  // 领先远程（有未推送提交）
  if (p.hasUnpushedCommits) tags.push({ text: `领先 ${p.ahead}`, color: 'blue' });
  // 可拉取
  if (p.canPull) tags.push({ text: `落后 ${p.behind}`, color: 'gold' });
  // 远程未连接：本次刷新 fetch 失败（离线/超时/鉴权），领先落后数基于本地引用，可能不准，提示用户
  if (p.fetchFailed) tags.push({ text: '远程未连接', color: 'volcano' });
  return tags;
}
