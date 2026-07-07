import React, { useEffect, useState } from 'react';
import { Drawer, Tabs, List, Tag, Descriptions, Button, Space, Empty, theme } from 'antd';
import { CodeOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { api } from '../api.js';
import { statusTags } from '../projectLogic.js';
import { hasVisibilityKey } from '../visibilityLogic.js';

// 项目详情抽屉：展示提交历史、变更文件、worktree 列表。

/**
 * 项目详情抽屉
 * @param {object} props - 组件属性
 * @param {object|null} props.project - 当前查看的项目（null 时关闭）
 * @param {number|string} [props.drawerWidth] - 抽屉宽度（响应式：窄屏传 '100%'）
 * @param {()=>void} props.onClose - 关闭回调
 * @param {(path:string)=>void} props.onOpenFinder - 打开 Finder 回调
 * @param {(path:string)=>void} props.onOpenVscode - 打开 VSCode 回调
 * @param {string} [props.worktreesRoot] - worktree 根目录，用于从 worktree 路径反推出任务名
 * @param {string[]} [props.hiddenTaskKeys] - 已隐藏任务名列表
 * @param {string[]} [props.pinnedTaskKeys] - 已置顶任务名列表
 * @param {boolean} [props.showHiddenTasks] - 是否展示隐藏任务的 worktree
 * @returns {JSX.Element} 抽屉元素
 */
export default function ProjectDetail({ project, drawerWidth = 560, onClose, onOpenFinder, onOpenVscode, worktreesRoot = '', hiddenTaskKeys = [], pinnedTaskKeys = [], showHiddenTasks = false }) {
  // 取主题 token，替换写死的灰色文字以适配明暗主题
  const { token } = theme.useToken();
  // commits 存储最近提交历史
  const [commits, setCommits] = useState([]);
  // worktrees 存储 worktree 列表
  const [worktrees, setWorktrees] = useState([]);

  // 项目变化时加载详情数据
  useEffect(() => {
    if (!project) return;
    // 拉取提交历史与 worktree（失败静默）
    api.getCommits(project.path, 15).then(setCommits).catch(() => setCommits([]));
    api.getWorktrees(project.path).then(setWorktrees).catch(() => setWorktrees([]));
  }, [project]);

  if (!project) return null;

  // taskVisibility 存储任务隐藏/置顶偏好，用于过滤该项目下的 worktree。
  const taskVisibility = { hidden: hiddenTaskKeys, pinned: pinnedTaskKeys };

  /**
   * 从 worktree 绝对路径推导任务名。
   * @param {string} worktreePath - worktree 绝对路径
   * @returns {string} 任务名；非任务 worktree 返回空字符串
   */
  const getTaskNameFromPath = (worktreePath) => {
    // cleanRoot 存储去掉末尾斜杠后的 worktree 根目录。
    const cleanRoot = String(worktreesRoot || '').replace(/\/+$/, '');
    // cleanPath 存储去掉末尾斜杠后的 worktree 路径。
    const cleanPath = String(worktreePath || '').replace(/\/+$/, '');
    if (!cleanRoot || !cleanPath.startsWith(`${cleanRoot}/`)) return '';
    // relPath 存储相对 worktree 根目录的路径，格式通常为 {任务名}/{项目名}。
    const relPath = cleanPath.slice(cleanRoot.length + 1);
    // parts 存储路径片段；任务名可包含斜杠，因此只去掉最后一个项目目录片段。
    const parts = relPath.split('/').filter(Boolean);
    if (parts.length < 2) return '';
    if (project?.name && parts[parts.length - 1] !== project.name) return '';
    return parts.slice(0, -1).join('/');
  };

  // visibleWorktrees 存储详情中实际展示的 worktree；隐藏任务默认过滤，置顶任务排在前面。
  const visibleWorktrees = [...worktrees]
    .map((worktree) => ({ ...worktree, taskName: getTaskNameFromPath(worktree.path) }))
    .filter((worktree) => showHiddenTasks || !hasVisibilityKey(taskVisibility, 'hidden', worktree.taskName))
    .sort((a, b) => {
      // aPinned/bPinned 标记该 worktree 所属任务是否置顶。
      const aPinned = hasVisibilityKey(taskVisibility, 'pinned', a.taskName);
      const bPinned = hasVisibilityKey(taskVisibility, 'pinned', b.taskName);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      return String(a.branch || '').localeCompare(String(b.branch || ''));
    });

  // 提交历史 Tab 内容
  const commitsTab = (
    <List
      size="small"
      dataSource={commits}
      locale={{ emptyText: <Empty description="暂无提交" /> }}
      renderItem={(c) => (
        <List.Item>
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Space>
              <code>{c.hash}</code>
              <span>{c.message}</span>
            </Space>
            <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>
              {c.author} · {c.date}
            </span>
          </Space>
        </List.Item>
      )}
    />
  );

  // 变更文件 Tab 内容
  const filesTab = (
    <List
      size="small"
      dataSource={project.changedFiles || []}
      locale={{ emptyText: <Empty description="工作区干净" /> }}
      renderItem={(f) => (
        <List.Item>
          <Tag>{(f.index || ' ') + (f.working_dir || ' ')}</Tag>
          <code>{f.path}</code>
        </List.Item>
      )}
    />
  );

  // worktree Tab 内容
  const worktreeTab = (
    <List
      size="small"
      dataSource={visibleWorktrees}
      locale={{ emptyText: <Empty description="无 worktree" /> }}
      renderItem={(w) => (
        <List.Item
          actions={[
            <Button type="link" size="small" key="finder" onClick={() => onOpenFinder(w.path)}>
              Finder
            </Button>,
            <Button type="link" size="small" key="vscode" onClick={() => onOpenVscode(w.path)}>
              VSCode
            </Button>,
          ]}
        >
          <Space direction="vertical" size={0}>
            <Space>
              <code>{w.branch || '(detached)'}</code>
              {w.isMain && <Tag color="blue">主工作区</Tag>}
              {w.taskName && hasVisibilityKey(taskVisibility, 'pinned', w.taskName) && <Tag color="blue">置顶</Tag>}
              {w.taskName && hasVisibilityKey(taskVisibility, 'hidden', w.taskName) && <Tag color="default">已隐藏</Tag>}
            </Space>
            <span style={{ color: token.colorTextSecondary, fontSize: 12, wordBreak: 'break-all' }}>{w.path}</span>
          </Space>
        </List.Item>
      )}
    />
  );

  return (
    <Drawer
      title={project.name}
      open={!!project}
      onClose={onClose}
      width={drawerWidth}
      extra={
        <Space>
          <Button icon={<CodeOutlined />} onClick={() => onOpenVscode(project.path)}>VSCode</Button>
          <Button icon={<FolderOpenOutlined />} onClick={() => onOpenFinder(project.path)}>Finder</Button>
        </Space>
      }
    >
      <Descriptions size="small" column={1} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="当前分支">{project.currentBranch || '-'}</Descriptions.Item>
        <Descriptions.Item label="跟踪分支">{project.tracking || '-'}</Descriptions.Item>
        <Descriptions.Item label="状态">
          <Space size={4} wrap>
            {statusTags(project).map((t) => (
              <Tag color={t.color} key={t.text}>
                {t.text}
              </Tag>
            ))}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="路径">
          <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{project.path}</span>
        </Descriptions.Item>
      </Descriptions>
      <Tabs
        items={[
          { key: 'commits', label: '提交历史', children: commitsTab },
          { key: 'files', label: `变更文件 (${(project.changedFiles || []).length})`, children: filesTab },
          { key: 'worktrees', label: `Worktree (${worktrees.length})`, children: worktreeTab },
        ]}
      />
    </Drawer>
  );
}
