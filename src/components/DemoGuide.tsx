import {
  CheckCircle2,
  ChevronLeft,
  CircleAlert,
  Play,
  RotateCcw,
  Square,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type DemoGuidePhase = 'ready' | 'waiting' | 'done' | 'error' | 'finished';
type DemoStateAttribute = 'aria-expanded' | 'aria-pressed' | 'data-demo-state' | 'data-xiaoyi-state';

interface DemoGuideStep {
  id: string;
  phase: string;
  title: string;
  location: string;
  action: string;
  actionLabel: string;
  speech: string;
  visibleChange: string;
  target: string;
  result?: string;
  prepareAction?: string | string[];
  resetAction?: string;
  cleanupSelectors?: string[];
  timeoutMs?: number;
  completion?: {
    selector?: string;
    attribute: DemoStateAttribute;
    values: string[];
  };
  group?: 'quick';
}

const STORAGE_KEY = 'malacca.demo-guide.v1';
const VERSION = '2026-10-24-holographic-v6';
const createGuideRunId = () => `MAL-DEMO-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`;

const steps: DemoGuideStep[] = [
  { id:'trained-evidence',phase:'00 场景证据',title:'已训练场景算法与数据清单',location:'逐场景训练证据',action:'trained-evidence',actionLabel:'显示全部已训练场景',target:'.demo-evidence-panel',result:'.demo-evidence-panel',speech:'逐场景展示已训练算法、数据集名称与数量、State、Reward、Action和输出。公开锚点、工程增强、监管情景和现场实绩分别注明；失败候选、验证切分、模型文件与哈希可展开核验。',visibleChange:'所有已训练场景卡及原始证据清单可见。',completion:{selector:'.demo-evidence-panel',attribute:'data-demo-state',values:['complete']} },
  {
    id: 'opening',
    phase: '01 业务总览',
    title: '马六甲港航网络解决什么问题',
    location: '态势总览 · 港航网络大屏',
    action: 'network-terrain-open',
    actionLabel: '展示港航科技态势',
    prepareAction: ['module-overview', 'network-map-open', 'network-reset-view'],
    target: '.holo-scene',
    result: '.holo-scene',
    speech: '先看保留卫星风格夜景的科技态势：海岸、发光航段和样船共同展示空间关系，R 编号对应清单，箭头表示配置方向。点选对象可看运行摘要和完整详情，也可开关拥堵热区、事件影响与船流，或切换关系图专看连接。底图是视觉示意，指标来自公开校准模拟；系统用公开数据、离线 RL、人工确认和审计回执处理拥堵、协同与突发恢复，当前展示不是生产控制。',
    visibleChange: '卫星风格夜景底图、发光航段、样船和图层开关显示，港口卡片与状态清单可查看。',
    completion: { attribute: 'aria-pressed', values: ['true'] },
  },
  {
    id: 'scenario',
    phase: '02 数据与推演态势',
    title: '加载可复现的港口拥堵场景',
    location: '沙盘推演 · 联动演示场景',
    action: 'demo-port-congestion',
    actionLabel: '加载港口拥堵场景',
    prepareAction: 'module-sandbox',
    resetAction: 'simulation-reset',
    target: '[data-xiaoyi-action="demo-port-congestion"]',
    result: '.event-impact-banner, .core-closure-header',
    speech: '先加载港口拥堵场景。系统用同一时钟更新新加坡港压力、船舶排队、延误传播和碳排影响，让观众看到事件不是静态卡片，而会改变地图、船流和后续策略输入。',
    visibleChange: '拥堵事件、受影响船舶、核心闭环状态机和地图传播图层同步变化。',
    completion: { attribute: 'aria-pressed', values: ['true'] },
  },
  {
    id: 'situation',
    phase: '03 实时态势推进',
    title: '启动连续沙盘推演',
    location: '沙盘推演 · 时间与业务状态',
    action: 'simulation-toggle',
    actionLabel: '开始推演',
    resetAction: 'simulation-reset',
    target: '[data-xiaoyi-action="simulation-toggle"]',
    result: '.sandbox-status-panel',
    speech: '点击开始后，15 分钟业务步持续推进。到港、服务、队列、作业吞吐、区间能耗、碳排和韧性会在同一后端模拟状态上变化，所有数值都明确标注为公开数据校准模拟。',
    visibleChange: '按钮进入运行态，时钟、KPI、船舶位置、事件流和阶段状态持续更新。',
    completion: { attribute: 'data-xiaoyi-state', values: ['running'] },
  },
  {
    id: 'sources',
    cleanupSelectors: ['[aria-label="关闭系统设置"]'],
    phase: '04 官方来源与边界',
    title: '核对公开数据来源',
    location: '系统设置 · 数据接入',
    action: 'open-settings',
    actionLabel: '打开数据来源',
    target: '[data-xiaoyi-action="open-settings"]',
    result: '.public-evidence-list',
    speech: '这里单独核对 MPA 港口统计、Open-Meteo 海洋场、公开 AIS 研究基线和 IMO 碳因子。官方原始字段、模型场、研究统计和工程派生量分层标识，未获授权的实时船位不会被伪装成现场数据。',
    visibleChange: '设置面板显示来源机构、官方地址、数据期、坐标、研究 DOI、碳因子和授权状态。',
    completion: { attribute: 'aria-expanded', values: ['true'] },
  },
  {
    id: 'dataset',
    cleanupSelectors: ['[aria-label="关闭训练数据集"]', '[aria-label="关闭系统设置"]'],
    phase: '05 RL 训练数据集',
    title: '查看真正进入训练的数据快照',
    location: '训练数据集 · 版本与校验',
    action: 'show-training-dataset',
    actionLabel: '展开训练数据集',
    prepareAction: 'open-settings',
    target: '[data-demo-action="show-training-dataset"]',
    result: '[data-demo-region="training-dataset"]',
    speech: '训练数据面板从真实数据集接口读取来源、许可、时间范围、记录数、70/15/15 时序切分、质量字段和 SHA-256 快照标识。MPA 月报是训练锚点，工程补齐字段与公开 AIS 独立验证不会混写成现场观测。',
    visibleChange: '宽屏数据卡展示记录量、训练/验证/测试切分、来源网址、许可、证据等级和完整指纹。',
    timeoutMs: 15_000,
    completion: { attribute: 'data-demo-state', values: ['ready'] },
  },
  {
    id: 'training-center',
    phase: '06 RL 训练中心',
    title: '进入真实训练控制台',
    location: '沙盘推演 · RL 训练中心',
    action: 'open-rl-training',
    actionLabel: '打开训练中心',
    prepareAction: 'module-sandbox',
    resetAction: 'rl-reset-training',
    target: '[data-xiaoyi-action="open-rl-training"]',
    result: '.rl-training-window',
    speech: '训练中心不是一张静态曲线图。它展示四种 RL 与 MPC 对照、服务器实际 episode、环境步、参数更新、数据切分、检查点和封存测试状态。',
    visibleChange: '中央训练窗口、八阶段生命周期、冠军证据条和训练任务控制台展开。',
    completion: { attribute: 'data-xiaoyi-state', values: ['open'] },
  },
  {
    id: 'xiaoyi-open',
    phase: '07 舷鸥任务编排',
    title: '打开舷鸥全系统助手',
    location: '舷鸥 · 自然语言指令',
    action: 'xiaoyi-system-avatar',
    actionLabel: '打开舷鸥助手',
    target: '[data-demo-action="xiaoyi-system-avatar"]',
    result: '.xiaoyi-system-panel',
    speech: '舷鸥不是一张功能说明卡，而是系统操作主线。它把自然语言目标匹配到白名单动作，逐步定位真实页面按钮，并保留人工确认和执行报告。',
    visibleChange: '舷鸥对话框、自然语言输入、意图阶段和可执行命令入口展开。',
    completion: { attribute: 'aria-expanded', values: ['true'] },
  },
  {
    id: 'xiaoyi-command',
    phase: '08 舷鸥下达 RL 任务',
    title: '自然语言生成训练配置',
    location: '舷鸥 · 受控动作链',
    action: 'xiaoyi-quick-rl-configure',
    actionLabel: '让舷鸥配置 RL 训练',
    prepareAction: 'xiaoyi-system-avatar',
    target: '[data-demo-action="xiaoyi-quick-rl-configure"]',
    result: '.xiaoyi-system-report-dialog, .xiaoyi-rl-assistant',
    speech: '选择“让舷鸥配置 RL 训练”。舷鸥识别当前韧性均衡目标，进入训练中心，调用现有顾问接口，生成算法、Baseline、参数、奖励权重和验证场景；它不能绕过人工确认直接启动生产控制。',
    visibleChange: '意图解析、动作白名单、页面联动、推荐配置和标准化执行报告逐步出现。',
    timeoutMs: 20_000,
    completion: { attribute: 'data-demo-state', values: ['ready'] },
  },
  {
    id: 'xiaoyi-review',
    phase: '09 舷鸥结果回收',
    title: '返回页面核验舷鸥结果',
    location: '舷鸥 · 执行报告',
    action: 'xiaoyi-report-return',
    actionLabel: '返回页面检查',
    target: '[data-demo-action="xiaoyi-report-return"]',
    result: '.xiaoyi-rl-assistant__recommendation',
    speech: '执行报告记录自然语言指令、动作标识、每一步页面回写、耗时和报告编号。返回页面后继续检查舷鸥推荐，不把“按钮已点”当成业务结果。',
    visibleChange: '报告关闭，训练窗口与舷鸥推荐卡恢复可见，算法和参数建议保留。',
  },
  {
    id: 'xiaoyi-apply',
    phase: '10 应用舷鸥建议',
    title: '把建议写入真实训练表单',
    location: '舷鸥训练助理 · 一键配置',
    action: 'rl-xiaoyi-apply-all',
    actionLabel: '一键配置全部',
    target: '[data-demo-action="rl-xiaoyi-apply-all"]',
    result: '.xiaoyi-rl-assistant__apply-feedback',
    speech: '点击后调用训练中心原有配置函数，把推荐算法、Baseline、Episode、学习率、奖励权重、后端接口和封存测试场景写入同一训练状态，不维护第二套业务逻辑。',
    visibleChange: '舷鸥显示“配置已生效”，训练卡片、参数和接口契约同步更新。',
    timeoutMs: 8_000,
    completion: { attribute: 'data-demo-state', values: ['success'] },
  },
  {
    id: 'xiaoyi-acknowledge',
    phase: '10a 人工核验配置',
    title: '核对配置并勾选人工复核',
    location: '舷鸥 · 执行报告人工复核',
    action: 'xiaoyi-review-acknowledge',
    actionLabel: '确认已核对真实配置',
    prepareAction: 'xiaoyi-report-open',
    target: '[data-demo-action="xiaoyi-review-acknowledge"]',
    result: '.xiaoyi-system-report-check',
    speech: '先核对刚才写入的算法、对照、训练量和奖励权重，再明确勾选人工复核。返回页面检查并不等于人工验收，这一步由操作员主动确认。',
    visibleChange: '执行报告中的人工复核框勾选，最终确认按钮解除禁用。',
    completion: { attribute: 'data-demo-state', values: ['acknowledged'] },
  },
  {
    id: 'xiaoyi-archive',
    phase: '10b 确认归档',
    title: '人工确认并归档舷鸥报告',
    location: '舷鸥 · 执行报告归档',
    action: 'xiaoyi-review-confirm',
    actionLabel: '人工确认执行完成',
    target: '[data-demo-action="xiaoyi-review-confirm"]',
    result: '.xiaoyi-system-review-record',
    speech: '点击人工确认后，系统记录确认时间并归档本次执行报告，随后才解除新指令的锁定。这不会替代港口生产审批或现场安全放行。',
    visibleChange: '报告关闭，页面显示人工验收已归档，新指令入口恢复可用。',
    completion: { selector: '[data-demo-action="xiaoyi-report-open"]', attribute: 'data-demo-state', values: ['archived'] },
    cleanupSelectors: ['[aria-label="收起舷鸥系统助手"]', '[aria-label="关闭舷鸥助手"]'],
  },
  {
    id: 'contract',
    cleanupSelectors: ['[aria-label="关闭RL训练契约"]'],
    phase: '11 RL 训练契约',
    title: '核对 State、Action、Reward 与安全门',
    location: 'RL 训练契约 · 宽屏证据',
    action: 'show-rl-contract',
    actionLabel: '查看 RL 训练契约',
    prepareAction: ['module-sandbox', 'open-rl-training'],
    target: '[data-demo-action="show-rl-contract"]',
    result: '[data-demo-region="rl-contract"]',
    speech: '宽屏契约列出观测空间、动作空间、六项 Reward 权重、算法与对照、Episode、随机种子、数据切分和验证门。RL 只能生成沙盘建议，监管放行、安全联锁和生产写权限始终在外部确定性门禁。',
    visibleChange: '训练契约以宽面板展示，不再挤在狭窄侧栏中。',
  },
  {
    id: 'training-review',
    phase: '12 人工复核',
    title: '打开训练任务确认门',
    location: 'RL 训练中心 · 人工确认',
    action: 'rl-start-training',
    actionLabel: '复核并准备启动',
    prepareAction: ['module-sandbox', 'open-rl-training'],
    target: '[data-xiaoyi-action="rl-start-training"]',
    result: '[data-demo-region="training-approval"]',
    speech: '点击训练按钮只打开确认门。操作员在这里核对目标、数据集边界、算法、Episode、奖励函数、安全约束和 production_authority=false；此时后端任务还没有创建。',
    visibleChange: '人工确认框展示完整配置快照、风险边界和最终启动按钮。',
    completion: { attribute: 'data-demo-state', values: ['approval'] },
  },
  {
    id: 'training-start',
    phase: '13 启动真实训练',
    title: '人工确认后提交训练任务',
    location: 'RL 训练中心 · 服务器任务',
    action: 'rl-confirm-training',
    actionLabel: '确认并启动训练',
    prepareAction: ['module-sandbox', 'open-rl-training', 'rl-start-training'],
    resetAction: 'rl-reset-training',
    target: '[data-demo-action="rl-confirm-training"]',
    result: '.rl-training-command-center',
    speech: '只有现在才调用真实训练任务接口。页面立即进入排队或训练态，随后显示 episode、环境步、采样速度、Reward EMA、参数更新、当前阶段和检查点；失败、取消和超时都有可见恢复路径。',
    visibleChange: '确认框关闭，任务状态、进度条、动态遥测和训练日志立即更新。',
    timeoutMs: 15_000,
    completion: {
      selector: '[data-xiaoyi-action="rl-start-training"]',
      attribute: 'data-xiaoyi-state',
      values: ['queued', 'running', 'completed'],
    },
  },
  {
    id: 'convergence',
    phase: '14 收敛与历史实验',
    title: '查看四种 RL 与 MPC 收敛证据',
    location: '训练中心 · 曲线与多算法对比',
    action: 'rl-show-curves',
    actionLabel: '聚焦训练曲线',
    prepareAction: ['module-sandbox', 'open-rl-training'],
    target: '[data-demo-action="rl-show-curves"]',
    result: '.rl-training-card--curves',
    speech: '曲线同时展示四种 RL 的训练走势与 MPC 控制基线，训练期、验证选优和最终测试严格分开。当前演示训练与历史正式五种子冠军也分开标识，避免用烟测冒充收敛结论。',
    visibleChange: 'Reward 走势、算法图例、关键阶段、训练指标和冠军选择结果进入视野。',
    timeoutMs: 120_000,
    completion: { selector: '[data-xiaoyi-action="rl-start-training"]', attribute: 'data-xiaoyi-state', values: ['completed'] },
  },
  {
    id: 'policy-test',
    phase: '15 封存测试与业务价值',
    title: '运行训练后策略测试',
    location: '训练中心 · 最终测试集回放',
    action: 'rl-policy-test',
    actionLabel: '启动封存测试',
    prepareAction: ['module-sandbox', 'open-rl-training'], resetAction: 'rl-reset-policy-test',
    target: '[data-xiaoyi-action="rl-policy-test"]',
    result: '.rl-policy-test',
    speech: '训练完成后显式读取未参与训练与选优的封存测试段，比较队列、延误、碳排、吞吐、安全和 Reward。结果绑定检查点、数据指纹和场景，不写成现场生产收益。',
    visibleChange: '测试进度、回放日志、基线对比和业务指标卡开始更新。',
    timeoutMs: 45_000,
    completion: { attribute: 'data-xiaoyi-state', values: ['completed'] },
  },
  {
    id: 'policy-inference', phase: '15a 检查点推理与准入',
    title: '查看已训练策略与准入结果', location: '沙盘推演 · 在线策略推理',
    action: 'open-rl-decision', actionLabel: '执行当前事件策略推理',
    prepareAction: 'module-sandbox', target: '[data-xiaoyi-action="open-rl-decision"]', result: '.rl-decision-cockpit',
    speech: '使用刚完成的真实训练检查点，读取当前事件与模拟状态，计算动作、情景预测和收益对照。ADMITTED 才可继续人工采用；ABSTAIN 则说明拒绝原因，保持未采用状态。本步核对真实推理和准入结果，不把推理完成当作策略获准执行。',
    visibleChange: '模型、策略动作、收益与 ADMITTED 或 ABSTAIN 结果显示；拒绝时采用按钮保持禁用。',
    timeoutMs: 30_000, completion: { selector: '.rl-decision-cockpit', attribute: 'data-demo-state', values: ['completed'] },
    cleanupSelectors: ['[aria-label="关闭在线策略推理舱"]'],
  },
  {
    id: 'evidence',
    phase: '16 验证与安全门',
    title: '进入后端权威证据中心',
    location: '证据与闭环 · 统一状态',
    action: 'module-evidence',
    actionLabel: '打开证据与闭环',
    target: '[data-xiaoyi-action="module-evidence"]',
    result: '.operational-evidence-center',
    speech: '训练完成不等于上线。证据中心把实时模拟、孪生守恒、预测、策略、监管、血缘、模型、安全门、审计和现场适配器放在同一后端快照与哈希链上。',
    visibleChange: '真实数据边界、运行快照、生产权限标签和十个证据页面加载。',
    timeoutMs: 20_000,
    completion: { selector: '.operational-evidence-center', attribute: 'data-demo-state', values: ['ready'] },
  },
  {
    id: 'handoff',
    phase: '17 舷鸥回收运行结果',
    title: '生成证据绑定的舷鸥交班',
    location: '安全治理 · 舷鸥运行交班',
    action: 'xiaoyi-operational-handoff',
    actionLabel: '生成舷鸥交班',
    prepareAction: ['module-evidence', 'evidence-tab-governance'],
    target: '[data-xiaoyi-action="xiaoyi-operational-handoff"]',
    result: '.xiaoyi-operational-handoff',
    speech: '舷鸥读取同一权威快照、策略建议、门禁状态、待审批事项、证据哈希和 Trace ID，再生成交班总结。模型不可用时明确降级为规则底稿，绝不伪装成大模型回答。',
    visibleChange: '交班摘要、风险警告、策略依据、门禁状态、模型连接状态和证据哈希显示。',
    timeoutMs: 20_000,
    completion: { attribute: 'data-xiaoyi-state', values: ['ready'] },
  },
  {
    id: 'audit',
    phase: '18 审计回溯',
    title: '回看任务、模型和哈希链',
    location: '证据与闭环 · 审计回放',
    action: 'evidence-tab-audit',
    actionLabel: '打开审计回放',
    prepareAction: 'module-evidence',
    target: '[data-xiaoyi-action="evidence-tab-audit"]',
    result: '.operational-evidence-body',
    speech: '审计页回看任务、参数、模型与数据哈希、执行回执、回滚和时间戳。每项结果都保留公开模拟、离线训练和生产权限关闭的边界，核心闭环到这里完成。',
    visibleChange: '审计事件、关联标识、哈希链和回放入口切换为当前页面。',
    completion: { attribute: 'aria-pressed', values: ['true'] },
  },
  {
    id: 'resilience', group: 'quick', phase: '19 能力速览 · 韧性',
    title: '网络韧性评估', location: '韧性评估', action: 'module-resilience', actionLabel: '打开韧性评估',
    target: '[data-xiaoyi-action="module-resilience"]', result: '.module-panel--resilience',
    speech: '快速展示港口、航道、船流、恢复能力与扩散范围的综合韧性评估。该指标是模型代理，不是认证安全等级。',
    visibleChange: '网络韧性得分、节点能力、脆弱性与恢复指标切换显示。', completion: { attribute: 'aria-pressed', values: ['true'] },
  },
  {
    id: 'dispatch', group: 'quick', phase: '20 能力速览 · 调度',
    title: '绿色调度与多方案对比', location: '调度优化', action: 'module-dispatch', actionLabel: '打开调度优化',
    target: '[data-xiaoyi-action="module-dispatch"]', result: '.module-panel--dispatch',
    speech: '快速展示低碳航速、错峰到港、邻港分流等候选策略，以及延误、碳排、影响船舶和收益得分的对比。',
    visibleChange: '多方案比较、策略得分和碳排/延误收益卡切换显示。', completion: { attribute: 'aria-pressed', values: ['true'] },
  },
  {
    id: 'emergency', group: 'quick', phase: '21 能力速览 · 应急',
    title: '应急预案与恢复门槛', location: '应急预案', action: 'module-emergency', actionLabel: '打开应急预案',
    target: '[data-xiaoyi-action="module-emergency"]', result: '.module-panel--emergency',
    speech: '快速展示事故封航、极端天气和港口能力损失下的隔离顺序、通知升级、恢复资源与重新开放门槛。',
    visibleChange: '应急响应等级、预案步骤、责任范围和恢复就绪度切换显示。', completion: { attribute: 'aria-pressed', values: ['true'] },
  },
  {
    id: 'event-injection', group: 'quick', phase: '22 能力速览 · 事件注入',
    cleanupSelectors: ['[aria-label="关闭事件注入选择面板"]', '[aria-label="关闭训练窗口"]', '[aria-label="关闭舷鸥助手"]'],
    title: '受控事件注入', location: '沙盘推演 · 事件编排', action: 'inject-event', actionLabel: '打开事件注入',
    prepareAction: 'module-sandbox', target: '[data-xiaoyi-action="inject-event"]', result: '.event-injection-cockpit',
    speech: '快速展示事故封航、强风浪、港口拥堵、协同分流和低碳窗口等可审计事件模板。用户仍需选择并确认具体事件。',
    visibleChange: '事件类型、作用范围、船舶影响和预估指标面板展开。', completion: { attribute: 'aria-pressed', values: ['true'] },
  },
  {
    id: 'micro-new-sample', group: 'quick', phase: '22a 独立微观样例',
    title: '重置并建立独立无事件样例', location: '沙盘推演 · 独立功能验证',
    action: 'simulation-reset', actionLabel: '重置沙盘并新建独立样例',
    prepareAction: 'module-sandbox', target: '[data-xiaoyi-action="simulation-reset"]', result: '.sandbox-status-panel',
    speech: '前面的事件策略保留真实准入结论。现在明确重置本地沙盘、事件及临时训练状态，建立独立的无事件单船请求样例；后端已保存的训练与测试记录仍可审计。它不是刚才事件策略已获采用或已通过物理验证的证据。',
    visibleChange: '事件清零、推演归零，单船请求入口回到无事件待命状态。',
    completion: { attribute: 'data-demo-state', values: ['reset'] },
  },
  {
    id: 'godot', group: 'quick', phase: '23 能力速览 · 微观仿真',
    title: '生成 Godot 单船验证信息流', location: '沙盘推演 · 微观验证', action: 'micro-generate-stream', actionLabel: '生成单船信息流',
    prepareAction: 'module-sandbox', target: '[data-demo-action="micro-generate-stream"]', result: '.micro-validation-console',
    speech: '把这个独立无事件样例的船舶、航段与风险封装为带 request ID 的单船验证请求，可送入独立 Godot 物理窗口或内嵌预览。生成请求不等于已运行物理验证，也不代表前一事件策略获准执行。',
    visibleChange: '单船请求、目标航速、风险、延误、碳排和验证信息流刷新。',
  },
  {
    id: 'visual', group: 'quick', phase: '24 能力速览 · 高端可视化',
    cleanupSelectors: ['[aria-label="关闭详情"]'],
    title: '切换高端地图视角', location: '中央数字孪生地图', action: 'cycle-map-view', actionLabel: '切换地图视角',
    prepareAction: 'network-layers-open', target: '[data-xiaoyi-action="cycle-map-view"]', result: '.map-stage',
    speech: '中央地图支持综合态势、拥堵、碳排与应急视角，叠加传播、船流、策略、风险和多尺度港口节点，用于快速说明高端可视化能力。',
    visibleChange: '地图主题、强调图层、船流轨迹和业务侧栏联动切换。',
  },
  {
    id: 'api', group: 'quick', phase: '25 能力速览 · 标准接口',
    cleanupSelectors: ['[aria-label="关闭API契约"]', '[aria-label="关闭系统设置"]'],
    title: '查看系统接口与替换边界', location: '系统设置 · API 契约', action: 'show-api-contract', actionLabel: '展开 API 契约',
    prepareAction: 'open-settings', target: '[data-demo-action="show-api-contract"]', result: '[data-demo-region="api-contract"]',
    speech: '最后展示公开数据、RL 训练、推理、运行态、审计、现场适配和 OpenAPI 契约。接口可替换不代表现场授权，南向执行仍由身份、联锁、双人审批和站点验收门禁控制。',
    visibleChange: '标准端点、协议版本、读写边界、认证状态和生产权限说明以宽屏面板显示。',
  },
];

const actionSelector = (action: string) =>
  `[data-demo-action="${action}"], [data-xiaoyi-action="${action}"]`;

const findAction = (action: string) => {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(actionSelector(action)));
  return nodes.find((node) => {
    const style = window.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
  }) ?? nodes[0] ?? null;
};

const readState = (element: HTMLElement | null, attribute: DemoStateAttribute) => {
  if (!element) return null;
  if (attribute === 'data-demo-state') return element.dataset.demoState ?? null;
  if (attribute === 'data-xiaoyi-state') return element.dataset.xiaoyiState ?? null;
  return element.getAttribute(attribute);
};

interface DemoGuideProps {
  onResetAll: () => void;
  onStopAll: () => void;
}

export function DemoGuide({ onResetAll, onStopAll }: DemoGuideProps) {
  const restored = useMemo(() => {
    try {
      const value = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null') as {
        open?: boolean;
        collapsed?: boolean;
        current?: number;
        completed?: string[];
        skipped?: string[];
        runId?: string;
      } | null;
      return {
        open: Boolean(value?.open),
        collapsed: Boolean(value?.collapsed),
        current: Math.min(Math.max(Number(value?.current ?? 0), 0), steps.length - 1),
        completed: Array.isArray(value?.completed) ? value.completed : [],
        skipped: Array.isArray(value?.skipped) ? value.skipped : [],
        runId: value?.runId ?? createGuideRunId(),
      };
    } catch {
      return { open: false, collapsed: false, current: 0, completed: [], skipped: [], runId: createGuideRunId() };
    }
  }, []);
  const [isOpen, setIsOpen] = useState(restored.open);
  const [isCollapsed, setIsCollapsed] = useState(restored.collapsed);
  const [currentIndex, setCurrentIndex] = useState(restored.current);
  const [completed, setCompleted] = useState<string[]>(restored.completed);
  const [skipped, setSkipped] = useState<string[]>(restored.skipped);
  const allStepsCompleted = steps.every((step) => completed.includes(step.id));
  const [runId, setRunId] = useState(restored.runId);
  const pendingRunRef = useRef<number | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [phase, setPhase] = useState<DemoGuidePhase>(() => restored.completed.includes(steps[restored.current].id) ? 'done' : 'ready');
  const [status, setStatus] = useState(() => restored.completed.includes(steps[restored.current].id)
    ? '已恢复本步完成记录，可以继续下一步。' : '点击当前真实操作开始演示。');
  const timeoutRef = useRef<number | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);
  const waitGenerationRef = useRef(0);
  const internalActionRef = useRef<string | null>(null);
  const xiaoyiAutomationRef = useRef(false);
  const currentStep = steps[currentIndex];

  const stopWaiting = useCallback(() => {
    waitGenerationRef.current += 1;
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    observerRef.current?.disconnect();
    observerRef.current = null;
  }, []);

  const clearHighlights = useCallback(() => {
    document.querySelectorAll('.malacca-demo-target, .malacca-demo-region, .malacca-demo-result').forEach((node) => {
      node.classList.remove('malacca-demo-target', 'malacca-demo-region', 'malacca-demo-result');
    });
  }, []);

  const highlightStep = useCallback((step: DemoGuideStep, result = false) => {
    clearHighlights();
    const target = document.querySelector<HTMLElement>(result ? step.result ?? step.target : step.target);
    const action = findAction(step.action);
    action?.classList.add('malacca-demo-target');
    target?.classList.add(result ? 'malacca-demo-result' : 'malacca-demo-region');
    (target ?? action)?.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
  }, [clearHighlights]);

  const markComplete = useCallback((step: DemoGuideStep, message?: string) => {
    stopWaiting();
    setCompleted((items) => items.includes(step.id) ? items : [...items, step.id]);
    setSkipped((items) => items.filter((id) => id !== step.id));
    setPhase('done');
    setStatus(message ?? '页面已经出现本步结果；请保持当前台词，讲解完成后再进入下一步。');
    window.requestAnimationFrame(() => highlightStep(step, true));
  }, [highlightStep, stopWaiting]);

  const waitForCompletion = useCallback((step: DemoGuideStep, origin: 'guide' | 'page') => {
    stopWaiting();
    setPhase('waiting');
    setStatus(origin === 'page'
      ? `已识别页面原按钮：${step.actionLabel}。正在等待真实结果…`
      : `已点击真实按钮：${step.actionLabel}。当前台词保持不变，正在等待结果…`);
    const completion = step.completion;
    const generation = waitGenerationRef.current;
    const selector = completion?.selector ?? (completion ? actionSelector(step.action) : step.result ?? step.target);
    const check = () => {
      if (generation !== waitGenerationRef.current) return false;
      if (!completion) {
        const visible = Array.from(document.querySelectorAll<HTMLElement>(selector)).some((element) =>
          element.getClientRects().length > 0 && window.getComputedStyle(element).visibility !== 'hidden');
        if (!visible) return false;
        markComplete(step, '已触发页面原生按钮并核对可见结果；讲解完成后再进入下一步。');
        return true;
      }
      const element = document.querySelector<HTMLElement>(selector);
      const value = readState(element, completion.attribute);
      if (value && completion.values.includes(value)) {
        markComplete(step, `真实页面状态已回写：${completion.attribute}=${value}。请讲解完成后再进入下一步。`);
        return true;
      }
      if (value === 'failed' || value === 'error' || value === 'rejected') {
        stopWaiting();
        setPhase('error');
        setStatus('页面返回失败状态。可以重试本步、重置本步或保底进入下一步。');
        return true;
      }
      return false;
    };
    observerRef.current = new MutationObserver(check);
    observerRef.current.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: completion ? [completion.attribute] : ['class', 'style', 'hidden', 'aria-hidden'],
    });
    window.requestAnimationFrame(check);
    timeoutRef.current = window.setTimeout(() => {
      stopWaiting();
      setPhase('error');
      setStatus('等待页面结果超时，演示未锁死；可以重试、重置或保底继续。');
    }, step.timeoutMs ?? 10_000);
  }, [markComplete, stopWaiting]);

  const clickNativeAction = useCallback(async (action: string) => {
    const element = findAction(action);
    if (!element || element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true') return false;
    internalActionRef.current = action;
    element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    element.click();
    window.setTimeout(() => {
      if (internalActionRef.current === action) internalActionRef.current = null;
    }, 0);
    return true;
  }, []);

  const runStep = useCallback(async (step: DemoGuideStep = currentStep, force = false) => {
    if (!step || (phase === 'waiting' && !force)) return;
    if (phase === 'done' && !force) {
      for (const selector of step.cleanupSelectors ?? []) document.querySelector<HTMLButtonElement>(selector)?.click();
      if (currentIndex >= steps.length - 1) {
        setPhase('finished');
        setStatus(allStepsCompleted ? '核心闭环与能力速览已完成；生产权限仍保持关闭。' : '本段演示已结束，仍有未完成步骤；完整演示尚未完成，可重新开始。');
        clearHighlights();
      } else {
        window.dispatchEvent(new Event("demo-evidence-close"));
        pendingRunRef.current = currentIndex + 1;
        setTransitioning(true);
        setCurrentIndex((index) => index + 1);
        setPhase('ready');
        setStatus('已进入下一步；台词、按钮和业务区域已同步。');
      }
      return;
    }
    const prepareActions = step.prepareAction
      ? Array.isArray(step.prepareAction) ? step.prepareAction : [step.prepareAction]
      : [];
    for (const prepareAction of prepareActions) {
      const prepareTarget = findAction(prepareAction);
      const alreadyPrepared = prepareTarget?.getAttribute('aria-expanded') === 'true' ||
        prepareTarget?.getAttribute('aria-pressed') === 'true' ||
        ['open', 'decision-open', 'training-open', 'approval'].includes(prepareTarget?.dataset.xiaoyiState ?? '');
      if (!alreadyPrepared) {
        const prepared = await clickNativeAction(prepareAction);
        if (!prepared) {
          setPhase('error');
          setStatus(`前置页面按钮“${prepareAction}”尚未就绪，可重试或保底继续。`);
          return;
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 120));
      }
    }
    const target = findAction(step.action);
    if (!target || target.matches(':disabled') || target.getAttribute('aria-disabled') === 'true') {
      setPhase('error');
      setStatus('当前真实按钮尚未就绪。请等待当前任务完成，或使用重试、重置和保底下一步。');
      highlightStep(step);
      return;
    }
    highlightStep(step);
    waitForCompletion(step, 'guide');
    await clickNativeAction(step.action);
  }, [allStepsCompleted, clearHighlights, clickNativeAction, currentIndex, currentStep, highlightStep, phase, waitForCompletion]);

  useEffect(() => {
    if (pendingRunRef.current !== currentIndex || phase !== 'ready') return;
    const timer = window.setTimeout(() => {
      pendingRunRef.current = null;
      setTransitioning(false);
      void runStep(currentStep, true);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [currentIndex, currentStep, phase, runStep]);

  useEffect(() => {
    const payload = { version: VERSION, open: isOpen, collapsed: isCollapsed, current: currentIndex, completed, skipped, runId, updatedAt: new Date().toISOString(), productionAuthority: false };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    document.body.classList.toggle('malacca-demo-guide-open', isOpen && !isCollapsed);
    document.body.classList.toggle('malacca-demo-guide-collapsed', isOpen && isCollapsed);
    return () => {
      document.body.classList.remove('malacca-demo-guide-open', 'malacca-demo-guide-collapsed');
    };
  }, [completed, currentIndex, isCollapsed, isOpen, runId, skipped]);

  useEffect(() => {
    if (!isOpen || !currentStep) return;
    window.requestAnimationFrame(() => {
      document.querySelector('.malacca-demo-guide__steps .is-active')?.scrollIntoView({ block: 'nearest' });
      highlightStep(currentStep, phase === 'done');
    });
  }, [currentStep, highlightStep, isOpen, phase]);

  useEffect(() => {
    const syncXiaoyiAutomation = (event: Event) => {
      xiaoyiAutomationRef.current = Boolean((event as CustomEvent<{ active?: boolean }>).detail?.active);
    };
    document.addEventListener('malacca:xiaoyi-automation', syncXiaoyiAutomation);
    return () => document.removeEventListener('malacca:xiaoyi-automation', syncXiaoyiAutomation);
  }, []);

  useEffect(() => {
    const syncDirectClick = (event: MouseEvent) => {
      if (!isOpen || !(event.target instanceof Element)) return;
      if (xiaoyiAutomationRef.current) return;
      const control = event.target.closest<HTMLElement>('[data-demo-action], [data-xiaoyi-action]');
      const action = control?.dataset.demoAction ?? control?.dataset.xiaoyiAction;
      if (!action || internalActionRef.current === action) return;
      const index = steps.findIndex((step) => step.action === action);
      if (index < 0) return;
      const step = steps[index];
      stopWaiting();
      setCurrentIndex(index);
      setPhase('ready');
      setStatus(`已从页面原按钮同步到第 ${index + 1} 步：${step.title}。`);
      window.setTimeout(() => waitForCompletion(step, 'page'), 0);
    };
    document.addEventListener('click', syncDirectClick, true);
    return () => document.removeEventListener('click', syncDirectClick, true);
  }, [isOpen, stopWaiting, waitForCompletion]);

  useEffect(() => () => {
    stopWaiting();
    clearHighlights();
  }, [clearHighlights, stopWaiting]);

  const resetStep = async () => {
    stopWaiting();
    if (currentStep?.resetAction) await clickNativeAction(currentStep.resetAction);
    setCompleted((items) => items.filter((id) => id !== currentStep?.id));
    setSkipped((items) => items.filter((id) => id !== currentStep?.id));
    setPhase('ready');
    setStatus('本步已重置，可以重新执行同一个真实页面按钮。');
  };

  const resetAll = () => {
    pendingRunRef.current = null;
    setTransitioning(false);
    window.dispatchEvent(new Event("demo-evidence-close"));
    stopWaiting();
    onResetAll();
    setCurrentIndex(0);
    setCompleted([]);
    setSkipped([]);
    setRunId(createGuideRunId());
    setPhase('ready');
    setStatus('演示状态与沙盘临时任务已重置，正在回到开场。');
    setIsOpen(true);
    setIsCollapsed(false);
  };

  const fallbackNext = () => {
    stopWaiting();
    if (currentStep) setSkipped((items) => items.includes(currentStep.id) ? items : [...items, currentStep.id]);
    if (currentIndex >= steps.length - 1) {
      setPhase('finished');
      setStatus('已保底完成最后一步；未成功的动作不会标记为通过。');
      return;
    }
    setCurrentIndex((index) => index + 1);
    setPhase('ready');
    setStatus('已记录保底推进；上一动作未标记成功，当前台词和按钮已同步。');
  };

  const startGuide = () => {
    pendingRunRef.current = null;
    setTransitioning(false);
    setIsOpen(true);
    setIsCollapsed(false);
    setCurrentIndex(0);
    setCompleted([]);
    setSkipped([]);
    setRunId(createGuideRunId());
    setPhase('ready');
    setStatus('点击当前真实操作开始演示。');
  };

  if (!isOpen) {
    return <button className="malacca-demo-launcher" data-demo-guide-launcher="ready" onClick={startGuide} type="button"><Play size={14} />演示开始</button>;
  }

  const progress = ((phase === 'finished' ? completed.length : currentIndex + 1) / steps.length) * 100;
  const quickStartIndex = steps.findIndex((step) => step.group === 'quick');

  return (
    <aside data-demo-index={currentIndex} className={`malacca-demo-guide${isCollapsed ? ' malacca-demo-guide--collapsed' : ''}`} data-demo-guide="ready" data-version={VERSION}>
      <header className="malacca-demo-guide__header">
        {!isCollapsed && <div><small>LIVE DEMO CONTROL</small><strong>马六甲港航沙盘 · 演示引导</strong></div>}
        <div>
          <button aria-label={isCollapsed ? '展开演示引导' : '折叠演示引导'} onClick={() => setIsCollapsed((value) => !value)} type="button"><ChevronLeft size={15} /></button>
          {!isCollapsed && <button aria-label="关闭演示引导" onClick={() => setIsOpen(false)} type="button"><X size={15} /></button>}
        </div>
      </header>
      {!isCollapsed && (
        <div className="malacca-demo-guide__body">
          <div className="malacca-demo-guide__progress-meta"><span>{phase === 'finished' ? completed.length : currentIndex + 1} / {steps.length}</span><span title={runId}>{runId.slice(0, 18)}</span></div>
          <div className="malacca-demo-guide__progress"><i style={{ width: `${progress}%` }} /></div>
          <ol className="malacca-demo-guide__steps">
            {steps.map((step, index) => (
              <li key={step.id}>
                {index === quickStartIndex && <div className="malacca-demo-guide__divider">核心闭环完成 · 以下为能力速览</div>}
                <button
                  className={`${index === currentIndex ? 'is-active' : ''}${completed.includes(step.id) ? ' is-done' : ''}${skipped.includes(step.id) ? ' is-skipped' : ''}`}
                  onClick={() => {
                    stopWaiting();
                    setCurrentIndex(index);
                    setPhase(completed.includes(step.id) ? 'done' : 'ready');
                    setStatus(`已跳到第 ${index + 1} 步；台词、按钮和目标区域已同步。`);
                  }}
                  type="button"
                >
                  <i>{completed.includes(step.id) ? '✓' : skipped.includes(step.id) ? '!' : index + 1}</i>
                  <strong>{step.title}</strong>
                  <em>{index === currentIndex ? phase === 'done' ? '已执行' : phase === 'waiting' ? '执行中' : '当前' : completed.includes(step.id) ? '完成' : ''}</em>
                </button>
              </li>
            ))}
          </ol>
          <section className="malacca-demo-guide__script">
            <small>{phase === 'finished' ? '演示完成' : currentStep.phase}</small>
            <h2>{phase === 'finished' ? allStepsCompleted ? '马六甲港航沙盘演示闭环已完成' : '本段演示结束，完整流程尚未完成' : currentStep.title}</h2>
            <em>{phase === 'finished' ? '公开数据 · 离线训练 · 校准模拟' : currentStep.location}</em>
            <p>{phase === 'finished'
              ? allStepsCompleted ? '本次演示完成港航态势、官方数据、RL 契约、舷鸥任务编排、人工确认、真实训练、封存测试、安全门、交班和审计，再快速展示韧性、调度、应急、事件注入、微观仿真、高端地图和标准接口；生产权限始终保持关闭。' : `本次仅完成 ${completed.length}/${steps.length} 步，跳过 ${skipped.length} 步。尚未执行的动作没有标为通过；请重新开始以完成全流程验证。`
              : currentStep.speech}</p>
            <div><CheckCircle2 size={13} /><span>可见变化：{phase === 'finished' ? '可以重新开始或关闭引导继续查看页面。' : currentStep.visibleChange}</span></div>
          </section>
          <button type="button" data-demo-action="trained-evidence" onClick={() => window.dispatchEvent(new Event('demo-evidence-open'))}>场景算法与数据清单</button>
          <div className={`malacca-demo-guide__status is-${phase}`}><CircleAlert size={13} /><span>{status}</span></div>
          <button className={`malacca-demo-guide__primary${phase === 'done' || phase === 'finished' ? ' is-next' : ''}`} disabled={phase === 'waiting' || transitioning} onClick={() => phase === 'finished' ? startGuide() : void runStep()} type="button">
            {phase === 'finished' ? <><RotateCcw size={14} />重新开始演示</> : phase === 'done' ? <><CheckCircle2 size={14} />{currentIndex === steps.length - 1 ? '讲解完成，结束演示' : '下一步并演示'}</> : phase === 'waiting' ? '正在等待真实结果…' : phase === 'error' ? <><RotateCcw size={14} />重试：{currentStep.actionLabel}</> : <><Play size={14} />点击：{currentStep.actionLabel}</>}
          </button>
          <div className="malacca-demo-guide__controls">
            <button onClick={() => { stopWaiting(); setPhase('ready'); setStatus('本步已解锁，正在重新触发同一个真实按钮。'); void runStep(currentStep, true); }} type="button">重试本步</button>
            <button onClick={() => void resetStep()} type="button">重置本步</button>
            <button onClick={resetAll} type="button">重置全部</button>
            <button className="is-fallback" onClick={fallbackNext} type="button">保底下一步</button>
          </div>
          <footer>
            <button onClick={resetAll} type="button"><RotateCcw size={11} />重新开始</button>
            <button onClick={() => { onStopAll(); setPhase('ready'); setStatus('已请求停止沙盘、训练与微观验证任务；取消结果由页面状态确认。'); }} type="button"><Square size={11} />全部停止</button>
            <button onClick={() => { stopWaiting(); clearHighlights(); setIsOpen(false); }} type="button"><X size={11} />结束演示</button>
          </footer>
        </div>
      )}
    </aside>
  );
}
