import React from 'react'
import {
  Button,
  Card,
  Col,
  Dropdown,
  Input,
  Row,
  Segmented,
  Space,
  Statistic,
} from 'antd'
import { DownOutlined } from '@ant-design/icons'
import { FILTERS } from '../projectLogic.ts'

// PROJECT_FILTER_OPTIONS 存储项目列表的筛选选项。
const PROJECT_FILTER_OPTIONS = [
  { label: '全部', value: FILTERS.ALL },
  { label: '非主分支', value: FILTERS.NON_MAIN },
  { label: '有变更', value: FILTERS.HAS_CHANGES },
  { label: '可拉取', value: FILTERS.CAN_PULL },
]

/**
 * 渲染项目统计卡片和项目列表控制区。
 * @param {object} props - 组件属性
 * @param {object} props.stats - 项目状态统计
 * @param {string} props.filter - 当前筛选条件
 * @param {string} props.keyword - 当前搜索词
 * @param {boolean} props.isNarrow - 是否为窄屏布局
 * @param {boolean} props.hasHiddenProjects - 是否存在隐藏项目
 * @param {boolean} props.showHiddenProjects - 是否正在显示隐藏项目
 * @param {Array<string>} props.selectedPaths - 当前可见的已选项目路径
 * @param {Array<object>} props.batchMenuItems - 批量操作菜单项
 * @param {(filter:string) => void} props.onFilterChange - 筛选条件修改回调
 * @param {(keyword:string) => void} props.onKeywordChange - 搜索词修改回调
 * @param {() => void} props.onToggleHiddenProjects - 切换隐藏项目展示回调
 * @param {(info:object) => void} props.onBatchMenuClick - 批量菜单点击回调
 * @returns {JSX.Element} 项目概览控制区
 */
export default function ProjectOverviewControls({
  stats,
  filter,
  keyword,
  isNarrow,
  hasHiddenProjects,
  showHiddenProjects,
  selectedPaths,
  batchMenuItems,
  onFilterChange,
  onKeywordChange,
  onToggleHiddenProjects,
  onBatchMenuClick,
}) {
  return (
    <>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} sm={12} md={6}>
          <Card size="small">
            <Statistic title="项目总数" value={stats.total} />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card size="small">
            <Statistic
              title="非主分支"
              value={stats.nonMain}
              styles={{ content: { color: '#fa8c16' } }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card size="small">
            <Statistic
              title="有未提交变更"
              value={stats.hasChanges}
              styles={{ content: { color: '#cf1322' } }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card size="small">
            <Statistic
              title="可拉取更新"
              value={stats.canPull}
              styles={{ content: { color: '#d48806' } }}
            />
          </Card>
        </Col>
      </Row>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 12,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Space size={10} wrap>
          <Segmented
            value={filter}
            onChange={onFilterChange}
            options={PROJECT_FILTER_OPTIONS}
          />
          <Input.Search
            placeholder="搜索项目名"
            allowClear
            value={keyword}
            style={{ width: isNarrow ? 150 : 200 }}
            onChange={(event) => onKeywordChange(event.target.value)}
          />
          <Button
            size="small"
            disabled={!hasHiddenProjects && !showHiddenProjects}
            onClick={onToggleHiddenProjects}
          >
            {showHiddenProjects ? '收起隐藏项目' : '显示隐藏项目'}
          </Button>
        </Space>
        <Dropdown
          menu={{ items: batchMenuItems, onClick: onBatchMenuClick }}
          disabled={!selectedPaths.length}
        >
          <Button type="primary">
            批量操作（{selectedPaths.length}） <DownOutlined />
          </Button>
        </Dropdown>
      </div>
    </>
  )
}
