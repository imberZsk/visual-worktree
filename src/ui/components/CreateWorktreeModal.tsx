import React, { useEffect, useRef, useState } from 'react'
import { Modal, Form, Input, Select, Alert } from 'antd'
import { normalizeTaskLinkItems } from '../worktreeLogic.ts'
import TaskLinksEditor from './TaskLinksEditor.tsx'

// 按任务批量创建 worktree 弹窗：输入任务名 + 可选多个项目 + 需求链接 + 分支名。
// 选择项目时在 worktreesRoot/{任务名}/{项目名} 下为每个选中项目各建一个 worktree；
// 未选择项目时仅创建任务目录，用于先记录需求链接、稍后再追加项目。

/**
 * 创建 worktree 弹窗
 * @param {object} props - 组件属性
 * @param {boolean} props.open - 是否打开
 * @param {Array<{name:string,path:string}>} props.projects - 可选源项目列表
 * @param {boolean} [props.projectsLoading] - 是否正在加载可选源项目列表
 * @param {string} props.worktreesPath - worktree 根目录（用于提示路径）
 * @param {string} [props.defaultTask] - 预填的任务名；设置后任务名字段禁用（从任务行添加时传入）
 * @param {(values:object)=>Promise<void>} props.onSubmit - 提交回调
 * @param {()=>void} props.onClose - 关闭回调
 * @returns {JSX.Element} 弹窗元素
 */
export default function CreateWorktreeModal({
  open,
  projects,
  projectsLoading = false,
  worktreesPath,
  defaultTask,
  onSubmit,
  onClose,
}) {
  // antd 表单实例
  const [form] = Form.useForm()
  // submitting 标记创建请求进行中，防止重复提交并给按钮加 loading 状态
  const [submitting, setSubmitting] = useState(false)
  // 监听任务名、分支名与项目选择以实时预览将创建的路径
  const task = Form.useWatch('task', form)
  const branch = Form.useWatch('branch', form)
  // projectPaths 存储当前选择的项目路径数组；空数组表示只创建任务目录。
  const projectPaths = Form.useWatch('projectPaths', form)
  // 上一次自动填充的分支名（用于判断用户是否手动修改过分支）
  const prevAutoFilled = useRef('')

  /**
   * 任务名输入时同步默认分支，避免提交发生在 effect 刷新前导致必填校验失败。
   * @param {import('react').ChangeEvent<HTMLInputElement>} event - 任务名输入事件
   */
  const handleTaskChange = (event) => {
    // nextTask 存储用户刚输入的任务名。
    const nextTask = event.target.value
    // currentBranch 存储当前分支字段值，用于保护用户手工输入。
    const currentBranch = form.getFieldValue('branch') || ''
    if (!currentBranch || currentBranch === prevAutoFilled.current) {
      form.setFieldValue('branch', nextTask)
      prevAutoFilled.current = nextTask
    }
  }

  // 打开时重置表单；若有预填任务名（从任务行入口打开），同步填入任务名和分支名
  useEffect(() => {
    if (open) {
      form.resetFields()
      prevAutoFilled.current = ''
      if (defaultTask) {
        form.setFieldValue('task', defaultTask)
        form.setFieldValue('branch', defaultTask)
        prevAutoFilled.current = defaultTask
      }
    }
  }, [open, form, defaultTask])

  // 任务名变化时自动同步分支名：
  // 仅当分支名为空或等于上次自动填充的值时才同步，避免覆盖用户手动修改的分支名
  useEffect(() => {
    if (!task) return
    const currentBranch = form.getFieldValue('branch') || ''
    if (!currentBranch || currentBranch === prevAutoFilled.current) {
      form.setFieldValue('branch', task)
      prevAutoFilled.current = task
    }
  }, [form, task])

  /**
   * 校验并提交；提交期间立即进入 loading 态，让用户感知到操作已发出
   */
  const handleOk = async () => {
    // 校验失败是用户正常路径（必填项未填），用 try/catch 吞掉 validateFields 的 reject，
    // 避免冒泡成 unhandled promise rejection；antd 会自动在对应表单项展示错误提示
    try {
      // values 为表单收集的创建参数
      const values = await form.validateFields()
      // submittedValues 存储最终提交值：补齐可选数组字段，保证下游无需处理 undefined
      const submittedValues = {
        ...values,
        projectPaths: Array.isArray(values.projectPaths)
          ? values.projectPaths
          : [],
        links: normalizeTaskLinkItems(values.links),
      }
      // 校验通过后立即 loading，给用户即时反馈（创建大量 worktree 时后端耗时约 1-3s）
      setSubmitting(true)
      await onSubmit(submittedValues)
    } catch (e) {
      // 校验未通过：不提交，错误已由 antd 表单项内联展示，无需额外处理
    } finally {
      setSubmitting(false)
    }
  }

  // 源项目下拉选项
  const projectOptions = (projects || [])
    .filter((p) => p.isGitRepo)
    .map((p) => ({ label: p.name, value: p.path }))

  return (
    // okButtonProps.loading 在点击「创建」后立即生效，避免用户等待约 1s 却无任何反馈
    <Modal
      title="按任务创建 Worktree"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      width={600}
      destroyOnHidden
      okText="创建"
      okButtonProps={{ loading: submitting }}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label="任务名（作为目录名，建议用需求号，如 PROJ-1234-xxx）"
          name="task"
          rules={[{ required: true, message: '请输入任务名' }]}
        >
          {/* defaultTask 时任务名已固定（从任务行入口打开），禁用编辑 */}
          <Input
            placeholder="PROJ-1234-需求简述"
            disabled={!!defaultTask}
            onChange={handleTaskChange}
          />
        </Form.Item>
        <Form.Item
          label="选择项目（可多选，将为每个项目各建一个 worktree）"
          name="projectPaths"
        >
          <Select
            mode="multiple"
            placeholder="选择要建立 worktree 的项目"
            options={projectOptions}
            optionFilterProp="label"
            showSearch
            loading={projectsLoading}
          />
        </Form.Item>
        <Form.Item label="需求链接" name="links">
          <TaskLinksEditor />
        </Form.Item>
        <Form.Item
          label="分支名"
          name="branch"
          rules={[{ required: true, message: '请输入分支名' }]}
          tooltip="有同名分支则自动检出，否则创建新分支"
        >
          <Input placeholder="已跟随任务名自动填入，可手动修改" />
        </Form.Item>
        {/* 路径预览：让用户确认 worktree 会建在哪 */}
        {task && (
          <Alert
            type="info"
            showIcon
            message="将创建到"
            description={
              (projectPaths || []).length > 0
                ? `${worktreesPath || '<worktree根目录>'}/${task}/<项目名>  →  分支 ${branch || '<分支名>'}`
                : `${worktreesPath || '<worktree根目录>'}/${task}  →  暂不创建项目 worktree`
            }
          />
        )}
      </Form>
    </Modal>
  )
}
