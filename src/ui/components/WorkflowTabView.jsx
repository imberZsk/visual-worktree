import React, { useEffect, useState, useRef } from 'react';
import {
  Row, Col, Button, Input, List, Modal, Form, Space, Tag, Collapse,
  Spin, Tooltip, Empty, App as AntApp, theme,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, PlayCircleOutlined,
  CheckCircleFilled, CloseCircleFilled, ClockCircleOutlined, MinusCircleOutlined,
} from '@ant-design/icons';
import { isStepEventFor, appendStepChunk } from '../../core/stepOutputLog.js';
import { withConfirmDefaults } from '../modalDefaults.js';

// 工作流 tab 主体组件：用户在这里定义"想法工作流"并运行。
// 工作流 = 一组有序步骤（每步一条 shell 命令），支持 {idea}/{path}/{task} 等占位符。
// 数据全部本地管理，通过 window.api 持久化到 ~/.visualWorktree。

/** 每个步骤状态值 */
const STEP_STATUS = { PENDING: 'pending', RUNNING: 'running', SUCCESS: 'success', ERROR: 'error' };

/**
 * 渲染单个步骤的状态图标
 * @param {string} status - 步骤状态
 * @param {object} token - antd theme token
 */
function StepStatusIcon({ status, token }) {
  if (status === STEP_STATUS.RUNNING) return <Spin size="small" />;
  if (status === STEP_STATUS.SUCCESS) return <CheckCircleFilled style={{ color: token.colorSuccess }} />;
  if (status === STEP_STATUS.ERROR)   return <CloseCircleFilled style={{ color: token.colorError }} />;
  // pending：灰色时钟
  return <ClockCircleOutlined style={{ color: token.colorTextQuaternary }} />;
}

/**
 * 工作流 Tab 主组件：管理工作流定义的增删改，以及按选中工作流运行任务。
 * 数据从 window.api.loadIdeaWorkflows / loadIdeaRuns 加载，无 Electron 时用防御写法兜底。
 */
export default function WorkflowTabView() {
  const { message, modal } = AntApp.useApp();
  const { token } = theme.useToken();

  // workflows 工作流定义数组，从持久化文件加载
  const [workflows, setWorkflows] = useState([]);
  // selectedId 当前选中的工作流 id
  const [selectedId, setSelectedId] = useState(null);
  // idea 用户输入的想法文本
  const [idea, setIdea] = useState('');
  // targetDir 目标目录路径
  const [targetDir, setTargetDir] = useState('');
  // runState 当前运行状态：null 表示未运行，否则为 { workflowId, steps:[{key,label,status,output}] }
  const [runState, setRunState] = useState(null);
  // running 是否有步骤正在执行中
  const [running, setRunning] = useState(false);
  // historyRuns 运行历史（最近10条展示用）
  const [historyRuns, setHistoryRuns] = useState([]);
  // editingWorkflow 正在编辑的工作流 {id?, name, description, steps}；null 表示未打开编辑弹窗
  const [editingWorkflow, setEditingWorkflow] = useState(null);
  // expandedSteps 展开输出的步骤 key 集合（Set）
  const [expandedSteps, setExpandedSteps] = useState(new Set());
  // form 编辑弹窗表单实例
  const [form] = Form.useForm();

  // outputsRef 各步骤实时输出累积，key 为步骤 key，避免频繁触发渲染
  const outputsRef = useRef({});

  // 初始化：加载工作流定义和运行历史
  useEffect(() => {
    // cancelled 标记组件是否已卸载，避免异步加载完成后继续更新已销毁组件。
    let cancelled = false;
    // api 存储 Electron preload 暴露的持久化接口。
    const api = window.api;
    Promise.all([
      api?.loadIdeaWorkflows?.() ?? Promise.resolve([]),
      api?.loadIdeaRuns?.() ?? Promise.resolve([]),
    ]).then(([defs, runs]) => {
      if (cancelled) return;
      setWorkflows(Array.isArray(defs) ? defs : []);
      setHistoryRuns(Array.isArray(runs) ? runs.slice(0, 10) : []);
    });
    return () => { cancelled = true; };
  }, []);

  // selectedWorkflow 当前选中的工作流定义对象
  const selectedWorkflow = workflows.find((w) => w.id === selectedId) || null;

  /**
   * 打开新建工作流弹窗，初始化空表单
   */
  const handleNewWorkflow = () => {
    // 新建时 id 为空，保存时生成
    setEditingWorkflow({ id: '', name: '', description: '', steps: [] });
    form.resetFields();
    form.setFieldsValue({ name: '', description: '', steps: [] });
  };

  /**
   * 打开编辑工作流弹窗，填入已有数据
   * @param {object} wf - 要编辑的工作流定义
   */
  const handleEditWorkflow = (wf) => {
    setEditingWorkflow({ ...wf });
    form.setFieldsValue({ name: wf.name, description: wf.description, steps: wf.steps.map((s) => ({ ...s })) });
  };

  /**
   * 删除工作流，二次确认后执行
   * @param {string} id - 要删除的工作流 id
   */
  const handleDeleteWorkflow = (id) => {
    modal.confirm(withConfirmDefaults({
      title: '删除工作流',
      content: '删除后无法恢复，是否继续？',
      okType: 'danger',
      onOk: async () => {
        // next 为移除该 id 后的新定义数组
        const next = workflows.filter((w) => w.id !== id);
        setWorkflows(next);
        if (selectedId === id) setSelectedId(null);
        await (window.api?.saveIdeaWorkflows?.(next));
      },
    }));
  };

  /**
   * 保存编辑弹窗（新建或更新），写入持久化文件
   */
  const handleSaveWorkflow = async () => {
    // values 为表单收集的所有字段
    const values = await form.validateFields();
    // newWf 为最终工作流对象：新建时生成 id，更新时沿用原 id
    const newWf = {
      id: editingWorkflow.id || `wf-${Date.now()}`,
      name: (values.name || '').trim(),
      description: (values.description || '').trim(),
      steps: (values.steps || []).filter((s) => s && String(s.label || '').trim()),
    };
    // next 为保存后的定义数组：更新时原地替换，新建时追加末尾
    const isNew = !editingWorkflow.id;
    const next = isNew
      ? [...workflows, newWf]
      : workflows.map((w) => (w.id === newWf.id ? newWf : w));
    setWorkflows(next);
    setEditingWorkflow(null);
    await (window.api?.saveIdeaWorkflows?.(next));
    message.success(isNew ? '工作流已创建' : '工作流已更新');
  };

  /**
   * 运行选中工作流：逐步骤串行执行，实时输出通过 onStepOutput 订阅推送
   */
  const handleRun = async () => {
    if (!selectedWorkflow) return;
    if (!idea.trim()) { message.warning('请输入你的想法'); return; }
    if (!targetDir.trim()) { message.warning('请输入目标目录'); return; }

    // initSteps 初始化所有步骤为 pending 状态
    const initSteps = selectedWorkflow.steps.map((s) => ({
      key: s.key, label: s.label, command: s.command,
      status: STEP_STATUS.PENDING, output: '',
    }));
    setRunState({ workflowId: selectedId, steps: initSteps });
    setExpandedSteps(new Set());
    outputsRef.current = {};
    setRunning(true);

    // startedAt 本次运行开始时间
    const startedAt = new Date().toISOString();
    // finalSteps 累积最终步骤结果，用于运行结束后写历史
    let finalSteps = [...initSteps];
    // overallStatus 本次运行整体状态
    let overallStatus = 'success';

    for (let i = 0; i < selectedWorkflow.steps.length; i++) {
      const step = selectedWorkflow.steps[i];
      // rk 步骤输出的 key（用于 outputsRef）
      const rk = step.key;
      outputsRef.current[rk] = '';

      // 把当前步骤标记为 running
      setRunState((prev) => ({
        ...prev,
        steps: prev.steps.map((s, idx) => idx === i ? { ...s, status: STEP_STATUS.RUNNING } : s),
      }));

      // 订阅该步骤的实时输出：仅接收归属于 'idea-workflow' 任务+本步骤的 chunk
      const unsub = window.api?.onStepOutput?.((evt) => {
        if (!isStepEventFor(evt, 'idea-workflow', step.key)) return;
        outputsRef.current[rk] = appendStepChunk(outputsRef.current[rk] || '', evt.chunk);
        // 同步到 runState，触发输出展示区更新
        setRunState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            steps: prev.steps.map((s, idx) =>
              idx === i ? { ...s, output: outputsRef.current[rk] } : s
            ),
          };
        });
      });

      let stepStatus = STEP_STATUS.SUCCESS;
      try {
        if (!step.command || !String(step.command).trim()) {
          // 未配置命令的步骤直接跳过，标记成功
          stepStatus = STEP_STATUS.SUCCESS;
        } else {
          // res 为该步骤的执行结果 {success, code, stdout, stderr, error}
          const res = await (window.api?.runWorkflowStep?.({
            command: step.command,
            cwd: targetDir,
            task: 'idea-workflow',
            branch: '',
            taskName: 'idea-workflow',
            stepKey: step.key,
            idea: idea.trim(),
          }) ?? { success: false, error: '非 Electron 环境' });
          stepStatus = res?.success ? STEP_STATUS.SUCCESS : STEP_STATUS.ERROR;
          // summary 为主进程回传的完整输出，作为流式内容的兜底
          if (!outputsRef.current[rk] && (res?.stdout || res?.stderr)) {
            outputsRef.current[rk] = [res.stdout, res.stderr].filter(Boolean).join('\n');
          }
          if (!res?.success) overallStatus = 'error';
        }
      } catch (e) {
        stepStatus = STEP_STATUS.ERROR;
        overallStatus = 'error';
        outputsRef.current[rk] = appendStepChunk(outputsRef.current[rk] || '', `\n[异常] ${e.message}`);
      } finally {
        unsub?.();
      }

      // 更新该步骤最终状态与输出
      finalSteps = finalSteps.map((s, idx) =>
        idx === i ? { ...s, status: stepStatus, output: outputsRef.current[rk] || '' } : s
      );
      setRunState((prev) => ({
        ...prev,
        steps: prev.steps.map((s, idx) =>
          idx === i ? { ...s, status: stepStatus, output: outputsRef.current[rk] || '' } : s
        ),
      }));

      // 步骤失败时终止后续步骤（后续步骤保持 pending）
      if (stepStatus === STEP_STATUS.ERROR) break;
    }

    setRunning(false);
    // runRecord 本次运行的完整记录，写入历史
    const runRecord = {
      id: `run-${Date.now()}`,
      workflowId: selectedId,
      workflowName: selectedWorkflow.name,
      idea: idea.trim(),
      targetDir: targetDir.trim(),
      startedAt,
      finishedAt: new Date().toISOString(),
      status: overallStatus,
      steps: finalSteps,
    };
    await (window.api?.appendIdeaRun?.(runRecord));
    setHistoryRuns((prev) => [runRecord, ...prev].slice(0, 10));
    message.info(overallStatus === 'success' ? '工作流执行完成 ✓' : '工作流执行失败，请查看步骤输出');
  };

  /**
   * 切换某步骤输出的展开/收起
   * @param {string} key - 步骤 key
   */
  const toggleExpand = (key) => {
    setExpandedSteps((prev) => {
      // next 为切换后的新集合
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // statusTagColor 运行整体状态 → Tag 颜色
  const runStatusColor = (status) => status === 'success' ? 'success' : status === 'error' ? 'error' : 'processing';

  return (
    <Row gutter={16} style={{ height: '100%' }}>
      {/* 左列：工作流列表 */}
      <Col span={8} style={{ borderRight: `1px solid ${token.colorBorderSecondary}`, paddingRight: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>我的工作流</span>
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleNewWorkflow}>
            新建工作流
          </Button>
        </div>
        {workflows.length === 0 ? (
          <Empty description="暂无工作流，点右上角新建" styles={{ image: { height: 40 } }} />
        ) : (
          <List
            dataSource={workflows}
            renderItem={(wf) => (
              // 选中高亮：用 colorPrimaryBg 作为选中背景
              <List.Item
                onClick={() => setSelectedId(wf.id)}
                style={{
                  cursor: 'pointer',
                  padding: '8px 10px',
                  borderRadius: 6,
                  marginBottom: 4,
                  background: selectedId === wf.id ? token.colorPrimaryBg : token.colorFillQuaternary,
                  border: `1px solid ${selectedId === wf.id ? token.colorPrimary : 'transparent'}`,
                }}
                actions={[
                  <Tooltip title="编辑" key="edit">
                    <Button size="small" type="text" icon={<EditOutlined />}
                      onClick={(e) => { e.stopPropagation(); handleEditWorkflow(wf); }} />
                  </Tooltip>,
                  <Tooltip title="删除" key="del">
                    <Button size="small" type="text" danger icon={<DeleteOutlined />}
                      onClick={(e) => { e.stopPropagation(); handleDeleteWorkflow(wf.id); }} />
                  </Tooltip>,
                ]}
              >
                <List.Item.Meta
                  title={<span style={{ fontSize: 13 }}>{wf.name}</span>}
                  description={
                    <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
                      {wf.description || '—'} · {wf.steps.length} 步
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Col>

      {/* 右列：运行区 + 步骤展示 + 历史 */}
      <Col span={16}>
        {/* 运行区：idea 输入 + 目录 + 运行按钮 */}
        <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 16 }}>
          <Input.TextArea
            rows={3}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="输入你的想法，如：给用户列表页加上搜索框和分页…"
            disabled={running}
          />
          <Input
            value={targetDir}
            onChange={(e) => setTargetDir(e.target.value)}
            placeholder="目标目录路径，如 /Users/you/work/worktrees/my-task"
            disabled={running}
          />
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={running}
            disabled={!selectedWorkflow}
            onClick={handleRun}
            block
          >
            {selectedWorkflow ? `运行「${selectedWorkflow.name}」` : '请先在左侧选择工作流'}
          </Button>
        </Space>

        {/* 步骤展示区：runState 非 null 时展示 */}
        {runState && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>执行进度</div>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              {runState.steps.map((step) => (
                <div key={step.key}
                  style={{ borderRadius: 6, padding: '6px 10px', background: token.colorFillQuaternary }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StepStatusIcon status={step.status} token={token} />
                    <span style={{ flex: 1, fontSize: 13 }}>{step.label}</span>
                    {/* 有输出时可展开查看 */}
                    {step.output && (
                      <Button size="small" type="link" onClick={() => toggleExpand(step.key)}>
                        {expandedSteps.has(step.key) ? '收起' : '查看输出'}
                      </Button>
                    )}
                  </div>
                  {/* 展开的输出区 */}
                  {expandedSteps.has(step.key) && step.output && (
                    <pre style={{
                      marginTop: 6, marginBottom: 0, fontSize: 11,
                      background: token.colorBgLayout, borderRadius: 4, padding: 8,
                      // minHeight 给展开输出一个高度基准：短输出也占稳定高度，避免从 0 突变到内容高度的大幅跳动（CLS）；maxHeight 之上超出部分内部滚动
                      minHeight: 48, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    }}>
                      {step.output}
                    </pre>
                  )}
                </div>
              ))}
            </Space>
          </div>
        )}

        {/* 历史区：最近10条运行记录，可折叠 */}
        <Collapse size="small" items={[{
          key: 'history',
          label: `运行历史（最近 ${historyRuns.length} 条）`,
          children: historyRuns.length === 0 ? (
            <Empty description="暂无运行记录" styles={{ image: { height: 32 } }} />
          ) : (
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              {historyRuns.map((run) => (
                <div key={run.id} style={{ fontSize: 12, color: token.colorTextSecondary }}>
                  <Space size={6} wrap>
                    <Tag color={runStatusColor(run.status)} style={{ fontSize: 11 }}>
                      {run.status === 'success' ? '成功' : run.status === 'error' ? '失败' : '运行中'}
                    </Tag>
                    <span style={{ color: token.colorText }}>{run.workflowName}</span>
                    <span>{String(run.idea || '').slice(0, 20)}{run.idea?.length > 20 ? '…' : ''}</span>
                    <span style={{ color: token.colorTextQuaternary }}>
                      {run.startedAt ? new Date(run.startedAt).toLocaleString() : ''}
                    </span>
                  </Space>
                </div>
              ))}
            </Space>
          ),
        }]} />
      </Col>

      {/* 编辑/新建工作流弹窗 */}
      <Modal
        title={editingWorkflow?.id ? '编辑工作流' : '新建工作流'}
        open={!!editingWorkflow}
        onOk={handleSaveWorkflow}
        onCancel={() => setEditingWorkflow(null)}
        width={560}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item label="工作流名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：完整研发流程" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input placeholder="简短说明这个工作流的用途（选填）" />
          </Form.Item>
          <Form.Item label="步骤列表">
            <Form.List name="steps">
              {(fields, { add, remove }) => (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <div style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                    <Space direction="vertical" style={{ width: '100%' }}>
                      {fields.map(({ key, name }) => (
                        <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          {/* key 隐藏字段：步骤稳定标识，改名不丢历史记录 */}
                          <Form.Item name={[name, 'key']} noStyle hidden><Input /></Form.Item>
                          <div style={{ flex: '0 0 130px' }}>
                            <Form.Item name={[name, 'label']} noStyle>
                              <Input placeholder="步骤名称" />
                            </Form.Item>
                          </div>
                          <div style={{ flex: 1 }}>
                            <Form.Item name={[name, 'command']} noStyle>
                              <Input placeholder="命令，支持 {idea}/{path}/{task} 占位符" />
                            </Form.Item>
                          </div>
                          <MinusCircleOutlined style={{ color: '#999', flex: '0 0 16px' }} onClick={() => remove(name)} />
                        </div>
                      ))}
                    </Space>
                  </div>
                  <Button type="dashed" size="small" icon={<PlusOutlined />}
                    onClick={() => add({ key: `step-${Date.now()}`, label: '', command: '' })}>
                    添加步骤
                  </Button>
                </Space>
              )}
            </Form.List>
          </Form.Item>
        </Form>
      </Modal>
    </Row>
  );
}
