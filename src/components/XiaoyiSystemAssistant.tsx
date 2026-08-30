import {
  BrainCircuit,
  CheckCircle2,
  CircleAlert,
  ListChecks,
  LoaderCircle,
  MousePointerClick,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';

type StepStatus = 'pending' | 'locating' | 'validating' | 'clicking' | 'done' | 'failed' | 'skipped';
type AssistantPhase = 'idle' | 'understanding' | 'planning' | 'confirming' | 'executing' | 'reviewing' | 'complete' | 'failed';

interface XiaoyiActionStep {
  target: string;
  label: string;
  skipWhenState?: string;
  verification: XiaoyiStepVerification;
}

type XiaoyiStepVerification =
  | {
      mode: 'attribute';
      attribute: 'aria-expanded' | 'aria-pressed' | 'data-xiaoyi-state';
      expected: string[];
      target?: string;
      description: string;
      timeoutMs?: number;
    }
  | {
      mode: 'changed';
      attribute: 'data-xiaoyi-state';
      target?: string;
      description: string;
      timeoutMs?: number;
    }
  | {
      mode: 'trigger';
      description: string;
    };

interface XiaoyiAction {
  id: string;
  label: string;
  summary: string;
  steps: XiaoyiActionStep[];
  requiresConfirmation?: boolean;
}

interface VisibleStep extends XiaoyiActionStep {
  status: StepStatus;
  detail: string;
}

interface XiaoyiExecutionReport {
  id: string;
  status: 'success' | 'failed';
  command: string;
  actionId: string;
  actionLabel: string;
  summary: string;
  confidence: number;
  steps: VisibleStep[];
  completedSteps: number;
  startedAt: string;
  completedAt: string;
  durationSeconds: string;
  failureReason?: string;
  confirmedAt?: string;
}

interface DragPosition {
  x: number;
  y: number;
}

interface DragRuntime extends DragPosition {
  pointerId: number;
  startX: number;
  startY: number;
  width: number;
  height: number;
  moved: boolean;
}

const moduleStep = (moduleId: string, label: string): XiaoyiActionStep => ({
  target: `module-${moduleId}`,
  label: `进入${label}`,
  verification: {
    mode: 'attribute',
    attribute: 'aria-pressed',
    expected: ['true'],
    description: `${label}已成为当前活动模块`,
  },
});

function startSimulationStep(): XiaoyiActionStep {
  return {
    target: 'simulation-toggle',
    label: '点击“开始”',
    skipWhenState: 'running',
    verification: {
      mode: 'attribute',
      attribute: 'data-xiaoyi-state',
      expected: ['running'],
      description: '推演运行态已回写',
    },
  };
}

function linkedDemoStep(demoId: string, label: string): XiaoyiActionStep {
  return {
    target: `demo-${demoId}`,
    label: `点击“${label}”`,
    verification: {
      mode: 'attribute',
      attribute: 'aria-pressed',
      expected: ['true'],
      description: `${label}场景及其联动状态已载入`,
    },
  };
}

const xiaoyiActions: Record<string, XiaoyiAction> = {
  overview: {
    id: 'overview',
    label: '打开态势总览',
    summary: '切换到港航网络态势总览。',
    steps: [moduleStep('overview', '态势总览')],
  },
  sandbox: {
    id: 'sandbox',
    label: '打开沙盘推演',
    summary: '切换到沙盘推演控制与微观验证页面。',
    steps: [moduleStep('sandbox', '沙盘推演')],
  },
  resilience: {
    id: 'resilience',
    label: '打开韧性评估',
    summary: '切换到港航网络韧性评估模块。',
    steps: [moduleStep('resilience', '韧性评估')],
  },
  dispatch: {
    id: 'dispatch',
    label: '打开调度优化',
    summary: '切换到绿色调度与策略对比模块。',
    steps: [moduleStep('dispatch', '调度优化')],
  },
  emergency: {
    id: 'emergency',
    label: '打开应急预案',
    summary: '切换到应急响应与预案模块。',
    steps: [moduleStep('emergency', '应急预案')],
  },
  'start-simulation': {
    id: 'start-simulation',
    label: '开始沙盘推演',
    summary: '进入沙盘模块并启动时间推进。',
    steps: [
      moduleStep('sandbox', '沙盘推演'),
      {
        target: 'simulation-toggle',
        label: '点击“开始”',
        skipWhenState: 'running',
        verification: {
          mode: 'attribute',
          attribute: 'data-xiaoyi-state',
          expected: ['running'],
          description: '推演运行态已回写',
        },
      },
    ],
  },
  'advance-simulation': {
    id: 'advance-simulation',
    label: '推进沙盘一步',
    summary: '进入沙盘模块并推进一个推演步长。',
    steps: [
      moduleStep('sandbox', '沙盘推演'),
      {
        target: 'simulation-step',
        label: '点击“推进”',
        verification: {
          mode: 'changed',
          attribute: 'data-xiaoyi-state',
          description: '推演时钟已推进',
        },
      },
    ],
  },
  'inject-event': {
    id: 'inject-event',
    label: '注入扰动事件',
    summary: '进入沙盘模块并注入下一条场景扰动事件。',
    steps: [
      moduleStep('sandbox', '沙盘推演'),
      {
        target: 'inject-event',
        label: '点击“事件注入”',
        verification: {
          mode: 'attribute',
          attribute: 'aria-pressed',
          expected: ['true'],
          description: '事件注入面板已打开',
        },
      },
    ],
  },
  'reset-simulation': {
    id: 'reset-simulation',
    label: '重置沙盘推演',
    summary: '这会清空当前推演进度、注入事件和已打开的策略面板。',
    requiresConfirmation: true,
    steps: [
      moduleStep('sandbox', '沙盘推演'),
      {
        target: 'simulation-reset',
        label: '点击“重置”',
        verification: {
          mode: 'attribute',
          attribute: 'data-xiaoyi-state',
          expected: ['idle'],
          target: 'simulation-toggle',
          description: '推演已回到待命态',
        },
      },
    ],
  },
  'rl-decision': {
    id: 'rl-decision',
    label: '打开策略推理',
    summary: '进入沙盘模块并打开在线策略推理舱。',
    steps: [
      moduleStep('sandbox', '沙盘推演'),
      {
        target: 'open-rl-decision',
        label: '点击“策略推理”',
        verification: {
          mode: 'attribute',
          attribute: 'data-xiaoyi-state',
          expected: ['decision-open', 'training-open'],
          description: '策略推理舱或训练前置页面已打开',
        },
      },
    ],
  },
  'rl-training': {
    id: 'rl-training',
    label: '打开强化学习训练中心',
    summary: '进入沙盘模块并打开系统级强化学习训练中心。',
    steps: [
      moduleStep('sandbox', '沙盘推演'),
      {
        target: 'open-rl-training',
        label: '点击“训练中心”',
        verification: {
          mode: 'attribute',
          attribute: 'data-xiaoyi-state',
          expected: ['open'],
          description: '训练中心已打开',
        },
      },
    ],
  },
  'rl-configure': {
    id: 'rl-configure',
    label: '让小懿配置 RL 训练',
    summary: '打开训练中心，并调用现有小懿 RL 顾问生成推荐配置。',
    steps: [
      moduleStep('sandbox', '沙盘推演'),
      {
        target: 'open-rl-training',
        label: '点击“训练中心”',
        verification: {
          mode: 'attribute',
          attribute: 'data-xiaoyi-state',
          expected: ['open'],
          description: '训练中心已打开',
        },
      },
      {
        target: 'rl-xiaoyi-configure',
        label: '点击“小懿智能配置”',
        verification: {
          mode: 'attribute',
          attribute: 'data-xiaoyi-state',
          expected: ['ready'],
          description: '小懿推荐已返回并绑定当前目标',
          timeoutMs: 15_000,
        },
      },
    ],
  },
  'rl-start': {
    id: 'rl-start',
    label: '启动强化学习训练',
    summary: '这会打开训练中心并启动长时训练任务。',
    requiresConfirmation: true,
    steps: [
      moduleStep('sandbox', '沙盘推演'),
      {
        target: 'open-rl-training',
        label: '点击“训练中心”',
        verification: {
          mode: 'attribute',
          attribute: 'data-xiaoyi-state',
          expected: ['open'],
          description: '训练中心已打开',
        },
      },
      {
        target: 'rl-start-training',
        label: '点击“启动训练”',
        skipWhenState: 'running',
        verification: {
          mode: 'attribute',
          attribute: 'data-xiaoyi-state',
          expected: ['queued', 'running', 'completed'],
          description: '后端训练任务已受理',
          timeoutMs: 15_000,
        },
      },
    ],
  },
  'rl-policy-test': {
    id: 'rl-policy-test',
    label: '运行强化学习策略测试',
    summary: '打开训练中心，并使用训练完成后的检查点运行最终测试集回放。',
    steps: [
      moduleStep('sandbox', '沙盘推演'),
      {
        target: 'open-rl-training',
        label: '点击“训练中心”',
        verification: {
          mode: 'attribute',
          attribute: 'data-xiaoyi-state',
          expected: ['open'],
          description: '训练中心已打开',
        },
      },
      {
        target: 'rl-policy-test',
        label: '点击“启动测试”',
        skipWhenState: 'running',
        verification: {
          mode: 'attribute',
          attribute: 'data-xiaoyi-state',
          expected: ['running', 'completed'],
          description: '最终测试集回放已启动',
          timeoutMs: 15_000,
        },
      },
    ],
  },
  'normal-demo': {
    id: 'normal-demo',
    label: '运行正常通航演示',
    summary: '载入正常通航场景并启动推演。',
    steps: [moduleStep('sandbox', '沙盘推演'), linkedDemoStep('normal-transit', '正常通航'), startSimulationStep()],
  },
  'congestion-demo': {
    id: 'congestion-demo',
    label: '运行港口拥堵演示',
    summary: '载入港口拥堵场景并启动推演。',
    steps: [moduleStep('sandbox', '沙盘推演'), linkedDemoStep('port-congestion', '港口拥堵'), startSimulationStep()],
  },
  'accident-demo': {
    id: 'accident-demo',
    label: '运行事故封航演示',
    summary: '载入事故封航场景并启动推演。',
    steps: [moduleStep('sandbox', '沙盘推演'), linkedDemoStep('accident-closure', '事故封航'), startSimulationStep()],
  },
  'weather-demo': {
    id: 'weather-demo',
    label: '运行极端天气演示',
    summary: '载入极端天气场景并启动推演。',
    steps: [moduleStep('sandbox', '沙盘推演'), linkedDemoStep('extreme-weather', '极端天气'), startSimulationStep()],
  },
  'carbon-demo': {
    id: 'carbon-demo',
    label: '运行低碳调度演示',
    summary: '载入低碳调度场景并启动推演。',
    steps: [moduleStep('sandbox', '沙盘推演'), linkedDemoStep('low-carbon-dispatch', '低碳调度'), startSimulationStep()],
  },
  settings: {
    id: 'settings',
    label: '打开系统设置',
    summary: '打开港口数据接入与显示设置。',
    steps: [{
      target: 'open-settings',
      label: '点击“系统设置”',
      verification: {
        mode: 'attribute',
        attribute: 'aria-expanded',
        expected: ['true'],
        description: '系统设置已打开',
      },
    }],
  },
  'export-report': {
    id: 'export-report',
    label: '导出闭环报告',
    summary: '进入沙盘模块并导出当前推演闭环报告。',
    steps: [
      moduleStep('sandbox', '沙盘推演'),
      {
        target: 'export-report',
        label: '点击“导出报告”',
        verification: {
          mode: 'changed',
          attribute: 'data-xiaoyi-state',
          description: '报告已生成并交给浏览器下载',
        },
      },
    ],
  },
  evidence: {
    id: 'evidence',
    label: '打开证据与闭环',
    summary: '进入后端权威证据、治理、模型与审计闭环中心。',
    steps: [moduleStep('evidence', '证据与闭环')],
  },
  regulatory: {
    id: 'regulatory',
    label: '打开监管韧性',
    summary: '进入海事与海关监管延误、官方放行及放行后恢复的证据页面。',
    steps: [
      moduleStep('evidence', '证据与闭环'),
      {
        target: 'evidence-tab-regulatory',
        label: '进入“监管韧性”',
        verification: {
          mode: 'attribute',
          attribute: 'aria-pressed',
          expected: ['true'],
          description: '监管权责边界、状态链和冻结测试证据已打开',
        },
      },
    ],
  },
  'operations-handoff': {
    id: 'operations-handoff',
    label: '生成小懿运行交班',
    summary: '读取同一后端权威快照，生成带模型连接状态、证据哈希和生产权限边界的运行交班。',
    steps: [
      moduleStep('evidence', '证据与闭环'),
      {
        target: 'evidence-tab-governance',
        label: '进入“安全治理”',
        verification: {
          mode: 'attribute',
          attribute: 'aria-pressed',
          expected: ['true'],
          description: '安全治理页面已打开',
        },
      },
      {
        target: 'xiaoyi-operational-handoff',
        label: '基于当前后端快照生成交班',
        verification: {
          mode: 'attribute',
          attribute: 'data-xiaoyi-state',
          expected: ['ready'],
          description: '交班已绑定权威快照和证据哈希',
          timeoutMs: 20_000,
        },
      },
    ],
  },
};

const quickCommands = ['进入沙盘推演', '运行港口拥堵演示', '打开监管韧性', '运行RL策略测试', '打开训练中心', '生成小懿运行交班'];

const delay = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
const getRuntimeTimestamp = () => window.performance.now();

const phaseLabels: Record<AssistantPhase, string> = {
  idle: '等待指令',
  understanding: '意图解析',
  planning: '操作编排',
  confirming: '等待人工确认',
  executing: '页面联动执行',
  reviewing: '等待人工验收',
  complete: '执行完成',
  failed: '执行异常',
};

const statusLabels: Record<StepStatus, string> = {
  pending: '等待',
  locating: '定位',
  validating: '校验',
  clicking: '点击',
  done: '完成',
  failed: '失败',
  skipped: '已跳过',
};

const phaseStages = [
  { label: '意图解析', Icon: BrainCircuit },
  { label: '白名单', Icon: ShieldCheck },
  { label: '操作编排', Icon: ListChecks },
  { label: '页面执行', Icon: MousePointerClick },
] as const;

const createVisibleSteps = (action: XiaoyiAction): VisibleStep[] => action.steps.map((step) => ({
  ...step,
  status: 'pending',
  detail: `动作标识 ${step.target} · 等待编排`,
}));

let localRecordSequence = 0;
const createLocalRecordId = (prefix: 'XY' | 'XYR') => {
  localRecordSequence += 1;
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
  return `${prefix}-LOCAL-${timestamp}-${String(localRecordSequence).padStart(4, '0')}`;
};
const createApprovalId = () => createLocalRecordId('XY');
const createReportId = () => createLocalRecordId('XYR');
const formatRuntimeTime = (date: Date) => date.toLocaleTimeString('zh-CN', { hour12: false });

const normalize = (value: string) => value.toLowerCase().replace(/[\s，。！？、,.!?：:；;“”"']/g, '');

const resolveXiaoyiAction = (command: string): XiaoyiAction | null => {
  const text = normalize(command).replace(/^小懿(请|帮我|现在)?/, '');
  if (/运行交班|交班报告|小懿交班|生成.*交班/.test(text)) return xiaoyiActions['operations-handoff'];
  if (/监管韧性|监管延误|海事.*检查|海关.*查验|放行.*恢复/.test(text)) return xiaoyiActions.regulatory;
  if (/证据与闭环|证据中心|审计闭环/.test(text)) return xiaoyiActions.evidence;
  if (/重置.*(沙盘|推演)|重新开始推演/.test(text)) return xiaoyiActions['reset-simulation'];
  if (/(开始|启动).*(强化学习|rl).*训练|(强化学习|rl).*训练.*(开始|启动)/.test(text)) return xiaoyiActions['rl-start'];
  if (/智能配置|推荐.*训练|训练.*推荐|配置.*(强化学习|rl).*训练|(强化学习|rl).*训练.*配置/.test(text)) return xiaoyiActions['rl-configure'];
  if (/训练中心|强化学习面板|rl训练面板/.test(text)) return xiaoyiActions['rl-training'];
  if (/(强化学习|rl).*(策略)?测试|策略测试|最终测试集回放/.test(text)) return xiaoyiActions['rl-policy-test'];
  if (/rl.*(策略|推理)|策略推理/.test(text)) return xiaoyiActions['rl-decision'];
  if (/港口拥堵|拥堵演示/.test(text)) return xiaoyiActions['congestion-demo'];
  if (/事故封航|封航演示/.test(text)) return xiaoyiActions['accident-demo'];
  if (/极端天气|天气演示|风浪演示/.test(text)) return xiaoyiActions['weather-demo'];
  if (/低碳调度|低碳演示/.test(text)) return xiaoyiActions['carbon-demo'];
  if (/正常通航|正常演示/.test(text)) return xiaoyiActions['normal-demo'];
  if (/事件注入|注入.*(事件|扰动)|扰动事件/.test(text)) return xiaoyiActions['inject-event'];
  if (/推进|下一步|前进一步/.test(text)) return xiaoyiActions['advance-simulation'];
  if (/(开始|启动).*(沙盘|推演)|(沙盘|推演).*(开始|启动)/.test(text)) return xiaoyiActions['start-simulation'];
  if (/态势总览|首页|总览模块/.test(text)) return xiaoyiActions.overview;
  if (/沙盘推演|沙盘模块/.test(text)) return xiaoyiActions.sandbox;
  if (/韧性评估|韧性模块/.test(text)) return xiaoyiActions.resilience;
  if (/调度优化|调度模块|策略对比/.test(text)) return xiaoyiActions.dispatch;
  if (/应急预案|应急模块/.test(text)) return xiaoyiActions.emergency;
  if (/系统设置|数据接入设置/.test(text)) return xiaoyiActions.settings;
  if (/导出.*报告|下载.*报告|闭环报告/.test(text)) return xiaoyiActions['export-report'];
  return null;
};

const calculateIntentConfidence = (command: string, action: XiaoyiAction) => {
  const normalizedCommand = normalize(command).replace(/^小懿(请|帮我|现在)?/, '');
  const normalizedLabel = normalize(action.label);
  if (normalizedCommand === normalizedLabel || normalizedCommand.includes(normalizedLabel)) return 98;
  const intentCore = normalizedLabel.replace(/^(打开|运行|开始|启动|推进|注入|重置|让小懿)/, '');
  if (intentCore.length >= 4 && normalizedCommand.includes(intentCore)) return 95;
  return 91;
};

const waitForTarget = async (target: string, runId: number, currentRun: { current: number }) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (currentRun.current !== runId) throw new Error('执行已取消');
    const element = document.querySelector<HTMLElement>(`[data-xiaoyi-action="${target}"]`);
    if (element) return element;
    await delay(100);
  }
  throw new Error(`未找到动作按钮：${target}`);
};

const readVerificationAttribute = (
  element: HTMLElement,
  attribute: 'aria-expanded' | 'aria-pressed' | 'data-xiaoyi-state',
) => attribute === 'data-xiaoyi-state'
  ? element.dataset.xiaoyiState ?? null
  : element.getAttribute(attribute);

const verifyStepResult = async (
  step: XiaoyiActionStep,
  initialValue: string | null,
  runId: number,
  currentRun: { current: number },
) => {
  if (step.verification.mode === 'trigger') return step.verification.description;
  const verificationTarget = step.verification.target ?? step.target;
  const timeoutMs = step.verification.timeoutMs ?? 8_000;
  const attempts = Math.max(1, Math.ceil(timeoutMs / 100));
  let lastValue: string | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (currentRun.current !== runId) throw new Error('执行已取消');
    const element = document.querySelector<HTMLElement>(`[data-xiaoyi-action="${verificationTarget}"]`);
    if (element) {
      lastValue = readVerificationAttribute(element, step.verification.attribute);
      if (
        (step.verification.mode === 'attribute' && step.verification.expected.includes(lastValue ?? '')) ||
        (step.verification.mode === 'changed' && lastValue !== null && lastValue !== initialValue)
      ) {
        return `${step.verification.description} · ${step.verification.attribute}=${lastValue}`;
      }
    }
    await delay(100);
  }
  throw new Error(`页面回写未通过：${step.verification.description}（当前 ${lastValue ?? 'missing'}）`);
};

export function XiaoyiSystemAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [command, setCommand] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [phase, setPhase] = useState<AssistantPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [intentConfidence, setIntentConfidence] = useState(0);
  const [message, setMessage] = useState('我已接入全系统。你可以让我切换模块、运行演示、注入事件或打开强化学习训练。');
  const [visibleSteps, setVisibleSteps] = useState<VisibleStep[]>([]);
  const [pendingAction, setPendingAction] = useState<XiaoyiAction | null>(null);
  const [activeAction, setActiveAction] = useState<XiaoyiAction | null>(null);
  const [approvalId, setApprovalId] = useState('');
  const [confirmationAcknowledged, setConfirmationAcknowledged] = useState(false);
  const [approvalRecorded, setApprovalRecorded] = useState(false);
  const [executionReport, setExecutionReport] = useState<XiaoyiExecutionReport | null>(null);
  const [isExecutionReportOpen, setIsExecutionReportOpen] = useState(false);
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const [reviewRecorded, setReviewRecorded] = useState(false);
  const [dragPosition, setDragPosition] = useState<DragPosition | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const currentRun = useRef(0);
  const activeCommand = useRef('');
  const activeConfidence = useRef(0);
  const dragRuntime = useRef<DragRuntime | null>(null);
  const suppressAvatarClick = useRef(false);
  const actionCount = useMemo(() => Object.keys(xiaoyiActions).length, []);
  const isLeftSide = dragPosition !== null && dragPosition.x < window.innerWidth / 2;

  useEffect(() => {
    const keepAvatarInViewport = () => {
      setDragPosition((position) => {
        if (!position) return position;
        const avatar = document.querySelector<HTMLElement>('.xiaoyi-system-avatar');
        const width = avatar?.offsetWidth ?? 116;
        const height = avatar?.offsetHeight ?? 154;
        return {
          x: Math.max(8, Math.min(window.innerWidth - width - 8, position.x)),
          y: Math.max(8, Math.min(window.innerHeight - height - 8, position.y)),
        };
      });
    };
    window.addEventListener('resize', keepAvatarInViewport);
    return () => window.removeEventListener('resize', keepAvatarInViewport);
  }, []);

  const executeAction = async (action: XiaoyiAction, preparedRunId?: number) => {
    const runId = preparedRunId ?? currentRun.current + 1;
    const executionStartedAt = new Date();
    const executionStartedAtRuntime = getRuntimeTimestamp();
    let reportSteps = createVisibleSteps(action);
    const updateExecutionStep = (index: number, status: StepStatus, detail: string) => {
      reportSteps = reportSteps.map((item, stepIndex) => stepIndex === index ? { ...item, status, detail } : item);
      setVisibleSteps(reportSteps);
    };
    currentRun.current = runId;
    setPendingAction(null);
    setConfirmationAcknowledged(false);
    setIsOpen(true);
    setIsRunning(true);
    setActiveAction(action);
    setPhase('executing');
    setProgress(40);
    setMessage(`操作链已锁定，开始执行 1/${action.steps.length}。每一步都会定位目标、校验状态、触发点击并等待页面回写。`);
    setVisibleSteps(reportSteps);

    let activeTarget: HTMLElement | null = null;
    try {
      for (let index = 0; index < action.steps.length; index += 1) {
        const step = action.steps[index];
        const stepStartedAt = getRuntimeTimestamp();
        setProgress(Math.round(40 + (index / action.steps.length) * 60));
        updateExecutionStep(index, 'locating', `正在扫描动作注册表 · ${step.target}`);
        setMessage(`正在执行 ${index + 1}/${action.steps.length}：定位“${step.label}”对应的页面目标。`);
        const target = await waitForTarget(step.target, runId, currentRun);
        activeTarget = target;
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        target.classList.add('xiaoyi-system-target');
        await delay(900);

        updateExecutionStep(index, 'validating', '目标已定位 · 正在校验可见性、禁用状态与运行上下文');
        setMessage(`安全校验 ${index + 1}/${action.steps.length}：目标已登记，正在检查按钮状态和重复执行条件。`);
        await delay(750);
        const targetStyle = window.getComputedStyle(target);
        const targetRect = target.getBoundingClientRect();
        if (
          !target.isConnected ||
          targetStyle.display === 'none' ||
          targetStyle.visibility === 'hidden' ||
          targetRect.width <= 0 ||
          targetRect.height <= 0
        ) {
          throw new Error(`按钮当前不可见：${step.label}`);
        }
        const state = target.dataset.xiaoyiState;
        if (step.skipWhenState && state === step.skipWhenState) {
          target.classList.remove('xiaoyi-system-target');
          activeTarget = null;
          updateExecutionStep(index, 'skipped', `当前状态已是 ${state} · 已阻止重复点击`);
          setMessage(`${step.label}：当前已经处于目标状态，跳过重复点击。`);
          setProgress(Math.round(40 + ((index + 1) / action.steps.length) * 60));
          await delay(700);
          continue;
        }
        if (target instanceof HTMLButtonElement && target.disabled) throw new Error(`按钮当前不可用：${step.label}`);

        const verificationTarget = step.verification.mode === 'trigger'
          ? target
          : document.querySelector<HTMLElement>(
              `[data-xiaoyi-action="${step.verification.target ?? step.target}"]`,
            );
        const initialVerificationValue = step.verification.mode === 'trigger' || !verificationTarget
          ? null
          : readVerificationAttribute(verificationTarget, step.verification.attribute);

        updateExecutionStep(index, 'clicking', '校验通过 · 正在触发受控 UI 点击');
        setMessage(`确认可执行，正在触发 ${index + 1}/${action.steps.length}：${step.label}`);
        await delay(800);
        target.click();
        updateExecutionStep(index, 'clicking', '动作已触发 · 正在核对声明的页面回写条件');
        const verificationDetail = await verifyStepResult(
          step,
          initialVerificationValue,
          runId,
          currentRun,
        );
        target.classList.remove('xiaoyi-system-target');
        activeTarget = null;
        const elapsedSeconds = ((getRuntimeTimestamp() - stepStartedAt) / 1000).toFixed(1);
        updateExecutionStep(index, 'done', `执行成功 · ${verificationDetail} · ${elapsedSeconds}s`);
        setProgress(Math.round(40 + ((index + 1) / action.steps.length) * 60));
        if (index < action.steps.length - 1) {
          setMessage(`第 ${index + 1} 步已完成，正在将页面状态交给下一步。`);
          await delay(650);
        }
      }
      const executionCompletedAt = new Date();
      const completedSteps = reportSteps.filter((step) => step.status === 'done' || step.status === 'skipped').length;
      setPhase('reviewing');
      setProgress(100);
      setMessage(`自动操作链已完成：${action.label}。执行报告已生成，等待人工核对页面状态并最终确认。`);
      setExecutionReport({
        id: createReportId(),
        status: 'success',
        command: activeCommand.current || action.label,
        actionId: action.id,
        actionLabel: action.label,
        summary: `${action.summary} ${completedSteps}/${action.steps.length} 个页面步骤已完成状态回写。`,
        confidence: activeConfidence.current,
        steps: reportSteps,
        completedSteps,
        startedAt: formatRuntimeTime(executionStartedAt),
        completedAt: formatRuntimeTime(executionCompletedAt),
        durationSeconds: ((getRuntimeTimestamp() - executionStartedAtRuntime) / 1000).toFixed(1),
      });
      setReviewAcknowledged(false);
      setReviewRecorded(false);
      setIsExecutionReportOpen(true);
    } catch (error) {
      activeTarget?.classList.remove('xiaoyi-system-target');
      const failureReason = error instanceof Error ? error.message : '执行未完成，请检查目标按钮。';
      reportSteps = reportSteps.map((item) => item.status === 'locating' || item.status === 'validating' || item.status === 'clicking' ? { ...item, status: 'failed', detail: '执行中断 · 等待人工检查' } : item);
      const executionCompletedAt = new Date();
      const completedSteps = reportSteps.filter((step) => step.status === 'done' || step.status === 'skipped').length;
      setPhase('failed');
      setVisibleSteps(reportSteps);
      setMessage(`执行未完成：${failureReason}。异常报告已生成，等待人工核查。`);
      setExecutionReport({
        id: createReportId(),
        status: 'failed',
        command: activeCommand.current || action.label,
        actionId: action.id,
        actionLabel: action.label,
        summary: `操作链在完成 ${completedSteps}/${action.steps.length} 个页面步骤后中断。`,
        confidence: activeConfidence.current,
        steps: reportSteps,
        completedSteps,
        startedAt: formatRuntimeTime(executionStartedAt),
        completedAt: formatRuntimeTime(executionCompletedAt),
        durationSeconds: ((getRuntimeTimestamp() - executionStartedAtRuntime) / 1000).toFixed(1),
        failureReason,
      });
      setReviewAcknowledged(false);
      setReviewRecorded(false);
      setIsExecutionReportOpen(true);
    } finally {
      if (currentRun.current === runId) setIsRunning(false);
    }
  };

  const prepareAction = async (action: XiaoyiAction, originalCommand: string) => {
    const runId = currentRun.current + 1;
    currentRun.current = runId;
    setIsOpen(true);
    setIsRunning(true);
    setPendingAction(null);
    setActiveAction(action);
    const confidence = calculateIntentConfidence(originalCommand, action);
    setIntentConfidence(confidence);
    setConfirmationAcknowledged(false);
    setApprovalRecorded(false);
    setExecutionReport(null);
    setIsExecutionReportOpen(false);
    setReviewAcknowledged(false);
    setReviewRecorded(false);
    activeCommand.current = originalCommand;
    activeConfidence.current = confidence;
    setApprovalId(createApprovalId());
    setVisibleSteps([]);
    setPhase('understanding');
    setProgress(6);
    setMessage('正在解析自然语言指令，提取目标对象、操作类型和状态影响。');

    const continueRun = () => currentRun.current === runId;
    await delay(700);
    if (!continueRun()) return;
    setProgress(15);
    setMessage(`已识别目标意图：“${action.label}”。正在与 ${actionCount} 项受控动作注册表进行语义匹配。`);
    await delay(750);
    if (!continueRun()) return;
    setProgress(24);
    setMessage(`动作匹配完成：${action.id} · 置信度 ${confidence}%。正在检查执行边界与页面状态约束。`);
    await delay(700);
    if (!continueRun()) return;

    setPhase('planning');
    setProgress(31);
    setVisibleSteps(createVisibleSteps(action));
    setMessage(`正在生成 ${action.steps.length} 步受控操作链，并为每一步绑定唯一页面动作标识。`);
    await delay(850);
    if (!continueRun()) return;
    setVisibleSteps((steps) => steps.map((step) => ({ ...step, detail: `已绑定 ${step.target} · 执行前将再次校验` })));
    setProgress(action.requiresConfirmation ? 38 : 40);

    if (action.requiresConfirmation) {
      setPhase('confirming');
      setPendingAction(action);
      setIsRunning(false);
      setMessage(`操作链已生成，但“${action.label}”属于高影响动作。系统已暂停，等待人工授权。`);
      return;
    }

    setMessage('操作链规划完成，白名单与当前页面状态校验通过。即将开始逐步执行。');
    await delay(700);
    if (!continueRun()) return;
    await executeAction(action, runId);
  };

  const handleCommand = (event?: FormEvent) => {
    event?.preventDefault();
    const trimmed = command.trim();
    if (!trimmed || isRunning) return;
    const action = resolveXiaoyiAction(trimmed);
    if (!action) {
      setPendingAction(null);
      setActiveAction(null);
      setVisibleSteps([]);
      setExecutionReport(null);
      setIsExecutionReportOpen(false);
      setReviewAcknowledged(false);
      setReviewRecorded(false);
      setPhase('failed');
      setProgress(0);
      setMessage('我还没有匹配到对应按钮。可以试试：进入沙盘推演、运行港口拥堵演示、注入扰动事件、打开训练中心。');
      return;
    }
    void prepareAction(action, trimmed);
  };

  const handleQuickCommand = (value: string) => {
    setCommand(value);
    const action = resolveXiaoyiAction(value);
    if (action) void prepareAction(action, value);
  };

  const cancelConfirmation = () => {
    currentRun.current += 1;
    setPendingAction(null);
    setConfirmationAcknowledged(false);
    setApprovalRecorded(false);
    setPhase('idle');
    setProgress(0);
    setVisibleSteps([]);
    setActiveAction(null);
    setMessage('已取消执行，高影响动作未触发。');
  };

  const approvePendingAction = () => {
    if (!pendingAction || !confirmationAcknowledged) return;
    setApprovalRecorded(true);
    void executeAction(pendingAction);
  };

  const confirmExecutionReview = () => {
    if (!executionReport || !reviewAcknowledged) return;
    const confirmedAt = formatRuntimeTime(new Date());
    setExecutionReport({ ...executionReport, confirmedAt });
    setReviewRecorded(true);
    setReviewAcknowledged(false);
    setIsExecutionReportOpen(false);
    if (executionReport.status === 'success') {
      setPhase('complete');
      setMessage(`人工复核已通过：${executionReport.actionLabel}。执行报告 ${executionReport.id} 已完成闭环归档。`);
      return;
    }
    setMessage(`人工已确认本次执行异常。报告 ${executionReport.id} 已归档，可修复页面状态后重新下达指令。`);
  };

  const phaseTrackIndex = phase === 'understanding' ? 0 : phase === 'planning' || phase === 'confirming' ? 2 : phase === 'executing' ? 3 : phase === 'reviewing' || phase === 'complete' ? 4 : -1;
  const reviewPending = Boolean(executionReport && !reviewRecorded);

  const handleAvatarPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const assistantRect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!assistantRect) return;
    dragRuntime.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: assistantRect.left,
      y: assistantRect.top,
      width: event.currentTarget.offsetWidth,
      height: event.currentTarget.offsetHeight,
      moved: false,
    };
    suppressAvatarClick.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleAvatarPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const runtime = dragRuntime.current;
    if (!runtime || runtime.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - runtime.startX;
    const deltaY = event.clientY - runtime.startY;
    if (!runtime.moved && Math.hypot(deltaX, deltaY) < 5) return;
    runtime.moved = true;
    suppressAvatarClick.current = true;
    setIsDragging(true);
    setDragPosition({
      x: Math.max(8, Math.min(window.innerWidth - runtime.width - 8, runtime.x + deltaX)),
      y: Math.max(8, Math.min(window.innerHeight - runtime.height - 8, runtime.y + deltaY)),
    });
  };

  const handleAvatarPointerEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRuntime.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRuntime.current = null;
    setIsDragging(false);
  };

  const handleAvatarClick = () => {
    if (suppressAvatarClick.current) {
      suppressAvatarClick.current = false;
      return;
    }
    setIsOpen((value) => !value);
  };

  return (
    <aside
      className={`xiaoyi-system-assistant${isOpen ? ' is-open' : ''}${isDragging ? ' is-dragging' : ''}${isLeftSide ? ' is-left-side' : ''}`}
      aria-label="小懿全系统联动助手"
      style={dragPosition ? { left: dragPosition.x, top: dragPosition.y, right: 'auto', bottom: 'auto' } : undefined}
    >
      {isRunning && activeAction && (
        <div className="xiaoyi-system-execution-hud" aria-live="polite">
          <span className="xiaoyi-system-execution-hud__icon"><LoaderCircle size={18} /></span>
          <span><small>小懿正在联动沙盘 · {phaseLabels[phase]}</small><strong>{activeAction.label}</strong></span>
          <em>{progress}%</em>
          <i><b style={{ width: `${progress}%` }} /></i>
        </div>
      )}
      {isOpen && (
        <section className="xiaoyi-system-panel" aria-label="小懿对话指令面板">
          <header className="xiaoyi-system-panel__header">
            <span className="xiaoyi-system-panel__identity">
              <Sparkles size={15} />
              <span><strong>小懿AI · 系统联动</strong><span>{actionCount} 个动作 · STEP-BY-STEP LINKAGE</span></span>
            </span>
            <button className="xiaoyi-system-close" aria-label="收起小懿系统助手" onClick={() => setIsOpen(false)} type="button"><X size={14} /></button>
          </header>
          <div className="xiaoyi-system-message">
            <span className={isRunning ? 'is-running' : ''}>{isRunning ? <Sparkles size={13} /> : pendingAction ? <CircleAlert size={13} /> : <CheckCircle2 size={13} />}</span>
            <p>{message}</p>
          </div>
          {activeAction && (
            <div className="xiaoyi-system-task">
              <header><span><BrainCircuit size={13} />任务理解</span><b>{phaseLabels[phase]}</b></header>
              <div className="xiaoyi-system-task__intent">
                <span><small>识别意图</small><strong>{activeAction.label}</strong></span>
                <span><small>动作 ID</small><strong>{activeAction.id}</strong></span>
                <span><small>语义置信度</small><strong>{intentConfidence}%</strong></span>
              </div>
              <div className="xiaoyi-system-progress" aria-label={`任务总进度 ${progress}%`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                <span><small>任务总进度</small><strong>{progress}%</strong></span>
                <i><b style={{ width: `${progress}%` }} /></i>
              </div>
              <div className="xiaoyi-system-phase-track" aria-label="小懿执行阶段">
                {phaseStages.map(({ label, Icon }, index) => (
                  <span className={phaseTrackIndex > index ? 'is-done' : phaseTrackIndex === index ? 'is-active' : ''} key={label}>
                    <Icon size={11} /><small>{label}</small>
                  </span>
                ))}
              </div>
              {activeAction.requiresConfirmation && (
                <div className={`xiaoyi-system-approval-record${approvalRecorded ? ' is-approved' : ''}`}>
                  <ShieldCheck size={11} />
                  <span><small>审批记录</small><strong>{approvalId}</strong></span>
                  <em>{approvalRecorded ? '人工确认已通过' : '等待人工确认'}</em>
                </div>
              )}
            </div>
          )}
          {visibleSteps.length > 0 && (
            <ol className="xiaoyi-system-steps">
              {visibleSteps.map((step, index) => (
                <li className={`xiaoyi-system-step is-${step.status}`} key={`${step.target}-${index}`}>
                  <b>{step.status === 'done' ? <CheckCircle2 size={12} /> : step.status === 'locating' || step.status === 'validating' || step.status === 'clicking' ? <LoaderCircle size={12} /> : index + 1}</b>
                  <span><strong>{step.label}</strong><small>{step.detail}</small></span>
                  <em>{statusLabels[step.status]}</em>
                </li>
              ))}
            </ol>
          )}
          {executionReport && (
            <div className={`xiaoyi-system-review-record${reviewRecorded ? ' is-recorded' : executionReport.status === 'failed' ? ' is-failed' : ' is-pending'}`}>
              <span>{reviewRecorded ? <CheckCircle2 size={14} /> : <ShieldCheck size={14} />}</span>
              <div>
                <small>{reviewRecorded ? 'HUMAN REVIEW ARCHIVED' : 'HUMAN REVIEW REQUIRED'}</small>
                <strong>{reviewRecorded ? '人工验收已归档' : executionReport.status === 'success' ? '执行报告待人工确认' : '异常报告待人工确认'}</strong>
                <em>{executionReport.id} · {executionReport.completedSteps}/{executionReport.steps.length} 步</em>
              </div>
              <button onClick={() => setIsExecutionReportOpen(true)} type="button">{reviewRecorded ? '查看报告' : '打开并确认'}</button>
            </div>
          )}
          <form className="xiaoyi-system-form" onSubmit={handleCommand}>
            <input aria-label="输入小懿系统指令" disabled={isRunning || Boolean(pendingAction) || reviewPending} onChange={(event) => setCommand(event.currentTarget.value)} placeholder="例如：小懿，运行港口拥堵演示" value={command} />
            <button aria-label="让小懿执行指令" disabled={isRunning || Boolean(pendingAction) || reviewPending || !command.trim()} type="submit"><Send size={14} /></button>
          </form>
          <div className="xiaoyi-system-quick">
            {quickCommands.map((item) => <button disabled={isRunning || Boolean(pendingAction) || reviewPending} key={item} onClick={() => handleQuickCommand(item)} type="button">{item}</button>)}
          </div>
          <footer className="xiaoyi-system-footer"><CircleAlert size={12} />仅操作当前沙盘 UI；自动步骤完成后由人工验收闭环 · HUMAN-IN-THE-LOOP</footer>
        </section>
      )}
      {pendingAction && (
        <div className="xiaoyi-system-confirm-backdrop">
          <section className="xiaoyi-system-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="xiaoyi-confirm-title">
            <header>
              <span><ShieldCheck size={21} /></span>
              <div><small>MANUAL APPROVAL REQUIRED</small><strong id="xiaoyi-confirm-title">高影响操作 · 等待人工确认</strong></div>
              <em>{approvalId}</em>
            </header>
            <div className="xiaoyi-system-confirm-dialog__body">
              <div className="xiaoyi-system-confirm-dialog__alert">
                <CircleAlert size={18} />
                <span><strong>{pendingAction.label}</strong><small>{pendingAction.summary}</small></span>
              </div>
              <dl>
                <div><dt>状态影响</dt><dd>清空或改变当前运行状态</dd><em>高</em></div>
                <div><dt>执行边界</dt><dd>仅点击当前沙盘已登记 UI</dd><em>受控</em></div>
                <div><dt>操作链</dt><dd>{pendingAction.steps.map((step) => step.label).join(' → ')}</dd><em>{pendingAction.steps.length} 步</em></div>
              </dl>
              <label className="xiaoyi-system-confirm-dialog__check">
                <input checked={confirmationAcknowledged} onChange={(event) => setConfirmationAcknowledged(event.currentTarget.checked)} type="checkbox" />
                <span><strong>我已了解上述影响，并授权小懿执行本次操作链</strong><small>确认动作、审批编号和每一步执行结果将保留在当前任务记录中。</small></span>
              </label>
            </div>
            <footer>
              <button onClick={cancelConfirmation} type="button">取消，不执行</button>
              <button disabled={!confirmationAcknowledged} onClick={approvePendingAction} type="button"><ShieldCheck size={14} />人工确认并执行</button>
            </footer>
          </section>
        </div>
      )}
      {executionReport && isExecutionReportOpen && (
        <div className="xiaoyi-system-report-backdrop">
          <section className={`xiaoyi-system-report-dialog is-${executionReport.status}`} role="dialog" aria-modal="true" aria-labelledby="xiaoyi-report-title">
            <header>
              <span>{executionReport.status === 'success' ? <CheckCircle2 size={22} /> : <CircleAlert size={22} />}</span>
              <div>
                <small>AUTOMATION EXECUTION REPORT · HUMAN IN THE LOOP</small>
                <strong id="xiaoyi-report-title">执行结果复核 · {reviewRecorded ? '人工验收已归档' : '等待人工最终确认'}</strong>
              </div>
              <em>{executionReport.id}</em>
            </header>
            <div className="xiaoyi-system-report-dialog__body">
              <div className="xiaoyi-system-report-hero">
                <span>{executionReport.status === 'success' ? <CheckCircle2 size={20} /> : <CircleAlert size={20} />}</span>
                <div>
                  <small>{executionReport.status === 'success' ? 'AUTOMATION STEPS COMPLETED' : 'AUTOMATION INTERRUPTED'}</small>
                  <strong>{executionReport.status === 'success' ? '页面操作链已完成，任务尚未人工闭环' : '页面操作链执行中断，禁止确认成功'}</strong>
                  <p>{executionReport.summary}</p>
                </div>
                <b>{executionReport.completedSteps}/{executionReport.steps.length}</b>
              </div>

              <div className="xiaoyi-system-report-metrics">
                <span><small>识别意图</small><strong>{executionReport.actionLabel}</strong></span>
                <span><small>动作 ID</small><strong>{executionReport.actionId}</strong></span>
                <span><small>语义置信度</small><strong>{executionReport.confidence}%</strong></span>
                <span><small>执行耗时</small><strong>{executionReport.durationSeconds}s</strong></span>
                <span><small>开始时间</small><strong>{executionReport.startedAt}</strong></span>
                <span><small>完成时间</small><strong>{executionReport.completedAt}</strong></span>
              </div>

              <div className="xiaoyi-system-report-command">
                <span><BrainCircuit size={14} /></span>
                <div><small>原始自然语言指令</small><strong>“{executionReport.command}”</strong></div>
                <em>已映射并留痕</em>
              </div>

              <section className="xiaoyi-system-report-section">
                <header><span><ListChecks size={14} />逐步执行记录</span><em>目标定位 · 状态校验 · 受控点击 · 页面回写</em></header>
                <ol>
                  {executionReport.steps.map((step, index) => (
                    <li className={`is-${step.status}`} key={`${step.target}-report-${index}`}>
                      <b>{step.status === 'done' || step.status === 'skipped' ? <CheckCircle2 size={13} /> : step.status === 'failed' ? <CircleAlert size={13} /> : index + 1}</b>
                      <span><strong>{index + 1}. {step.label}</strong><small>{step.detail}</small></span>
                      <code>{step.target}</code>
                      <em>{statusLabels[step.status]}</em>
                    </li>
                  ))}
                </ol>
              </section>

              <div className={`xiaoyi-system-report-summary${executionReport.status === 'failed' ? ' is-failed' : ''}`}>
                <span><ShieldCheck size={17} /></span>
                <div>
                  <small>{executionReport.status === 'success' ? '自动执行总结' : '异常摘要'}</small>
                  <strong>{executionReport.status === 'success' ? executionReport.summary : executionReport.failureReason}</strong>
                  <p>{executionReport.status === 'success'
                    ? `本次操作仅调用 ${actionCount} 项白名单中的已登记页面动作，未执行外部命令。每一步均完成可见性、可用性和重复状态校验；最终业务状态仍由人工负责确认。`
                    : '系统已停止后续步骤，没有把未完成任务标记为成功。请核对页面按钮状态和失败步骤，再决定是否重新执行。'}</p>
                </div>
              </div>

              {reviewRecorded ? (
                <div className="xiaoyi-system-report-archived">
                  <CheckCircle2 size={16} />
                  <span><strong>{executionReport.status === 'success' ? '人工已确认执行完成' : '人工已确认并知晓异常'}</strong><small>确认时间 {executionReport.confirmedAt} · 报告已完成当前会话归档</small></span>
                </div>
              ) : (
                <label className="xiaoyi-system-report-check">
                  <input checked={reviewAcknowledged} onChange={(event) => setReviewAcknowledged(event.currentTarget.checked)} type="checkbox" />
                  <span>
                    <strong>{executionReport.status === 'success' ? '我已核对真实页面状态，确认本次操作结果符合业务意图' : '我已查看失败步骤和异常原因，确认知晓本次操作未完成'}</strong>
                    <small>小懿只提交执行证据，不代替人工做最终业务验收；本次确认将写入报告。</small>
                  </span>
                </label>
              )}
            </div>
            <footer>
              {reviewRecorded ? (
                <button onClick={() => setIsExecutionReportOpen(false)} type="button">关闭报告</button>
              ) : (
                <>
                  <button onClick={() => setIsExecutionReportOpen(false)} type="button">返回页面检查</button>
                  <button disabled={!reviewAcknowledged} onClick={confirmExecutionReview} type="button">
                    <ShieldCheck size={14} />{executionReport.status === 'success' ? '人工确认执行完成' : '确认异常并归档'}
                  </button>
                </>
              )}
            </footer>
          </section>
        </div>
      )}
      <button
        className="xiaoyi-system-avatar"
        aria-label="打开或拖动小懿全系统联动助手"
        onClick={handleAvatarClick}
        onPointerCancel={handleAvatarPointerEnd}
        onPointerDown={handleAvatarPointerDown}
        onPointerMove={handleAvatarPointerMove}
        onPointerUp={handleAvatarPointerEnd}
        title="点击对话 · 拖动小懿 / Click or drag Xiaoyi"
        type="button"
      >
        <span className="xiaoyi-system-speech" aria-hidden="true">
          <strong>小懿已接入全系统</strong>
          <span>说出指令，我会逐步点击 · COMMAND LINKAGE</span>
          <span className="xiaoyi-system-wave"><i /><i /><i /><i /><i /><i /><i /></span>
        </span>
        <span className="xiaoyi-system-avatar__figure" aria-hidden="true" />
      </button>
    </aside>
  );
}
