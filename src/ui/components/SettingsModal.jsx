import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Drawer, Form, Input, Switch, Select, AutoComplete, Button, Space, Tabs, App as AntApp, Typography, theme, Tag, Modal } from 'antd';
import { PlusOutlined, MinusCircleOutlined, EditOutlined } from '@ant-design/icons';
import { api } from '../api.js';
import { useStore } from '../store/useStore.js';
import { DEFAULT_WORKFLOW_STEPS, TASK_ARG_MODE_APPEND_PATH, TASK_ARG_MODE_AUTO, TASK_ARG_MODE_NONE, normalizeWorkflowSteps } from '../workflowLogic.js';
import { TASK_TITLE_BADGE_ITEMS, normalizeTaskTitleBadges } from '../visibilityLogic.js';
import { withConfirmDefaults } from '../modalDefaults.js';

// 默认工作文档模板：设置页缺省时只配置会归档的 docs 目录，固定说明文件由核心层单独生成。
const DEFAULT_WORK_DOCUMENT_TEMPLATES = [{ type: 'directory', path: 'docs', content: '' }];
// 设置抽屉：拆分为「路径」「工具」「工作文档」「流程」「CI/CD」五个 Tab 分别配置。
// Text 用于设置项内的辅助说明文字。
const { Text } = Typography;
// 流程步骤详情弹层层级：需高于设置 Drawer，避免弹层被抽屉遮挡。
const WORKFLOW_STEP_EDITOR_Z_INDEX = 1300;
// 工作文档详情弹层层级：需高于设置 Drawer，避免弹层被抽屉遮挡。
const WORK_DOCUMENT_EDITOR_Z_INDEX = 1300;
// 路径组合管理弹层层级：需高于设置 Drawer，避免弹层被抽屉遮挡。
const PATH_PROFILE_EDITOR_Z_INDEX = 1300;
// WORKFLOW_TASK_ARG_MODE_OPTIONS 存储流程步骤「任务目录参数」的下拉选项。
const WORKFLOW_TASK_ARG_MODE_OPTIONS = [
  { label: '自动', value: TASK_ARG_MODE_AUTO },
  { label: '不追加', value: TASK_ARG_MODE_NONE },
  { label: '总是追加', value: TASK_ARG_MODE_APPEND_PATH },
];

// DISPLAY_BADGE_DESCRIPTIONS 存储「设置 → 展示」中每个任务标题徽标的用户友好说明。
const DISPLAY_BADGE_DESCRIPTIONS = {
  projectCount: '展示任务包含的项目数量，快速判断影响范围。',
  taskStatus: '展示未开始、进行中、待发布等人工状态，方便按任务阶段扫视。',
  taskLinks: '展示绑定的需求或工单链接，减少在任务和外部系统之间来回查找。',
  envHealth: '展示自动环境检查结果，快速发现依赖、端口或服务问题。',
  claudeUsage: '展示任务关联的 Token 与费用消耗，便于控制 AI 使用成本。',
};

// 编辑器打开命令的预置选项：覆盖常见编辑器；用 AutoComplete 既可下拉选择也可手动输入自定义命令。
// {path} 为路径占位符；code 命令会在主进程自动注入 -n 新窗口打开，避免替换当前窗口。
const EDITOR_COMMAND_OPTIONS = [
  { label: 'VSCode（code {path}）', value: 'code {path}' },
  { label: 'Cursor（cursor {path}）', value: 'cursor {path}' },
  { label: 'Trae（trae {path}）', value: 'trae {path}' },
  { label: 'WebStorm（webstorm {path}）', value: 'webstorm {path}' },
];

// 各平台终端应用下拉选项：Windows 用 Windows Terminal/PowerShell/cmd，macOS 用 Terminal/iTerm2/Ghostty。
// value 与主进程 openInTerminal/resolveTerminalKind 识别的 terminalApp 取值保持一致。
const TERMINAL_OPTIONS_WIN32 = [
  { value: 'wt', label: 'Windows Terminal（推荐，Win11 自带）' },
  { value: 'powershell', label: 'PowerShell（Windows 自带）' },
  { value: 'cmd', label: 'cmd（Windows 自带，兜底）' },
];
// macOS 终端选项（保持原有）
const TERMINAL_OPTIONS_DARWIN = [
  { value: 'Terminal', label: 'Terminal（macOS 默认，推荐）' },
  { value: 'iTerm2', label: 'iTerm2' },
  { value: 'Ghostty', label: 'Ghostty' },
];
// PATH_PROFILE_ID_PREFIX 存储设置页新建路径组合时使用的 id 前缀。
const PATH_PROFILE_ID_PREFIX = 'path-profile';
// DEFAULT_PATH_PROFILE_NAME 存储旧配置迁移到路径组合时使用的默认名称。
const DEFAULT_PATH_PROFILE_NAME = '工作路径';

/**
 * 将配置里的路径组合规范化为设置表单可直接使用的结构。
 * @param {object|null} config - 当前应用配置
 * @returns {{pathProfiles:Array,activePathProfileId:string}} 表单路径组合与当前启用 id
 */
function normalizePathProfilesForForm(config) {
  // fallbackProfile 存储从旧版顶层路径字段构造出的默认组合。
  const fallbackProfile = {
    id: 'default',
    name: DEFAULT_PATH_PROFILE_NAME,
    sourceProjectsPath: config?.sourceProjectsPath || '',
    worktreesPath: config?.worktreesPath || '',
  };
  // rawProfiles 存储配置里的路径组合数组；旧配置没有该字段时用 fallbackProfile 迁移。
  const rawProfiles = Array.isArray(config?.pathProfiles) && config.pathProfiles.length > 0
    ? config.pathProfiles
    : [fallbackProfile];
  // profiles 存储清洗后的路径组合表单值。
  let profiles = rawProfiles.map((profile, index) => ({
    id: String(profile?.id || (index === 0 ? 'default' : `${PATH_PROFILE_ID_PREFIX}-${index + 1}`)).trim(),
    name: String(profile?.name || `路径组合 ${index + 1}`).trim(),
    sourceProjectsPath: String(profile?.sourceProjectsPath || fallbackProfile.sourceProjectsPath || '').trim(),
    worktreesPath: String(profile?.worktreesPath || fallbackProfile.worktreesPath || '').trim(),
  })).filter((profile) => profile.id);
  if (profiles.length === 0) profiles = [fallbackProfile];
  // activePathProfileId 存储当前启用组合 id；失效时回退第一组。
  const activePathProfileId = profiles.some((profile) => profile.id === config?.activePathProfileId)
    ? config.activePathProfileId
    : profiles[0].id;
  return { pathProfiles: profiles, activePathProfileId };
}

/**
 * 创建一个新的路径组合草稿。
 * @param {number} index - 新组合即将插入的下标
 * @returns {{id:string,name:string,sourceProjectsPath:string,worktreesPath:string}} 新路径组合草稿
 */
function createPathProfileDraft(index) {
  // timestamp 存储当前时间戳，确保连续新增的组合 id 不与已有组合冲突。
  const timestamp = Date.now();
  // id 存储新组合的唯一标识。
  const id = `${PATH_PROFILE_ID_PREFIX}-${timestamp}-${index + 1}`;
  // name 存储新组合名称；新增时留空，让用户手动输入并走必填校验。
  const name = '';
  // sourceProjectsPath 存储新组合源项目根目录；新增时留空，让用户明确选择/输入。
  const sourceProjectsPath = '';
  // worktreesPath 存储新组合 worktree 根目录；新增时留空，让用户明确选择/输入。
  const worktreesPath = '';
  return { id, name, sourceProjectsPath, worktreesPath };
}

/**
 * 把 Form 字段路径转成稳定字符串 key，用于目录选择按钮 loading 状态。
 * @param {string|string[]} fieldName - Form 字段名或字段路径数组
 * @returns {string} 可比较的字段 key
 */
function getFormFieldKey(fieldName) {
  return Array.isArray(fieldName) ? fieldName.join('.') : String(fieldName || '');
}

/**
 * 保存前清洗路径组合列表，过滤损坏项并补齐展示名。
 * @param {Array} rawProfiles - 表单收集到的路径组合数组
 * @returns {Array<{id:string,name:string,sourceProjectsPath:string,worktreesPath:string}>} 可保存的路径组合
 */
function normalizePathProfilesForSave(rawProfiles) {
  // profiles 存储表单里的路径组合数组；非数组时回退空数组。
  const profiles = Array.isArray(rawProfiles) ? rawProfiles : [];
  return profiles.map((profile, index) => ({
    id: String(profile?.id || `${PATH_PROFILE_ID_PREFIX}-${index + 1}`).trim(),
    name: String(profile?.name || `路径组合 ${index + 1}`).trim(),
    sourceProjectsPath: String(profile?.sourceProjectsPath || '').trim(),
    worktreesPath: String(profile?.worktreesPath || '').trim(),
  })).filter((profile) => profile.id && profile.sourceProjectsPath && profile.worktreesPath);
}

/**
 * 从路径组合列表中解析当前启用的组合 id。
 * @param {string} rawActivePathProfileId - 表单当前选择的组合 id
 * @param {Array<{id:string}>} pathProfiles - 已清洗的路径组合列表
 * @returns {string} 有效的当前组合 id
 */
function resolveActivePathProfileId(rawActivePathProfileId, pathProfiles) {
  // activePathProfileId 存储去空白后的候选组合 id。
  const activePathProfileId = String(rawActivePathProfileId || '').trim();
  return pathProfiles.some((profile) => profile.id === activePathProfileId)
    ? activePathProfileId
    : pathProfiles[0]?.id;
}

/**
 * 按运行平台返回终端应用下拉选项。
 * @param {string} platform - 运行平台标识（来自 api.platform，如 'win32'|'darwin'）
 * @returns {{value:string,label:string}[]} 当前平台可选的终端应用列表
 */
function getTerminalOptions(platform) {
  // Windows 展示 wt/powershell/cmd，其余（macOS/Linux）展示 Terminal 系
  return platform === 'win32' ? TERMINAL_OPTIONS_WIN32 : TERMINAL_OPTIONS_DARWIN;
}

/**
 * 设置抽屉
 * @param {object} props - 组件属性
 * @param {boolean} props.open - 是否打开
 * @param {object|null} props.config - 当前配置
 * @param {()=>void} props.onClose - 关闭回调
 * @param {(cfg:object)=>void} props.onSaved - 保存成功回调
 * @returns {JSX.Element} 抽屉元素
 */
export default function SettingsModal({ open, config, onClose, onSaved }) {
  // antd 表单实例
  const [form] = Form.useForm();
  // fallbackPathProfileState 存储从配置推导出的路径组合，用于路径组合表单尚未挂载时给当前组合下拉兜底。
  const fallbackPathProfileState = useMemo(() => normalizePathProfilesForForm(config), [config]);
  // watchedPathProfiles 存储路径组合表单当前值，用于驱动「当前路径组合」下拉选项实时刷新；preserve 允许读取尚未挂载到弹层中的字段。
  const watchedPathProfiles = Form.useWatch('pathProfiles', { form, preserve: true }) || form.getFieldValue('pathProfiles');
  // effectivePathProfiles 存储当前用于渲染路径组合下拉的列表；表单未挂载/未同步时先使用配置兜底。
  const effectivePathProfiles = Array.isArray(watchedPathProfiles) && watchedPathProfiles.length > 0
    ? watchedPathProfiles
    : fallbackPathProfileState.pathProfiles;
  // pathProfileOptions 存储当前路径组合下拉选项，名称编辑后立即反映在 Select 中。
  const pathProfileOptions = useMemo(() => {
    // profiles 存储可用于生成下拉选项的路径组合数组。
    return effectivePathProfiles
      .filter((profile) => profile?.id)
      .map((profile, index) => ({
        value: profile.id,
        label: String(profile.name || `路径组合 ${index + 1}`).trim() || `路径组合 ${index + 1}`,
      }));
  }, [effectivePathProfiles]);
  // workflowEditorIndex 当前正在编辑的流程步骤下标；null 表示未打开编辑弹层。
  const [workflowEditorIndex, setWorkflowEditorIndex] = useState(null);
  // workDocumentEditorIndex 当前正在编辑的工作文档模板下标；null 表示未打开编辑弹层。
  const [workDocumentEditorIndex, setWorkDocumentEditorIndex] = useState(null);
  // pathProfileEditorOpen 标记路径组合管理弹层是否打开。
  const [pathProfileEditorOpen, setPathProfileEditorOpen] = useState(false);
  // pickingPathField 当前正在打开系统目录选择器的字段名；空字符串表示没有选择器在执行。
  const [pickingPathField, setPickingPathField] = useState('');
  // saving 标记保存操作是否正在进行，防止重复提交并给按钮提供 loading 反馈。
  const [saving, setSaving] = useState(false);
  // resetting 标记恢复默认设置是否正在进行，避免重复点击确认造成并发写配置。
  const [resetting, setResetting] = useState(false);
  // 从 AntApp 上下文取 message，使提示跟随明暗主题
  const { message, modal } = AntApp.useApp();
  // token 当前主题设计变量，用于流程步骤卡片在明暗主题下保持合适对比度
  const { token } = theme.useToken();
  // 已扫描到的项目列表，用于 CI/CD Tab 的"项目目录名"下拉选项
  const projects = useStore((s) => s.projects);
  // projectLoading 标记源项目扫描是否正在进行，用于 CI/CD 项目下拉显示 loading 状态。
  const projectLoading = useStore((s) => s.loading);
  // scanProjects 触发源项目扫描；设置页需要在项目视图尚未加载时补齐 CI/CD 下拉选项。
  const scanProjects = useStore((s) => s.scan);
  // projectScanRequestedRef 记录本轮打开设置抽屉是否已发起过补扫，避免源目录为空时反复扫描。
  const projectScanRequestedRef = useRef(false);
  // projectOptions 将项目列表转为 Select options 格式
  const projectOptions = projects.map((p) => ({ label: p.name, value: p.name }));

  // 打开设置页时按需补扫项目列表；默认 worktree 视图启动不会填充 projects，但 CI/CD Tab 需要项目名下拉。
  useEffect(() => {
    if (!open) {
      // 设置页关闭后重置本轮补扫标记，便于下次打开时在项目列表仍为空的情况下重新尝试。
      projectScanRequestedRef.current = false;
      return;
    }
    // 已有项目、正在扫描或本轮已请求过时都不重复扫描；尤其要避免源目录暂无仓库时陷入循环。
    if (!config || projects.length > 0 || projectLoading || projectScanRequestedRef.current) return;
    projectScanRequestedRef.current = true;
    scanProjects({ fetch: false });
  }, [open, config, projects.length, projectLoading, scanProjects]);

  // 打开时用当前配置填充表单；cicdLinks 对象转为 Form.List 所需的数组格式
  useEffect(() => {
    if (open && config) {
      // cicdLinksArr 为 Form.List 内部使用的数组，方便增删行
      const cicdLinksArr = Object.entries(config.cicdLinks || {}).map(([project, url]) => ({ project, url }));
      // workflowSteps 为流程步骤数组：未配置时用默认清单填充
      const workflowSteps = (config.workflowSteps ?? DEFAULT_WORKFLOW_STEPS).map((s) => ({ ...s }));
      // workDocumentTemplates 为工作文档模板数组：未配置时只使用 docs 目录。
      const workDocumentTemplates = normalizeWorkDocumentTemplatesForForm(config.workDocumentTemplates ?? DEFAULT_WORK_DOCUMENT_TEMPLATES);
      // taskTitleBadges 为任务标题旁徽标展示开关；缺失字段默认全开。
      const taskTitleBadges = normalizeTaskTitleBadges(config.taskTitleBadges);
      // pathProfileState 存储路径组合表单状态，兼容旧配置里的顶层路径字段。
      const pathProfileState = normalizePathProfilesForForm(config);
      form.setFieldsValue({ ...config, ...pathProfileState, cicdLinksArr, workflowSteps, workDocumentTemplates, taskTitleBadges });
    }
  }, [open, config, form]);

  /**
   * 校验并保存配置；将 Form.List 的数组形式转回对象再持久化
   */
  const handleOk = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await form.validateFields();
      // values 为表单收集的所有 Tab 下的配置值；getFieldsValue(true) 会包含未打开 Tab 中尚未挂载的字段。
      // WHY：antd Tabs 默认懒渲染，未进入「流程/工作文档/CI/CD」页时 validateFields 只返回已挂载字段，
      // 若直接保存会把这些 Form.List 当空数组写盘，导致重启后流程步骤等配置丢失。
      const values = form.getFieldsValue(true);
      // 拆出 Form.List 字段单独处理：路径组合、cicdLinksArr 转对象、workflowSteps / workDocumentTemplates 规范化；envCheckRoles 不再暴露在 UI 中
      const {
        pathProfiles: rawPathProfiles = [],
        activePathProfileId: rawActivePathProfileId,
        sourceProjectsPath: legacySourceProjectsPath,
        worktreesPath: legacyWorktreesPath,
        cicdLinksArr = [],
        workflowSteps: rawSteps = [],
        workDocumentTemplates: rawWorkDocumentTemplates = [],
        taskTitleBadges: rawTaskTitleBadges = {},
        ...rest
      } = values;
      // legacySourceProjectsPath/legacyWorktreesPath 存储旧表单残留顶层路径字段；新版统一由 activePathProfile 同步，避免双源状态。
      void legacySourceProjectsPath;
      void legacyWorktreesPath;
      const cicdLinks = Object.fromEntries(
        cicdLinksArr.filter((i) => i?.project?.trim()).map((i) => [i.project.trim(), (i.url || '').trim()])
      );
      // pathProfiles 存储保存前清洗后的路径组合列表；至少需要一组完整路径。
      const pathProfiles = normalizePathProfilesForSave(rawPathProfiles);
      if (pathProfiles.length === 0) {
        message.error('请至少保留一组完整的路径组合');
        return;
      }
      // activePathProfileId 存储有效的当前路径组合 id；原选择失效时回退第一组。
      const activePathProfileId = resolveActivePathProfileId(rawActivePathProfileId, pathProfiles);
      // activePathProfile 存储当前启用的路径组合，用于同步顶层路径字段。
      const activePathProfile = pathProfiles.find((profile) => profile.id === activePathProfileId) || pathProfiles[0];
      // workflowSteps 规范化：过滤空 label、补全/去重 key
      const workflowSteps = normalizeWorkflowSteps(rawSteps);
      // workDocumentTemplates 规范化：过滤空路径，目录内容置空。
      const workDocumentTemplates = normalizeWorkDocumentTemplatesForForm(rawWorkDocumentTemplates);
      // taskTitleBadges 规范化：老配置缺失字段时按默认全开展示。
      const taskTitleBadges = normalizeTaskTitleBadges(rawTaskTitleBadges);
      // envCheckRoles 为历史兼容字段：新 UI 改为自动识别前后端，不再要求用户维护角色映射
      const envCheckRoles = Array.isArray(config?.envCheckRoles) ? config.envCheckRoles : [];
      const saved = await api.saveConfig({
        ...rest,
        sourceProjectsPath: activePathProfile.sourceProjectsPath,
        worktreesPath: activePathProfile.worktreesPath,
        activePathProfileId,
        pathProfiles,
        cicdLinks,
        workflowSteps,
        workDocumentTemplates,
        taskTitleBadges,
        envCheckRoles,
      });
      message.success('配置已保存');
      onSaved(saved);
      onClose();
    } catch (e) {
      // isValidationError 标记 antd 表单校验失败；字段错误已由表单展示，不额外弹全局错误。
      const isValidationError = Array.isArray(e?.errorFields);
      if (!isValidationError) message.error(`保存配置失败：${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  /**
   * 弹出确认框并在确认后恢复默认配置。
   */
  const handleResetDefaults = () => {
    modal.confirm(withConfirmDefaults({
      title: '确认恢复默认设置？',
      content: '将恢复路径、工具、流程、工作文档、展示和 CI/CD 等设置；不会删除已有 worktree、任务状态、流程勾选、链接或历史记录。',
      okText: '确认恢复',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        if (resetting) return;
        setResetting(true);
        try {
          // defaultConfig 存储主进程写入磁盘后的默认配置，用于同步刷新外层状态。
          const defaultConfig = await api.resetConfig();
          message.success('已恢复默认设置');
          onSaved(defaultConfig);
          onClose();
        } catch (e) {
          message.error(`恢复默认设置失败：${e.message}`);
          setResetting(false);
        }
      },
    }));
  };

  /**
   * 打开某个流程步骤的详情编辑弹层
   * @param {number} index - 流程步骤在 Form.List 中的下标
   */
  const openWorkflowStepEditor = (index) => {
    setWorkflowEditorIndex(index);
  };

  /**
   * 关闭流程步骤详情编辑弹层
   */
  const closeWorkflowStepEditor = () => {
    setWorkflowEditorIndex(null);
  };

  /**
   * 打开某个工作文档模板的详情编辑弹层
   * @param {number} index - 工作文档模板在 Form.List 中的下标
   */
  const openWorkDocumentEditor = (index) => {
    setWorkDocumentEditorIndex(index);
  };

  /**
   * 关闭工作文档详情编辑弹层
   */
  const closeWorkDocumentEditor = () => {
    setWorkDocumentEditorIndex(null);
  };

  /**
   * 打开路径组合管理弹层。
   */
  const openPathProfileEditor = () => {
    setPathProfileEditorOpen(true);
  };

  /**
   * 关闭路径组合管理弹层。
   */
  const closePathProfileEditor = () => {
    setPathProfileEditorOpen(false);
  };

  /**
   * 打开系统目录选择器，并把选中的目录写回指定表单字段。
   * @param {string} fieldName - 要写回的路径字段名
   */
  const handlePickDirectory = async (fieldName) => {
    // fieldKey 存储当前选择动作的字段标识，用于定位对应按钮 loading。
    const fieldKey = getFormFieldKey(fieldName);
    // currentPath 存储当前表单字段里的路径，用作系统选择器默认打开目录。
    const currentPath = form.getFieldValue(fieldName);
    setPickingPathField(fieldKey);
    try {
      // result 存储主进程目录选择结果；取消选择时不覆盖用户已输入路径。
      const result = await api.selectDirectory({ defaultPath: currentPath });
      if (result?.canceled) return;
      if (result?.path) {
        form.setFieldValue(fieldName, result.path);
        return;
      }
      message.error(result?.error || '选择目录失败');
    } catch (e) {
      message.error(`选择目录失败：${e.message}`);
    } finally {
      setPickingPathField('');
    }
  };

  /**
   * 新增路径组合，新组合内容留空并由表单必填校验约束。
   * @param {(value:object)=>void} add - Form.List 新增函数
   * @param {number} index - 新组合插入下标
   */
  const handleAddPathProfile = (add, index) => {
    // activePathProfileId 存储当前启用组合 id。
    const activePathProfileId = form.getFieldValue('activePathProfileId');
    // draft 存储即将新增到表单里的路径组合草稿。
    const draft = createPathProfileDraft(index);
    add(draft);
    if (!activePathProfileId) form.setFieldValue('activePathProfileId', draft.id);
  };

  /**
   * 删除路径组合；若删除的是当前启用组合，则自动切到剩余第一组。
   * @param {(index:number)=>void} remove - Form.List 删除函数
   * @param {number} index - 待删除组合下标
   */
  const handleRemovePathProfile = (remove, index) => {
    // profiles 存储删除前的路径组合数组。
    const profiles = form.getFieldValue('pathProfiles') || [];
    // activePathProfileId 存储当前启用组合 id。
    const activePathProfileId = form.getFieldValue('activePathProfileId');
    // removedProfile 存储即将删除的组合，用于判断是否需要切换当前组合。
    const removedProfile = profiles[index];
    // remainingProfiles 存储删除后的剩余组合列表。
    const remainingProfiles = profiles.filter((_, profileIndex) => profileIndex !== index);
    remove(index);
    if (removedProfile?.id === activePathProfileId && remainingProfiles[0]?.id) {
      form.setFieldValue('activePathProfileId', remainingProfiles[0].id);
    }
  };

  /**
   * 打开系统文件选择器，把选中的文件路径拼接到「执行命令」字段。
   * WHY：命令可能是手写脚本片段 + 一个文件路径的组合（如 `python {path}`），
   * 已有文本不清空，只在末尾追加，保留手动输入与文件选择两种方式并存的能力。
   * @param {number} stepIndex - 流程步骤在 Form.List 中的下标
   */
  const handlePickCommandFile = async (stepIndex) => {
    // fieldName 命令字段在 Form 中的路径，用于读写该步骤的 command 值。
    const fieldName = ['workflowSteps', stepIndex, 'command'];
    // currentCommand 当前命令输入框已有内容，用于判断追加时是否需要分隔空格。
    const currentCommand = form.getFieldValue(fieldName) || '';
    setPickingPathField(`workflowSteps.${stepIndex}.command`);
    try {
      // result 存储主进程文件选择结果；取消选择时不改动已输入内容。
      const result = await api.selectFile({});
      if (result?.canceled) return;
      if (result?.path) {
        // nextCommand 追加选中的文件路径；已有内容非空时补一个空格分隔。
        const nextCommand = currentCommand && !currentCommand.endsWith(' ')
          ? `${currentCommand} ${result.path}`
          : `${currentCommand}${result.path}`;
        form.setFieldValue(fieldName, nextCommand);
        return;
      }
      message.error(result?.error || '选择文件失败');
    } catch (e) {
      message.error(`选择文件失败：${e.message}`);
    } finally {
      setPickingPathField('');
    }
  };

  // 三个 Tab 的内容定义
  const tabItems = [
    {
      key: 'paths',
      label: '路径',
      children: (
        <>
          <Form.Item
            label="当前路径组合"
            name="activePathProfileId"
            extra={<Text type="secondary" style={{ fontSize: 12 }}>可用于切换工作和个人项目工作路径。</Text>}
            rules={[{ required: true, message: '请选择当前路径组合' }]}
          >
            <Space.Compact style={{ width: '100%' }}>
              <Select
                data-testid="active-path-profile-select"
                showSearch
                optionFilterProp="label"
                options={pathProfileOptions}
                placeholder="选择当前生效的路径组合"
                onChange={(value) => form.setFieldValue('activePathProfileId', value)}
              />
              <Button icon={<EditOutlined />} onClick={openPathProfileEditor}>
                管理路径组合
              </Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item label="主分支名（可多个）" name="mainBranches">
            <Select mode="tags" placeholder="master, main" tokenSeparators={[',']} />
          </Form.Item>
          <Form.Item label="忽略的项目目录" name="ignoredProjects">
            <Select mode="tags" placeholder="输入要忽略的目录名" tokenSeparators={[',']} />
          </Form.Item>
          <Form.Item
            label="扫描时自动 fetch 远程（较慢，但能计算落后提交数）"
            name="autoFetch"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </>
      ),
    },
    {
      key: 'tools',
      label: '工具',
      children: (
        <>
          {/* 编辑器命令配置：AutoComplete 既可从预置编辑器下拉选择，也可手动输入自定义命令，{path} 占位符会被替换为实际路径 */}
          <Form.Item
            label="编辑器打开命令"
            name="vscodeCommand"
            tooltip="可下拉选择常见编辑器，也可手动输入。使用 {path} 作为路径占位符。VSCode：code {path}（自动加 -n 新窗口打开）；Cursor：cursor {path}；Trae：trae {path}"
            rules={[{ required: true, message: '请选择或输入编辑器命令' }]}
          >
            <AutoComplete
              options={EDITOR_COMMAND_OPTIONS}
              placeholder="选择或输入，如 code {path} / cursor {path}"
              // 输入时按已输入内容过滤预置选项，便于在自定义与预置间快速切换
              filterOption={(input, opt) => String(opt.value).toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
          {/* 终端应用选择：按平台展示不同选项——Windows 为 wt/PowerShell/cmd，macOS 为 Terminal/iTerm2/Ghostty */}
          <Form.Item
            label="终端应用"
            name="terminalApp"
            tooltip="Windows：默认 Windows Terminal（Win11 自带），未安装时自动兜底 PowerShell/cmd。macOS：默认系统 Terminal，iTerm2/Ghostty 需先安装对应应用，未安装所选终端时自动兜底系统 Terminal。"
          >
            <Select options={getTerminalOptions(api.platform)} />
          </Form.Item>
        </>
      ),
    },
    {
      key: 'work-documents',
      label: '工作文档',
      children: (
        <Form.Item
          label="工作文档模板"
          tooltip="新建任务时在任务目录按模板创建；删除任务前按同一模板归档到历史工作目录。CLAUDE.md 和 AGENTS.md 会固定生成，但不会归档。路径必须是相对路径。"
        >
          <Form.List name="workDocumentTemplates">
            {(fields, { add, remove, move }) => (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  默认工作文档为任务目录下的 docs 目录。项目 worktree 不会按这里的模板创建目录或文件；任务删除时会收集这些工作文档到历史记录。
                </Text>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {fields.map(({ key, name }, index) => (
                    <Form.Item key={key} noStyle shouldUpdate>
                      {() => {
                        // template 当前行对应的工作文档模板表单值。
                        const template = form.getFieldValue(['workDocumentTemplates', name]) || {};
                        // templatePath 当前模板路径，空值时给出友好占位。
                        const templatePath = String(template.path || '').trim() || `未设置路径 ${index + 1}`;
                        // templateType 当前模板类型；除 file 外均按目录展示。
                        const templateType = template.type === 'file' ? 'file' : 'directory';
                        return (
                          <div
                            data-testid={`work-document-row-${index}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => openWorkDocumentEditor(name)}
                            onKeyDown={(e) => { if (e.key === 'Enter') openWorkDocumentEditor(name); }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 10,
                              width: '100%',
                              maxWidth: '100%',
                              padding: '9px 10px',
                              boxSizing: 'border-box',
                              border: `1px solid ${token.colorBorderSecondary}`,
                              borderRadius: token.borderRadius,
                              background: token.colorFillQuaternary,
                              cursor: 'pointer',
                            }}
                          >
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>模板 {index + 1}</Text>
                                <Text strong ellipsis style={{ minWidth: 0 }}>{templatePath}</Text>
                              </div>
                              <div style={{ marginTop: 4 }}>
                                <Tag color={templateType === 'file' ? 'blue' : 'default'} style={{ marginInlineEnd: 0 }}>
                                  {templateType === 'file' ? '文件' : '目录'}
                                </Tag>
                              </div>
                            </div>
                            <Space size={4} style={{ flexShrink: 0 }}>
                              <Button
                                size="small"
                                data-testid={`work-document-move-up-${index}`}
                                disabled={index === 0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // 上移模板：只调整展示/保存顺序，不改变模板内容。
                                  move(name, name - 1);
                                }}
                              >
                                上移
                              </Button>
                              <Button
                                size="small"
                                data-testid={`work-document-move-down-${index}`}
                                disabled={index === fields.length - 1}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // 下移模板：只调整展示/保存顺序，不改变模板内容。
                                  move(name, name + 1);
                                }}
                              >
                                下移
                              </Button>
                              <Button
                                size="small"
                                icon={<EditOutlined />}
                                onClick={(e) => { e.stopPropagation(); openWorkDocumentEditor(name); }}
                              >
                                编辑
                              </Button>
                              <Button
                                type="text"
                                danger
                                size="small"
                                icon={<MinusCircleOutlined />}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // 删除正在编辑的模板时同步关闭弹层，避免 Modal 继续指向已不存在的下标。
                                  if (workDocumentEditorIndex === name) closeWorkDocumentEditor();
                                  remove(name);
                                }}
                              />
                            </Space>
                          </div>
                        );
                      }}
                    </Form.Item>
                  ))}
                </Space>
                <Modal
                  title="编辑工作文档"
                  open={workDocumentEditorIndex != null}
                  zIndex={WORK_DOCUMENT_EDITOR_Z_INDEX}
                  onCancel={closeWorkDocumentEditor}
                  footer={[
                    <Button key="done" type="primary" onClick={closeWorkDocumentEditor}>
                      完成
                    </Button>,
                  ]}
                >
                  {workDocumentEditorIndex != null && (
                    <Form.Item noStyle shouldUpdate>
                      {() => {
                        // template 当前正在编辑的工作文档模板。
                        const template = form.getFieldValue(['workDocumentTemplates', workDocumentEditorIndex]) || {};
                        // isFile 标记当前模板是否为文件，文件才展示默认内容输入。
                        const isFile = template.type === 'file';
                        return (
                          <>
                            <Form.Item label="类型" name={[workDocumentEditorIndex, 'type']} initialValue="directory">
                              <Select
                                options={[
                                  { label: '目录', value: 'directory' },
                                  { label: '文件', value: 'file' },
                                ]}
                              />
                            </Form.Item>
                            <Form.Item
                              label="路径"
                              name={[workDocumentEditorIndex, 'path']}
                              rules={[{ required: true, message: '请输入工作文档路径' }]}
                            >
                              <Input placeholder="相对路径，如 docs 或 .ai/summary.md" />
                            </Form.Item>
                            {isFile && (
                              <Form.Item label="文件默认内容" name={[workDocumentEditorIndex, 'content']}>
                                <Input.TextArea placeholder="文件默认内容" autoSize={{ minRows: 5, maxRows: 12 }} />
                              </Form.Item>
                            )}
                          </>
                        );
                      }}
                    </Form.Item>
                  )}
                </Modal>
                <Button
                  block
                  type="dashed"
                  onClick={() => {
                    // nextIndex 为新增模板在列表中的下标；添加后立即打开详情弹层，减少用户再次点击。
                    const nextIndex = fields.length;
                    add({ type: 'directory', path: '', content: '' });
                    openWorkDocumentEditor(nextIndex);
                  }}
                  icon={<PlusOutlined />}
                  size="small"
                >
                  添加工作文档
                </Button>
              </Space>
            )}
          </Form.List>
        </Form.Item>
      ),
    },
    {
      key: 'workflow',
      label: '流程',
      children: (
        /* 需求流程步骤配置：每个任务在 worktree 视图中展示这组步骤，每步都可勾选标记完成；
           配置了「执行命令」的步骤还会额外提供「执行」按钮，点击在任务目录下跑该命令 */
        <Form.Item
          label="需求流程步骤"
          tooltip="每一步都可打勾标记完成。可选给某步配一段 shell 命令：配了的步骤会多出「执行」按钮，点击在任务目录下运行。命令支持占位符：{path} 任务目录、{task} 任务名、{branch} 分支。改名不会丢失已勾选状态。"
        >
          <Form.List name="workflowSteps">
            {(fields, { add, remove, move }) => (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  每个步骤都会显示在 Worktree 任务的「流程」入口中；执行命令选填，支持 {'{path}'} / {'{task}'} / {'{branch}'}，也可通过参数模式自动传入任务目录。
                </Text>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {fields.map(({ key, name }, index) => (
                    <React.Fragment key={key}>
                      {/* key 隐藏字段：保留步骤稳定标识，改名时沿用以免丢失各任务的勾选状态 */}
                      <Form.Item name={[name, 'key']} noStyle hidden>
                        <Input />
                      </Form.Item>
                      {/* 主列表只展示每个流程步骤摘要，详情字段收敛到点击后的弹层中，避免步骤多时所有字段同时铺开。 */}
                      <Form.Item noStyle shouldUpdate>
                        {() => {
                          // step 当前行对应的流程步骤表单值
                          const step = form.getFieldValue(['workflowSteps', name]) || {};
                          // label 当前步骤展示名称，空值时给出友好的占位文案
                          const label = String(step.label || '').trim() || `未命名步骤 ${index + 1}`;
                          // hasCommand 标记该步骤是否配置了可执行命令
                          const hasCommand = !!String(step.command || '').trim();
                          return (
                            <div
                              data-testid={`workflow-step-row-${index}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => openWorkflowStepEditor(name)}
                              onKeyDown={(e) => { if (e.key === 'Enter') openWorkflowStepEditor(name); }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 10,
                                width: '100%',
                                maxWidth: '100%',
                                padding: '9px 10px',
                                boxSizing: 'border-box',
                                border: `1px solid ${token.colorBorderSecondary}`,
                                borderRadius: token.borderRadius,
                                background: token.colorFillQuaternary,
                                cursor: 'pointer',
                              }}
                            >
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                  <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>步骤 {index + 1}</Text>
                                  <Text strong ellipsis style={{ minWidth: 0 }}>{label}</Text>
                                </div>
                                <div style={{ marginTop: 4 }}>
                                  <Tag color={hasCommand ? 'blue' : 'default'} style={{ marginInlineEnd: 0 }}>
                                    {hasCommand ? '已配置命令' : '仅勾选'}
                                  </Tag>
                                </div>
                              </div>
                              <Space size={4} style={{ flexShrink: 0 }}>
                                <Button
                                  size="small"
                                  data-testid={`workflow-step-move-up-${index}`}
                                  disabled={index === 0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // 上移步骤：仅调整 Form.List 顺序，key 保持不变以免丢失历史勾选态。
                                    move(name, name - 1);
                                  }}
                                >
                                  上移
                                </Button>
                                <Button
                                  size="small"
                                  data-testid={`workflow-step-move-down-${index}`}
                                  disabled={index === fields.length - 1}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // 下移步骤：只影响展示/保存顺序，不改变步骤稳定 key。
                                    move(name, name + 1);
                                  }}
                                >
                                  下移
                                </Button>
                                <Button
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={(e) => { e.stopPropagation(); openWorkflowStepEditor(name); }}
                                >
                                  编辑
                                </Button>
                                <Button
                                  type="text"
                                  danger
                                  size="small"
                                  icon={<MinusCircleOutlined />}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // 删除正在编辑的步骤时同步关闭弹层，避免 Modal 继续指向已不存在的下标。
                                    if (workflowEditorIndex === name) closeWorkflowStepEditor();
                                    remove(name);
                                  }}
                                />
                              </Space>
                            </div>
                          );
                        }}
                      </Form.Item>
                    </React.Fragment>
                  ))}
                </Space>
                {/* 当前选中步骤的详情编辑弹层：只在需要时展示名称和命令字段，主列表保持收敛。 */}
                <Modal
                  title="编辑流程步骤"
                  open={workflowEditorIndex != null}
                  zIndex={WORKFLOW_STEP_EDITOR_Z_INDEX}
                  onCancel={closeWorkflowStepEditor}
                  footer={[
                    <Button key="done" type="primary" onClick={closeWorkflowStepEditor}>
                      完成
                    </Button>,
                  ]}
                >
                  {workflowEditorIndex != null && (
                    <>
                      {/* label 步骤展示名：弹层内独立编辑，主列表只展示摘要。 */}
                      <Form.Item label="步骤名称" name={[workflowEditorIndex, 'label']}>
                        <Input placeholder="步骤名称，如：审查需求方案" />
                      </Form.Item>
                      {/* command 执行命令：多行编辑，WHY：命令通常包含脚本路径与占位符，单行输入会显示不全。
                          下方额外提供「选择文件」按钮：可用系统文件选择器把某个脚本/文件路径追加到命令末尾，
                          也可以直接手动输入，两种方式不互斥。 */}
                      <Form.Item
                        label="执行命令（选填）"
                        name={[workflowEditorIndex, 'command']}
                        tooltip="可手动输入，也可点击下方「选择文件」把文件路径追加到命令末尾"
                      >
                        <Input.TextArea
                          placeholder="执行命令（选填），如 ./deploy.sh {path}"
                          autoSize={{ minRows: 3, maxRows: 8 }}
                        />
                      </Form.Item>
                      {/* taskArgMode 控制任务目录如何传给脚本：auto 兼容 bash xxx.sh 这类常见脚本，特殊命令可显式关闭或强制追加。 */}
                      <Form.Item
                        label="任务目录参数"
                        name={[workflowEditorIndex, 'taskArgMode']}
                        initialValue={TASK_ARG_MODE_AUTO}
                        tooltip="自动：脚本命令缺少占位符时追加任务目录；不追加：只注入环境变量；总是追加：命令未使用 {path} 时追加任务目录"
                      >
                        <Select options={WORKFLOW_TASK_ARG_MODE_OPTIONS} />
                      </Form.Item>
                      <Form.Item noStyle>
                        <Button
                          size="small"
                          loading={pickingPathField === `workflowSteps.${workflowEditorIndex}.command`}
                          onClick={() => handlePickCommandFile(workflowEditorIndex)}
                          style={{ marginBottom: 24 }}
                        >
                          选择文件
                        </Button>
                      </Form.Item>
                      {/* autoCheckOnSuccess 控制命令成功后是否自动勾选；默认开启以延续现有「成功即完成」体验。 */}
                      <Form.Item label="成功后自动勾选" name={[workflowEditorIndex, 'autoCheckOnSuccess']} valuePropName="checked" initialValue>
                        <Switch checkedChildren="开" unCheckedChildren="关" />
                      </Form.Item>
                      {/* stopOnFailure 控制批量运行时失败是否停止；默认开启，避免前置失败后继续跑后续命令。 */}
                      <Form.Item label="失败后停止后续步骤" name={[workflowEditorIndex, 'stopOnFailure']} valuePropName="checked" initialValue>
                        <Switch checkedChildren="开" unCheckedChildren="关" />
                      </Form.Item>
                    </>
                  )}
                </Modal>
                {/* 新增步骤：默认命令为空（仅可勾选、不触发副作用），key 留空由保存时自动生成 */}
                <Button
                  block
                  type="dashed"
                  onClick={() => {
                    // nextIndex 为新增步骤在列表中的下标；添加后立即打开详情弹层，减少用户再次点击。
                    const nextIndex = fields.length;
                    add({ label: '', command: '', taskArgMode: TASK_ARG_MODE_AUTO });
                    openWorkflowStepEditor(nextIndex);
                  }}
                  icon={<PlusOutlined />}
                  size="small"
                >
                  添加流程步骤
                </Button>
              </Space>
            )}
          </Form.List>
        </Form.Item>
      ),
    },
    {
      key: 'display',
      label: '展示',
      children: (
        <div data-testid="display-settings-panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              padding: '14px 16px',
              borderRadius: token.borderRadiusLG,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorFillAlter,
            }}
          >
            <Text strong>任务标题展示偏好</Text>
            <div style={{ marginTop: 6 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                按需选择任务标题旁显示哪些辅助信息，让任务列表保持清爽但不丢关键状态。
              </Text>
            </div>
          </div>
          <div
            data-testid="display-badge-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
              alignItems: 'stretch',
            }}
          >
            {TASK_TITLE_BADGE_ITEMS.map((item) => (
              <div
                key={item.key}
                data-testid={`display-badge-card-${item.key}`}
                style={{
                  minHeight: 112,
                  padding: 14,
                  borderRadius: token.borderRadiusLG,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorBgContainer,
                  boxShadow: token.boxShadowTertiary,
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <Text strong>{item.label}</Text>
                    <div style={{ marginTop: 6 }}>
                      <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.6 }}>
                        {DISPLAY_BADGE_DESCRIPTIONS[item.key]}
                      </Text>
                    </div>
                  </div>
                  <Form.Item
                    name={['taskTitleBadges', item.key]}
                    valuePropName="checked"
                    style={{ marginBottom: 0, flex: '0 0 auto' }}
                  >
                    <Switch checkedChildren="展示" unCheckedChildren="隐藏" />
                  </Form.Item>
                </div>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      key: 'cicd',
      label: 'CI/CD',
      children: (
        /* CI/CD 流水线地址：按项目名配置，有则填写，任务视图中显示跳转按钮 */
        <Form.Item label="CI/CD 流水线地址（按项目配置，选填）">
          <Form.List name="cicdLinksArr">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ width: '100%' }}>
                {/* 列表区限高滚动，避免条目过多时撑破抽屉内容区 */}
                <div style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {fields.map(({ key, name }) => (
                      // 每行三栏：左侧 project 固定等宽、中间 url 弹性等宽、右侧删除按钮固定列宽，与流程 Tab 对齐风格一致
                      <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
                        {/* project 项目目录名：从已扫描项目中下拉选择，也支持手动输入。固定列宽 130px 与流程 Tab type 列等宽 */}
                        <div style={{ flex: '0 0 130px' }}>
                          <Form.Item name={[name, 'project']} noStyle>
                            <Select
                              showSearch
                              allowClear
                              placeholder="选择项目"
                              style={{ width: '100%' }}
                              options={projectOptions}
                              loading={projectLoading && projectOptions.length === 0}
                              filterOption={(input, opt) => opt.value.toLowerCase().includes(input.toLowerCase())}
                            />
                          </Form.Item>
                        </div>
                        {/* url 对应项目的 CI/CD 流水线 URL，占满剩余弹性宽度，显式 width:100% 填满外层 div 保证每行等宽 */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Form.Item name={[name, 'url']} noStyle>
                            <Input style={{ width: '100%' }} placeholder="https://ci.example.com/pipeline/..." />
                          </Form.Item>
                        </div>
                        {/* 删除按钮固定列宽，保证每行右侧对齐 */}
                        <MinusCircleOutlined style={{ flex: '0 0 16px', color: '#999' }} onClick={() => remove(name)} />
                      </div>
                    ))}
                  </Space>
                </div>
                <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />} size="small">
                  添加项目 CI/CD 地址
                </Button>
              </Space>
            )}
          </Form.List>
        </Form.Item>
      ),
    },
  ];

  return (
    <Drawer
      title="设置"
      open={open}
      onClose={onClose}
      width={640}
      destroyOnHidden
      footer={
        // 底部操作按钮
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%' }}>
          <Button danger loading={resetting} disabled={saving || resetting} onClick={handleResetDefaults}>恢复默认设置</Button>
          <Space>
            <Button disabled={saving || resetting} onClick={onClose}>取消</Button>
            <Button type="primary" loading={saving} disabled={saving || resetting} onClick={handleOk}>保存</Button>
          </Space>
        </div>
      }
    >
      <Form form={form} layout="vertical">
        <Tabs items={tabItems} />
        <Modal
          title="管理路径组合"
          open={pathProfileEditorOpen}
          zIndex={PATH_PROFILE_EDITOR_Z_INDEX}
          width={720}
          onOk={closePathProfileEditor}
          onCancel={closePathProfileEditor}
          okText="完成"
          cancelButtonProps={{ style: { display: 'none' } }}
          styles={{ body: { maxHeight: '62vh', overflowY: 'auto' } }}
        >
          <Form.List name="pathProfiles">
            {(fields, { add, remove }) => (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                {fields.map(({ key, name }, index) => (
                  <div
                    key={key}
                    data-testid={`path-profile-row-${index}`}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      boxSizing: 'border-box',
                      border: `1px solid ${token.colorBorderSecondary}`,
                      borderRadius: token.borderRadius,
                      background: token.colorFillQuaternary,
                    }}
                  >
                    <Form.Item name={[name, 'id']} hidden>
                      <Input />
                    </Form.Item>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                      <Text strong>路径组合 {index + 1}</Text>
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<MinusCircleOutlined />}
                        disabled={fields.length <= 1}
                        aria-label={`删除路径组合 ${index + 1}`}
                        onClick={() => handleRemovePathProfile(remove, name)}
                      />
                    </div>
                    <Form.Item
                      label="组合名称"
                      name={[name, 'name']}
                      rules={[{ required: true, message: '请输入组合名称' }]}
                    >
                      <Input placeholder="例如：工作 / 个人" />
                    </Form.Item>
                    <Form.Item label="源项目根目录" required>
                      <Space.Compact style={{ width: '100%' }}>
                        <Form.Item name={[name, 'sourceProjectsPath']} rules={[{ required: true, message: '请输入源项目根目录' }]} noStyle>
                          <Input style={{ flex: 1, minWidth: 0 }} placeholder="/Users/you/work/projects" />
                        </Form.Item>
                        <Button
                          aria-label={`选择源项目根目录 ${index + 1}`}
                          loading={pickingPathField === getFormFieldKey(['pathProfiles', name, 'sourceProjectsPath'])}
                          onClick={() => handlePickDirectory(['pathProfiles', name, 'sourceProjectsPath'])}
                        >
                          选择
                        </Button>
                      </Space.Compact>
                    </Form.Item>
                    <Form.Item label="Worktree 根目录" required style={{ marginBottom: 0 }}>
                      <Space.Compact style={{ width: '100%' }}>
                        <Form.Item name={[name, 'worktreesPath']} rules={[{ required: true, message: '请输入 Worktree 根目录' }]} noStyle>
                          <Input style={{ flex: 1, minWidth: 0 }} placeholder="/Users/you/work/worktrees" />
                        </Form.Item>
                        <Button
                          aria-label={`选择 Worktree 根目录 ${index + 1}`}
                          loading={pickingPathField === getFormFieldKey(['pathProfiles', name, 'worktreesPath'])}
                          onClick={() => handlePickDirectory(['pathProfiles', name, 'worktreesPath'])}
                        >
                          选择
                        </Button>
                      </Space.Compact>
                    </Form.Item>
                  </div>
                ))}
                <Button
                  block
                  type="dashed"
                  icon={<PlusOutlined />}
                  size="small"
                  onClick={() => handleAddPathProfile(add, fields.length)}
                >
                  添加路径组合
                </Button>
              </Space>
            )}
          </Form.List>
        </Modal>
      </Form>
    </Drawer>
  );
}

/**
 * 规范化设置页中的工作文档模板，过滤空路径并补齐类型/内容字段。
 * @param {Array<{type?:string,path?:string,content?:string}>} templates - 表单里的工作文档模板数组
 * @returns {Array<{type:'directory'|'file',path:string,content:string}>} 可提交给配置保存的模板数组
 */
function normalizeWorkDocumentTemplatesForForm(templates) {
  // sourceTemplates 存储待规范化的模板数组；非数组时回退到默认 docs 目录。
  const sourceTemplates = Array.isArray(templates) ? templates : DEFAULT_WORK_DOCUMENT_TEMPLATES;
  // normalizedTemplates 累积表单可保存的模板；核心层会继续做路径安全过滤。
  const normalizedTemplates = [];

  for (const template of sourceTemplates) {
    // path 存储用户填写的相对路径，空路径在保存时忽略。
    const path = String(template?.path || '').trim();
    if (!path) continue;
    if (isFixedInstructionPathForForm(path)) continue;
    // type 存储模板类型；除 file 外统一按目录保存。
    const type = template?.type === 'file' ? 'file' : 'directory';
    // content 存储文件默认内容，目录模板不需要内容。
    const content = type === 'file' ? String(template?.content || '') : '';
    normalizedTemplates.push({ type, path, content });
  }

  return normalizedTemplates.length > 0
    ? normalizedTemplates
    : DEFAULT_WORK_DOCUMENT_TEMPLATES.map((template) => ({ ...template }));
}

/**
 * 判断表单路径是否为固定说明文件路径。
 * @param {string} path - 用户填写的工作文档路径
 * @returns {boolean} 是否为固定说明文件
 */
function isFixedInstructionPathForForm(path) {
  // normalizedPath 存储统一分隔符和大小写后的路径，用于匹配根目录固定说明文件。
  const normalizedPath = String(path || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
  return normalizedPath === 'claude.md' || normalizedPath === 'agents.md';
}
