import { withConfirmDefaults } from '../modalDefaults.ts'

// BATCH_MENU_KEYS 存储批量操作菜单键，避免菜单渲染与点击分发使用散落字符串。
const BATCH_MENU_KEYS = {
  pull: 'pull',
  checkoutMain: 'checkout-main',
}

// BATCH_OPERATIONS 存储主进程支持的批量操作类型。
const BATCH_OPERATIONS = {
  pull: 'pull',
  checkoutMain: 'checkoutMain',
}

// BATCH_MENU_ITEMS 存储批量操作菜单固定顺序：先更新，再按仓库实际分支切换主分支。
const BATCH_MENU_ITEMS = [
  { key: BATCH_MENU_KEYS.pull, label: '批量拉取更新' },
  { key: BATCH_MENU_KEYS.checkoutMain, label: '批量切到主分支' },
]

/**
 * 管理项目批量操作菜单、确认和结果提示。
 * @param {object} options - 批量操作依赖。
 * @param {Array<string>} options.selectedPaths - 当前可参与批量操作的项目路径。
 * @param {(operation:string,args:object) => Promise<Array<object>>} options.runBatch - 执行批量操作的 Store 动作。
 * @param {object} options.message - Ant Design message API。
 * @param {object} options.modal - Ant Design modal API。
 * @returns {object} 批量菜单项和点击处理函数。
 */
export default function useBatchOperations({
  selectedPaths,
  runBatch,
  message,
  modal,
}) {
  /**
   * 执行批量操作并展示成功与失败数量。
   * @param {string} operation - 主进程批量操作类型。
   * @param {object} args - 批量操作参数。
   */
  const execute = async (operation, args) => {
    // results 存储每个项目的批量执行结果。
    const results = await runBatch(operation, args)
    // successCount 存储执行成功的项目数量。
    const successCount = results.filter((result) => result.success).length
    // failureCount 存储执行失败的项目数量。
    const failureCount = results.length - successCount
    if (failureCount === 0) message.success(`全部成功（${successCount} 个）`)
    else message.warning(`完成：成功 ${successCount}，失败 ${failureCount}`)
  }

  /**
   * 确认用户选择的批量操作后异步执行。
   * @param {string} operation - 主进程批量操作类型。
   * @param {object} args - 批量操作参数。
   * @param {string} label - 确认框中的操作名称。
   */
  const confirm = (operation, args, label) => {
    if (!selectedPaths.length) {
      message.warning('请先勾选项目')
      return
    }
    modal.confirm(
      withConfirmDefaults({
        title: `批量${label}`,
        content: `将对选中的 ${selectedPaths.length} 个项目执行「${label}」，是否继续？`,
        // 不返回 Promise，让确认框立即关闭，执行进度由独立进度弹窗展示。
        onOk: () => {
          void execute(operation, args)
        },
      })
    )
  }

  /**
   * 将菜单项 key 分发到对应批量操作。
   * @param {{key:string}} menuInfo - Ant Design 菜单点击信息。
   */
  const handleMenuClick = ({ key }) => {
    if (key === BATCH_MENU_KEYS.pull) {
      confirm(BATCH_OPERATIONS.pull, {}, '拉取更新')
    } else if (key === BATCH_MENU_KEYS.checkoutMain) {
      confirm(BATCH_OPERATIONS.checkoutMain, {}, '切到主分支')
    }
  }

  return { menuItems: BATCH_MENU_ITEMS, handleMenuClick }
}
