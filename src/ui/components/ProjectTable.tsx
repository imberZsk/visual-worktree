import React from 'react'
import { Table, Tag, Button, Space, Tooltip } from 'antd'
import {
  EyeInvisibleOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  CopyOutlined,
  PushpinFilled,
  PushpinOutlined,
  GitlabOutlined,
  ConsoleSqlOutlined,
} from '@ant-design/icons'
import { statusTags } from '../projectLogic.ts'
import { hasVisibilityKey } from '../visibilityLogic.ts'
import { VscodeIcon } from '../icons.tsx'
import SingleLineText from './SingleLineText.tsx'

// 项目列表表格组件：展示项目名、当前分支、状态标签、操作按钮，支持多选。

/**
 * 项目表格
 * @param {object} props - 组件属性
 * @param {Array} props.data - 过滤后的项目列表
 * @param {boolean} props.loading - 是否加载中
 * @param {string[]} props.selectedPaths - 选中的项目路径
 * @param {(paths:string[])=>void} props.onSelectChange - 选中变化回调
 * @param {(project:object)=>void} props.onDetail - 查看详情回调
 * @param {(project:object)=>void} props.onCheckoutMain - 切换主分支回调
 * @param {(project:object)=>void} props.onPull - 拉取更新回调
 * @param {(project:object)=>void} props.onSyncUpdates - 提交并推送更新回调
 * @param {(project:object)=>void} props.onOpenFinder - 打开 Finder 回调
 * @param {(project:object)=>void} props.onOpenVscode - 打开 VSCode 回调
 * @param {(url:string)=>void} props.onOpenUrl - 打开外部链接回调
 * @param {(project:object)=>void} props.onOpenTerminal - 打开终端回调
 * @param {(project:object)=>void} props.onCopyPath - 复制路径回调
 * @param {string[]} [props.hiddenProjectKeys] - 已隐藏项目路径列表
 * @param {string[]} [props.pinnedProjectKeys] - 已置顶项目路径列表
 * @param {string[]} [props.hidingProjectKeys] - 正在播放隐藏退出动画的项目路径列表
 * @param {Set<string>} [props.loadingPaths] - 正在执行操作（切分支/拉取/同步更新）的项目路径集合，用于按钮 loading 反馈
 * @param {(projectPath:string, hidden:boolean)=>void} [props.onProjectHiddenChange] - 隐藏/恢复项目回调
 * @param {(projectPath:string, pinned:boolean)=>void} [props.onProjectPinnedChange] - 置顶/取消置顶项目回调
 * @returns {JSX.Element} 表格元素
 */
export default function ProjectTable({
  data,
  loading,
  selectedPaths,
  onSelectChange,
  onDetail,
  onCheckoutMain,
  onPull,
  onSyncUpdates,
  onOpenFinder,
  onOpenVscode,
  onOpenUrl,
  onOpenTerminal,
  onCopyPath,
  hiddenProjectKeys = [],
  pinnedProjectKeys = [],
  hidingProjectKeys = [],
  loadingPaths = new Set(),
  onProjectHiddenChange,
  onProjectPinnedChange,
}) {
  // projectVisibility 存储项目隐藏/置顶偏好，复用纯逻辑判断函数。
  const projectVisibility = {
    hidden: hiddenProjectKeys,
    pinned: pinnedProjectKeys,
  }

  /**
   * 判断项目是否隐藏。
   * @param {object} project - 项目状态对象
   * @returns {boolean} 是否隐藏
   */
  const isProjectHidden = (project) =>
    hasVisibilityKey(projectVisibility, 'hidden', project.path)

  /**
   * 判断项目是否置顶。
   * @param {object} project - 项目状态对象
   * @returns {boolean} 是否置顶
   */
  const isProjectPinned = (project) =>
    hasVisibilityKey(projectVisibility, 'pinned', project.path)

  /**
   * 判断项目是否正在执行隐藏退出动画。
   * @param {object} project - 项目状态对象
   * @returns {boolean} 是否处于隐藏动画态
   */
  const isProjectHiding = (project) => hidingProjectKeys.includes(project.path)

  /**
   * 计算项目表格行 className。
   * @param {object} project - 项目状态对象
   * @returns {string} 行样式类名
   */
  const getProjectRowClassName = (project) => {
    // classNames 存储当前行需要叠加的展示态类名。
    const classNames = []
    if (isProjectHidden(project)) classNames.push('project-row-hidden')
    if (isProjectHiding(project)) classNames.push('project-row-hiding')
    return classNames.join(' ')
  }

  // 表格列定义
  const columns = [
    {
      title: '项目名称',
      dataIndex: 'name',
      key: 'name',
      width: 220,
      fixed: 'left',
      sorter: (a, b) => {
        // aPinned/bPinned 标记项目是否置顶；用户点击表头排序时也保持置顶在最上方。
        const aPinned = isProjectPinned(a)
        const bPinned = isProjectPinned(b)
        if (aPinned !== bPinned) return aPinned ? -1 : 1
        return a.name.localeCompare(b.name)
      },
      render: (name, record) => (
        <Space size={4} style={{ maxWidth: '100%', minWidth: 0 }}>
          <SingleLineText
            text={name}
            style={{ maxWidth: 150, fontWeight: 500 }}
          />
          {isProjectPinned(record) && (
            <Tag color="blue" style={{ marginInlineEnd: 0 }}>
              置顶
            </Tag>
          )}
          {isProjectHidden(record) && (
            <Tag color="default" style={{ marginInlineEnd: 0 }}>
              已隐藏
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: '当前分支',
      dataIndex: 'currentBranch',
      key: 'currentBranch',
      width: 200,
      ellipsis: { showTitle: false },
      render: (branch, record) =>
        record.isGitRepo ? (
          <SingleLineText text={branch || '(detached)'} as="code" />
        ) : (
          '-'
        ),
    },
    {
      title: '状态',
      key: 'status',
      width: 240,
      render: (_, record) => (
        <Space size={4} wrap>
          {statusTags(record).map((t) => (
            <Tag color={t.color} key={t.text}>
              {t.text}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 330,
      fixed: 'right',
      render: (_, record) => (
        <Space size={4}>
          <Button size="small" onClick={() => onDetail(record)}>
            详情
          </Button>
          {/* 非主分支才显示切换按钮 */}
          {record.isGitRepo && !record.isMainBranch && (
            <Button
              size="small"
              type="primary"
              ghost
              loading={loadingPaths.has(record.path)}
              disabled={loadingPaths.has(record.path)}
              onClick={() => onCheckoutMain(record)}
            >
              切主分支
            </Button>
          )}
          {/* 可拉取时显示拉取按钮 */}
          {record.canPull && (
            <Button
              size="small"
              loading={loadingPaths.has(record.path)}
              disabled={loadingPaths.has(record.path)}
              onClick={() => onPull(record)}
            >
              拉取
            </Button>
          )}
          {/* 同步更新会提交全部工作区变更并推送，因此仅对 Git 项目展示。 */}
          {record.isGitRepo && (
            <Button
              size="small"
              loading={loadingPaths.has(record.path)}
              disabled={loadingPaths.has(record.path)}
              onClick={() => onSyncUpdates(record)}
            >
              同步更新
            </Button>
          )}
          {/* Finder / VSCode / 终端 / 复制路径 直接展示为图标按钮，无需收入下拉 */}
          <Tooltip title="在 Finder 中打开">
            <Button
              size="small"
              icon={<FolderOpenOutlined />}
              onClick={() => onOpenFinder(record)}
            />
          </Tooltip>
          <Tooltip title="在 VSCode 中打开">
            <Button
              size="small"
              icon={<VscodeIcon />}
              onClick={() => onOpenVscode(record)}
            />
          </Tooltip>
          {/* GitLab 项目入口：由核心层根据 origin remote 自动推导，紧跟 VSCode 方便项目级跳转。 */}
          {record.gitlabUrl && (
            <Tooltip title="打开 GitLab">
              <Button
                size="small"
                aria-label={`打开 GitLab ${record.name}`}
                icon={<GitlabOutlined />}
                onClick={() => onOpenUrl?.(record.gitlabUrl)}
              />
            </Tooltip>
          )}
          <Tooltip title="在终端中打开">
            <Button
              size="small"
              icon={<ConsoleSqlOutlined />}
              onClick={() => onOpenTerminal?.(record)}
            />
          </Tooltip>
          <Tooltip title="复制路径">
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={() => onCopyPath?.(record)}
            />
          </Tooltip>
          <Tooltip
            title={isProjectPinned(record) ? '取消置顶项目' : '置顶项目'}
          >
            <Button
              size="small"
              aria-label={`${isProjectPinned(record) ? '取消置顶项目' : '置顶项目'} ${record.name}`}
              icon={
                isProjectPinned(record) ? (
                  <PushpinFilled />
                ) : (
                  <PushpinOutlined />
                )
              }
              onClick={() =>
                onProjectPinnedChange?.(record.path, !isProjectPinned(record))
              }
            />
          </Tooltip>
          {/* 隐藏项目：图标表达当前可见状态，tooltip/aria 表达点击动作。 */}
          <Tooltip
            title={isProjectHidden(record) ? '恢复显示项目' : '隐藏项目'}
          >
            <Button
              size="small"
              aria-label={`${isProjectHidden(record) ? '恢复显示项目' : '隐藏项目'} ${record.name}`}
              icon={
                isProjectHidden(record) ? (
                  <EyeInvisibleOutlined />
                ) : (
                  <EyeOutlined />
                )
              }
              disabled={isProjectHiding(record)}
              onClick={() =>
                onProjectHiddenChange?.(record.path, !isProjectHidden(record))
              }
            />
          </Tooltip>
        </Space>
      ),
    },
  ]

  // 多选配置
  const rowSelection = {
    selectedRowKeys: selectedPaths,
    onChange: onSelectChange,
    // 隐藏项目即使临时展示出来，也不允许勾选参与批量操作。
    getCheckboxProps: (record) => ({
      disabled: isProjectHidden(record) || isProjectHiding(record),
    }),
  }

  return (
    <Table
      rowKey="path"
      size="small"
      columns={columns}
      dataSource={data}
      loading={loading}
      rowSelection={rowSelection}
      pagination={false}
      rowClassName={getProjectRowClassName}
      // 横向滚动：窄屏保持列宽，左右列固定；纵向由外层 Content 处理，不再设 scroll.y
      scroll={{ x: 950 }}
    />
  )
}
