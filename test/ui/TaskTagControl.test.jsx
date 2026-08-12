import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TASK_TAGS } from '../../src/core/taskTags.js'
import TaskTagControl from '../../src/ui/components/TaskTagControl.tsx'

afterEach(() => cleanup())

describe('TaskTagControl', () => {
  it('未分类任务可选择 BUG，已分类任务可清除', async () => {
    // onChange 存储任务分类变更调用，用于验证稳定 key 而非展示文案被保存。
    const onChange = vi.fn()
    const { rerender } = render(
      <TaskTagControl
        taskName="TASK-1"
        taskTags={DEFAULT_TASK_TAGS}
        onChange={onChange}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '设置任务分类 TASK-1' }))
    fireEvent.click(await screen.findByText('BUG'))
    expect(onChange).toHaveBeenCalledWith('TASK-1', 'bug')

    rerender(
      <TaskTagControl
        taskName="TASK-1"
        tagKey="bug"
        taskTags={DEFAULT_TASK_TAGS}
        onChange={onChange}
      />
    )
    // selectedTag 存储重渲染后当前控件中的已选标签，避开正在退出的旧下拉菜单同名项。
    const selectedTag = document.querySelector('.task-tag-control-tag')
    fireEvent.click(selectedTag)
    fireEvent.click(await screen.findByText('清除分类'))
    expect(onChange).toHaveBeenLastCalledWith('TASK-1', '')
  })
})
