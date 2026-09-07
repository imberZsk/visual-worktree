import React, { useEffect, useState } from 'react'
import {
  Drawer,
  Tabs,
  Tag,
  Descriptions,
  Button,
  Space,
  Empty,
  theme,
} from 'antd'
import { CodeOutlined, FolderOpenOutlined } from '@ant-design/icons'
import { api } from '../api.ts'
import { statusTags } from '../projectLogic.ts'
import { hasVisibilityKey } from '../visibilityLogic.ts'
import './ProjectDetail.css'

// 项目详情抽屉：展示提交历史、变更文件、worktree 列表。

/**
 * 渲染项目详情中的紧凑数据列表。
 * @param {object} props - 组件属性
 * @param {Array<object>} props.items - 待展示的数据项
 * @param {string} props.emptyDescription - 空列表提示
 * @param {(item:object,index:number) => React.ReactNode} props.renderItem - 单项渲染函数
 * @param {(item:object,index:number) => React.Key} props.getItemKey - 单项 key 生成函数
 * @returns {JSX.Element} 语义化详情列表
 */
function DetailList({ items, emptyDescription, renderItem, getItemKey }) {
  // token 存储当前 antd 主题变量，用于列表项分隔线。
  const { token } = theme.useToken()
  if (items.length === 0) return <Empty description={emptyDescription} />
  return (
    <div role="list">
      {items.map((item, index) => (
        <div
          key={getItemKey(item, index)}
          role="listitem"
          style={{
            borderBlockEnd: `1px solid ${token.colorSplit}`,
            paddingBlock: 8,
          }}
        >
          {renderItem(item, index)}
        </div>
      ))}
    </div>
  )
}

/**
 * 项目详情抽屉
 * @param {object} props - 组件属性
 * @param {object|null} props.project - 当前查看的项目（null 时关闭）
 * @param {number|string} [props.drawerWidth] - 抽屉宽度（响应式：窄屏传 '100%'）
 * @param {()=>void} props.onClose - 关闭回调
 * @param {(path:string)=>void} props.onOpenFinder - 打开 Finder 回调
 * @param {(path:string)=>void} props.onOpenVscode - 打开 VSCode 回调
 * @param {string} [props.worktreesRoot] - worktree 根目录，用于从 worktree 路径反推出任务名
 * @param {string[]} [props.hiddenTaskKeys] - 已隐藏任务名列表
 * @param {string[]} [props.pinnedTaskKeys] - 已置顶任务名列表
 * @param {boolean} [props.showHiddenTasks] - 是否展示隐藏任务的 worktree
 * @returns {JSX.Element} 抽屉元素
 */
export default function ProjectDetail({
  project,
  drawerWidth = 560,
  onClose,
  onOpenFinder,
  onOpenVscode,
  worktreesRoot = '',
  hiddenTaskKeys = [],
  pinnedTaskKeys = [],
  showHiddenTasks = false,
}) {
  // 取主题 token，替换写死的灰色文字以适配明暗主题
  const { token } = theme.useToken()
  // commits 存储最近提交历史
  const [commits, setCommits] = useState([])
  // worktrees 存储 worktree 列表
  const [worktrees, setWorktrees] = useState([])
  // displayedProject 存储最后一次打开的项目，关闭动画期间保留内容避免 Drawer 被立即卸载。
  const [displayedProject, setDisplayedProject] = useState(project)

  // 项目变化时加载详情数据
  useEffect(() => {
    if (!project) return
    setDisplayedProject(project)
    // 拉取提交历史与 worktree（失败静默）
    api
      .getCommits(project.path, 15)
      .then(setCommits)
      .catch(() => setCommits([]))
    api
      .getWorktrees(project.path)
      .then(setWorktrees)
      .catch(() => setWorktrees([]))
  }, [project])

  // activeProject 存储当前渲染的项目；关闭期间回退最后一次项目以完成退出动画。
  const activeProject = project || displayedProject
  if (!activeProject) return null

  // taskVisibility 存储任务隐藏/置顶偏好，用于过滤该项目下的 worktree。
  const taskVisibility = { hidden: hiddenTaskKeys, pinned: pinnedTaskKeys }

  /**
   * 从 worktree 绝对路径推导任务名。
   * @param {string} worktreePath - worktree 绝对路径
   * @returns {string} 任务名；非任务 worktree 返回空字符串
   */
  const getTaskNameFromPath = (worktreePath) => {
    // cleanRoot 存储去掉末尾斜杠后的 worktree 根目录。
    const cleanRoot = String(worktreesRoot || '').replace(/\/+$/, '')
    // cleanPath 存储去掉末尾斜杠后的 worktree 路径。
    const cleanPath = String(worktreePath || '').replace(/\/+$/, '')
    if (!cleanRoot || !cleanPath.startsWith(`${cleanRoot}/`)) return ''
    // relPath 存储相对 worktree 根目录的路径，格式通常为 {任务名}/{项目名}。
    const relPath = cleanPath.slice(cleanRoot.length + 1)
    // parts 存储路径片段；任务名可包含斜杠，因此只去掉最后一个项目目录片段。
    const parts = relPath.split('/').filter(Boolean)
    if (parts.length < 2) return ''
    if (activeProject?.name && parts[parts.length - 1] !== activeProject.name)
      return ''
    return parts.slice(0, -1).join('/')
  }

  // visibleWorktrees 存储详情中实际展示的 worktree；隐藏任务默认过滤，置顶任务排在前面。
  const visibleWorktrees = [...worktrees]
    .map((worktree) => ({
      ...worktree,
      taskName: getTaskNameFromPath(worktree.path),
    }))
    .filter(
      (worktree) =>
        showHiddenTasks ||
        !hasVisibilityKey(taskVisibility, 'hidden', worktree.taskName)
    )
    .sort((a, b) => {
      // aPinned/bPinned 标记该 worktree 所属任务是否置顶。
      const aPinned = hasVisibilityKey(taskVisibility, 'pinned', a.taskName)
      const bPinned = hasVisibilityKey(taskVisibility, 'pinned', b.taskName)
      if (aPinned !== bPinned) return aPinned ? -1 : 1
      return String(a.branch || '').localeCompare(String(b.branch || ''))
    })

  // 提交历史 Tab 内容
  const commitsTab = (
    <DetailList
      items={commits}
      emptyDescription="暂无提交"
      getItemKey={(commit, index) => commit.hash || index}
      renderItem={(commit) => (
        <Space orientation="vertical" size={0} style={{ width: '100%' }}>
          <Space>
            <code>{commit.hash}</code>
            <span>{commit.message}</span>
          </Space>
          <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>
            {commit.author} · {commit.date}
          </span>
        </Space>
      )}
    />
  )

  // 工作区文件 Tab 内容：包含已跟踪改动与未跟踪文件，名称避免被误解为仅 git diff。
  const filesTab = (
    <DetailList
      items={activeProject.changedFiles || []}
      emptyDescription="工作区干净"
      getItemKey={(file, index) => file.path || index}
      renderItem={(file) => (
        <Space>
          <Tag>{(file.index || ' ') + (file.working_dir || ' ')}</Tag>
          <code>{file.path}</code>
        </Space>
      )}
    />
  )

  // worktree Tab 内容
  const worktreeTab = (
    <DetailList
      items={visibleWorktrees}
      emptyDescription="无 worktree"
      getItemKey={(worktree, index) => worktree.path || index}
      renderItem={(worktree) => (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <Space orientation="vertical" size={0}>
            <Space>
              <code>{worktree.branch || '(detached)'}</code>
              {worktree.isMain && <Tag color="blue">主工作区</Tag>}
              {worktree.taskName &&
                hasVisibilityKey(
                  taskVisibility,
                  'pinned',
                  worktree.taskName
                ) && <Tag color="blue">置顶</Tag>}
              {worktree.taskName &&
                hasVisibilityKey(
                  taskVisibility,
                  'hidden',
                  worktree.taskName
                ) && <Tag color="default">已隐藏</Tag>}
            </Space>
            <span
              style={{
                color: token.colorTextSecondary,
                fontSize: 12,
                wordBreak: 'break-all',
              }}
            >
              {worktree.path}
            </span>
          </Space>
          <Space size={0}>
            <Button
              type="link"
              size="small"
              onClick={() => onOpenFinder(worktree.path)}
            >
              Finder
            </Button>
            <Button
              type="link"
              size="small"
              onClick={() => onOpenVscode(worktree.path)}
            >
              VSCode
            </Button>
          </Space>
        </div>
      )}
    />
  )

  return (
    <Drawer
      rootClassName="project-detail-drawer"
      title={activeProject.name}
      open={!!project}
      onClose={onClose}
      afterOpenChange={(isOpen) => {
        // 退出动画结束后再清理旧内容，行为与设置抽屉一致。
        if (!isOpen && !project) setDisplayedProject(null)
      }}
      size={drawerWidth}
      extra={
        <Space>
          <Button
            icon={<CodeOutlined />}
            onClick={() => onOpenVscode(activeProject.path)}
          >
            VSCode
          </Button>
          <Button
            icon={<FolderOpenOutlined />}
            onClick={() => onOpenFinder(activeProject.path)}
          >
            Finder
          </Button>
        </Space>
      }
    >
      <Descriptions size="small" column={1} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="当前分支">
          {activeProject.currentBranch || '-'}
        </Descriptions.Item>
        <Descriptions.Item label="跟踪分支">
          {activeProject.tracking || '-'}
        </Descriptions.Item>
        <Descriptions.Item label="状态">
          <Space size={4} wrap>
            {statusTags(activeProject).map((t) => (
              <Tag color={t.color} key={t.text}>
                {t.text}
              </Tag>
            ))}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="路径">
          <span style={{ fontSize: 12, color: token.colorTextSecondary }}>
            {activeProject.path}
          </span>
        </Descriptions.Item>
      </Descriptions>
      <Tabs
        items={[
          { key: 'commits', label: '提交历史', children: commitsTab },
          {
            key: 'files',
            label: `工作区文件 (${(activeProject.changedFiles || []).length})`,
            children: filesTab,
          },
          {
            key: 'worktrees',
            label: `Worktree (${worktrees.length})`,
            children: worktreeTab,
          },
        ]}
      />
    </Drawer>
  )
}
