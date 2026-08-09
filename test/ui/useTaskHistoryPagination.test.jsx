import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import useTaskHistoryPagination from '../../src/ui/hooks/useTaskHistoryPagination.ts'

/**
 * 渲染可观察页码与每页条数的历史分页测试容器。
 * @param {object} props - 测试容器属性。
 * @param {number} props.itemCount - 当前历史记录数量。
 * @returns {JSX.Element} 历史分页测试容器。
 */
function HistoryPaginationHarness({ itemCount }) {
  // paginationState 存储 hook 返回的分页状态和列表引用。
  const paginationState = useTaskHistoryPagination({ open: true, itemCount })
  return (
    <div>
      <div ref={paginationState.listShellRef} className="history-task-list">
        <div className="history-task-list-item">历史记录</div>
      </div>
      <output data-testid="history-page">{paginationState.page}</output>
      <output data-testid="history-page-size">
        {paginationState.pageSize}
      </output>
      <button
        type="button"
        onClick={() => paginationState.pagination?.onChange(3)}
      >
        第三页
      </button>
    </div>
  )
}

afterEach(() => cleanup())

describe('历史任务分页状态', () => {
  it('第三页删除记录后不按新首条高度重算容量并跳到第二页', () => {
    // originalClientHeight 存储测试前的容器高度属性描述符。
    const originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientHeight'
    )
    // originalOffsetHeight 存储测试前的记录高度属性描述符。
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetHeight'
    )
    // itemHeight 存储当前模拟记录高度，删除后会变为更紧凑的高度。
    let itemHeight = 56
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return this.classList?.contains('history-task-list') ? 224 : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        return this.classList?.contains('history-task-list-item')
          ? itemHeight
          : 0
      },
    })

    try {
      // renderedHarness 存储测试容器及其重渲染能力。
      const renderedHarness = render(
        <HistoryPaginationHarness itemCount={14} />
      )
      expect(screen.getByTestId('history-page-size').textContent).toBe('4')
      fireEvent.click(screen.getByRole('button', { name: '第三页' }))
      expect(screen.getByTestId('history-page').textContent).toBe('3')

      itemHeight = 28
      renderedHarness.rerender(<HistoryPaginationHarness itemCount={13} />)

      expect(screen.getByTestId('history-page-size').textContent).toBe('4')
      expect(screen.getByTestId('history-page').textContent).toBe('3')
    } finally {
      if (originalClientHeight) {
        Object.defineProperty(
          HTMLElement.prototype,
          'clientHeight',
          originalClientHeight
        )
      } else {
        delete HTMLElement.prototype.clientHeight
      }
      if (originalOffsetHeight) {
        Object.defineProperty(
          HTMLElement.prototype,
          'offsetHeight',
          originalOffsetHeight
        )
      } else {
        delete HTMLElement.prototype.offsetHeight
      }
    }
  })
})
