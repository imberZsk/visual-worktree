import React from 'react'
import { Button, Input, Modal, Space, Tooltip, Typography } from 'antd'
import { FolderOpenOutlined } from '@ant-design/icons'

// ONBOARDING_PATH_FIELD 存储首次初始化目录选择动作的字段标识。
export const ONBOARDING_PATH_FIELD = {
  SOURCE_PROJECTS: 'source-projects',
  WORKTREES: 'worktrees',
}

/**
 * 渲染首次安装所需的项目路径配置弹窗。
 * @param {object} props - 组件属性
 * @param {boolean} props.open - 弹窗是否显示
 * @param {string} props.sourceProjectsPath - 源项目根目录
 * @param {string} props.worktreesPath - Worktree 根目录
 * @param {string} props.pickingField - 当前正在选择目录的字段
 * @param {boolean} props.saving - 是否正在保存配置
 * @param {(value:string) => void} props.onSourceProjectsPathChange - 源项目路径修改回调
 * @param {(value:string) => void} props.onWorktreesPathChange - Worktree 路径修改回调
 * @param {(field:string) => void} props.onPickDirectory - 选择目录回调
 * @param {() => void} props.onSubmit - 保存配置回调
 * @returns {JSX.Element} 首次初始化弹窗
 */
export default function OnboardingModal({
  open,
  sourceProjectsPath,
  worktreesPath,
  pickingField,
  saving,
  onSourceProjectsPathChange,
  onWorktreesPathChange,
  onPickDirectory,
  onSubmit,
}) {
  // submitDisabled 标记必填路径是否完整，防止提交空配置。
  const submitDisabled = !sourceProjectsPath.trim() || !worktreesPath.trim()

  return (
    <Modal
      open={open}
      title="配置项目路径"
      closable={false}
      mask={{ closable: false }}
      keyboard={false}
      footer={
        <Button
          type="primary"
          loading={saving}
          disabled={submitDisabled}
          onClick={onSubmit}
        >
          保存并开始使用
        </Button>
      }
    >
      <Typography.Paragraph>
        请选择本地 Git 仓库所在目录，以及用于创建任务 Worktree
        的目录。完成后即可扫描项目和管理 Worktree。
      </Typography.Paragraph>
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <Typography.Text strong>源项目根目录</Typography.Text>
          <Space.Compact style={{ width: '100%', marginTop: 6 }}>
            <Input
              aria-label="源项目根目录"
              value={sourceProjectsPath}
              placeholder="例如：/Users/you/Desktop/work/projects"
              onChange={(event) =>
                onSourceProjectsPathChange(event.target.value)
              }
            />
            <Tooltip title="选择源项目根目录">
              <Button
                aria-label="选择源项目根目录"
                icon={<FolderOpenOutlined />}
                loading={pickingField === ONBOARDING_PATH_FIELD.SOURCE_PROJECTS}
                onClick={() =>
                  onPickDirectory(ONBOARDING_PATH_FIELD.SOURCE_PROJECTS)
                }
              />
            </Tooltip>
          </Space.Compact>
        </div>
        <div>
          <Typography.Text strong>Worktree 根目录</Typography.Text>
          <Space.Compact style={{ width: '100%', marginTop: 6 }}>
            <Input
              aria-label="Worktree 根目录"
              value={worktreesPath}
              placeholder="例如：/Users/you/Desktop/work/worktrees"
              onChange={(event) => onWorktreesPathChange(event.target.value)}
            />
            <Tooltip title="选择 Worktree 根目录">
              <Button
                aria-label="选择 Worktree 根目录"
                icon={<FolderOpenOutlined />}
                loading={pickingField === ONBOARDING_PATH_FIELD.WORKTREES}
                onClick={() => onPickDirectory(ONBOARDING_PATH_FIELD.WORKTREES)}
              />
            </Tooltip>
          </Space.Compact>
        </div>
      </Space>
    </Modal>
  )
}
