import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProjectDetail from '../../src/ui/components/ProjectDetail.tsx'

afterEach(() => cleanup())

describe('ProjectDetail 关闭过渡', () => {
  it('关闭时保留最后一次项目内容供 Drawer 执行退出动画', async () => {
    // project 存储打开详情抽屉所需的最小项目数据。
    const project = {
      name: 'alpha-project',
      path: '/repo/alpha-project',
      currentBranch: 'master',
      changedFiles: [],
    }
    // props 存储与本用例无关的稳定回调，避免重渲染引入额外变化。
    const props = {
      onClose: vi.fn(),
      onOpenFinder: vi.fn(),
      onOpenVscode: vi.fn(),
    }
    // rerender 存储测试库的原位重渲染入口，用于模拟父组件清空 detailProject。
    const { rerender } = render(<ProjectDetail project={project} {...props} />)

    await waitFor(() => {
      expect(screen.getByText('alpha-project')).toBeTruthy()
      expect(screen.getByText('暂无提交')).toBeTruthy()
    })
    rerender(<ProjectDetail project={null} {...props} />)

    expect(screen.getByText('alpha-project')).toBeTruthy()
    expect(document.querySelector('.project-detail-drawer')).toBeTruthy()
  })
})
