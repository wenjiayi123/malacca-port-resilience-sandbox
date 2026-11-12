import { Activity, AlertTriangle, CircleGauge, Gauge, Play, Route } from 'lucide-react';

export const workspaceModules = [
  { id: 'overview', label: '态势总览', icon: Activity, eyebrow: 'SITUATION OVERVIEW', description: '先掌握港航网络、运行指标与需要关注的风险。', task: '查看全局态势', next: 'sandbox', nextLabel: '进入沙盘推演' },
  { id: 'sandbox', label: '沙盘推演', icon: Play, eyebrow: 'SCENARIO WORKSPACE', description: '选择场景、注入事件并推进时间，在同一场景中完成策略训练与单船验证。', task: '运行与验证场景', next: 'resilience', nextLabel: '评估推演影响' },
  { id: 'resilience', label: '韧性评估', icon: Gauge, eyebrow: 'RESILIENCE ANALYSIS', description: '分析关键节点压力、风险传播与恢复能力，再决定优化方向。', task: '定位瓶颈与恢复能力', next: 'dispatch', nextLabel: '制定调度方案' },
  { id: 'dispatch', label: '调度优化', icon: Route, eyebrow: 'DISPATCH PLANNING', description: '查看策略建议与能碳影响；已训练策略的回放结果在这里汇总。', task: '比较策略与业务影响', next: 'evidence', nextLabel: '核对执行与证据' },
  { id: 'emergency', label: '应急预案', icon: AlertTriangle, eyebrow: 'EMERGENCY RESPONSE', description: '从风险和气象条件出发，检查预案优先级、准备度与恢复门槛。', task: '处置风险与恢复运行', next: 'sandbox', nextLabel: '返回沙盘验证预案' },
  { id: 'evidence', label: '证据与闭环', icon: CircleGauge, eyebrow: 'EVIDENCE & OPERATIONS', description: '集中核对数据血缘、运行控制、审批回执与审计记录。', task: '核对来源与运行回执', next: 'overview', nextLabel: '返回态势总览' },
] as const;

export type WorkspaceId = (typeof workspaceModules)[number]['id'];

export function resolveWorkspace(hash: string): WorkspaceId {
  const candidate = hash.replace(/^#\/?/, '').split(/[?&/]/)[0];
  return workspaceModules.find((item) => item.id === candidate)?.id ?? 'overview';
}

const panelWorkspaces: Record<string, readonly WorkspaceId[]> = {
  '港航网络总览': ['overview'],
  '船舶态势': ['sandbox'],
  '航道通航状态': ['sandbox', 'emergency'],
  '风险预警': ['overview', 'emergency'],
  '气象与海况': ['overview', 'sandbox', 'emergency'],
  '碳排放监测': ['dispatch'],
  '航道拥堵热力图': ['resilience'],
  '关键节点监控': ['resilience'],
};

export function isWorkspacePanelVisible(workspace: WorkspaceId, title: string): boolean {
  return panelWorkspaces[title]?.includes(workspace) ?? false;
}
