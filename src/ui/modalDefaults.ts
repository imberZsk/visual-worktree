/**
 * 合并确认弹层的全局默认交互。
 * @param {object} options - 调用方传入的确认弹层配置
 * @returns {object} 合并默认交互后的确认弹层配置
 */
export function withConfirmDefaults(options = {}) {
  // confirmOptions 存储最终传给 antd modal.confirm / Modal.confirm 的配置；调用方字段后置，便于显式覆盖默认值。
  const confirmOptions = {
    centered: true,
    mask: { closable: true },
    ...options,
  }
  return confirmOptions
}
