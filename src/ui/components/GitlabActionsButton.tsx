import React from 'react'
import { Button, Dropdown } from 'antd'
import { GitlabOutlined } from '@ant-design/icons'
import { buildGitlabMergeRequestUrl } from '../gitlabLogic.ts'

// GITLAB_ACTION_OPEN 存储打开 GitLab 项目动作的菜单 key 前缀。
const GITLAB_ACTION_OPEN = 'open'
// GITLAB_ACTION_CREATE_MR 存储创建 Merge Request 动作的菜单 key 前缀。
const GITLAB_ACTION_CREATE_MR = 'create-mr'

/**
 * GitLab 悬停操作按钮，支持打开项目与创建预填目标分支的 Merge Request。
 * @param {object} props - 组件属性
 * @param {string} props.ariaLabel - 图标按钮的无障碍名称
 * @param {Array<{key:string,label:string,url:string,branch?:string}>} props.entries - 可操作的 GitLab 项目列表
 * @param {string} props.targetBranch - Merge Request 目标分支
 * @param {(url:string)=>void} props.onOpenUrl - 打开外部地址的回调
 * @param {'small'|'middle'|'large'} [props.size] - 按钮尺寸
 * @param {'link'|'text'|'default'|'primary'|'dashed'} [props.type] - 按钮类型
 * @returns {JSX.Element|null} GitLab 操作按钮；无有效项目时返回空
 */
export default function GitlabActionsButton({
  ariaLabel,
  entries,
  targetBranch,
  onOpenUrl,
  size = 'small',
  type = 'default',
}) {
  // validEntries 存储地址有效的 GitLab 项目，避免损坏扫描数据生成空菜单。
  const validEntries = (entries || []).filter((entry) => entry?.url)
  if (validEntries.length === 0) return null

  // menuItems 存储悬停菜单动作；多项目任务会为每个项目分别提供打开和新建 MR 入口。
  const menuItems = validEntries.flatMap((entry) => {
    // mergeRequestUrl 存储当前项目预填源分支和目标分支的新建 MR 地址。
    const mergeRequestUrl = buildGitlabMergeRequestUrl(
      entry.url,
      entry.branch || '',
      targetBranch
    )
    // projectSuffix 存储多项目任务菜单中的项目名，单项目时省略以保持紧凑。
    const projectSuffix = validEntries.length > 1 ? ` ${entry.label}` : ''
    // items 存储当前项目对应的菜单项。
    const items = [
      {
        key: `${GITLAB_ACTION_OPEN}:${entry.key}`,
        label: `打开 GitLab${projectSuffix}`,
      },
    ]
    if (mergeRequestUrl) {
      items.push({
        key: `${GITLAB_ACTION_CREATE_MR}:${entry.key}`,
        label: `创建${projectSuffix}合并到 ${targetBranch} 的 MR`,
      })
    }
    return items
  })

  /**
   * 处理 GitLab 悬停菜单动作。
   * @param {{key:string,domEvent?:Event}} info - Ant Design 菜单点击信息
   */
  const handleMenuClick = ({ key, domEvent }) => {
    domEvent?.stopPropagation?.()
    // separatorIndex 存储动作前缀与项目 key 的分隔位置，项目 URL 可能包含冒号，不能直接 split。
    const separatorIndex = key.indexOf(':')
    // action 存储用户选择的 GitLab 动作类型。
    const action = key.slice(0, separatorIndex)
    // entryKey 存储菜单项关联的项目稳定 key。
    const entryKey = key.slice(separatorIndex + 1)
    // entry 存储本次动作对应的 GitLab 项目。
    const entry = validEntries.find((item) => item.key === entryKey)
    if (!entry) return
    // targetUrl 存储最终需要交给系统浏览器打开的地址。
    const targetUrl =
      action === GITLAB_ACTION_CREATE_MR
        ? buildGitlabMergeRequestUrl(
            entry.url,
            entry.branch || '',
            targetBranch
          )
        : entry.url
    if (targetUrl) onOpenUrl?.(targetUrl)
  }

  return (
    <Dropdown
      trigger={['hover', 'click']}
      menu={{ items: menuItems, onClick: handleMenuClick }}
    >
      <Button
        size={size}
        type={type}
        aria-label={ariaLabel}
        icon={<GitlabOutlined />}
        onClick={(event) => event.stopPropagation()}
      />
    </Dropdown>
  )
}
