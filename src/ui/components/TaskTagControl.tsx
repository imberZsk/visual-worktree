import { DownOutlined, TagOutlined } from '@ant-design/icons'
import { Button, Dropdown, Tag, Tooltip } from 'antd'
import { normalizeTaskTags } from '../../core/taskTags.js'
import { getTaskTagMeta } from '../taskTagLogic.ts'
import './TaskTagControl.css'

/**
 * 展示并修改单个任务的自定义分类标签。
 * @param {object} props - 组件属性。
 * @param {string} props.taskName - 当前任务名。
 * @param {string} props.tagKey - 当前任务选择的分类 key。
 * @param {Array<object>} props.taskTags - 当前工作区可选分类定义。
 * @param {(taskName:string,tagKey:string)=>void} props.onChange - 分类变更回调，空 key 表示清除。
 * @returns {JSX.Element|null} 分类选择控件；没有可选分类且未选中时不渲染。
 */
export default function TaskTagControl({
  taskName,
  tagKey,
  taskTags = [],
  onChange,
}) {
  // availableTags 存储当前工作区清洗后的可选分类定义。
  const availableTags = normalizeTaskTags(taskTags)
  // selectedTag 存储当前任务映射命中的分类定义。
  const selectedTag = getTaskTagMeta(tagKey, availableTags)
  if (availableTags.length === 0 && !selectedTag) return null

  // menuItems 存储下拉菜单的分类选项和可选的清除操作。
  const menuItems = availableTags.map((tag) => ({
    key: tag.key,
    label: (
      <Tag color={tag.color} className="task-tag-control-menu-tag">
        {tag.label}
      </Tag>
    ),
  }))
  if (selectedTag) {
    menuItems.push({ type: 'divider' }, { key: '__clear__', label: '清除分类' })
  }

  /**
   * 将下拉菜单选择转换为任务分类变更。
   * @param {{key:string,domEvent:Event}} info - Ant Design 菜单点击信息。
   */
  const handleMenuClick = ({ key, domEvent }) => {
    domEvent?.stopPropagation?.()
    onChange?.(taskName, key === '__clear__' ? '' : key)
  }

  return (
    <Dropdown
      menu={{ items: menuItems, onClick: handleMenuClick }}
      trigger={['click']}
    >
      <span
        className="task-tag-control"
        onClick={(event) => event.stopPropagation()}
      >
        {selectedTag ? (
          <Tag color={selectedTag.color} className="task-tag-control-tag">
            {selectedTag.label}
            <DownOutlined className="task-tag-control-chevron" />
          </Tag>
        ) : (
          <Tooltip title="设置任务分类">
            <Button
              type="text"
              size="small"
              icon={<TagOutlined />}
              aria-label={`设置任务分类 ${taskName}`}
            />
          </Tooltip>
        )}
      </span>
    </Dropdown>
  )
}
