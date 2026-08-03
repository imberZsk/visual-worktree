import React, { useEffect, useState } from 'react'
import { Card, Pagination, Space, Tag, Typography } from 'antd'

// ENV_CHECK_LABELS 存储环境检查项的中文展示名称。
const ENV_CHECK_LABELS = {
  deps: '依赖',
  ports: '端口',
  services: '服务',
  git: 'Git',
}

// ENV_PROJECT_PAGE_SIZE 存储环境检查详情中每页展示的项目卡片数量。
const ENV_PROJECT_PAGE_SIZE = 2

// ENV_PROJECT_STATUS_SORT_ORDER 存储项目排序权重，优先展示错误和警告项目。
const ENV_PROJECT_STATUS_SORT_ORDER = { failed: 0, warning: 1, ok: 2 }

/**
 * 把检查项状态映射为 antd Tag 颜色。
 * @param {string} status - 检查项状态 ok/warning/error
 * @returns {string} antd Tag color
 */
function getCheckTagColor(status) {
  return status === 'ok'
    ? 'success'
    : status === 'warning'
      ? 'warning'
      : 'error'
}

/**
 * 判断环境检查项是否应在详情中隐藏。
 * @param {string} key - 检查项 key
 * @param {object} item - 检查项结果
 * @returns {boolean} 是否隐藏
 */
function shouldHideEnvCheckItem(key, item) {
  // 端口未声明只是没有检查依据，不属于需要用户处理的环境问题。
  return (
    key === 'ports' &&
    (item?.skipped || item?.message === '未在 scripts 中发现端口声明')
  )
}

/**
 * 渲染单个环境检查项。
 * @param {object} props - 组件属性
 * @param {string} props.checkKey - 检查项 key
 * @param {object} props.item - 检查项结果
 * @returns {JSX.Element|null} 检查项内容
 */
function EnvCheckItem({ checkKey, item }) {
  if (shouldHideEnvCheckItem(checkKey, item)) return null
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <Tag
        color={getCheckTagColor(item.status)}
        style={{ flex: '0 0 auto', marginInlineEnd: 0 }}
      >
        {ENV_CHECK_LABELS[checkKey]}
      </Tag>
      <div style={{ minWidth: 0, flex: 1 }}>
        <Typography.Text>{item.message}</Typography.Text>
        {item.fixes?.length > 0 && (
          <ul style={{ marginTop: 4, marginBottom: 0, paddingInlineStart: 18 }}>
            {item.fixes.map((fix, index) => (
              <li key={index}>
                <Typography.Text type="secondary">{fix}</Typography.Text>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/**
 * 环境检查详情内容：优先展示项目级自动识别结果，旧结构作为兜底继续兼容。
 * @param {object} props - 组件属性
 * @param {object} props.result - 环境检查结果
 * @param {object} props.token - antd 主题 token
 * @returns {JSX.Element|null} 详情内容
 */
export default function EnvHealthResultContent({ result, token }) {
  // projectPage 存储环境检查项目卡片当前页码。
  const [projectPage, setProjectPage] = useState(1)
  useEffect(() => {
    setProjectPage(1)
  }, [result])

  if (!result) return null
  if (result.error)
    return <div style={{ color: token.colorError }}>{result.error}</div>

  // hasProjectDetails 标记核心层是否返回项目级结构。
  const hasProjectDetails = Array.isArray(result.projects)
  if (hasProjectDetails) {
    // summary 存储任务级汇总，缺失时使用兼容旧数据的兜底内容。
    const summary = result.summary || {
      status: 'failed',
      projectCount: result.projects.length,
      issueCount: 0,
      message: '环境检查完成',
    }
    // summaryColor 存储顶部摘要标签颜色。
    const summaryColor =
      summary.status === 'ok'
        ? 'success'
        : summary.status === 'warning'
          ? 'warning'
          : 'error'
    // allProjects 存储按问题严重程度排序后的全部项目。
    const allProjects = [...result.projects].sort(
      (left, right) =>
        (ENV_PROJECT_STATUS_SORT_ORDER[left.status] ?? 3) -
        (ENV_PROJECT_STATUS_SORT_ORDER[right.status] ?? 3)
    )
    // totalPages 存储项目卡片总页数。
    const totalPages = Math.max(
      1,
      Math.ceil(allProjects.length / ENV_PROJECT_PAGE_SIZE)
    )
    // safeProjectPage 存储不会超过总页数的当前页码。
    const safeProjectPage = Math.min(projectPage, totalPages)
    // visibleProjects 存储当前页实际展示的项目卡片。
    const visibleProjects = allProjects.slice(
      (safeProjectPage - 1) * ENV_PROJECT_PAGE_SIZE,
      safeProjectPage * ENV_PROJECT_PAGE_SIZE
    )
    // showProjectPagination 标记当前项目数量是否需要分页。
    const showProjectPagination = allProjects.length > ENV_PROJECT_PAGE_SIZE
    // projectListMinHeight 存储分页列表的稳定最小高度。
    const projectListMinHeight = showProjectPagination ? 240 : undefined

    return (
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              minWidth: 0,
            }}
          >
            <Tag color={summaryColor} style={{ marginInlineEnd: 0 }}>
              {summary.status === 'ok'
                ? '环境正常'
                : `${summary.issueCount || 1} 个环境问题`}
            </Tag>
            <Typography.Text>{summary.message}</Typography.Text>
          </div>
          {showProjectPagination && (
            <Pagination
              size="small"
              current={safeProjectPage}
              pageSize={ENV_PROJECT_PAGE_SIZE}
              total={allProjects.length}
              showSizeChanger={false}
              onChange={(page) => setProjectPage(page)}
            />
          )}
        </div>
        <div
          style={{ display: 'grid', gap: 12, minHeight: projectListMinHeight }}
        >
          {visibleProjects.map((project) => {
            // projectStatusColor 存储单项目状态标签颜色。
            const projectStatusColor =
              project.status === 'ok'
                ? 'success'
                : project.status === 'warning'
                  ? 'warning'
                  : 'error'
            // checks 存储当前项目的各项检查结果。
            const checks = project.checks || {}
            // reasons 存储项目类型识别依据，限制数量避免标题区域过高。
            const reasons = Array.isArray(project.reasons)
              ? project.reasons.slice(0, 3)
              : []
            return (
              <Card
                key={project.path || project.name}
                size="small"
                title={
                  <Space wrap size={6}>
                    <Typography.Text strong>{project.name}</Typography.Text>
                    <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                      {project.kindLabel || project.kind || '未知'}
                    </Tag>
                    <Tag
                      color={projectStatusColor}
                      style={{ marginInlineEnd: 0 }}
                    >
                      {project.status === 'ok'
                        ? '正常'
                        : `${project.issueCount || 1} 个问题`}
                    </Tag>
                  </Space>
                }
              >
                <Space
                  orientation="vertical"
                  size={8}
                  style={{ width: '100%' }}
                >
                  {reasons.length > 0 && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      识别依据：{reasons.join('、')}
                    </Typography.Text>
                  )}
                  {['deps', 'ports', 'services', 'git'].map((checkKey) => (
                    <EnvCheckItem
                      key={checkKey}
                      checkKey={checkKey}
                      item={
                        checks[checkKey] || {
                          status: 'error',
                          message: '检查结果缺失',
                          fixes: [],
                        }
                      }
                    />
                  ))}
                </Space>
              </Card>
            )
          })}
        </div>
      </Space>
    )
  }

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      {['deps', 'ports', 'services', 'git'].map((checkKey) => {
        // item 存储旧结构下的当前检查项结果。
        const item = result[checkKey] || {
          status: 'error',
          message: '无结果',
          fixes: [],
        }
        if (shouldHideEnvCheckItem(checkKey, item)) return null
        return (
          <Card key={checkKey} size="small" title={ENV_CHECK_LABELS[checkKey]}>
            <Space orientation="vertical" size={8} style={{ width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag color={getCheckTagColor(item.status)}>
                  {String(item.status || '').toUpperCase()}
                </Tag>
                <Typography.Text>{item.message}</Typography.Text>
              </div>
              {item.fixes?.length > 0 && (
                <div>
                  <Typography.Text type="secondary">修复建议：</Typography.Text>
                  <ul style={{ marginTop: 4, marginBottom: 0 }}>
                    {item.fixes.map((fix, index) => (
                      <li key={index}>{fix}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Space>
          </Card>
        )
      })}
    </Space>
  )
}
