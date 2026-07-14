import React, { useState } from 'react'
import {
  Collapse,
  Tag,
  Button,
  Space,
  Empty,
  Tooltip,
  Dropdown,
  Popover,
  Modal,
  Checkbox,
  theme,
  Spin,
} from 'antd'
import {
  EyeInvisibleOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  DeleteOutlined,
  WarningOutlined,
  CopyOutlined,
  DownOutlined,
  PlusOutlined,
  LinkOutlined,
  RocketOutlined,
  UnorderedListOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  PushpinFilled,
  PushpinOutlined,
  GitlabOutlined,
  ConsoleSqlOutlined,
} from '@ant-design/icons'
import {
  TASK_STATUSES,
  getTaskStatusMeta,
  normalizeTaskLinkItems,
} from '../worktreeLogic.js'
import { isStepDone, computeWorkflowProgress } from '../workflowLogic.js'
import {
  getRunnableWorkflowSteps,
  getWorkflowStepRunStatus,
  getWorkflowTaskRunSummary,
} from '../workflowRunLogic.js'
import {
  hasVisibilityKey,
  normalizeTaskTitleBadges,
} from '../visibilityLogic.js'
import { stepRunKey } from '../../core/stepOutputLog.js'
import { VscodeIcon } from '../icons.jsx'
import ClaudeUsageTag from './ClaudeUsageTag.jsx'
import TaskLinksEditor from './TaskLinksEditor.jsx'
import SingleLineText from './SingleLineText.jsx'

// 进度徽标用圆点展示的最大步骤数阈值：步骤数 ≤ 此值时用一排圆点直观展示，
// 超过则改用紧凑的「✓ N/M」文字，避免圆点过多把任务行撑长。
const PROGRESS_DOT_MAX = 5

// Worktree 任务视角面板：按任务（worktreesRoot 下的目录）分组，
// 每组展示该任务涉及的所有项目 worktree 及其分支/状态，支持打开/删除/prune。

/**
 * 任务状态标签 + 切换下拉：展示当前人工标记的状态，点击可切换
 * @param {object} props - 组件属性
 * @param {string} props.taskName - 任务名（作为状态映射的键）
 * @param {string} [props.statusKey] - 当前状态 key（未设置则回退默认「未开始」）
 * @param {(taskName:string, statusKey?:string)=>void} props.onChange - 切换状态回调
 * @returns {JSX.Element} 状态标签下拉
 */
function TaskStatusControl({ taskName, statusKey, onChange }) {
  // meta 为当前状态的展示信息（label/color）；未设置时兜底为「未开始」
  const meta = getTaskStatusMeta(statusKey)
  // 下拉菜单项：列出全部状态（含「未开始」），选中即写回
  const menuItems = TASK_STATUSES.map((s) => ({
    key: s.key,
    label: (
      <Tag color={s.color} style={{ marginInlineEnd: 0 }}>
        {s.label}
      </Tag>
    ),
  }))
  return (
    // stopPropagation 必须放在 Dropdown 外层的包裹元素上：
    // 若放在 Dropdown 的子元素上，会被 antd Dropdown(rc-trigger) 克隆子节点时覆盖掉 onClick，
    // 导致点击仍冒泡到 Collapse 头部触发展开/折叠。外层包裹则由我们完全掌控，可靠拦截冒泡。
    <span
      onClick={(e) => e.stopPropagation()}
      style={{ display: 'inline-flex', cursor: 'pointer' }}
    >
      <Dropdown
        trigger={['click']}
        menu={{
          items: menuItems,
          // 选中即写回（选「未开始」时上层会清除存储，效果等价于复位默认态）
          onClick: ({ key }) => onChange(taskName, key),
        }}
      >
        <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>
          {meta.label} <DownOutlined style={{ fontSize: 10 }} />
        </Tag>
      </Dropdown>
    </span>
  )
}

/**
 * 环境检查状态标签：展示任务级自动检查状态，点击打开详情或触发检查。
 * @param {object} props - 组件属性
 * @param {object} props.task - 任务分组项（含 task/path）
 * @param {{status?:string, issueCount?:number, error?:string}} [props.entry] - 任务环境检查状态缓存；status 支持 ok/warning/failed/checking
 * @param {(task:object)=>void} props.onClick - 点击状态标签时的回调
 * @returns {JSX.Element} 状态标签
 */
function EnvHealthStatusTag({ task, entry, onClick }) {
  // status 当前任务环境状态：未检查时回退为 idle
  const status = entry?.status || 'idle'
  // issueCount 当前任务的问题数量，warning/failed 态展示用
  const issueCount =
    entry?.issueCount || entry?.result?.summary?.issueCount || 0
  // label 状态标签文案：只保留用户需要的一眼判断信息
  const label =
    status === 'checking'
      ? '环境检查中'
      : status === 'ok'
        ? '环境正常'
        : status === 'warning' || status === 'failed'
          ? `${issueCount || 1} 个环境问题`
          : '未检查'
  // color 映射到 antd Tag 色值：成功绿色，warning 黄色，失败红色，检查中/未检查低噪音。
  const color =
    status === 'ok'
      ? 'success'
      : status === 'warning'
        ? 'warning'
        : status === 'failed'
          ? 'error'
          : status === 'checking'
            ? 'processing'
            : 'default'
  // icon 根据状态展示轻量图标；检查中用 Spin 传达自动运行中
  const icon =
    status === 'checking' ? (
      <Spin size="small" />
    ) : status === 'ok' ? (
      <CheckCircleOutlined />
    ) : status === 'warning' || status === 'failed' ? (
      <WarningOutlined />
    ) : null
  // tooltipText 鼠标悬停文案：异常时优先展示核心摘要或错误信息
  const tooltipText =
    status === 'warning' || status === 'failed'
      ? entry?.error || entry?.result?.summary?.message || '点击查看环境问题'
      : status === 'checking'
        ? '正在自动检查环境'
        : status === 'ok'
          ? '点击查看环境检查详情'
          : '点击执行环境检查'

  return (
    <span
      onClick={(e) => e.stopPropagation()}
      style={{ display: 'inline-flex' }}
    >
      <Tooltip title={tooltipText}>
        <Tag
          className="worktree-title-tag env-health-status-tag"
          color={color}
          onClick={() => onClick?.(task)}
          style={{ cursor: 'pointer', minWidth: 92, whiteSpace: 'nowrap' }}
        >
          {icon}
          <span>{label}</span>
        </Tag>
      </Tooltip>
    </span>
  )
}

/**
 * 从任务下的 worktree 列表中收集可打开的 GitLab 项目入口，并按 URL 去重。
 * @param {object} task - 任务分组项（含 worktrees）
 * @returns {Array<{key:string,label:string,url:string}>} GitLab 菜单/按钮入口列表
 */
function getTaskGitlabEntries(task) {
  // seenUrls 存储已收集过的 GitLab URL，避免同一项目重复出现在任务级入口中。
  const seenUrls = new Set()
  // entries 存储任务级 GitLab 入口，每个入口对应一个项目仓库。
  const entries = []
  for (const wt of task?.worktrees || []) {
    // url 存储当前 worktree 对应的 GitLab 网页地址。
    const url = typeof wt?.gitlabUrl === 'string' ? wt.gitlabUrl.trim() : ''
    if (!url || seenUrls.has(url)) continue
    seenUrls.add(url)
    // label 存储下拉菜单或 tooltip 中展示的项目名，项目名缺失时回退 URL。
    const label = wt?.project || url
    entries.push({ key: url, label, url })
  }
  return entries
}

/**
 * 任务级 GitLab 打开按钮：单项目直接打开，多项目以下拉菜单选择具体项目。
 * @param {object} props - 组件属性
 * @param {string} props.taskName - 任务名，用于无障碍标签区分任务入口
 * @param {Array<{key:string,label:string,url:string}>} props.entries - 当前任务可打开的 GitLab 项目入口列表
 * @param {(url:string)=>void} props.onOpenUrl - 打开外部 URL 的回调
 * @returns {JSX.Element|null} GitLab 图标按钮或空
 */
function TaskGitlabButton({ taskName, entries, onOpenUrl }) {
  // validEntries 存储有效 GitLab 入口列表，避免外部传入 null/undefined 时渲染出错。
  const validEntries = entries || []
  if (validEntries.length === 0) return null
  if (validEntries.length === 1) {
    // entry 存储单项目任务的唯一 GitLab 入口，点击图标即可直接打开。
    const entry = validEntries[0]
    return (
      <Tooltip title={`打开 GitLab：${entry.label}`}>
        <Button
          size="small"
          type="link"
          aria-label={`打开 GitLab ${taskName} ${entry.label}`}
          icon={<GitlabOutlined />}
          onClick={(e) => {
            e.stopPropagation()
            onOpenUrl?.(entry.url)
          }}
        />
      </Tooltip>
    )
  }
  // menuItems 存储多项目任务的 GitLab 下拉菜单项，每项打开对应项目仓库。
  const menuItems = validEntries.map((entry) => ({
    key: entry.key,
    label: entry.label,
  }))

  /**
   * 处理多项目任务 GitLab 菜单点击。
   * @param {{key:string}} info - antd Dropdown 传入的菜单点击信息
   */
  const handleMenuClick = ({ key }) => {
    // entry 存储用户在下拉菜单中选择的项目入口。
    const entry = validEntries.find((item) => item.key === key)
    if (entry) onOpenUrl?.(entry.url)
  }

  return (
    // stopPropagation 放在 Dropdown 外层，避免点击图标或菜单触发 Collapse 展开/收起。
    <span
      onClick={(e) => e.stopPropagation()}
      style={{ display: 'inline-flex' }}
    >
      <Dropdown
        trigger={['click']}
        menu={{ items: menuItems, onClick: handleMenuClick }}
      >
        <Tooltip title="打开 GitLab">
          <Button
            size="small"
            type="link"
            aria-label={`打开 GitLab ${taskName}`}
            icon={<GitlabOutlined />}
            onClick={(e) => e.stopPropagation()}
          />
        </Tooltip>
      </Dropdown>
    </span>
  )
}

/**
 * 任务工作流（需求流程）入口：一个聚合按钮，点击弹出 Modal 列出该任务的全部流程步骤。
 * 步骤统一可勾选标记完成（持久化）；配置 command 的步骤额外提供执行入口。
 * 步骤清单由设置统一配置（workflowSteps），此处只负责渲染与交互分发，不内置具体操作逻辑。
 * @param {object} props - 组件属性
 * @param {string} props.taskName - 任务名（作为勾选态映射的键）
 * @param {object} props.task - 任务分组项（透传给 action 回调，便于操作拿到 worktree/路径信息）
 * @param {Array<{key:string,label:string,type:string}>} props.steps - 当前生效的工作流步骤清单
 * @param {Record<string,string[]>} props.workflowMap - 任务名 → 已勾选步骤 key 数组 的映射
 * @param {(taskName:string, stepKey:string, done:boolean)=>void} props.onToggleStep - 切换 checkbox 步骤勾选态
 * @param {(task:object, step:object)=>void} props.onRunStepAction - 执行 action 型步骤
 * @param {Record<string,boolean>} [props.runningSteps] - 正在执行的步骤集合（key 为 stepRunKey(任务名,步骤key)），命中时该步骤「执行」按钮显示 loading
 * @returns {JSX.Element|null} 流程入口按钮（无步骤配置时不渲染）
 */
function WorkflowControl({
  taskName,
  task,
  steps = [],
  workflowMap = {},
  onToggleStep,
  onRunStepAction,
  onRunWorkflowSteps,
  runningSteps = {},
  lastStepOutputs = {},
  onViewLastOutput,
  onViewCurrentOutput,
}) {
  // open 控制 Modal 开合（受控）；点击步骤后不自动关闭，便于连续操作多个步骤
  const [open, setOpen] = useState(false)
  // 取主题 token，用于步骤分隔线等颜色适配明暗主题
  const { token } = theme.useToken()

  // 无步骤配置时不渲染入口（设置里清空了全部步骤的极端情况）
  if (!steps || steps.length === 0) return null

  // progress 该任务的 checkbox 步骤完成进度 {done,total}，用于按钮上的徽标展示
  const progress = computeWorkflowProgress(steps, workflowMap, taskName)
  // allDone 是否全部步骤已完成：用于切换「绿色对勾」与「进度圆点」两种展示
  const allDone = progress.total > 0 && progress.done === progress.total
  // notStarted 是否一步未做：用于淡化未开始状态的视觉（不显眼，避免像未读红点那样制造焦虑）
  const notStarted = progress.done === 0
  // runnableSteps 存储当前任务流程中配置了命令的步骤，决定是否展示/启用批量运行入口。
  const runnableSteps = getRunnableWorkflowSteps(steps)
  // taskRunSummary 存储任务级流程执行摘要，用于入口上显示执行中/失败态。
  const taskRunSummary = getWorkflowTaskRunSummary(
    steps,
    taskName,
    workflowMap,
    runningSteps,
    lastStepOutputs
  )
  // hasAnyRunning 表示该任务下是否有步骤正在执行，用于避免批量运行重复触发。
  const hasAnyRunning = taskRunSummary.hasRunning

  // content 为 Modal 主体内容：纵向列出每个步骤。每步统一可勾选；配了执行命令的步骤在右侧追加执行入口（打勾与执行并存）
  const content = (
    <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingInlineEnd: 4 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
            已完成 {progress.done}/{progress.total} 步
          </div>
          {taskRunSummary.hasFailed && (
            <div
              style={{ marginTop: 2, fontSize: 12, color: token.colorError }}
            >
              最近未通过：{taskRunSummary.lastFailedStepLabel || '未知步骤'}
            </div>
          )}
        </div>
        <Button
          size="small"
          type="primary"
          ghost
          icon={<ThunderboltOutlined />}
          disabled={runnableSteps.length === 0 || hasAnyRunning}
          loading={hasAnyRunning}
          onClick={() => onRunWorkflowSteps?.(task)}
        >
          运行全部
        </Button>
      </div>
      {steps.map((step) => {
        // rawDone 当前步骤持久化的原始勾选态（所有步骤都可勾选，勾选态来自 workflowMap）
        const rawDone = isStepDone(workflowMap, taskName, step.key)
        // hasCommand 该步骤是否配置了执行命令：有则额外显示「执行」按钮
        const hasCommand = !!(step.command && String(step.command).trim())
        // running 该步骤当前是否正在执行：命中时「执行」按钮显示 loading 并禁用，仅影响本任务本步骤
        const running = !!runningSteps[stepRunKey(taskName, step.key)]
        // hasLastOutput 该步骤是否有最近一次执行的输出快照：有则显示「查看」按钮，可重新打开输出弹窗
        const hasLastOutput = !!lastStepOutputs[stepRunKey(taskName, step.key)]
        // runStatus 存储步骤当前展示状态：未执行、执行中、已完成或失败。
        const runStatus = getWorkflowStepRunStatus(
          step,
          taskName,
          workflowMap,
          runningSteps,
          lastStepOutputs
        )
        // failed 标记该步骤最近一次执行失败，决定按钮文案和状态标签。
        const failed = runStatus === 'failed'
        // done 为最终展示勾选态；执行失败会在上层撤销 rawDone，之后用户手动勾选应被如实展示。
        const done = rawDone
        // statusTag 当前步骤的状态标签；idle 不渲染，降低视觉噪音。
        const statusTag =
          runStatus === 'running' ? (
            <Tag
              color="processing"
              style={{ marginInlineEnd: 0, flexShrink: 0 }}
            >
              执行中
            </Tag>
          ) : runStatus === 'failed' ? (
            <Tag color="error" style={{ marginInlineEnd: 0, flexShrink: 0 }}>
              未通过
            </Tag>
          ) : runStatus === 'success' ? (
            <Tag color="success" style={{ marginInlineEnd: 0, flexShrink: 0 }}>
              已完成
            </Tag>
          ) : null
        return (
          <div
            key={step.key}
            data-testid={`workflow-step-row-${step.key}`}
            style={{
              padding: '8px 0',
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            {/* 文案前的勾选框：标记该步是否完成 */}
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <div
                data-testid={`workflow-step-title-line-${step.key}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  minWidth: 0,
                }}
              >
                <Checkbox
                  checked={done}
                  onChange={(e) =>
                    onToggleStep?.(taskName, step.key, e.target.checked)
                  }
                  style={{ maxWidth: '100%', minWidth: 0, flex: '0 1 auto' }}
                >
                  <SingleLineText
                    text={step.label}
                    inline
                    style={{ maxWidth: 300 }}
                  />
                </Checkbox>
                {statusTag}
              </div>
            </div>
            {/* 文案后的操作区：查看（icon-only 省空间，避免挤占文案）+ 执行。
                查看按钮在「执行中」或「有历史输出」时显示：执行中点它看实时输出，结束后点它回看上次结果 */}
            <div
              data-testid={`workflow-step-actions-${step.key}`}
              style={{
                flexShrink: 0,
                alignSelf: 'flex-start',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 4,
                maxWidth: 260,
              }}
            >
              {(running || hasLastOutput) && (
                <Tooltip title={running ? '查看实时输出' : '查看上次输出'}>
                  <Button
                    size="small"
                    icon={<FileTextOutlined />}
                    onClick={() =>
                      (running ? onViewCurrentOutput : onViewLastOutput)?.(
                        task,
                        step
                      )
                    }
                  />
                </Tooltip>
              )}
              {/* 执行按钮：仅配置了命令的步骤才显示，点击在任务目录下跑该命令。
                  执行中显示 loading 并禁用，文案变「执行中…」，避免重复点击；其他步骤/任务不受影响 */}
              {hasCommand && (
                <>
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    icon={<ThunderboltOutlined />}
                    loading={running}
                    disabled={running}
                    onClick={() => onRunStepAction?.(task, step)}
                  >
                    {running ? '执行中' : failed ? '重试' : '执行'}
                  </Button>
                  <Button
                    size="small"
                    type="link"
                    disabled={hasAnyRunning}
                    onClick={() => onRunWorkflowSteps?.(task, step.key)}
                    style={{ paddingInline: 4 }}
                  >
                    从此处运行
                  </Button>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )

  return (
    // stopPropagation 放在入口外层：需求流程入口位于 Collapse 头部 extra 区，点击时不应触发展开/折叠。
    <span
      onClick={(e) => e.stopPropagation()}
      style={{ display: 'inline-flex' }}
    >
      <Tooltip
        title={
          progress.total > 0
            ? `需求流程：已完成 ${progress.done}/${progress.total} 步`
            : '查看/操作需求流程'
        }
      >
        {/* 流程入口按钮：用分段圆点表达进度，比生硬的「0/4」数字更友好直观。
            无可勾选步骤时只显示「流程」；全部完成显示绿色对勾；否则用一排小圆点（已完成实心、未完成空心）一眼看完成度 */}
        <Button
          size="small"
          type="link"
          icon={<UnorderedListOutlined />}
          onClick={(e) => {
            e.stopPropagation()
            setOpen(true)
          }}
          style={{ paddingInline: 4 }}
        >
          流程
          {taskRunSummary.hasRunning && (
            <Spin size="small" style={{ marginInlineStart: 5 }} />
          )}
          {!taskRunSummary.hasRunning && taskRunSummary.hasFailed && (
            <WarningOutlined
              style={{ color: token.colorError, marginInlineStart: 5 }}
            />
          )}
          {/* 进度指示容器：对勾/圆点/文字三态互斥切换（尤其 allDone 切换）宽度不同会撑动标题行，
              统一包一层 minWidth 容器占位，让 allDone 时的对勾与进度态占据一致宽度，避免横向抖动（CLS）。
              左对齐保证内容起点稳定，minWidth 取一个能容纳典型进度展示的经验值 */}
          {progress.total > 0 && (
            <span
              style={{
                marginInlineStart: 5,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                minWidth: 46,
                verticalAlign: 'middle',
              }}
            >
              {allDone && (
                // 全部完成：绿色对勾，给用户「这条流程已走完」的明确正反馈
                <CheckCircleOutlined style={{ color: token.colorSuccess }} />
              )}
              {!allDone && progress.total <= PROGRESS_DOT_MAX && (
                // 步骤数较少（≤阈值）：一排圆点，每个步骤一个；已完成的用主题色实心、未完成的用淡灰空心，最直观
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  {Array.from({ length: progress.total }).map((_, i) => (
                    <span
                      key={i}
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        // 前 done 个圆点为已完成（主题色实心），其余为未完成（淡灰空心感）
                        background:
                          i < progress.done
                            ? token.colorPrimary
                            : token.colorFillSecondary,
                      }}
                    />
                  ))}
                  {/* 进度文字补充：圆点旁附 N/M 文字，未开始时淡化以降低存在感（不制造「待办焦虑」） */}
                  <span
                    style={{
                      marginInlineStart: 2,
                      fontSize: 11,
                      color: notStarted
                        ? token.colorTextQuaternary
                        : token.colorTextSecondary,
                    }}
                  >
                    {progress.done}/{progress.total}
                  </span>
                </span>
              )}
              {!allDone && progress.total > PROGRESS_DOT_MAX && (
                // 步骤数较多（>阈值）：圆点会排成长条撑宽任务行，改用紧凑「✓图标 + N/M」文字，宽度恒定
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    fontSize: 12,
                    color: notStarted
                      ? token.colorTextQuaternary
                      : token.colorTextSecondary,
                  }}
                >
                  <CheckCircleOutlined
                    style={{
                      fontSize: 11,
                      color:
                        progress.done > 0
                          ? token.colorPrimary
                          : token.colorTextQuaternary,
                    }}
                  />
                  {progress.done}/{progress.total}
                </span>
              )}
            </span>
          )}
        </Button>
      </Tooltip>
      <Modal
        title={`需求流程 - ${taskName}`}
        open={open}
        footer={null}
        width={640}
        destroyOnHidden
        onCancel={() => setOpen(false)}
      >
        {content}
      </Modal>
    </span>
  )
}

/**
 * 单个 worktree 行的状态标签
 * @param {object} wt - worktree 项
 * @returns {JSX.Element|null} 标签元素
 */
function wtStatusTags(wt) {
  // tags 累积状态标签
  const tags = []
  // trackedFilesCount 存储已跟踪文件改动数量；总数中剔除未跟踪文件，避免只有新增目录时误报成 diff。
  const trackedFilesCount = Math.max(
    (wt.changedFilesCount || 0) - (wt.untrackedFilesCount || 0),
    0
  )
  // 失效（目录被手动删除）
  if (wt.prunable || wt.missing)
    tags.push(
      <Tag color="default" key="missing">
        失效
      </Tag>
    )
  // 有已跟踪文件改动：展示为“有变更”，与仅新增未跟踪目录区分开。
  if (
    wt.hasTrackedChanges ||
    (wt.hasUncommittedChanges && !wt.hasUntrackedChanges)
  )
    tags.push(
      <Tag color="red" key="dirty">
        有变更{trackedFilesCount ? ` ${trackedFilesCount}` : ''}
      </Tag>
    )
  // 未跟踪文件/目录单独展示，解释 git diff 为空但 status 仍不干净的场景。
  if (wt.hasUntrackedChanges)
    tags.push(
      <Tag color="volcano" key="untracked">
        未跟踪{wt.untrackedFilesCount ? ` ${wt.untrackedFilesCount}` : ''}
      </Tag>
    )
  // 领先远程
  if (wt.ahead > 0)
    tags.push(
      <Tag color="blue" key="ahead">
        领先 {wt.ahead}
      </Tag>
    )
  // 落后远程
  if (wt.behind > 0)
    tags.push(
      <Tag color="gold" key="behind">
        落后 {wt.behind}
      </Tag>
    )
  return tags
}

/**
 * Worktree 任务面板
 * @param {object} props - 组件属性
 * @param {Array} props.tasks - 按任务分组的 worktree 数据
 * @param {boolean} props.loading - 是否加载中
 * @param {string[]|undefined} props.activeKeys - 受控展开的任务面板 key 集合
 * @param {(keys:string[])=>void} props.onActiveKeysChange - 展开集合变化回调
 * @param {(path:string)=>void} props.onOpenFinder - 打开 Finder
 * @param {(path:string)=>void} props.onOpenVscode - 打开 VSCode
 * @param {(path:string)=>void} props.onOpenTerminal - 在终端中打开
 * @param {(path:string)=>void} props.onCopyPath - 复制绝对路径到剪贴板
 * @param {(wt:object)=>void} props.onRemove - 删除单个 worktree
 * @param {(task:object)=>void} props.onRemoveTask - 删除整个任务下的所有 worktree
 * @param {(wt:object)=>void} props.onPrune - 清理某项目的失效 worktree
 * @param {Record<string,string>} props.taskStatusMap - 任务名 → 人工状态 key 的映射
 * @param {(taskName:string, statusKey?:string)=>void} props.onTaskStatusChange - 切换/清除任务状态
 * @param {Record<string,string|string[]|Array<{name?:string,url?:string}>>} props.taskLinkMap - 任务名 → Jira/飞书需求/工单链接条目列表 的映射
 * @param {(taskName:string, links:Array<{name:string,url:string}>|string[]|string)=>void} props.onTaskLinkChange - 设置/清除任务链接
 * @param {(url:string)=>void} props.onOpenUrl - 在浏览器中打开 URL
 * @param {(task:object)=>void} props.onAddWorktree - 为某任务追加创建 worktree
 * @param {Record<string,object>} props.envHealthMap - 任务名 → 环境检查状态 的映射
 * @param {Record<string,string>} props.cicdLinks - 项目名 → CI/CD 流水线 URL 的映射（从全局配置读取）
 * @param {Record<string,object>} props.claudeUsageMap - 任务名 → Claude 用量汇总 {sessionCount, usage, cost} 的映射
 * @param {Array<{key:string,label:string,type:string}>} props.workflowSteps - 工作流（需求流程）步骤清单（从全局配置读取）
 * @param {Record<string,string[]>} props.workflowMap - 任务名 → 已勾选步骤 key 数组 的映射
 * @param {(taskName:string, stepKey:string, done:boolean)=>void} props.onToggleStep - 切换某任务某 checkbox 步骤的勾选态
 * @param {(task:object, step:object)=>void} props.onRunStepAction - 执行某任务某 action 步骤
 * @param {(task:object, startKey?:string)=>void} props.onRunWorkflowSteps - 从任务流程起点或指定步骤开始串行执行命令步骤
 * @param {Record<string,boolean>} props.runningSteps - 正在执行的步骤集合（key 为 stepRunKey(任务名,步骤key)），用于步骤「执行」按钮显示 loading
 * @param {string[]} [props.hiddenTaskKeys] - 已隐藏任务名列表
 * @param {string[]} [props.pinnedTaskKeys] - 已置顶任务名列表
 * @param {string[]} [props.hidingTaskKeys] - 正在播放隐藏退出动画的任务名列表
 * @param {(taskName:string, hidden:boolean)=>void} [props.onTaskHiddenChange] - 隐藏/恢复任务回调
 * @param {(taskName:string, pinned:boolean)=>void} [props.onTaskPinnedChange] - 置顶/取消置顶任务回调
 * @param {Record<string,boolean>} [props.taskTitleBadges] - 任务标题旁徽标展示开关
 * @returns {JSX.Element} 面板元素
 */
export default function WorktreePanel({
  tasks,
  loading,
  activeKeys,
  onActiveKeysChange,
  onOpenFinder,
  onOpenVscode,
  onOpenTerminal,
  onCopyPath,
  onRemove,
  onRemoveTask,
  onPrune,
  taskStatusMap = {},
  onTaskStatusChange,
  taskLinkMap = {},
  onTaskLinkChange,
  onOpenUrl,
  onAddWorktree,
  onEnvCheck,
  envHealthMap = {},
  cicdLinks = {},
  claudeUsageMap = {},
  workflowSteps = [],
  workflowMap = {},
  onToggleStep,
  onRunStepAction,
  onRunWorkflowSteps,
  runningSteps = {},
  lastStepOutputs = {},
  onViewLastOutput,
  onViewCurrentOutput,
  hiddenTaskKeys = [],
  pinnedTaskKeys = [],
  hidingTaskKeys = [],
  onTaskHiddenChange,
  onTaskPinnedChange,
  taskTitleBadges,
}) {
  // 取主题 token，替换写死颜色以适配明暗主题
  const { token } = theme.useToken()
  // taskVisibility 存储任务隐藏/置顶偏好，供标题与按钮判断当前状态。
  const taskVisibility = { hidden: hiddenTaskKeys, pinned: pinnedTaskKeys }
  // titleBadges 存储任务标题旁徽标展示开关，缺失字段默认展示。
  const titleBadges = normalizeTaskTitleBadges(taskTitleBadges)
  // linkPopoverTask 当前打开链接配置气泡的任务名；null 表示无
  const [linkPopoverTask, setLinkPopoverTask] = useState(null)
  // linkInputVal 链接配置气泡内的输入框草稿数组（多条 Jira/飞书需求/工单链接，含展示名称和 URL）
  const [linkInputVal, setLinkInputVal] = useState([{ name: '', url: '' }])

  /**
   * 保存链接并关闭气泡
   * @param {string} taskName - 任务名
   */
  const handleSaveLink = (taskName) => {
    // links 存储从输入框草稿中清洗出的链接条目数组，传给上层统一持久化。
    const links = normalizeTaskLinkItems(linkInputVal)
    onTaskLinkChange?.(taskName, links)
    setLinkPopoverTask(null)
  }

  /**
   * 判断任务是否隐藏。
   * @param {string} taskName - 任务名
   * @returns {boolean} 是否隐藏
   */
  const isTaskHidden = (taskName) =>
    hasVisibilityKey(taskVisibility, 'hidden', taskName)

  /**
   * 判断任务是否置顶。
   * @param {string} taskName - 任务名
   * @returns {boolean} 是否置顶
   */
  const isTaskPinned = (taskName) =>
    hasVisibilityKey(taskVisibility, 'pinned', taskName)

  // 无数据时不渲染 Collapse（空 Collapse 会留一条灰色边框线）：
  // 三态（loading / empty / 有数据）共用同一 minHeight 外层容器，避免加载态→空态→数据态之间的高度跳变（CLS）
  if (!tasks || tasks.length === 0) {
    return (
      <div style={{ minHeight: 240 }}>
        {loading ? null : (
          <Empty
            description="暂无 worktree。点击右上角「创建 Worktree」按任务批量创建"
            style={{ marginTop: 60 }}
          />
        )}
      </div>
    )
  }

  // 折叠面板项：每个任务一项
  const items = (tasks || []).map((t) => {
    // taskHidden 标记当前任务是否已被用户隐藏；showHiddenTasks 打开时仍渲染用于恢复。
    const taskHidden = isTaskHidden(t.task)
    // taskPinned 标记当前任务是否已置顶，用于标题标签和按钮图标。
    const taskPinned = isTaskPinned(t.task)
    // taskHiding 标记当前任务是否正在播放隐藏退出动画。
    const taskHiding = hidingTaskKeys.includes(t.task)
    // 该任务下是否有失效 worktree，用于在标题提示
    const hasPrunable = t.worktrees.some((w) => w.prunable || w.missing)
    // taskLinks 该任务绑定的 Jira/飞书需求/工单链接条目列表（兼容旧版单字符串和 URL 数组）
    const taskLinks = normalizeTaskLinkItems(taskLinkMap[t.task])
    // taskGitlabEntries 存储当前任务下所有可打开的 GitLab 项目入口，任务级按钮使用它直开或下拉选择。
    const taskGitlabEntries = getTaskGitlabEntries(t)
    // hasTaskLinks 标记该任务是否已绑定至少一条需求链接
    const hasTaskLinks = taskLinks.length > 0
    // projectCount 存储当前任务覆盖的 worktree 项目数量，用于任务标题第一枚信息徽标
    const projectCount = t.worktrees.length
    // projectCountTag 存储空心方形项目数徽标；替代 Badge 圆点，让它与状态/链接/环境等标签同级展示
    const projectCountTag = (
      <Tooltip title={`${projectCount} 个项目`}>
        <Tag
          className="worktree-title-tag"
          aria-label={`项目数量 ${projectCount}`}
          style={{
            marginInlineEnd: 0,
            background: 'transparent',
            border: `1px solid ${token.colorPrimary}`,
            borderRadius: 4,
            color: token.colorPrimary,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 22,
            minWidth: 40,
            padding: '0 6px',
            lineHeight: '20px',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {projectCount} 项目
        </Tag>
      </Tooltip>
    )
    // taskLinkTags 存储任务标题旁逐条展示的需求链接标签；每个标签可直接打开对应链接。
    const taskLinkTags = taskLinks.map((item, index) => (
      <Tooltip
        title={item.name ? `${item.name}：${item.url}` : item.url}
        key={`${item.url}-${index}`}
      >
        <Tag
          className="worktree-title-tag task-link-title-tag"
          color="processing"
          onClick={(e) => {
            e.stopPropagation()
            onOpenUrl?.(item.url)
          }}
          style={{ cursor: 'pointer', maxWidth: 220 }}
        >
          <LinkOutlined style={{ flexShrink: 0 }} />
          <SingleLineText
            text={item.name || item.url}
            inline
            style={{ maxWidth: 180 }}
          />
        </Tag>
      </Tooltip>
    ))

    // 链接配置气泡内容：输入框 + 操作按钮
    const linkPopoverContent = (
      <Space direction="vertical" size={4}>
        <TaskLinksEditor
          value={linkInputVal}
          onChange={setLinkInputVal}
          width={340}
        />
        <Space size={4}>
          <Button size="small" onClick={() => handleSaveLink(t.task)}>
            保存
          </Button>
          {hasTaskLinks && (
            <Button
              size="small"
              danger
              onClick={() => {
                onTaskLinkChange?.(t.task, [])
                setLinkPopoverTask(null)
              }}
            >
              清除
            </Button>
          )}
        </Space>
      </Space>
    )

    /**
     * 打开当前任务的链接管理气泡，并用现有链接初始化输入草稿。
     */
    const openTaskLinkPopover = () => {
      setLinkInputVal(
        taskLinks.length > 0 ? taskLinks : [{ name: '', url: '' }]
      )
      setLinkPopoverTask(t.task)
    }

    return {
      key: t.task,
      className: taskHiding ? 'worktree-task-hiding' : undefined,
      label: (
        <div className="worktree-task-title-scroll">
          <SingleLineText
            text={t.task}
            inline
            style={{ maxWidth: 360, fontWeight: 600 }}
          />
          {taskPinned && (
            <Tag color="blue" style={{ marginInlineEnd: 0 }}>
              置顶
            </Tag>
          )}
          {taskHidden && (
            <Tag color="default" style={{ marginInlineEnd: 0 }}>
              已隐藏
            </Tag>
          )}
          {/* 项目数量徽标：信息优先级最高，先表达任务覆盖范围，再展示处理状态/链接/环境/用量。 */}
          {titleBadges.projectCount && projectCountTag}
          {/* 人工状态标签：紧跟项目数，折叠时也可见，点击切换/清除。 */}
          {titleBadges.taskStatus && (
            <TaskStatusControl
              taskName={t.task}
              statusKey={taskStatusMap[t.task]}
              onChange={onTaskStatusChange}
            />
          )}
          {/* 任务链接标签：排在状态后，保存了几条就逐条展示，点击直接打开对应需求/文档/工单。 */}
          {titleBadges.taskLinks && hasTaskLinks && taskLinkTags}
          {/* 环境检查状态：创建 worktree 后自动进入 loading，完成后直接红/绿展示；点击打开详情 */}
          {titleBadges.envHealth && onEnvCheck && (
            <EnvHealthStatusTag
              task={t}
              entry={envHealthMap[t.task]}
              onClick={onEnvCheck}
            />
          )}
          {/* Claude Code 用量标签：显示该任务关联会话的 token 量和费用，预加载数据从 claudeUsageMap 取 */}
          {titleBadges.claudeUsage && (
            <span
              onClick={(e) => e.stopPropagation()}
              style={{ display: 'inline-flex' }}
            >
              <ClaudeUsageTag
                taskName={t.task}
                summary={claudeUsageMap[t.task]}
              />
            </span>
          )}
          {hasPrunable && (
            <Tooltip title="包含失效 worktree，可清理">
              <WarningOutlined style={{ color: '#faad14' }} />
            </Tooltip>
          )}
        </div>
      ),
      extra: (
        <Space size={0}>
          {/* 需求流程入口：聚合该任务的研发流程步骤，点击展开后逐步勾选/执行 */}
          <WorkflowControl
            taskName={t.task}
            task={t}
            steps={workflowSteps}
            workflowMap={workflowMap}
            onToggleStep={onToggleStep}
            onRunStepAction={onRunStepAction}
            onRunWorkflowSteps={onRunWorkflowSteps}
            runningSteps={runningSteps}
            lastStepOutputs={lastStepOutputs}
            onViewLastOutput={onViewLastOutput}
            onViewCurrentOutput={onViewCurrentOutput}
          />
          {/* 置顶任务：只影响展示排序，不影响任务内容和 Git 操作 */}
          <Tooltip title={taskPinned ? '取消置顶任务' : '置顶任务'}>
            <Button
              size="small"
              type="link"
              aria-label={`${taskPinned ? '取消置顶任务' : '置顶任务'} ${t.task}`}
              icon={taskPinned ? <PushpinFilled /> : <PushpinOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                onTaskPinnedChange?.(t.task, !taskPinned)
              }}
            />
          </Tooltip>
          {/* 隐藏任务：默认从任务/看板/统计中排除；图标表达当前可见状态，tooltip/aria 表达点击动作 */}
          <Tooltip title={taskHidden ? '恢复显示任务' : '隐藏任务'}>
            <Button
              size="small"
              type="link"
              aria-label={`${taskHidden ? '恢复显示任务' : '隐藏任务'} ${t.task}`}
              icon={taskHidden ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              disabled={taskHiding}
              onClick={(e) => {
                e.stopPropagation()
                onTaskHiddenChange?.(t.task, !taskHidden)
              }}
            />
          </Tooltip>
          {/* 为此任务追加创建 worktree */}
          <Tooltip title="为此任务添加项目 Worktree">
            <Button
              size="small"
              type="link"
              icon={<PlusOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                onAddWorktree?.(t)
              }}
            />
          </Tooltip>
          {/* 链接配置：气泡内管理 Jira/飞书需求/工单链接名称和 URL；已绑定时图标高亮 */}
          {/* stopPropagation 必须在 Popover 外层：rc-trigger 会覆盖子元素 onClick，
              内层 Button 的 stopPropagation 会被丢弃，导致点击仍触发面板折叠 */}
          <span
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'inline-flex' }}
          >
            <Popover
              open={linkPopoverTask === t.task}
              onOpenChange={(v) => {
                if (v) openTaskLinkPopover()
                else setLinkPopoverTask(null)
              }}
              content={linkPopoverContent}
              title="绑定需求链接"
              trigger="click"
              placement="bottomRight"
            >
              <Tooltip
                title={
                  hasTaskLinks
                    ? '已绑定链接，点击管理'
                    : '绑定 Jira/飞书需求/工单链接'
                }
              >
                <Button
                  size="small"
                  type="link"
                  icon={
                    <LinkOutlined
                      style={{
                        color: hasTaskLinks ? token.colorPrimary : undefined,
                      }}
                    />
                  }
                  onClick={(e) => {
                    e.stopPropagation()
                    openTaskLinkPopover()
                  }}
                />
              </Tooltip>
            </Popover>
          </span>
          {/* 在 VSCode 中打开任务目录 */}
          <Tooltip title="在 VSCode 中打开">
            <Button
              size="small"
              type="link"
              icon={<VscodeIcon />}
              onClick={(e) => {
                e.stopPropagation()
                onOpenVscode(t.path)
              }}
            />
          </Tooltip>
          {/* GitLab 项目入口：放在 VSCode 后面；单项目直开，多项目由 TaskGitlabButton 下拉选择。 */}
          <TaskGitlabButton
            taskName={t.task}
            entries={taskGitlabEntries}
            onOpenUrl={onOpenUrl}
          />
          {/* 在 Finder 中打开任务目录 */}
          <Tooltip title="在 Finder 中打开">
            <Button
              size="small"
              type="link"
              icon={<FolderOpenOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                onOpenFinder(t.path)
              }}
            />
          </Tooltip>
          {/* 复制任务目录绝对路径：stopPropagation 防止点击触发面板折叠 */}
          <Tooltip title="复制路径">
            <Button
              size="small"
              type="link"
              icon={<CopyOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                onCopyPath(t.path)
              }}
            />
          </Tooltip>
          {/* 在终端中打开任务目录：stopPropagation 防止点击触发面板折叠 */}
          <Tooltip title="在终端中打开">
            <Button
              size="small"
              type="link"
              icon={<ConsoleSqlOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                onOpenTerminal(t.path)
              }}
            />
          </Tooltip>
          {/* 删除整个任务：一键删除该任务目录下所有 worktree（二次确认） */}
          <Tooltip title="删除任务">
            <Button
              size="small"
              type="link"
              danger
              title="删除任务"
              aria-label="删除任务"
              icon={<DeleteOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                onRemoveTask(t)
              }}
            />
          </Tooltip>
        </Space>
      ),
      children: (
        <div>
          {/* 任务目录已创建但尚未添加项目时，给内容区一个明确入口，复用任务栏加号的追加项目流程。 */}
          {t.worktrees.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="还没有项目 worktree"
              style={{ margin: '24px 0' }}
            >
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => onAddWorktree?.(t)}
              >
                添加项目
              </Button>
            </Empty>
          ) : (
            t.worktrees.map((wt) => (
              <div
                key={wt.path}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: `1px solid ${token.colorBorderSecondary}`,
                }}
              >
                <Space
                  direction="vertical"
                  size={0}
                  style={{ minWidth: 0, flex: 1 }}
                >
                  <Space wrap size={4}>
                    <Tag
                      color="geekblue"
                      style={{ maxWidth: 220, marginInlineEnd: 0 }}
                    >
                      <SingleLineText
                        text={wt.project}
                        inline
                        style={{ maxWidth: 200 }}
                      />
                    </Tag>
                    <SingleLineText
                      text={wt.branch || '(detached)'}
                      as="code"
                      inline
                      style={{ maxWidth: 360, fontSize: 12 }}
                    />
                    {wtStatusTags(wt)}
                  </Space>
                  <SingleLineText
                    text={wt.path}
                    style={{ color: token.colorTextSecondary, fontSize: 12 }}
                    tooltipPlacement="bottom"
                  />
                </Space>
                <Space size={4}>
                  {/* 失效 worktree 提供清理按钮 */}
                  {wt.prunable || wt.missing ? (
                    <Button size="small" onClick={() => onPrune(wt)}>
                      清理
                    </Button>
                  ) : (
                    <>
                      {/* CI/CD 流水线：当该项目在配置中有对应 URL 时才显示 */}
                      {cicdLinks[wt.project] && (
                        <Tooltip title="打开 CI/CD 流水线">
                          <Button
                            size="small"
                            icon={<RocketOutlined />}
                            onClick={() => onOpenUrl?.(cicdLinks[wt.project])}
                          />
                        </Tooltip>
                      )}
                      <Tooltip title="在 VSCode 中打开">
                        <Button
                          size="small"
                          icon={<VscodeIcon />}
                          onClick={() => onOpenVscode(wt.path)}
                        />
                      </Tooltip>
                      {/* GitLab 项目入口：由核心层根据 origin remote 自动推导，放在 VSCode 后面方便连续操作。 */}
                      {wt.gitlabUrl && (
                        <Tooltip title="打开 GitLab">
                          <Button
                            size="small"
                            aria-label={`打开 GitLab ${wt.project}`}
                            icon={<GitlabOutlined />}
                            onClick={() => onOpenUrl?.(wt.gitlabUrl)}
                          />
                        </Tooltip>
                      )}
                      <Tooltip title="在 Finder 中打开">
                        <Button
                          size="small"
                          icon={<FolderOpenOutlined />}
                          onClick={() => onOpenFinder(wt.path)}
                        />
                      </Tooltip>
                      <Tooltip title="复制路径">
                        <Button
                          size="small"
                          icon={<CopyOutlined />}
                          onClick={() => onCopyPath(wt.path)}
                        />
                      </Tooltip>
                      <Tooltip title="在终端中打开">
                        <Button
                          size="small"
                          icon={<ConsoleSqlOutlined />}
                          onClick={() => onOpenTerminal(wt.path)}
                        />
                      </Tooltip>
                      <Tooltip title="删除此 worktree">
                        <Button
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => onRemove(wt)}
                        />
                      </Tooltip>
                    </>
                  )}
                </Space>
              </div>
            ))
          )}
        </div>
      ),
    }
  })

  return (
    <Collapse
      className="worktree-task-collapse"
      items={items}
      activeKey={activeKeys ?? []}
      onChange={onActiveKeysChange}
    />
  )
}
