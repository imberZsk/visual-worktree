import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'path';

// Claude Code 固定说明文件名：随任务根和项目 worktree 自动生成，但不属于工作文档归档模板。
const CLAUDE_FILE_NAME = 'CLAUDE.md';
// 通用 Agent 固定说明文件名：随任务根和项目 worktree 自动生成，但不属于工作文档归档模板。
const AGENTS_FILE_NAME = 'AGENTS.md';

// CLAUDE_TEMPLATE 存储 Claude Code 专用入口内容，引导 Claude 继续读取通用规则。
const CLAUDE_TEMPLATE = `# CLAUDE.md

本文件供 Claude Code 使用。

请先阅读并遵守同目录下的 AGENTS.md。AGENTS.md 是 Codex、Claude Code 等 AI 协作工具共用的项目规则。
`;

// AGENTS_TEMPLATE 存储通用 AI 协作说明内容，提示工作记录默认落在 docs/ 下。
const AGENTS_TEMPLATE = `# AGENTS.md

## 工作记录

- 所有输出文档、计划、总结、排查记录、交接说明优先放到当前目录的工作文档中，默认目录是 docs/。
- 如果 Visual Worktree 设置里配置了其他工作文档目录或文件，以当前目录下已生成的工作文档为准。
- 不要把临时工作记录散落在项目根目录。
- 修改代码时优先遵守仓库已有的 AGENTS.md、CLAUDE.md 或项目说明；本文件只补充当前 worktree 的工作记录约定。
`;

// 默认工作文档模板：开箱只创建并归档 docs 目录；CLAUDE.md / AGENTS.md 由固定说明文件逻辑单独生成。
export const DEFAULT_WORK_DOCUMENT_TEMPLATES = [
  { type: 'directory', path: 'docs', content: '' },
];

/**
 * 规范化工作文档模板列表，过滤空路径、绝对路径和路径穿越项。
 * @param {Array<{type?:string,path?:string,content?:string}>} [templates] - 用户配置的工作文档模板列表
 * @returns {Array<{type:'directory'|'file',path:string,content:string}>} 可安全使用的模板列表
 */
export function normalizeWorkDocumentTemplates(templates = DEFAULT_WORK_DOCUMENT_TEMPLATES) {
  // sourceTemplates 存储待规范化的模板列表；非数组配置视为默认模板，避免损坏配置导致功能不可用。
  const sourceTemplates = Array.isArray(templates) ? templates : DEFAULT_WORK_DOCUMENT_TEMPLATES;
  // normalizedTemplates 累积校验通过且已规整路径格式的模板。
  const normalizedTemplates = [];
  // seenPaths 存储已经收录的 type/path 组合，用于避免重复创建或重复归档。
  const seenPaths = new Set();

  for (const template of sourceTemplates) {
    // rawPath 存储用户输入的相对路径文本。
    const rawPath = String(template?.path || '').trim();
    // safePath 存储经过安全校验与格式规整后的相对路径。
    const safePath = normalizeWorkDocumentPath(rawPath);
    if (!safePath) continue;
    if (isFixedInstructionPath(safePath)) continue;

    // type 存储模板类型；除 file 外统一按 directory 处理，避免未知类型写文件。
    const type = template?.type === 'file' ? 'file' : 'directory';
    // dedupeKey 存储去重键，同一路径的同类型模板只保留第一条，避免后续内容覆盖语义不清。
    const dedupeKey = `${type}:${safePath}`;
    if (seenPaths.has(dedupeKey)) continue;
    seenPaths.add(dedupeKey);

    // content 存储文件模板要写入的默认内容；目录模板不使用内容，统一置空。
    const content = type === 'file' ? String(template?.content || '') : '';
    normalizedTemplates.push({ type, path: safePath, content });
  }

  return normalizedTemplates;
}

/**
 * 初始化工作入口目录内的固定说明文件，以及工作文档目录与文件。
 * @param {string} worktreePath - 目标工作入口目录，既可以是任务目录，也可以是项目 worktree 根目录
 * @param {Array<{type?:string,path?:string,content?:string}>} [templates] - 工作文档模板列表
 * @returns {{created:string[],skipped:string[],templates:Array<{type:'directory'|'file',path:string,content:string}>,docsPath:string}} 初始化结果
 */
export function ensureTaskDocsAssets(worktreePath, templates = DEFAULT_WORK_DOCUMENT_TEMPLATES) {
  // normalizedTemplates 存储可安全落盘的工作文档模板。
  const normalizedTemplates = normalizeWorkDocumentTemplates(templates);
  // created 累积本次新创建的目录或文件路径。
  const created = [];
  // skipped 累积因已存在而未覆盖的目录或文件路径。
  const skipped = [];
  // docsTemplate 存储默认 docs 目录模板，用于兼容旧调用方读取 docsPath。
  const docsTemplate = normalizedTemplates.find((template) => template.path === 'docs');
  // docsPath 存储默认 docs 目录路径；即使用户移除 docs 模板也给出稳定兜底路径供历史兼容。
  const docsPath = join(worktreePath, docsTemplate?.path || 'docs');

  if (!existsSync(worktreePath)) {
    mkdirSync(worktreePath, { recursive: true });
  }

  ensureFixedInstructionFiles(worktreePath, created, skipped);

  for (const template of normalizedTemplates) {
    // targetPath 存储模板在当前 worktree 根目录下对应的安全绝对路径。
    const targetPath = buildSafeWorkDocumentPath(worktreePath, template.path);
    if (!targetPath) continue;

    if (existsSync(targetPath)) {
      skipped.push(targetPath);
      continue;
    }

    if (template.type === 'directory') {
      mkdirSync(targetPath, { recursive: true });
    } else {
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, template.content, 'utf8');
    }
    created.push(targetPath);
  }

  return { created, skipped, templates: normalizedTemplates, docsPath };
}

/**
 * 初始化固定说明文件，并保留用户已写入的同名文件。
 * @param {string} worktreePath - 目标工作入口目录
 * @param {string[]} created - 本次已创建路径列表，函数会向其中追加新建文件
 * @param {string[]} skipped - 本次跳过路径列表，函数会向其中追加已存在文件
 * @returns {void}
 */
function ensureFixedInstructionFiles(worktreePath, created, skipped) {
  // fixedFiles 存储需要固定生成的说明文件名和默认内容。
  const fixedFiles = [
    { name: CLAUDE_FILE_NAME, content: CLAUDE_TEMPLATE },
    { name: AGENTS_FILE_NAME, content: AGENTS_TEMPLATE },
  ];

  for (const fixedFile of fixedFiles) {
    // targetPath 存储固定说明文件在当前工作入口下的绝对路径。
    const targetPath = join(worktreePath, fixedFile.name);
    if (existsSync(targetPath)) {
      skipped.push(targetPath);
      continue;
    }

    writeFileSync(targetPath, fixedFile.content, 'utf8');
    created.push(targetPath);
  }
}

/**
 * 计算任务 docs 归档目录路径。
 * @param {string} archiveRoot - 历史任务 docs 的根目录，如 ~/.visualWorktree/task-docs
 * @param {string} taskName - 任务名，可能包含路径分隔符
 * @returns {string} 该任务的安全归档目录路径
 */
export function buildTaskDocsArchivePath(archiveRoot, taskName) {
  // safeTaskName 存储可作为单个目录名使用的任务名，保留可读性并避免斜杠创建多级目录。
  const safeTaskName = sanitizeTaskName(taskName);
  return join(archiveRoot, safeTaskName);
}

/**
 * 归档任务根目录和每个项目 worktree 的工作文档。
 * @param {string} taskDir - 待删除的任务目录，格式通常为 worktreesRoot/{任务名}
 * @param {string} taskName - 任务名，用于生成归档目录名
 * @param {string} archiveRoot - 历史任务工作文档的根目录
 * @param {Array<{type?:string,path?:string,content?:string}>} [templates] - 工作文档模板列表
 * @returns {{success:boolean, docsPath:string, archivedProjects:number, error?:string}} 归档结果
 */
export function archiveTaskDocs(taskDir, taskName, archiveRoot, templates = DEFAULT_WORK_DOCUMENT_TEMPLATES) {
  // docsPath 存储本任务最终的归档目录。
  const docsPath = buildTaskDocsArchivePath(archiveRoot, taskName);
  // normalizedTemplates 存储可安全读取与归档的工作文档模板。
  const normalizedTemplates = normalizeWorkDocumentTemplates(templates);

  try {
    mkdirSync(docsPath, { recursive: true });

    archiveWorkDocumentsFromBase(taskDir, docsPath, normalizedTemplates);

    // projectDirs 存储任务目录下一层项目目录；任务目录不存在时视为空任务归档。
    const projectDirs = existsSync(taskDir)
      ? readdirSync(taskDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
      : [];
    // archivedProjects 存储已成功复制 docs 的项目数量。
    let archivedProjects = 0;

    // projectEntry 存储当前遍历到的项目目录项。
    for (const projectEntry of projectDirs) {
      // sourceBasePath 存储该项目 worktree 根路径，用于在其下按模板收集工作文档。
      const sourceBasePath = join(taskDir, projectEntry.name);
      // targetDocsPath 存储该项目在历史归档中的目标根目录路径。
      const targetDocsPath = join(docsPath, sanitizeProjectName(projectEntry.name));

      if (archiveWorkDocumentsFromBase(sourceBasePath, targetDocsPath, normalizedTemplates)) {
        archivedProjects += 1;
      }
    }

    return { success: true, docsPath, archivedProjects };
  } catch (e) {
    // e 存储归档过程中出现的文件系统错误，返回给调用方展示。
    return { success: false, docsPath, archivedProjects: 0, error: e.message };
  }
}

/**
 * 将任务名转换成安全、可读的单层目录名。
 * @param {string} taskName - 原始任务名
 * @returns {string} 可安全作为目录名的任务名
 */
function sanitizeTaskName(taskName) {
  // rawName 存储规整后的任务名字符串，空值时给一个稳定兜底名。
  const rawName = String(taskName || 'untitled-task').trim() || 'untitled-task';
  return rawName.replace(/[\\/]+/g, '__').replace(/[:*?"<>|]/g, '_');
}

/**
 * 将项目目录名转换成安全的单层目录名。
 * @param {string} projectName - 原始项目目录名
 * @returns {string} 可安全作为目录名的项目名
 */
function sanitizeProjectName(projectName) {
  // basename 会丢弃潜在路径片段，额外替换非法字符避免归档路径穿越或平台保留字符。
  return basename(String(projectName || 'project')).replace(/[\\/]+/g, '__').replace(/[:*?"<>|]/g, '_');
}

/**
 * 判断路径是否存在且为目录。
 * @param {string} targetPath - 待判断路径
 * @returns {boolean} 是否为目录
 */
function isDirectory(targetPath) {
  try {
    return statSync(targetPath).isDirectory();
  } catch (e) {
    // e 存储 statSync 读取失败原因；路径不存在时按非目录处理。
    return false;
  }
}

/**
 * 将固定说明文件与工作文档模板路径加入仓库本地 exclude，避免安全删除 worktree 时被自动生成文件误判为脏数据。
 * @param {string} gitCommonDir - 仓库 common git dir，通常是源仓库 .git 目录
 * @param {Array<{type?:string,path?:string,content?:string}>} [templates] - 工作文档模板列表
 * @returns {{updated:boolean, excludePath:string}} 是否写入了新规则及 exclude 文件路径
 */
export function ensureTaskDocsGitExclude(gitCommonDir, templates = DEFAULT_WORK_DOCUMENT_TEMPLATES) {
  // excludePath 存储仓库本地忽略规则文件路径；info/exclude 不进版本库，只影响本机。
  const excludePath = join(gitCommonDir, 'info', 'exclude');
  // normalizedTemplates 存储可安全加入 exclude 的工作文档模板。
  const normalizedTemplates = normalizeWorkDocumentTemplates(templates);
  // requiredPatterns 存储需要忽略的自动工作文档路径模式。
  const requiredPatterns = [
    CLAUDE_FILE_NAME,
    AGENTS_FILE_NAME,
    ...normalizedTemplates.map((template) => (
      template.type === 'directory' ? `${template.path}/` : template.path
    )),
  ];
  // currentContent 存储当前 exclude 内容，文件不存在时视为空。
  const currentContent = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
  // existingPatterns 存储逐行去空白后的已有规则，用于幂等去重。
  const existingPatterns = new Set(currentContent.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  // missingPatterns 存储尚未写入的规则。
  const missingPatterns = requiredPatterns.filter((pattern) => !existingPatterns.has(pattern));

  if (missingPatterns.length === 0) {
    return { updated: false, excludePath };
  }

  mkdirSync(dirname(excludePath), { recursive: true });
  // prefix 存储追加前是否需要补换行，避免把规则接到已有最后一行末尾。
  const prefix = currentContent && !currentContent.endsWith('\n') ? '\n' : '';
  appendFileSync(excludePath, `${prefix}${missingPatterns.join('\n')}\n`, 'utf8');
  return { updated: true, excludePath };
}

/**
 * 规范化单个工作文档相对路径，拒绝可能越界的路径。
 * @param {string} rawPath - 用户输入的原始路径
 * @returns {string} 安全相对路径；非法时返回空字符串
 */
function normalizeWorkDocumentPath(rawPath) {
  // slashPath 存储统一为 POSIX 分隔符的路径文本，方便做跨平台段落校验。
  const slashPath = String(rawPath || '').trim().replace(/\\/g, '/');
  if (!slashPath || isAbsolute(slashPath)) return '';
  // segments 存储路径段；任何 .. 都视为越界风险，即便 normalize 后可抵消也不接受。
  const segments = slashPath.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === '..')) return '';
  // normalizedPath 存储去掉重复分隔符和末尾斜杠后的相对路径。
  const normalizedPath = normalize(slashPath).replace(/\\/g, '/').replace(/\/+$/g, '');
  if (!normalizedPath || normalizedPath === '.' || normalizedPath.startsWith('../')) return '';
  return normalizedPath;
}

/**
 * 判断工作文档路径是否命中固定说明文件。
 * @param {string} documentPath - 已规范化的工作文档相对路径
 * @returns {boolean} 是否为固定说明文件路径
 */
function isFixedInstructionPath(documentPath) {
  // normalizedPath 存储统一大小写后的路径文本，用于匹配根目录固定说明文件。
  const normalizedPath = String(documentPath || '').toLowerCase();
  return normalizedPath === CLAUDE_FILE_NAME.toLowerCase() || normalizedPath === AGENTS_FILE_NAME.toLowerCase();
}

/**
 * 把工作文档相对路径解析到指定根目录下，并确认不会越过根目录。
 * @param {string} rootPath - 工作入口根目录
 * @param {string} documentPath - 已规范化的工作文档相对路径
 * @returns {string} 安全绝对路径；越界时返回空字符串
 */
function buildSafeWorkDocumentPath(rootPath, documentPath) {
  // resolvedRoot 存储根目录绝对路径，用于与目标路径做相对关系判断。
  const resolvedRoot = resolve(rootPath);
  // resolvedTarget 存储模板路径解析后的绝对路径。
  const resolvedTarget = resolve(resolvedRoot, documentPath);
  // relativePath 存储目标相对根目录的路径；以 .. 开头或绝对路径代表越界。
  const relativePath = relative(resolvedRoot, resolvedTarget);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) return '';
  return resolvedTarget;
}

/**
 * 从一个任务根或项目 worktree 根目录按模板归档工作文档。
 * @param {string} sourceBasePath - 待收集的任务根或项目 worktree 根目录
 * @param {string} targetBasePath - 归档目标根目录
 * @param {Array<{type:'directory'|'file',path:string,content:string}>} templates - 已规范化的工作文档模板
 * @returns {boolean} 是否至少归档了一个文件或目录
 */
function archiveWorkDocumentsFromBase(sourceBasePath, targetBasePath, templates) {
  // archived 存储当前根目录是否有任何模板被成功复制。
  let archived = false;

  for (const template of templates) {
    // sourcePath 存储当前模板在源根目录下的安全路径。
    const sourcePath = buildSafeWorkDocumentPath(sourceBasePath, template.path);
    // targetPath 存储当前模板在归档根目录下的安全路径；默认 docs 目录沿用旧版平铺行为，其他目录保留目录名避免冲突。
    const targetPath = template.type === 'directory'
      ? getDirectoryArchiveTargetPath(targetBasePath, template.path)
      : buildSafeWorkDocumentPath(targetBasePath, template.path);
    if (!sourcePath || !targetPath || !existsSync(sourcePath)) continue;

    if (template.type === 'directory') {
      if (!isDirectory(sourcePath)) continue;
      mkdirSync(targetPath, { recursive: true });
      cpSync(sourcePath, targetPath, { recursive: true, force: true });
    } else {
      if (!isFile(sourcePath)) continue;
      mkdirSync(dirname(targetPath), { recursive: true });
      cpSync(sourcePath, targetPath, { force: true });
    }
    archived = true;
  }

  return archived;
}

/**
 * 计算目录模板的归档目标路径。
 * @param {string} targetBasePath - 归档目标根目录
 * @param {string} documentPath - 工作文档目录相对路径
 * @returns {string} 目录模板的归档目标路径
 */
function getDirectoryArchiveTargetPath(targetBasePath, documentPath) {
  // docs 作为历史默认工作文档目录，保留旧版“复制 docs 内容到归档根”的行为，避免历史入口层级变化。
  if (documentPath === 'docs') return targetBasePath;
  return buildSafeWorkDocumentPath(targetBasePath, documentPath);
}

/**
 * 判断路径是否存在且为普通文件。
 * @param {string} targetPath - 待判断路径
 * @returns {boolean} 是否为文件
 */
function isFile(targetPath) {
  try {
    return statSync(targetPath).isFile();
  } catch (e) {
    // e 存储 statSync 读取失败原因；路径不存在时按非文件处理。
    return false;
  }
}
