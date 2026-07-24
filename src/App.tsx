import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {
  Activity,
  AlertTriangle,
  Anchor,
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleGauge,
  Clock,
  CloudSun,
  Compass,
  Download,
  ExternalLink,
  Expand,
  FastForward,
  Gauge,
  GripVertical,
  Info,
  Layers,
  MapPinned,
  Minimize,
  Pause,
  Play,
  PlusCircle,
  RadioTower,
  RefreshCw,
  Route,
  RotateCcw,
  Settings,
  Ship,
  Sparkles,
  ThermometerSun,
  Waves,
  Wind,
  X,
} from 'lucide-react';
import { malaccaScenario, monitoredPorts } from './data/malaccaScenario';
import {
  defaultPortDataConfig,
  loadPortTelemetry,
  type PortDataConfig,
  type PortDataConnectionStatus,
  type PublicEvidenceSummary,
} from './integrations/portDataAdapter';
import {
  cancelRlTrainingJob,
  createRlTrainingJob,
  evaluateRlTrainingJob,
  fetchRlTrainingJob,
  type RlBenchmarkResponse,
  type RlPolicyEvaluationResponse,
  type RlTrainingJobSnapshot,
} from './integrations/rlBenchmarkAdapter';
import {
  submitRlPolicyInference,
  type RlDisturbanceType,
  type RlPolicyInferenceEventContext,
  type RlPolicyInferenceResponse,
} from './integrations/rlPolicyAdapter';
import {
  requestXiaoyiRlAdvice,
  type XiaoyiRlAdvisorResponse,
} from './integrations/xiaoyiRlAdvisorAdapter';
import { XiaoyiSystemAssistant } from './components/XiaoyiSystemAssistant';
import {
  getRlObjectivePreset,
  type RlObjectiveId,
} from '../shared/rlObjectivePresets';
import type {
  AiDecisionRecommendation,
  ChannelRole,
  EmergencyContingencyAssessment,
  EventLogEntry,
  GodotRiskLevel,
  GodotRiskEvent,
  GodotValidationRequest,
  GodotValidationResult,
  GreenSchedulingStrategy,
  GreenStrategyComparison,
  NetworkResilienceAssessment,
  PortCongestionLevel,
  PortCongestionSimulation,
  PortNode,
  RiskAlert,
  RouteOverlay,
  StatusTone,
  StrategyType,
  VesselCategory,
  VesselDelaySimulation,
  VesselEmissionSimulation,
  VesselMarker,
} from './types/sandbox';

const routeClassByRole: Record<ChannelRole, string> = {
  main: 'main',
  secondary: 'secondary',
  'traffic-separation': 'warning',
};

const channelRoleLabelByRole: Record<ChannelRole, string> = {
  main: '主航道',
  secondary: '辅助航道',
  'traffic-separation': '分道通航',
};

const statusColorByTone: Record<StatusTone, string> = {
  ok: '#23e6a8',
  warning: '#ffbd45',
  danger: '#ff4c47',
};

const portDataStatusLabel: Record<PortDataConnectionStatus, string> = {
  demo: '仿真沙盘 · 等待接入港口',
  connecting: '数据同步中',
  public: '公开数据驱动仿真 · 等待接入港口',
  live: '实时港口数据',
  fallback: '等待接入港口 · 仿真回退',
};

const portDataStatusTone: Record<PortDataConnectionStatus, StatusTone> = {
  demo: 'ok',
  connecting: 'warning',
  public: 'warning',
  live: 'ok',
  fallback: 'warning',
};

const GODOT_SIMULATOR_URL = '/godot-simulator/index.html';

const riskLevelLabelByTone: Record<StatusTone, string> = {
  ok: '低',
  warning: '中',
  danger: '高',
};

const godotRiskLevelLabelByLevel: Record<GodotRiskLevel, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '严重风险',
};

const godotRiskToneByLevel: Record<GodotRiskLevel, StatusTone> = {
  low: 'ok',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
};

const heatLevelLabelByTone: Record<StatusTone, string> = {
  ok: '低风险',
  warning: '中风险',
  danger: '高风险',
};

const portCongestionLevelLabel: Record<PortCongestionLevel, string> = {
  low: '低拥堵',
  medium: '中拥堵',
  high: '高拥堵',
  severe: '严重拥堵',
};

const portCongestionStages: Array<{
  key: keyof Pick<
    PortCongestionSimulation,
    | 'arrivingVessels'
    | 'queueingVessels'
    | 'berthingVessels'
    | 'handlingVessels'
    | 'departingVessels'
  >;
  label: string;
}> = [
  { key: 'arrivingVessels', label: '到港' },
  { key: 'queueingVessels', label: '排队' },
  { key: 'berthingVessels', label: '靠泊' },
  { key: 'handlingVessels', label: '装卸' },
  { key: 'departingVessels', label: '离港' },
];

const strategyTypeLabelByType: Record<StrategyType, string> = {
  'slow-steaming': '低速航行',
  'off-peak-arrival': '错峰进港',
  'port-diversion': '分流港口',
  'priority-berthing': '优先靠泊',
  'route-adjustment': '改道绕行',
};

const strategyStatusLabelByStatus: Record<GreenSchedulingStrategy['status'], string> = {
  available: '可用',
  recommended: '推荐',
  standby: '待命',
};

const strategyActionSummaryByType: Record<StrategyType, string> = {
  'slow-steaming': '降低目标船速，压低主机负荷与峰值到港压力',
  'off-peak-arrival': '将到港窗口后移，削平泊位利用率峰值',
  'port-diversion': '把高拥堵目的港船舶转入可承接港口',
  'priority-berthing': '优先释放高时效船舶泊位等待时间',
  'route-adjustment': '绕开高风险航段，降低航道管制延误',
};

const windDirectionDegreesByName: Record<string, number> = {
  北风: 0,
  东北风: 45,
  东风: 90,
  东南风: 135,
  南风: 180,
  西南风: 225,
  西风: 270,
  西北风: 315,
};

const simulationSpeeds = [1, 2, 4];

const advanceMinutesStep = 15;

const simulationRenderStepMinutes = 15;

const defaultRlPolicyRecoveryMinutes = 90;

interface RlPolicyRecoveryRuntimeState {
  status: 'idle' | 'recovering' | 'stabilized';
  advancedMinutes: number;
  targetMinutes: number;
}

const advanceRlPolicyRecovery = (
  recovery: RlPolicyRecoveryRuntimeState,
  minutes: number,
): RlPolicyRecoveryRuntimeState => {
  if (recovery.status === 'idle') return recovery;

  const advancedMinutes = Math.min(
    recovery.targetMinutes,
    recovery.advancedMinutes + Math.max(0, minutes),
  );

  return {
    ...recovery,
    advancedMinutes,
    status: advancedMinutes >= recovery.targetMinutes ? 'stabilized' : 'recovering',
  };
};

interface SandboxEventImpactProfile {
  incidentPressureDelta: number;
  portIds?: string[];
  channelIds?: string[];
  routeIds?: string[];
  portQueueDelta?: number;
  portCongestionDelta?: number;
  portBerthCountDelta?: number;
  portBerthUtilizationDelta?: number;
  portWaitingHoursDelta?: number;
  channelCongestionDelta?: number;
  channelDelayMinutesDelta?: number;
  routeDelayMinutesDelta?: number;
  routeSpeedKnotsDelta?: number;
  vesselSpeedKnotsDelta?: number;
  riskDelayMinutesDelta?: number;
  weather?: {
    windSpeedMsDelta?: number;
    waveHeightMDelta?: number;
    visibilityKmDelta?: number;
    currentSpeedKnotsDelta?: number;
  };
  carbonMultiplierDelta?: number;
  strategyScoreBoostByType?: Partial<Record<StrategyType, number>>;
  summary: string;
}

interface EventInjectionTemplate {
  id: string;
  label: string;
  category: string;
  scopeLabel: string;
  metricPreview: string;
  vesselEffectMode: 'queue' | 'hold' | 'slow' | 'divert' | 'eco';
  vesselEffectLabel: string;
  vesselEffectShortLabel: string;
  message: string;
  tone: StatusTone;
  impact: SandboxEventImpactProfile;
}

const eventInjectionTemplates: EventInjectionTemplate[] = [
  {
    id: 'singapore-berth-closure',
    label: '新加坡泊位关闭',
    category: '港口能力',
    scopeLabel: '新加坡港及 3 条接续航线',
    metricPreview: '拥堵 +14pt · 航道延误 +10分',
    vesselEffectMode: 'queue',
    vesselEffectLabel: '赴新加坡船舶进入排队等泊',
    vesselEffectShortLabel: '等泊',
    message: '事件注入：新加坡港临时关闭 1 个集装箱泊位',
    tone: 'danger',
    impact: {
      incidentPressureDelta: 7,
      portIds: ['singapore'],
      channelIds: ['phillip-channel', 'singapore-east-west'],
      routeIds: ['main-route-north', 'secondary-route-klang-singapore', 'traffic-separation-singapore'],
      portQueueDelta: 18,
      portCongestionDelta: 14,
      portBerthCountDelta: -1,
      portBerthUtilizationDelta: 6,
      portWaitingHoursDelta: 1.1,
      channelCongestionDelta: 8,
      channelDelayMinutesDelta: 10,
      routeDelayMinutesDelta: 14,
      riskDelayMinutesDelta: 8,
      strategyScoreBoostByType: {
        'port-diversion': 16,
        'off-peak-arrival': 11,
        'priority-berthing': 8,
      },
      summary: '新加坡港排队、靠泊等待和接续航道延误同步上升',
    },
  },
  {
    id: 'eastbound-accident-closure',
    label: '东航道事故封航',
    category: '航道事故',
    scopeLabel: '东航道及巴生港东向航线',
    metricPreview: '航道延误 +42分 · 航速 -1.6kn',
    vesselEffectMode: 'hold',
    vesselEffectLabel: '受影响船舶减速等待单向放行',
    vesselEffectShortLabel: '等放',
    message: '事件注入：东航道事故封航并启用单向放行',
    tone: 'danger',
    impact: {
      incidentPressureDelta: 9,
      channelIds: ['eastbound-lane'],
      routeIds: ['secondary-route-klang-singapore'],
      channelCongestionDelta: 24,
      channelDelayMinutesDelta: 42,
      routeDelayMinutesDelta: 48,
      routeSpeedKnotsDelta: -2.2,
      vesselSpeedKnotsDelta: -1.6,
      riskDelayMinutesDelta: 22,
      strategyScoreBoostByType: {
        'route-adjustment': 24,
        'slow-steaming': 9,
      },
      summary: '东航道拥堵和延误被抬升，改道绕行策略权重增加',
    },
  },
  {
    id: 'extreme-weather-control',
    label: '强风浪与低能见度',
    category: '极端气象',
    scopeLabel: '东部与杜迈航道',
    metricPreview: '风速 +5m/s · 浪高 +0.55m · 能见度 -3km',
    vesselEffectMode: 'slow',
    vesselEffectLabel: '受影响船舶降速并扩大安全间距',
    vesselEffectShortLabel: '限速',
    message: '事件注入：东部航道强风浪与低能见度管制',
    tone: 'danger',
    impact: {
      incidentPressureDelta: 6,
      channelIds: ['eastbound-lane', 'dumai-channel'],
      routeIds: ['secondary-route-klang-singapore', 'secondary-route-dumai'],
      channelCongestionDelta: 10,
      channelDelayMinutesDelta: 18,
      routeDelayMinutesDelta: 20,
      routeSpeedKnotsDelta: -1.4,
      vesselSpeedKnotsDelta: -1,
      riskDelayMinutesDelta: 16,
      weather: {
        windSpeedMsDelta: 5,
        waveHeightMDelta: 0.55,
        visibilityKmDelta: -3,
        currentSpeedKnotsDelta: 0.25,
      },
      strategyScoreBoostByType: {
        'slow-steaming': 14,
        'route-adjustment': 12,
      },
      summary: '风速、浪高和低能见度直接抬升天气延误',
    },
  },
  {
    id: 'tanjung-diversion-window',
    label: '丹戎帕拉帕斯分流',
    category: '港口协同',
    scopeLabel: '新加坡港与分道通航区',
    metricPreview: '港口拥堵 -8pt · 等待 -0.7h',
    vesselEffectMode: 'divert',
    vesselEffectLabel: '可分流船舶转向丹戎帕拉帕斯港',
    vesselEffectShortLabel: '分流',
    message: '事件注入：丹戎帕拉帕斯港开放分流窗口',
    tone: 'ok',
    impact: {
      incidentPressureDelta: -4,
      portIds: ['singapore', 'tanjung-pelepas'],
      channelIds: ['singapore-east-west'],
      routeIds: ['traffic-separation-singapore'],
      portQueueDelta: -10,
      portCongestionDelta: -8,
      portWaitingHoursDelta: -0.7,
      channelCongestionDelta: -5,
      channelDelayMinutesDelta: -6,
      routeDelayMinutesDelta: -8,
      riskDelayMinutesDelta: -5,
      strategyScoreBoostByType: {
        'port-diversion': 18,
        'off-peak-arrival': 7,
      },
      summary: '新加坡港压力回落，分流港口策略收益提高',
    },
  },
  {
    id: 'low-carbon-speed-window',
    label: '东向低碳航速窗口',
    category: '绿色调度',
    scopeLabel: '主航道与东向航线',
    metricPreview: '目标航速 -1.4kn · 碳系数 -11%',
    vesselEffectMode: 'eco',
    vesselEffectLabel: '受影响船舶切换低碳航速剖面',
    vesselEffectShortLabel: '低碳',
    message: '事件注入：东向低碳航速窗口开放',
    tone: 'ok',
    impact: {
      incidentPressureDelta: -2,
      channelIds: ['malacca-main', 'eastbound-lane'],
      routeIds: ['main-route-north', 'secondary-route-klang-singapore'],
      routeSpeedKnotsDelta: -1.8,
      vesselSpeedKnotsDelta: -1.4,
      routeDelayMinutesDelta: 5,
      carbonMultiplierDelta: -0.11,
      strategyScoreBoostByType: {
        'slow-steaming': 22,
        'off-peak-arrival': 6,
      },
      summary: '目标航速下调，单船燃油碳排核算按低碳窗口修正',
    },
  },
];

const passiveEventImpactProfile: SandboxEventImpactProfile = {
  incidentPressureDelta: 0,
  summary: '演示记录事件，不额外改写推演参数',
};

const dashboardModules = [
  { id: 'overview', label: '态势总览', icon: Activity },
  { id: 'sandbox', label: '沙盘推演', icon: Play },
  { id: 'resilience', label: '韧性评估', icon: Gauge },
  { id: 'dispatch', label: '调度优化', icon: Route },
  { id: 'emergency', label: '应急预案', icon: AlertTriangle },
] as const;

type DashboardModuleId = (typeof dashboardModules)[number]['id'];

type ValidationSelection =
  | { type: 'vessel'; id: string }
  | { type: 'route'; id: string };

type LinkedDemoCaseId =
  | 'normal-transit'
  | 'port-congestion'
  | 'accident-closure'
  | 'extreme-weather'
  | 'low-carbon-dispatch';

type MapViewMode = 'operations' | 'congestion' | 'carbon' | 'emergency';

type MapOverlayPanelId = 'congestion' | 'delay' | 'carbon' | 'strategy' | 'propagation';

type RouteLayerFilter = 'all' | ChannelRole;

type VesselCategoryFilter = 'all' | VesselCategory;

type GodotSimulatorStatus = 'checking' | 'available' | 'missing';

type SandboxPhaseId =
  | 'event-sensing'
  | 'pressure-spread'
  | 'vessel-dispatch'
  | 'micro-validation'
  | 'metric-feedback';

type SandboxPhaseStatus = 'pending' | 'running' | 'completed';

type RlTrainingStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

type RlAlgorithmId = 'q-learning' | 'sarsa' | 'expected-sarsa' | 'dyna-q' | 'mpc';

type RlPolicyTestStatus = 'locked' | 'idle' | 'running' | 'completed';

type RlTrainingObjectiveId = RlObjectiveId;

type RlPolicyTestCaseId =
  | 'closed-loop-replay'
  | 'peak-congestion-stress'
  | 'weather-disturbance-generalization';

type RlTrainingBaselineId =
  | 'q-learning'
  | 'sarsa'
  | 'expected-sarsa'
  | 'dyna-q'
  | 'mpc';

type RlBackendMode = 'http' | 'websocket' | 'ray-service';

type RlBackendStatus = 'disconnected' | 'checking' | 'connected' | 'failed';

type RlTrainingSettingId =
  | 'network-snapshot'
  | 'vessel-state'
  | 'event-disturbance'
  | 'weather-sea-state'
  | 'congestion-delay'
  | 'carbon-reward'
  | 'dispatch-action'
  | 'micro-validation';

type RlTrainingStageId =
  | 'snapshot-build'
  | 'reward-assembly'
  | 'baseline-warmup'
  | 'policy-rollout'
  | 'evaluation'
  | 'interface-package';

type RlTrainingCardId =
  | 'algorithm'
  | 'baselines'
  | 'settings'
  | 'parameters'
  | 'backend'
  | 'progress'
  | 'metrics'
  | 'curves'
  | 'policy-test'
  | 'contract';

interface RlTrainingWindowState {
  isOpen: boolean;
  isMinimized: boolean;
  isCollapsed: boolean;
  compactCardIds: RlTrainingCardId[];
  collapsedCardIds: RlTrainingCardId[];
  closedCardIds: RlTrainingCardId[];
}

interface SandboxPhaseState {
  id: SandboxPhaseId;
  status: SandboxPhaseStatus;
  startedAt: string;
  startedMinute: number;
  completedAt?: string;
  completedMinute?: number;
  summary: string;
}

interface RlTrainingBaseline {
  id: RlTrainingBaselineId;
  label: string;
  shortLabel: string;
  family: string;
  detail: string;
  interfaceKey: string;
  tone: StatusTone;
}

interface RlAlgorithmOption {
  id: RlAlgorithmId;
  label: string;
  shortLabel: string;
  family: string;
  detail: string;
  backendHint: string;
  defaultBackendMode: RlBackendMode;
  tone: StatusTone;
}

interface RlTrainingStage {
  id: RlTrainingStageId;
  label: string;
  rangeStart: number;
  rangeEnd: number;
  detail: string;
  output: string;
  tone: StatusTone;
}

interface RlTrainingObjectiveOption {
  id: RlTrainingObjectiveId;
  label: string;
  shortLabel: string;
  detail: string;
  rewardFocus: string;
  tone: StatusTone;
}

interface RlPolicyTestCase {
  id: RlPolicyTestCaseId;
  label: string;
  shortLabel: string;
  detail: string;
  tone: StatusTone;
}

interface RlPolicyTestRuntimeState {
  status: RlPolicyTestStatus;
  selectedCaseId: RlPolicyTestCaseId;
  progressPercent: number;
  startedAt: string | null;
  completedAt: string | null;
  logCursor: number;
}

interface RlTrainingSettingItem {
  id: RlTrainingSettingId;
  label: string;
  value: string;
  detail: string;
  tone: StatusTone;
}

interface RlTrainingParameterState {
  learningRate: number;
  discountGamma: number;
  tuningTrials: number;
  maxEpisodes: number;
  wallClockHours: number;
  seed: number;
  rewardDelay: number;
  rewardCongestion: number;
  rewardCarbon: number;
  rewardSafety: number;
  rewardResilience: number;
  rewardThroughput: number;
}

type RlTrainingParameterKey = keyof RlTrainingParameterState;

type RlBackendEditableField = 'endpoint' | 'websocketUrl' | 'projectName' | 'authToken';

interface RlBackendIntegrationState {
  mode: RlBackendMode;
  endpoint: string;
  websocketUrl: string;
  projectName: string;
  authToken: string;
  status: RlBackendStatus;
  lastMessage: string;
}

interface RlTrainingRequestContract {
  protocolVersion: string;
  adapter: 'local-job-api' | 'http-json' | 'websocket-json' | 'ray-job-api';
  endpoint: string;
  algorithmId: RlAlgorithmId;
  baselineId: RlTrainingBaselineId;
  objectiveId: RlTrainingObjectiveId;
  objectiveLabel: string;
  selectedSettingId: RlTrainingSettingId;
  createdAt: string;
  backend: {
    mode: RlBackendMode;
    endpoint: string;
    websocketUrl: string;
    projectName: string;
    status: RlBackendStatus;
  };
  trainingParameters: RlTrainingParameterState;
  scenarioSnapshot: {
    scenarioId: string;
    ports: number;
    channels: number;
    vessels: number;
    injectedEvents: number;
    peakCongestionPercent: number;
    carbonTons: number;
    networkResilienceIndex: number;
  };
  observationSpace: string[];
  actionSpace: string[];
  rewardWeights: {
    delay: number;
    congestion: number;
    carbon: number;
    safety: number;
    resilience: number;
    throughput: number;
  };
}

interface RlTrainingRuntimeState {
  status: RlTrainingStatus;
  selectedAlgorithmId: RlAlgorithmId;
  selectedBaselineId: RlTrainingBaselineId;
  selectedObjectiveId: RlTrainingObjectiveId;
  activeSettingId: RlTrainingSettingId;
  parameters: RlTrainingParameterState;
  backend: RlBackendIntegrationState;
  progressPercent: number;
  currentStageId: RlTrainingStageId;
  startedAt: string | null;
  startedAtEpochMs: number | null;
  plannedDurationSeconds: number;
  completedAt: string | null;
  episodeCursor: number;
  jobId: string | null;
  trainingRequest: RlTrainingRequestContract | null;
  policyTest: RlPolicyTestRuntimeState;
}

interface SandboxPhasePatch extends Partial<Omit<SandboxPhaseState, 'id'>> {
  id: SandboxPhaseId;
}

interface SimulationRenderStep {
  id: SandboxPhaseId;
  label: string;
  shortLabel: string;
  detail: string;
  value: string;
  unit: string;
  tone: StatusTone;
  x: number;
  y: number;
  status: SandboxPhaseStatus;
  startedAt: string;
  startedMinute: number;
  completedAt?: string;
  completedMinute?: number;
  summary: string;
}

interface ImpactPropagationNode {
  id: string;
  label: string;
  x: number;
  y: number;
  pressureScore: number;
  queueVessels: number;
  recoveryHours: number;
  affectedRouteCount: number;
  intensity: number;
  radius: number;
  tone: StatusTone;
}

interface ImpactPropagationLink {
  id: string;
  label: string;
  svgPath: string;
  pressureScore: number;
  delayMinutes: number;
  vesselVolume: number;
  tone: StatusTone;
  animationDelaySeconds: number;
}

interface StrategyFlowVector {
  id: string;
  label: string;
  target: string;
  metric: string;
  svgPath: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  tone: StatusTone;
  score: number;
  animationDelaySeconds: number;
}

const sandboxPhaseDefinitions: Record<
  SandboxPhaseId,
  { label: string; shortLabel: string; initialSummary: string }
> = {
  'event-sensing': {
    label: '事件感知',
    shortLabel: '感知',
    initialSummary: '港口、航道、气象与 AIS 信号持续扫描',
  },
  'pressure-spread': {
    label: '影响传播',
    shortLabel: '传播',
    initialSummary: '等待事件感知输出，准备计算拥堵、延误和风险扩散',
  },
  'vessel-dispatch': {
    label: '船舶调度',
    shortLabel: '调度',
    initialSummary: '等待影响传播结果，准备重算航速和调度策略',
  },
  'micro-validation': {
    label: '微观验证',
    shortLabel: '验证',
    initialSummary: '等待调度方案封装为单船验证信息流',
  },
  'metric-feedback': {
    label: '指标回写',
    shortLabel: '回写',
    initialSummary: '等待微观验证结果回写韧性、拥堵和碳排指标',
  },
};

const sandboxPhaseStatusLabel: Record<SandboxPhaseStatus, string> = {
  pending: '待执行',
  running: '执行中',
  completed: '已完成',
};

const rlTrainingStatusLabel: Record<RlTrainingStatus, string> = {
  idle: '训练待命',
  queued: '任务排队',
  running: '训练中',
  completed: '训练完成',
  failed: '训练失败',
  cancelled: '训练已取消',
};

const rlPolicyTestStatusLabel: Record<RlPolicyTestStatus, string> = {
  locked: '等待训练完成',
  idle: '测试待命',
  running: '测试中',
  completed: '测试完成',
};

const rlBackendModeLabel: Record<RlBackendMode, string> = {
  http: 'HTTP 服务',
  websocket: 'WebSocket',
  'ray-service': 'Ray/RLlib',
};

const rlBackendStatusLabel: Record<RlBackendStatus, string> = {
  disconnected: '未连接',
  checking: '检测中',
  connected: '已连接',
  failed: '接入失败',
};

const rlBackendStatusTone: Record<RlBackendStatus, StatusTone> = {
  disconnected: 'warning',
  checking: 'warning',
  connected: 'ok',
  failed: 'danger',
};

const rlBackendModeDefaults: Record<
  RlBackendMode,
  {
    endpoint: string;
    websocketUrl: string;
  }
> = {
  http: {
    endpoint: '/api/rl/jobs',
    websocketUrl: 'ws://127.0.0.1:8765/ws/rl-training',
  },
  websocket: {
    endpoint: 'http://127.0.0.1:8090/api/sandbox/rl-training/start',
    websocketUrl: 'ws://127.0.0.1:8765/ws/rl-training',
  },
  'ray-service': {
    endpoint: 'http://127.0.0.1:8265/api/jobs/rl-sandbox-training',
    websocketUrl: 'ws://127.0.0.1:8765/ws/rl-training',
  },
};

const rlAlgorithmOptions: RlAlgorithmOption[] = [
  {
    id: 'q-learning',
    label: 'Q-Learning 离策略控制',
    shortLabel: 'Q-Learn',
    family: '强化学习 / 离策略值函数',
    detail: '使用贝尔曼最优目标执行真实价值表更新，适合作为可解释、可复现的离策略基线。',
    backendHint: '内置 TypeScript 训练器；检查点保存 Q 表与数据指纹',
    defaultBackendMode: 'http',
    tone: 'ok',
  },
  {
    id: 'sarsa',
    label: 'SARSA 在策略控制',
    shortLabel: 'SARSA',
    family: '强化学习 / 在策略值函数',
    detail: '按实际探索动作更新价值，适合比较风险扰动下更保守的在策略控制。',
    backendHint: '与其他算法共享训练切分、状态动作空间和随机种子族',
    defaultBackendMode: 'http',
    tone: 'warning',
  },
  {
    id: 'expected-sarsa',
    label: 'Expected SARSA 期望更新',
    shortLabel: 'Exp-SARSA',
    family: '强化学习 / 期望值函数',
    detail: '使用探索策略下全部动作的期望价值更新，降低下一动作抽样方差。',
    backendHint: '每次参数更新均由真实训练 episode 产生',
    defaultBackendMode: 'http',
    tone: 'ok',
  },
  {
    id: 'dyna-q',
    label: 'Dyna-Q 规划增强控制',
    shortLabel: 'Dyna-Q',
    family: '强化学习 / 学习与规划',
    detail: '在真实交互更新之外从已学习环境模型回放，提高公开小数据集下的样本效率。',
    backendHint: '模型转移与规划更新次数写入真实训练遥测',
    defaultBackendMode: 'http',
    tone: 'warning',
  },
  {
    id: 'mpc',
    label: '模型预测控制基线',
    shortLabel: 'MPC',
    family: '控制理论 / 滚动时域优化',
    detail: '用训练段辨识到港需求模型，并在每个时刻枚举有限预测时域控制序列，作为非 RL 对照。',
    backendHint: 'MPC 不伪装成强化学习，不产生 episode 参数更新',
    defaultBackendMode: 'http',
    tone: 'danger',
  },
];

const rlTrainingObjectives: RlTrainingObjectiveOption[] = [
  {
    id: 'balanced-resilience',
    label: '韧性均衡优化',
    shortLabel: '均衡韧性',
    detail: '在延误、拥堵、碳排、安全和恢复能力之间保持综合最优，适合默认演示场景。',
    rewardFocus: 'delay + congestion + carbon + safety + resilience',
    tone: 'ok',
  },
  {
    id: 'min-delay',
    label: '最小化平均延误',
    shortLabel: '最小延误',
    detail: '优先降低船舶等待、航道排队和到港窗口偏移，突出时效性提升。',
    rewardFocus: 'delay_weight ↑ / queue_penalty ↑',
    tone: 'ok',
  },
  {
    id: 'min-carbon',
    label: '最小化碳排放',
    shortLabel: '低碳优先',
    detail: '强化低速航行、错峰进港和燃油消耗控制，适合绿色航运展示。',
    rewardFocus: 'carbon_weight ↑ / speed_smoothing ↑',
    tone: 'ok',
  },
  {
    id: 'max-throughput',
    label: '最大化港口吞吐',
    shortLabel: '吞吐优先',
    detail: '提高泊位、锚地、航道和多港联动利用率，强调单位时间过境能力。',
    rewardFocus: 'throughput_reward ↑ / idle_berth_penalty ↑',
    tone: 'warning',
  },
  {
    id: 'port-congestion-relief',
    label: '港口拥堵削峰',
    shortLabel: '拥堵削峰',
    detail: '针对新加坡港、巴生港等高压节点削峰填谷，抑制拥堵扩散。',
    rewardFocus: 'peak_congestion_penalty ↑ / diversion_reward ↑',
    tone: 'warning',
  },
  {
    id: 'fair-queueing',
    label: '公平排队与服务均衡',
    shortLabel: '公平排队',
    detail: '避免单类船舶或单一港口长期等待，平衡货船、油轮、集装箱船服务水平。',
    rewardFocus: 'fairness_index ↑ / starvation_penalty ↑',
    tone: 'ok',
  },
  {
    id: 'safety-first',
    label: '安全优先避险',
    shortLabel: '安全优先',
    detail: '把 CPA 安全距离、风浪管制、事故封航和高风险航段避让放在首位。',
    rewardFocus: 'safety_constraint ↑ / risk_penalty ↑',
    tone: 'danger',
  },
  {
    id: 'rapid-recovery',
    label: '突发事件快速恢复',
    shortLabel: '快速恢复',
    detail: '面向封航、港口拥堵、极端天气后的网络恢复时间最小化。',
    rewardFocus: 'recovery_time ↓ / resilience_reward ↑',
    tone: 'danger',
  },
  {
    id: 'energy-cost-control',
    label: '燃油成本控制',
    shortLabel: '燃油成本',
    detail: '兼顾低碳与燃油费用，适合展示经济性与绿色性双目标优化。',
    rewardFocus: 'fuel_cost ↓ / carbon_price_penalty ↓',
    tone: 'warning',
  },
  {
    id: 'weather-robustness',
    label: '气象扰动鲁棒性',
    shortLabel: '天气鲁棒',
    detail: '强化低能见度、强风浪和流速变化下的稳定策略表现。',
    rewardFocus: 'weather_generalization ↑ / variance_penalty ↓',
    tone: 'danger',
  },
  {
    id: 'multi-port-coordination',
    label: '多港协同分流',
    shortLabel: '多港协同',
    detail: '联合新加坡、巴生、丹戎帕拉帕斯、巴淡岛等节点做跨港分流。',
    rewardFocus: 'multi_port_balance ↑ / transfer_cost ↓',
    tone: 'ok',
  },
];

const rlPolicyTestCases: RlPolicyTestCase[] = [
  {
    id: 'closed-loop-replay',
    label: '闭环回放测试',
    shortLabel: '闭环',
    detail: '用训练后策略重放当前马六甲沙盘快照，输出单步动作、奖励、指标回写和 A/B baseline 差异。',
    tone: 'ok',
  },
  {
    id: 'peak-congestion-stress',
    label: '峰值拥堵压力测试',
    shortLabel: '压力',
    detail: '把新加坡港与东航道流量推到峰值，检查策略在高拥堵、高延误条件下的恢复能力。',
    tone: 'warning',
  },
  {
    id: 'weather-disturbance-generalization',
    label: '天气扰动泛化测试',
    shortLabel: '泛化',
    detail: '注入强风浪、低能见度和航速限制，展示策略对未见扰动场景的泛化表现。',
    tone: 'danger',
  },
];

const rlTrainingBaselines: RlTrainingBaseline[] = [
  {
    id: 'q-learning',
    label: 'Q-Learning 离策略基线',
    shortLabel: 'Q-Learn',
    family: '值函数 / Off-policy',
    detail: '使用最大下一状态动作价值更新，作为离策略控制的标准可复现基线。',
    interfaceKey: 'baseline.q_learning.v1',
    tone: 'ok',
  },
  {
    id: 'sarsa',
    label: 'SARSA 在策略基线',
    shortLabel: 'SARSA',
    family: '值函数 / On-policy',
    detail: '使用实际下一动作更新，体现探索策略在风险扰动下的保守控制表现。',
    interfaceKey: 'baseline.sarsa.v1',
    tone: 'warning',
  },
  {
    id: 'expected-sarsa',
    label: 'Expected SARSA 基线',
    shortLabel: 'Exp-SARSA',
    family: '期望值更新',
    detail: '对下一状态全部动作求策略期望，降低单次采样带来的训练方差。',
    interfaceKey: 'baseline.expected_sarsa.v1',
    tone: 'ok',
  },
  {
    id: 'dyna-q',
    label: 'Dyna-Q 规划增强基线',
    shortLabel: 'Dyna-Q',
    family: '模型学习 + 规划',
    detail: '在真实交互更新之外执行模型回放规划，提高扰动场景的样本效率。',
    interfaceKey: 'baseline.dyna_q.v1',
    tone: 'danger',
  },
  {
    id: 'mpc',
    label: '模型预测控制基线',
    shortLabel: 'MPC',
    family: '控制理论 / Receding Horizon',
    detail: '基于训练段做需求模型辨识，并以三步预测时域滚动求解控制动作。',
    interfaceKey: 'baseline.mpc.v1',
    tone: 'danger',
  },
];

const rlOptimizationParameterControls: Array<{
  key: RlTrainingParameterKey;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}> = [
  {
    key: 'learningRate',
    label: '价值更新步长',
    min: 0.01,
    max: 0.5,
    step: 0.01,
    unit: '',
  },
  {
    key: 'discountGamma',
    label: '折扣 gamma',
    min: 0.7,
    max: 0.999,
    step: 0.001,
    unit: '',
  },
  {
    key: 'tuningTrials',
    label: '验证集调参候选',
    min: 1,
    max: 5,
    step: 1,
    unit: '组',
  },
];

const rlRolloutParameterControls: Array<{
  key: RlTrainingParameterKey;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}> = [
  {
    key: 'maxEpisodes',
    label: '每种RL算法 Episode',
    min: 120,
    max: 5000,
    step: 40,
    unit: '',
  },
  {
    key: 'wallClockHours',
    label: '任务超时上限',
    min: 0.05,
    max: 24,
    step: 0.05,
    unit: 'h',
  },
  {
    key: 'seed',
    label: '随机种子',
    min: 1,
    max: 99999,
    step: 1,
    unit: '',
  },
];

const rlRewardParameterControls: Array<{
  key: RlTrainingParameterKey;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}> = [
  {
    key: 'rewardDelay',
    label: '延误权重',
    min: 0,
    max: 1,
    step: 0.01,
    unit: '',
  },
  {
    key: 'rewardCongestion',
    label: '拥堵权重',
    min: 0,
    max: 1,
    step: 0.01,
    unit: '',
  },
  {
    key: 'rewardCarbon',
    label: '碳排权重',
    min: 0,
    max: 1,
    step: 0.01,
    unit: '',
  },
  {
    key: 'rewardSafety',
    label: '安全权重',
    min: 0,
    max: 1,
    step: 0.01,
    unit: '',
  },
  {
    key: 'rewardResilience',
    label: '韧性权重',
    min: 0,
    max: 1,
    step: 0.01,
    unit: '',
  },
  {
    key: 'rewardThroughput',
    label: '吞吐服务权重',
    min: 0,
    max: 1,
    step: 0.01,
    unit: '',
  },
];

const rlTrainingStages: RlTrainingStage[] = [
  {
    id: 'snapshot-build',
    label: '训练集校验与切分',
    rangeStart: 0,
    rangeEnd: 8,
    detail: '校验港口字段、重复时间戳和时间顺序，按时间执行训练/验证/最终测试切分并计算数据指纹。',
    output: 'dataset_manifest.json',
    tone: 'ok',
  },
  {
    id: 'reward-assembly',
    label: '环境与奖励装配',
    rangeStart: 8,
    rangeEnd: 18,
    detail: '从训练记录构造排队、递延积压、延误、吞吐、碳强度与气象风险状态；错峰和分流不会让需求凭空消失。',
    output: 'reward_config.yaml',
    tone: 'warning',
  },
  {
    id: 'baseline-warmup',
    label: '四种 RL 参数更新',
    rangeStart: 18,
    rangeEnd: 72,
    detail: '四种 RL 只读取训练段更新价值函数，并在验证前段比较超参数候选。',
    output: 'q_tables',
    tone: 'ok',
  },
  {
    id: 'policy-rollout',
    label: 'MPC 模型辨识',
    rangeStart: 72,
    rangeEnd: 82,
    detail: '用同一训练段辨识需求偏差，再建立三步滚动时域优化的控制理论基线。',
    output: 'mpc_model',
    tone: 'ok',
  },
  {
    id: 'evaluation',
    label: '验证集选优',
    rangeStart: 82,
    rangeEnd: 96,
    detail: '只在验证段比较五种算法并选择最优；最终测试段此阶段保持封存，不生成沙盘回放。',
    output: 'evaluation_metrics',
    tone: 'warning',
  },
  {
    id: 'interface-package',
    label: '接口封装',
    rangeStart: 96,
    rangeEnd: 100,
    detail: '保存策略参数、训练配置、数据指纹和评估摘要，供后续推理与回放使用。',
    output: 'checkpoint.json',
    tone: 'ok',
  },
];

const createInitialRlTrainingParameters = (): RlTrainingParameterState => ({
  learningRate: 0.12,
  discountGamma: 0.97,
  tuningTrials: 3,
  maxEpisodes: 600,
  wallClockHours: 1,
  seed: 240520,
  rewardDelay: getRlObjectivePreset('balanced-resilience').weights.delay,
  rewardCongestion: getRlObjectivePreset('balanced-resilience').weights.congestion,
  rewardCarbon: getRlObjectivePreset('balanced-resilience').weights.carbon,
  rewardSafety: getRlObjectivePreset('balanced-resilience').weights.safety,
  rewardResilience: getRlObjectivePreset('balanced-resilience').weights.resilience,
  rewardThroughput: getRlObjectivePreset('balanced-resilience').weights.throughput,
});

const createInitialRlBackendIntegrationState = (): RlBackendIntegrationState => ({
  mode: 'http',
  endpoint: rlBackendModeDefaults.http.endpoint,
  websocketUrl: rlBackendModeDefaults.http.websocketUrl,
  projectName: 'malacca-strait-sandbox',
  authToken: '',
  status: 'disconnected',
  lastMessage: '本机异步训练服务已预置；点击“测试接入”验证四种RL与MPC任务接口。',
});

const createInitialRlPolicyTestState = (): RlPolicyTestRuntimeState => ({
  status: 'locked',
  selectedCaseId: 'closed-loop-replay',
  progressPercent: 0,
  startedAt: null,
  completedAt: null,
  logCursor: 0,
});

const createInitialRlTrainingState = (): RlTrainingRuntimeState => ({
  status: 'idle',
  selectedAlgorithmId: 'q-learning',
  selectedBaselineId: 'q-learning',
  selectedObjectiveId: 'balanced-resilience',
  activeSettingId: 'network-snapshot',
  parameters: createInitialRlTrainingParameters(),
  backend: createInitialRlBackendIntegrationState(),
  progressPercent: 0,
  currentStageId: 'snapshot-build',
  startedAt: null,
  startedAtEpochMs: null,
  plannedDurationSeconds: 60 * 60,
  completedAt: null,
  episodeCursor: 0,
  jobId: null,
  trainingRequest: null,
  policyTest: createInitialRlPolicyTestState(),
});

const createInitialRlTrainingWindowState = (): RlTrainingWindowState => ({
  isOpen: false,
  isMinimized: false,
  isCollapsed: false,
  compactCardIds: [],
  collapsedCardIds: [],
  closedCardIds: [],
});

const getRlTrainingStageByProgress = (progressPercent: number) =>
  rlTrainingStages.find(
    (stage) => progressPercent >= stage.rangeStart && progressPercent < stage.rangeEnd,
  ) ?? rlTrainingStages[rlTrainingStages.length - 1];

const RL_TRAINING_STORAGE_KEY = 'malacca.rl-training.runtime.v3';
const RL_BENCHMARK_STORAGE_KEY = 'malacca.rl-training.benchmark.v3';

const restoreRlTrainingState = (): RlTrainingRuntimeState => {
  const initial = createInitialRlTrainingState();
  if (typeof window === 'undefined') return initial;
  try {
    const raw = window.localStorage.getItem(RL_TRAINING_STORAGE_KEY);
    if (!raw) return initial;
    const saved = JSON.parse(raw) as Partial<RlTrainingRuntimeState>;
    const selectedObjectiveId = rlTrainingObjectives.some(
      (objective) => objective.id === saved.selectedObjectiveId,
    )
      ? saved.selectedObjectiveId as RlTrainingObjectiveId
      : initial.selectedObjectiveId;
    const savedWallClockHours = saved.parameters?.wallClockHours;
    const parameters = {
      ...initial.parameters,
      ...saved.parameters,
      wallClockHours: savedWallClockHours === 3.25
        ? initial.parameters.wallClockHours
        : savedWallClockHours ?? initial.parameters.wallClockHours,
    };
    const savedBackendMode = saved.backend?.mode;
    const backendMode: RlBackendMode = savedBackendMode === 'http' || savedBackendMode === 'websocket' || savedBackendMode === 'ray-service'
      ? savedBackendMode
      : 'http';
    return {
      ...initial,
      ...saved,
      status: saved.jobId && ['queued', 'running', 'completed'].includes(saved.status ?? '')
        ? saved.status as RlTrainingRuntimeState['status']
        : 'idle',
      selectedObjectiveId,
      parameters,
      backend: {
        ...initial.backend,
        ...saved.backend,
        mode: backendMode,
        authToken: '',
      },
      progressPercent: saved.progressPercent ?? 0,
      currentStageId: saved.currentStageId ?? 'snapshot-build',
      startedAt: saved.startedAt ?? null,
      startedAtEpochMs: saved.startedAtEpochMs ?? null,
      plannedDurationSeconds: parameters.wallClockHours * 60 * 60,
      completedAt: saved.completedAt ?? null,
      episodeCursor: saved.episodeCursor ?? 0,
      jobId: saved.jobId ?? null,
      trainingRequest: saved.trainingRequest ?? null,
      policyTest: createInitialRlPolicyTestState(),
    };
  } catch {
    return initial;
  }
};

const restoreRlBenchmark = (): RlBenchmarkResponse | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(RL_BENCHMARK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RlBenchmarkResponse>;
    return parsed.protocolVersion === 'rl-benchmark.v2' && Array.isArray(parsed.results)
      ? (parsed as RlBenchmarkResponse)
      : null;
  } catch {
    return null;
  }
};

const pendingPhaseStartLabel = '待启动';

const createInitialSandboxPhases = (): SandboxPhaseState[] =>
  Object.entries(sandboxPhaseDefinitions).map(([id, definition], index) => ({
    id: id as SandboxPhaseId,
    status: index === 0 ? 'running' : 'pending',
    startedAt: index === 0 ? malaccaScenario.currentTime : pendingPhaseStartLabel,
    startedMinute: 0,
    summary: definition.initialSummary,
  }));

const patchSandboxPhases = (
  phases: SandboxPhaseState[],
  patches: SandboxPhasePatch[],
): SandboxPhaseState[] => {
  const patchById = new Map<SandboxPhaseId, SandboxPhasePatch>(
    patches.map((patch) => [patch.id, patch]),
  );

  return phases.map((phase) => {
    const patch = patchById.get(phase.id);

    return patch ? { ...phase, ...patch } : phase;
  });
};

interface ValidationFeedItem {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: StatusTone;
}

interface InspectorMetric {
  label: string;
  value: string;
  unit?: string;
  tone?: StatusTone;
}

interface InspectorAction {
  label: string;
  module: DashboardModuleId;
}

interface InspectorPanel {
  id: string;
  title: string;
  subtitle: string;
  body: string;
  tone: StatusTone;
  metrics: InspectorMetric[];
  action?: InspectorAction;
}

interface ContextInspectorWindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isCollapsed: boolean;
}

interface LinkedDemoCaseDefinition {
  id: LinkedDemoCaseId;
  label: string;
  shortLabel: string;
  description: string;
  tone: StatusTone;
  vesselId: string;
  routeId: string;
  targetSpeedKnots: number;
  dispatchStrategyIds: string[];
  riskEvents: GodotRiskEvent[];
  result: Omit<GodotValidationResult, 'requestId' | 'vesselId'>;
}

interface SandboxCapabilityItem {
  id: string;
  label: string;
  value: string;
  tone: StatusTone;
  detail: string;
}

interface SandboxRuntimeState {
  isSimulationRunning: boolean;
  simulationSpeed: number;
  elapsedMinutes: number;
  injectedEvents: RuntimeInjectedEvent[];
  injectionCursor: number;
  activeDemoCaseId: LinkedDemoCaseId | null;
  generatedGodotRequest: GodotValidationRequest | null;
  importedGodotResult: GodotValidationResult | null;
  phases: SandboxPhaseState[];
  rlTraining: RlTrainingRuntimeState;
  policyRecovery: RlPolicyRecoveryRuntimeState;
}

interface RuntimeInjectedEvent extends EventLogEntry {
  templateId: string;
  impact: SandboxEventImpactProfile;
}

const createInitialSandboxRuntime = (): SandboxRuntimeState => ({
  isSimulationRunning: false,
  simulationSpeed: 1,
  elapsedMinutes: 0,
  injectedEvents: [],
  injectionCursor: 0,
  activeDemoCaseId: null,
  generatedGodotRequest: null,
  importedGodotResult: null,
  phases: createInitialSandboxPhases(),
  rlTraining: restoreRlTrainingState(),
  policyRecovery: {
    status: 'idle',
    advancedMinutes: 0,
    targetMinutes: defaultRlPolicyRecoveryMinutes,
  },
});

const contextInspectorDefaultSize = {
  width: 540,
  height: 315,
};

const getCenteredContextInspectorWindowState = (): ContextInspectorWindowState => {
  const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight;
  const width = contextInspectorDefaultSize.width;
  const height = contextInspectorDefaultSize.height;

  return {
    x: Math.max(18, Math.round((viewportWidth - width) / 2)),
    y: Math.max(82, Math.round((viewportHeight - height) / 2)),
    width,
    height,
    isCollapsed: false,
  };
};

const linkedDemoCases: LinkedDemoCaseDefinition[] = [
  {
    id: 'normal-transit',
    label: '正常通航',
    shortLabel: '正常',
    description: '主航道船舶保持推荐航速通过，Godot 验证为低风险安全通过。',
    tone: 'ok',
    vesselId: 'vessel-001',
    routeId: 'main-route-north',
    targetSpeedKnots: 14.2,
    dispatchStrategyIds: ['slow-steaming-eastbound'],
    riskEvents: [],
    result: {
      status: 'passed',
      safePass: true,
      estimatedTravelMinutes: 48,
      riskLevel: 'low',
      recommendedSpeedKnots: 14.1,
      simulatedDurationSeconds: 2,
      reachedDestination: false,
      averageSpeedKnots: 13.9,
      minClearanceMeters: 74.6,
      collisionCount: 0,
      groundingCount: 0,
      riskEventResolvedCount: 0,
      delayDeltaMinutes: -3,
      carbonDeltaTons: -0.2,
      loadedScene: { routePointCount: 2, riskZoneCount: 0, temporaryObstacleCount: 0 },
      summary: '正常通航演示：主航道安全间距充足，建议保持 14.1kn 稳定通过。',
    },
  },
  {
    id: 'port-congestion',
    label: '港口拥堵',
    shortLabel: '拥堵',
    description: '新加坡港拥堵导致靠泊窗口收缩，验证建议降速并错峰到港。',
    tone: 'warning',
    vesselId: 'vessel-005',
    routeId: 'secondary-route-klang-singapore',
    targetSpeedKnots: 10.8,
    dispatchStrategyIds: ['divert-to-tanjung-pelepas', 'off-peak-klang-arrival'],
    riskEvents: [
      {
        id: 'demo-port-congestion-singapore',
        type: 'port-paralysis',
        label: '新加坡港靠泊拥堵',
        affectedArea: '新加坡港外锚地',
        severity: 'warning',
        startMinute: 0,
        expectedDurationMinutes: 150,
        recommendedAction: '降低航速并等待错峰靠泊窗口',
      },
    ],
    result: {
      status: 'degraded',
      safePass: false,
      estimatedTravelMinutes: 94,
      riskLevel: 'medium',
      recommendedSpeedKnots: 10.2,
      simulatedDurationSeconds: 2,
      reachedDestination: false,
      averageSpeedKnots: 9.8,
      minClearanceMeters: 28.4,
      collisionCount: 0,
      groundingCount: 0,
      riskEventResolvedCount: 1,
      delayDeltaMinutes: 18,
      carbonDeltaTons: -1.1,
      loadedScene: { routePointCount: 2, riskZoneCount: 1, temporaryObstacleCount: 1 },
      summary: '港口拥堵演示：可安全等待，但靠泊延误偏高，建议错峰或分流。',
    },
  },
  {
    id: 'accident-closure',
    label: '事故封航',
    shortLabel: '封航',
    description: '东航道事故封航生成阻断障碍，验证建议限速等待并执行绕航。',
    tone: 'danger',
    vesselId: 'vessel-004',
    routeId: 'secondary-route-klang-singapore',
    targetSpeedKnots: 8.4,
    dispatchStrategyIds: ['reroute-east-dumai-risk', 'slow-steaming-eastbound'],
    riskEvents: [
      {
        id: 'demo-accident-eastbound-closure',
        type: 'channel-closure',
        label: '东航道事故封航',
        affectedArea: '巴生港至新加坡东向航线中段',
        severity: 'danger',
        startMinute: 0,
        expectedDurationMinutes: 180,
        recommendedAction: '切换绕行航段并等待海巡放行窗口',
      },
    ],
    result: {
      status: 'failed',
      safePass: false,
      estimatedTravelMinutes: 138,
      riskLevel: 'critical',
      recommendedSpeedKnots: 7.8,
      simulatedDurationSeconds: 2,
      reachedDestination: false,
      averageSpeedKnots: 7.2,
      minClearanceMeters: 9.6,
      collisionCount: 1,
      groundingCount: 0,
      riskEventResolvedCount: 0,
      delayDeltaMinutes: 48,
      carbonDeltaTons: -1.8,
      loadedScene: { routePointCount: 2, riskZoneCount: 1, temporaryObstacleCount: 1 },
      summary: '事故封航演示：原航段不可安全通过，必须执行改道绕行。',
    },
  },
  {
    id: 'extreme-weather',
    label: '极端天气',
    shortLabel: '天气',
    description: '强风浪与低能见度压缩水域安全窗口，验证建议低速编队通过。',
    tone: 'danger',
    vesselId: 'vessel-006',
    routeId: 'secondary-route-dumai',
    targetSpeedKnots: 8.8,
    dispatchStrategyIds: ['slow-steaming-eastbound', 'reroute-east-dumai-risk'],
    riskEvents: [
      {
        id: 'demo-extreme-weather-east',
        type: 'extreme-weather',
        label: '强对流与低能见度',
        affectedArea: '杜迈支线接入海域',
        severity: 'danger',
        startMinute: 0,
        expectedDurationMinutes: 210,
        recommendedAction: '降低目标航速并扩大横向安全距离',
      },
    ],
    result: {
      status: 'degraded',
      safePass: false,
      estimatedTravelMinutes: 118,
      riskLevel: 'high',
      recommendedSpeedKnots: 8.6,
      simulatedDurationSeconds: 2,
      reachedDestination: false,
      averageSpeedKnots: 8.1,
      minClearanceMeters: 21.3,
      collisionCount: 0,
      groundingCount: 0,
      riskEventResolvedCount: 1,
      delayDeltaMinutes: 34,
      carbonDeltaTons: -1.4,
      loadedScene: { routePointCount: 2, riskZoneCount: 1, temporaryObstacleCount: 1 },
      summary: '极端天气演示：无碰撞但安全裕度偏低，建议低速编队通过。',
    },
  },
  {
    id: 'low-carbon-dispatch',
    label: '低碳调度优化',
    shortLabel: '低碳',
    description: '低速航行与错峰到港联动，验证得到减排收益并保持安全通过。',
    tone: 'ok',
    vesselId: 'vessel-002',
    routeId: 'main-route-north',
    targetSpeedKnots: 10.6,
    dispatchStrategyIds: ['slow-steaming-eastbound', 'off-peak-klang-arrival'],
    riskEvents: [
      {
        id: 'demo-low-carbon-window',
        type: 'energy-control',
        label: '低碳航速窗口',
        affectedArea: '西北入口至新加坡主通道',
        severity: 'ok',
        startMinute: 0,
        expectedDurationMinutes: 120,
        recommendedAction: '按低碳推荐航速通过并同步错峰到港',
      },
    ],
    result: {
      status: 'passed',
      safePass: true,
      estimatedTravelMinutes: 76,
      riskLevel: 'low',
      recommendedSpeedKnots: 10.4,
      simulatedDurationSeconds: 2,
      reachedDestination: false,
      averageSpeedKnots: 10.2,
      minClearanceMeters: 63.8,
      collisionCount: 0,
      groundingCount: 0,
      riskEventResolvedCount: 1,
      delayDeltaMinutes: 9,
      carbonDeltaTons: -2.6,
      loadedScene: { routePointCount: 2, riskZoneCount: 1, temporaryObstacleCount: 0 },
      summary: '低碳调度演示：推荐 10.4kn 低速通过，预计单船减排 2.6t。',
    },
  },
];

const mapViewModes: Array<{
  id: MapViewMode;
  label: string;
  module: DashboardModuleId;
  detail: string;
}> = [
  {
    id: 'operations',
    label: '综合态势',
    module: 'overview',
    detail: '显示全网港口、航道、船舶和风险图层',
  },
  {
    id: 'congestion',
    label: '拥堵热力',
    module: 'resilience',
    detail: '突出港口排队、航道拥堵和关键节点压力',
  },
  {
    id: 'carbon',
    label: '低碳调度',
    module: 'dispatch',
    detail: '聚焦燃油碳排核算和绿色调度收益',
  },
  {
    id: 'emergency',
    label: '应急态势',
    module: 'emergency',
    detail: '联动风险预警、事故封航和应急预案',
  },
];

const routeLayerFilters: Array<{
  id: RouteLayerFilter;
  label: string;
  icon: 'anchor' | 'main' | 'secondary' | 'warning';
}> = [
  { id: 'all', label: '全部图层', icon: 'anchor' },
  { id: 'main', label: '主航道', icon: 'main' },
  { id: 'secondary', label: '次要航道', icon: 'secondary' },
  { id: 'traffic-separation', label: '分道通航', icon: 'warning' },
];

const formatInteger = (value: number) => value.toLocaleString('en-US');

const formatPercent = (value: number) => `${value.toFixed(1)}%`;

const formatCoordinate = (value: number) => value.toFixed(4);

const formatHeatPercent = (value: number) => `${Math.round(value * 100)}%`;

const padTime = (value: number) => value.toString().padStart(2, '0');

const formatScenarioDateTime = (date: Date) =>
  [
    `${date.getFullYear()}-${padTime(date.getMonth() + 1)}-${padTime(date.getDate())}`,
    `${padTime(date.getHours())}:${padTime(date.getMinutes())}:${padTime(date.getSeconds())}`,
  ].join(' ');

const formatScenarioTime = (date: Date) =>
  `${padTime(date.getHours())}:${padTime(date.getMinutes())}:${padTime(date.getSeconds())}`;

const getHeatmapTone = (value: number): StatusTone => {
  if (value >= 0.7) {
    return 'danger';
  }

  if (value >= 0.45) {
    return 'warning';
  }

  return 'ok';
};

const getPortCongestionLevel = (score: number): PortCongestionLevel => {
  if (score >= 82) {
    return 'severe';
  }

  if (score >= 65) {
    return 'high';
  }

  if (score >= 42) {
    return 'medium';
  }

  return 'low';
};

const getPortCongestionTone = (level: PortCongestionLevel): StatusTone => {
  if (level === 'severe' || level === 'high') {
    return 'danger';
  }

  if (level === 'medium') {
    return 'warning';
  }

  return 'ok';
};

const getDelayTone = (delayMinutes: number): StatusTone => {
  if (delayMinutes >= 45) {
    return 'danger';
  }

  if (delayMinutes >= 20) {
    return 'warning';
  }

  return 'ok';
};

const getEmissionTone = (carbonChangePercent: number): StatusTone => {
  if (carbonChangePercent >= 18) {
    return 'danger';
  }

  if (carbonChangePercent >= 6) {
    return 'warning';
  }

  return 'ok';
};

const getGreenStrategyTone = (score: number): StatusTone => {
  if (score >= 78) {
    return 'ok';
  }

  if (score >= 46) {
    return 'warning';
  }

  return 'danger';
};

const getResilienceTone = (index: number): StatusTone => {
  if (index >= 78) {
    return 'ok';
  }

  if (index >= 62) {
    return 'warning';
  }

  return 'danger';
};

const getPressureTone = (pressureScore: number): StatusTone => {
  if (pressureScore >= 72) {
    return 'danger';
  }

  if (pressureScore >= 52) {
    return 'warning';
  }

  return 'ok';
};

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const parseScreenPercent = (value: string) => {
  const parsed = Number.parseFloat(value);

  return Number.isFinite(parsed) ? parsed : 0;
};

const screenPositionToSvgPoint = (position: PortNode['position']) => ({
  x: parseScreenPercent(position.x) * 10,
  y: parseScreenPercent(position.y) * 7.2,
});

const buildCurvedSvgPath = (
  source: PortNode,
  target: PortNode,
  bendIndex = 0,
) => {
  const start = screenPositionToSvgPoint(source.position);
  const end = screenPositionToSvgPoint(target.position);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const bend = (bendIndex % 2 === 0 ? 1 : -1) * (54 + bendIndex * 18);
  const controlOne = {
    x: start.x + dx * 0.36 - dy * 0.08,
    y: start.y + dy * 0.28 + bend,
  };
  const controlTwo = {
    x: start.x + dx * 0.72 + dy * 0.06,
    y: start.y + dy * 0.72 - bend * 0.72,
  };

  return `M${start.x.toFixed(0)} ${start.y.toFixed(0)} C${controlOne.x.toFixed(0)} ${controlOne.y.toFixed(0)} ${controlTwo.x.toFixed(0)} ${controlTwo.y.toFixed(0)} ${end.x.toFixed(0)} ${end.y.toFixed(0)}`;
};

const kpiIconById = {
  'active-vessels': Ship,
  'transit-vessels': Route,
  'cargo-throughput': Anchor,
  'carbon-emission': CloudSun,
  'resilience-index': Gauge,
};

const vesselColorByCategory: Record<VesselCategory, string> = {
  cargo: '#ff5c54',
  tanker: '#ffbd45',
  container: '#2bd9ff',
  bulk: '#23e6a8',
  other: '#b46bff',
};

const vesselCategoryLabelByCategory: Record<VesselCategory, string> = {
  cargo: '货船',
  tanker: '油轮',
  container: '集装箱船',
  bulk: '散货船',
  other: '其他',
};

const fuelProfileByCategory: Record<
  VesselCategory,
  {
    dailyFuelTons: number;
    waitingFuelTonsPerHour: number;
    referenceSpeedKnots: number;
  }
> = {
  cargo: { dailyFuelTons: 34, waitingFuelTonsPerHour: 0.62, referenceSpeedKnots: 13 },
  tanker: { dailyFuelTons: 48, waitingFuelTonsPerHour: 0.88, referenceSpeedKnots: 12.5 },
  container: { dailyFuelTons: 68, waitingFuelTonsPerHour: 1.12, referenceSpeedKnots: 15 },
  bulk: { dailyFuelTons: 38, waitingFuelTonsPerHour: 0.7, referenceSpeedKnots: 12 },
  other: { dailyFuelTons: 24, waitingFuelTonsPerHour: 0.48, referenceSpeedKnots: 11 },
};

const routeDistanceNmById: Record<string, number> = {
  'main-route-north': 510,
  'main-route-south': 486,
  'secondary-route-klang-singapore': 214,
  'secondary-route-dumai': 186,
  'traffic-separation-singapore': 72,
};

const carbonTonsPerFuelTon = 3.114;

const getPortNodeTitle = (port: PortNode) =>
  [
    `${port.name} / ${port.englishName}`,
    `经纬度 ${formatCoordinate(port.geo.lat)}, ${formatCoordinate(port.geo.lon)}`,
    `船舶 ${port.vesselCount} 艘 / 排队 ${port.queueVessels} 艘 / 平均等待 ${port.averageWaitingHours}h`,
    `吞吐 ${port.dailyThroughputMillionTons} 百万吨 / 碳强度 ${port.carbonIntensityKgPerTon} kg/t`,
    `泊位利用 ${port.berthUtilizationPercent}% / 韧性权重 ${port.resilienceWeight}`,
  ].join('\n');

const getRouteTitle = (
  route: RouteOverlay,
  originName: string,
  destinationName: string,
) =>
  [
    `${route.label}`,
    `${originName} -> ${destinationName}`,
    `流量 ${route.vesselVolume} 艘/日 / 平均航速 ${route.averageSpeedKnots}kn`,
    `延误 ${route.delayMinutes} 分钟 / 碳排 ${formatInteger(route.carbonEmissionTons)} 吨`,
  ].join('\n');

const getVesselTitle = (
  vessel: VesselMarker,
  route: RouteOverlay,
  destinationName: string,
) =>
  [
    `${vessel.name} / ${vessel.imo}`,
    `船型 ${vessel.category} / 目标 ${destinationName}`,
    `航线 ${route.label} / 进度 ${vessel.progressPercent}%`,
    `航速 ${vessel.speedKnots}kn / 碳排 ${vessel.carbonEmissionTonsPerHour} 吨/小时`,
  ].join('\n');

const englishTextByChinese: Record<string, string> = {
  系统设置: 'System',
  综合态势: 'Situation',
  拥堵热力: 'Congestion Heat',
  低碳调度: 'Low-Carbon Dispatch',
  应急态势: 'Emergency',
  全屏显示: 'Fullscreen',
  退出全屏: 'Exit Fullscreen',
  港航网络总览: 'Port Network Overview',
  船舶态势: 'Vessel Status',
  航道通航状态: 'Channel Status',
  风险预警: 'Risk Alerts',
  气象与海况: 'Weather & Sea State',
  碳排放监测: 'Carbon Monitor',
  航道拥堵热力图: 'Channel Congestion Heatmap',
  关键节点监控: 'Key Node Monitor',
  态势总览: 'Situation Overview',
  沙盘推演: 'Sandbox Simulation',
  韧性评估: 'Resilience Assessment',
  调度优化: 'Dispatch Optimization',
  应急预案: 'Emergency Plans',
  实时船舶总数: 'Live Vessels',
  今日过境船舶: 'Transit Today',
  吞吐量: 'Throughput',
  碳排放: 'Carbon Emission',
  网络韧性指数: 'Network Resilience Index',
  港口数量: 'Ports',
  航道数量: 'Channels',
  锚地数量: 'Anchorages',
  船舶总数: 'Total Vessels',
  分类总数: 'Fleet Mix',
  主监控区: 'Focus Area',
  浮层: 'Layers',
  传播: 'Propagation',
  拥堵: 'Congestion',
  延误: 'Delay',
  碳排: 'Carbon',
  策略: 'Strategy',
  '影响传播 / 韧性扩散': 'Impact Propagation / Resilience Diffusion',
  港口拥堵推演: 'Port Congestion Simulation',
  船舶延误推演: 'Vessel Delay Simulation',
  燃油与碳排核算: 'Fuel & Carbon Accounting',
  绿色调度策略对比: 'Green Dispatch Strategies',
  今日碳排放: 'Today Carbon',
  较昨日: 'vs Yesterday',
  绿色调度后: 'After Green Dispatch',
  当前小时: 'Current Hour',
  峰值时段: 'Peak Hour',
  当前功能清单: 'Capability Matrix',
  结果回传: 'Result Feedback',
  滚动验证信息流: 'Validation Stream',
  推荐策略: 'Recommended Strategy',
  微观调度建议: 'Micro Dispatch Advice',
  开始: 'Start',
  暂停: 'Pause',
  重置: 'Reset',
  事件注入: 'Event Injection',
  RL策略推理: 'RL Policy',
  训练中心: 'Training Center',
  导出报告: 'Export Report',
  倍速: 'Speed',
  风速: 'Wind Speed',
  风向: 'Wind Direction',
  浪高: 'Wave Height',
  流速: 'Current',
  水温: 'Sea Temp',
  气压: 'Pressure',
  能见度: 'Visibility',
  调度: 'Dispatch',
  验证: 'Validation',
  风险: 'Risk',
  正常通航: 'Normal Transit',
  港口拥堵: 'Port Congestion',
  事故封航: 'Accident Closure',
  极端天气: 'Extreme Weather',
  低碳调度优化: 'Low-Carbon Dispatch',
  正常: 'Normal',
  封航: 'Closure',
  天气: 'Weather',
  低碳: 'Low Carbon',
  推进: 'Advance',
  阶段: 'Phase',
  微观: 'Micro',
  下一步: 'Next Step',
  事件: 'Event',
  韧性: 'Resilience',
  回写: 'Feedback',
  生成: 'Generated',
  待命: 'Standby',
  安全: 'Safety',
  耗时: 'Travel Time',
  目标航速: 'Target Speed',
  推荐航速: 'Recommended Speed',
  生成信息流: 'Generate Stream',
  导入模拟结果: 'Import Result',
  航行模拟器: 'Simulator',
  港口控制算法训练: 'Port Control Training',
  打开中央训练窗口: 'Open Training Window',
  推演运行中: 'Simulation Running',
  推演已暂停: 'Simulation Paused',
  本地渲染流: 'Local Render Feed',
  控制: 'Control',
  感知: 'Sense',
  参数封装: 'Parameter Package',
  验证对象: 'Validation Target',
  风险校核: 'Risk Check',
  策略推送: 'Strategy Push',
  指标回写: 'KPI Feedback',
  结果已回写: 'Result Synced',
  信息流已生成: 'Stream Generated',
  事件已注入: 'Event Injected',
  推演待命: 'Standby',
  查看回写指标: 'View Feedback',
  等待模拟结果: 'Await Result',
  启动或注入事件: 'Start or Inject',
  等待生成信息流: 'Await Stream',
  模拟结果已回写: 'Result Synced',
  请求生成: 'Request Ready',
  训练待命: 'Training Standby',
  任务排队: 'Queued',
  训练中: 'Training',
  训练完成: 'Training Complete',
  训练失败: 'Training Failed',
  训练已取消: 'Training Cancelled',
  待执行: 'Pending',
  执行中: 'Running',
  已完成: 'Completed',
  已推进: 'Elapsed',
  注入事件: 'Events Injected',
  港口控制算法训练中心: 'Port Control Training Center',
  还原窗口: 'Restore Window',
  算法选择: 'Algorithm Selection',
  'Baseline 对照': 'Baseline Comparison',
  沙盘信息设置: 'Sandbox Inputs',
  训练参数: 'Training Parameters',
  训练优化目标: 'Training Objective',
  优化器: 'Optimizer',
  采样与回放: 'Sampling & Replay',
  奖励函数权重: 'Reward Weights',
  后台算法接入: 'Backend Integration',
  测试接入: 'Test Connection',
  同步参数: 'Sync Parameters',
  断开接入: 'Disconnect',
  训练进度: 'Training Progress',
  重新训练: 'Retrain',
  启动训练: 'Start Training',
  重置训练: 'Reset Training',
  训练指标: 'Training Metrics',
  训练后策略测试: 'Post-Training Policy Test',
  接口预留: 'Reserved Interface',
  等待训练完成: 'Await Training',
  测试待命: 'Test Standby',
  测试中: 'Testing',
  测试完成: 'Test Complete',
  重新测试: 'Retest',
  启动测试: 'Start Test',
  重置测试: 'Reset Test',
  待解锁: 'Locked',
  未连接: 'Disconnected',
  检测中: 'Checking',
  已连接: 'Connected',
  接入失败: 'Connection Failed',
  内置任务服务: 'Built-in Job Service',
  'HTTP 服务': 'HTTP Service',
  'Q-Learning 离策略控制': 'Q-Learning Off-Policy Control',
  'SARSA 在策略控制': 'SARSA On-Policy Control',
  'Expected SARSA 期望更新': 'Expected SARSA',
  'Dyna-Q 规划增强控制': 'Dyna-Q Planning Control',
  模型预测控制基线: 'Model Predictive Control Baseline',
  '强化学习 / 离策略值函数': 'RL / Off-Policy Value Function',
  '强化学习 / 在策略值函数': 'RL / On-Policy Value Function',
  '强化学习 / 期望值函数': 'RL / Expected Value Function',
  '强化学习 / 学习与规划': 'RL / Learning and Planning',
  '控制理论 / 滚动时域优化': 'Control / Receding Horizon',
  拓扑快照: 'Topology Snapshot',
  船舶状态: 'Vessel State',
  事件扰动: 'Event Disturbance',
  气象海况: 'Weather & Sea',
  拥堵延误: 'Congestion Delay',
  碳排奖励: 'Carbon Reward',
  动作空间: 'Action Space',
  验证回写: 'Validation Feedback',
  韧性均衡优化: 'Balanced Resilience',
  均衡韧性: 'Balanced Resilience',
  最小化平均延误: 'Minimize Average Delay',
  最小延误: 'Min Delay',
  最小化碳排放: 'Minimize Carbon Emission',
  低碳优先: 'Low-Carbon First',
  最大化港口吞吐: 'Maximize Port Throughput',
  吞吐优先: 'Throughput First',
  港口拥堵削峰: 'Port Congestion Peak Shaving',
  拥堵削峰: 'Peak Shaving',
  公平排队与服务均衡: 'Fair Queueing & Service Balance',
  公平排队: 'Fair Queueing',
  安全优先避险: 'Safety-First Avoidance',
  安全优先: 'Safety First',
  突发事件快速恢复: 'Rapid Incident Recovery',
  快速恢复: 'Rapid Recovery',
  燃油成本控制: 'Fuel Cost Control',
  燃油成本: 'Fuel Cost',
  气象扰动鲁棒性: 'Weather Robustness',
  天气鲁棒: 'Weather Robust',
  多港协同分流: 'Multi-Port Diversion',
  多港协同: 'Multi-Port Coordination',
  价值更新步长: 'Value Update Step',
  '折扣 gamma': 'Discount Gamma',
  '每种RL算法 Episode': 'Episodes per RL Algorithm',
  任务超时上限: 'Job Timeout',
  随机种子: 'Random Seed',
  延误权重: 'Delay Weight',
  拥堵权重: 'Congestion Weight',
  碳排权重: 'Carbon Weight',
  安全权重: 'Safety Weight',
  韧性权重: 'Resilience Weight',
  沙盘快照采样: 'Sandbox Snapshot Sampling',
  奖励函数装配: 'Reward Assembly',
  'Baseline 对齐': 'Baseline Alignment',
  '策略 Rollout': 'Policy Rollout',
  评估与回放: 'Evaluation & Replay',
  接口封装: 'Interface Packaging',
  闭环回放测试: 'Closed-Loop Replay Test',
  闭环: 'Closed Loop',
  峰值拥堵压力测试: 'Peak Congestion Stress Test',
  压力: 'Stress',
  天气扰动泛化测试: 'Weather Disturbance Generalization',
  泛化: 'Generalization',
  平均延误: 'Average Delay',
  拥堵峰值: 'Congestion Peak',
  安全违规: 'Safety Violations',
  推理延迟: 'Inference Latency',
  碳减: 'Carbon Cut',
};

function BilingualText({
  className = '',
  en,
  text,
}: {
  className?: string;
  en?: string;
  text: string;
}) {
  const english = en ?? englishTextByChinese[text];

  return (
    <span className={`bilingual-label ${className}`.trim()}>
      <span className="bilingual-label__zh">{text}</span>
      {english && <small className="bilingual-label__en">{english}</small>}
    </span>
  );
}

const formatBilingualPlainText = (text: string) => {
  const english = englishTextByChinese[text];

  return english ? `${text} / ${english}` : text;
};

const handleValidationKeyDown = <T extends Element>(
  event: KeyboardEvent<T>,
  action: () => void,
) => {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  event.preventDefault();
  action();
};

function Panel({
  title,
  children,
  className = '',
  isExpanded = false,
  onClose,
  onExpand,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  isExpanded?: boolean;
  onClose?: () => void;
  onExpand?: () => void;
}) {
  const isExpandable = Boolean(onExpand);
  const handlePanelClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (!isExpandable || isExpanded) {
      return;
    }

    const target = event.target as HTMLElement | null;

    if (
      target?.closest(
        'button, a, input, select, textarea, [role="button"], [role="link"], [data-panel-action]',
      )
    ) {
      return;
    }

    onExpand?.();
  };
  const handlePanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!isExpandable || isExpanded || event.currentTarget !== event.target) {
      return;
    }

    handleValidationKeyDown(event, () => onExpand?.());
  };

  return (
    <section
      aria-label={`${title}${isExpanded ? '放大视图' : '，点击放大查看'}`}
      className={`hud-panel${isExpandable ? ' hud-panel--expandable' : ''}${isExpanded ? ' hud-panel--expanded' : ''} ${className}`.trim()}
      onClick={handlePanelClick}
      onKeyDown={handlePanelKeyDown}
      tabIndex={isExpandable && !isExpanded ? 0 : undefined}
    >
      <header className="hud-panel__header">
        <BilingualText text={title} />
        {isExpandable && (
          <button
            aria-label={isExpanded ? `关闭${title}放大视图` : `放大查看${title}`}
            className="hud-panel__zoom-button"
            data-panel-action="zoom"
            onClick={(event) => {
              event.stopPropagation();
              if (isExpanded) {
                onClose?.();
              } else {
                onExpand?.();
              }
            }}
            type="button"
          >
            {isExpanded ? <X size={15} /> : <Expand size={14} />}
          </button>
        )}
      </header>
      <div className="hud-panel__body">{children}</div>
    </section>
  );
}

function RollingMetricValue({ value }: { value: string }) {
  return (
    <span className="rolling-number" aria-label={value}>
      {Array.from(value).map((character, index) => (
        <span
          aria-hidden="true"
          className={/\d/.test(character) ? 'rolling-number__digit' : 'rolling-number__mark'}
          key={`${character}-${index}`}
          style={{ '--digit-index': index } as CSSProperties}
        >
          {character}
        </span>
      ))}
    </span>
  );
}

const rlTrainingCardPresentation: Record<
  RlTrainingCardId,
  { index: string; layer: string; className: string }
> = {
  algorithm: { index: '01', layer: '策略选择层', className: 'config' },
  baselines: { index: '02', layer: '基线对照层', className: 'config' },
  settings: { index: '03', layer: '状态空间层', className: 'config' },
  parameters: { index: '04', layer: '超参数层', className: 'config' },
  backend: { index: '05', layer: '服务接入层', className: 'service' },
  progress: { index: '06', layer: '训练执行层', className: 'execution' },
  metrics: { index: '07', layer: '在线指标层', className: 'metrics' },
  curves: { index: '08', layer: '对比分析层', className: 'analytics' },
  'policy-test': { index: '09', layer: '策略验证层', className: 'validation' },
  contract: { index: '10', layer: '接口契约层', className: 'service' },
};

function RlTrainingCard({
  children,
  id,
  isCollapsed,
  isCompact,
  label,
  onAskXiaoyi,
  onClose,
  onToggleCollapse,
  onToggleCompact,
  subtitle,
  tone,
  xiaoyiApplied = false,
  xiaoyiBusy = false,
  xiaoyiSelected = false,
}: {
  children: ReactNode;
  id: RlTrainingCardId;
  isCollapsed: boolean;
  isCompact: boolean;
  label: string;
  onAskXiaoyi?: (id: RlTrainingCardId) => void;
  onClose: (id: RlTrainingCardId) => void;
  onToggleCollapse: (id: RlTrainingCardId) => void;
  onToggleCompact: (id: RlTrainingCardId) => void;
  subtitle: string;
  tone: StatusTone;
  xiaoyiApplied?: boolean;
  xiaoyiBusy?: boolean;
  xiaoyiSelected?: boolean;
}) {
  const presentation = rlTrainingCardPresentation[id];
  return (
    <section
      className={`rl-training-card rl-training-card--${id} rl-training-card--${tone} rl-training-card--layer-${presentation.className}${isCollapsed ? ' rl-training-card--collapsed' : ''}${isCompact ? ' rl-training-card--compact' : ''}${xiaoyiApplied ? ' rl-training-card--xiaoyi-applied' : ''}`}
      style={{ '--rl-card-color': statusColorByTone[tone] } as CSSProperties}
    >
      <header className="rl-training-card__header">
        <span className="rl-training-card__identity">
          <b>{presentation.index}</b>
          <span>
            <BilingualText text={label} />
            <small>{presentation.layer}</small>
          </span>
        </span>
        <strong>
          <BilingualText text={subtitle} />
        </strong>
        <div className="rl-training-card__controls">
          {xiaoyiApplied && (
            <span className="rl-training-card__applied-badge" role="status">
              <CheckCircle2 size={11} />
              小懿已配置
            </span>
          )}
          {onAskXiaoyi && (
            <button
              aria-label={`让小懿推荐${label}`}
              className={`rl-card-xiaoyi-button${xiaoyiSelected ? ' rl-card-xiaoyi-button--active' : ''}`}
              disabled={xiaoyiBusy}
              onClick={() => onAskXiaoyi(id)}
              title={`无需理解算法，让小懿按当前优化目标推荐${label}`}
              type="button"
            >
              <Sparkles size={11} />
              <span>{xiaoyiBusy && xiaoyiSelected ? '分析中' : '小懿推荐'}</span>
            </button>
          )}
          <button
            aria-label={`${isCompact ? '还原' : '缩小'}${label}`}
            onClick={() => onToggleCompact(id)}
            type="button"
          >
            {isCompact ? <Expand size={11} /> : <Minimize size={11} />}
          </button>
          <button
            aria-label={`${isCollapsed ? '展开' : '收起'}${label}`}
            onClick={() => onToggleCollapse(id)}
            type="button"
          >
            {isCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
          <button aria-label={`关闭${label}`} onClick={() => onClose(id)} type="button">
            <X size={11} />
          </button>
        </div>
      </header>
      {!isCollapsed && <div className="rl-training-card__body">{children}</div>}
    </section>
  );
}

export function App() {
  const [baseScenario, setBaseScenario] = useState(malaccaScenario);
  const [portDataConfig, setPortDataConfig] = useState<PortDataConfig>(() => ({
    ...defaultPortDataConfig,
    endpoint: import.meta.env.VITE_PORT_DATA_ENDPOINT || defaultPortDataConfig.endpoint,
  }));
  const [portDataStatus, setPortDataStatus] = useState<PortDataConnectionStatus>('connecting');
  const [portDataMessage, setPortDataMessage] = useState('正在获取 MPA、Open-Meteo 与 AIS 研究实证数据');
  const [portDataObservedAt, setPortDataObservedAt] = useState<string | null>(null);
  const [publicEvidence, setPublicEvidence] = useState<PublicEvidenceSummary | null>(null);
  const [portDataRefreshToken, setPortDataRefreshToken] = useState(0);
  const baseScenarioTime = useMemo(
    () => new Date(baseScenario.currentTime.replace(' ', 'T')),
    [baseScenario.currentTime],
  );
  const [sandboxRuntime, setSandboxRuntime] = useState<SandboxRuntimeState>(
    createInitialSandboxRuntime,
  );
  const {
    isSimulationRunning,
    simulationSpeed,
    elapsedMinutes,
    injectedEvents,
    activeDemoCaseId,
    generatedGodotRequest,
    importedGodotResult,
    phases,
    rlTraining,
    policyRecovery,
  } = sandboxRuntime;
  const [activeModule, setActiveModule] = useState<DashboardModuleId>('overview');
  const [validationSelection, setValidationSelection] = useState<ValidationSelection>({
    type: 'vessel',
    id: baseScenario.vesselMarkers[0]?.id ?? '',
  });
  const [activeMapView, setActiveMapView] = useState<MapViewMode>('operations');
  const [routeLayerFilter, setRouteLayerFilter] = useState<RouteLayerFilter>('all');
  const [vesselCategoryFilter, setVesselCategoryFilter] =
    useState<VesselCategoryFilter>('all');
  const [selectedPortId, setSelectedPortId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showCoreClosure, setShowCoreClosure] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isGodotSimulatorOpen, setIsGodotSimulatorOpen] = useState(false);
  const [hasPreviewedGodotSimulator, setHasPreviewedGodotSimulator] = useState(false);
  const [isEventInjectionPanelOpen, setIsEventInjectionPanelOpen] = useState(false);
  const [selectedEventTemplateId, setSelectedEventTemplateId] = useState(
    eventInjectionTemplates[0].id,
  );
  const [isRlDecisionPanelOpen, setIsRlDecisionPanelOpen] = useState(false);
  const [rlInferenceStatus, setRlInferenceStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const [rlInferenceProgress, setRlInferenceProgress] = useState(0);
  const [rlInferenceRunId, setRlInferenceRunId] = useState(0);
  const [rlDisturbance, setRlDisturbance] = useState<{
    type: RlDisturbanceType;
    intensity: number;
  }>({ type: 'none', intensity: 0 });
  const [rlPolicyInference, setRlPolicyInference] = useState<RlPolicyInferenceResponse | null>(null);
  const [rlPolicyApplied, setRlPolicyApplied] = useState(false);
  const [expandedPanelTitle, setExpandedPanelTitle] = useState<string | null>(null);
  const [godotSimulatorStatus, setGodotSimulatorStatus] =
    useState<GodotSimulatorStatus>('checking');
  const [godotSimulatorReloadKey, setGodotSimulatorReloadKey] = useState(0);
  const [inspectorPanel, setInspectorPanel] = useState<InspectorPanel | null>(null);
  const [contextInspectorWindow, setContextInspectorWindow] =
    useState<ContextInspectorWindowState>(() => getCenteredContextInspectorWindowState());
  const [openMapOverlays, setOpenMapOverlays] = useState<Record<MapOverlayPanelId, boolean>>({
    congestion: false,
    delay: false,
    carbon: false,
    strategy: false,
    propagation: false,
  });
  const [rlTrainingWindowState, setRlTrainingWindowState] = useState<RlTrainingWindowState>(
    createInitialRlTrainingWindowState,
  );
  const [xiaoyiAdvisorStatus, setXiaoyiAdvisorStatus] = useState<'idle' | 'thinking' | 'ready' | 'failed'>('idle');
  const [xiaoyiAdvisorScope, setXiaoyiAdvisorScope] = useState<RlTrainingCardId | 'all'>('all');
  const [xiaoyiRlAdvice, setXiaoyiRlAdvice] = useState<XiaoyiRlAdvisorResponse | null>(null);
  const [xiaoyiAdviceObjectiveId, setXiaoyiAdviceObjectiveId] = useState<RlTrainingObjectiveId | null>(null);
  const [xiaoyiApplyFeedback, setXiaoyiApplyFeedback] = useState<{
    status: 'idle' | 'applying' | 'success';
    scope: RlTrainingCardId | 'all' | null;
    message: string;
    appliedAt: string | null;
  }>({ status: 'idle', scope: null, message: '', appliedAt: null });
  const [isXiaoyiAssistantOpen, setIsXiaoyiAssistantOpen] = useState(true);
  const [isXiaoyiAssistantMinimized, setIsXiaoyiAssistantMinimized] = useState(false);
  const [xiaoyiAssistantPosition, setXiaoyiAssistantPosition] = useState(() => ({
    x: typeof window === 'undefined' ? 1080 : Math.max(24, window.innerWidth - 330),
    y: 150,
  }));
  const [rlBenchmark, setRlBenchmark] = useState<RlBenchmarkResponse | null>(restoreRlBenchmark);
  const [rlTrainingJob, setRlTrainingJob] = useState<RlTrainingJobSnapshot | null>(null);
  const [rlPolicyEvaluation, setRlPolicyEvaluation] = useState<RlPolicyEvaluationResponse | null>(null);
  const [rlBenchmarkMessage, setRlBenchmarkMessage] = useState(
    () => restoreRlBenchmark()
      ? '已恢复上次训练摘要；正在通过任务编号校验服务器检查点'
      : '等待提交四种RL算法与MPC控制基线训练',
  );
  const godotResultInputRef = useRef<HTMLInputElement | null>(null);
  const godotSimulatorFrameRef = useRef<HTMLIFrameElement | null>(null);
  const xiaoyiAdviceRequestIdRef = useRef(0);
  const xiaoyiApplyFeedbackTimerRef = useRef<number | null>(null);
  const godotResultReceiverRef = useRef<(result: GodotValidationResult) => void>(() => undefined);
  const rlPolicyRecoveryProgress = clampNumber(
    policyRecovery.advancedMinutes / Math.max(1, policyRecovery.targetMinutes),
    0,
    1,
  );
  const rlPolicyRecoveryPercent = Math.round(rlPolicyRecoveryProgress * 100);
  const rlPolicyRecoveryTone: StatusTone =
    !rlPolicyApplied || rlPolicyRecoveryProgress < 0.34
      ? 'danger'
      : rlPolicyRecoveryProgress < 0.68
        ? 'warning'
        : 'ok';
  const rlPolicyRecoveryColor =
    !rlPolicyApplied || rlPolicyRecoveryProgress <= 0
      ? statusColorByTone.danger
      : rlPolicyRecoveryProgress < 0.34
        ? '#ff8736'
        : rlPolicyRecoveryProgress < 0.68
          ? '#ffd65a'
          : statusColorByTone.ok;
  const rlPolicyRecoveryStageLabel =
    !rlPolicyApplied
      ? '事件扩散'
      : rlPolicyRecoveryProgress <= 0
        ? '策略待执行'
        : rlPolicyRecoveryProgress < 0.34
          ? '流量受控'
          : rlPolicyRecoveryProgress < 0.68
            ? '排队消散'
            : rlPolicyRecoveryProgress < 1
              ? '通航恢复'
              : '网络稳定';
  const rlOperationalImpactRemainingFactor = rlPolicyApplied
    ? clampNumber(1 - rlPolicyRecoveryProgress * 0.94, 0.06, 1)
    : 1;
  const rlCongestionReliefPoints =
    (rlPolicyInference?.comparison.improvement.congestionPoints ?? 0) * rlPolicyRecoveryProgress;
  const rlDelayReliefMinutes =
    (rlPolicyInference?.comparison.improvement.delayMinutes ?? 0) * rlPolicyRecoveryProgress;
  const rlResilienceGainPoints =
    (rlPolicyInference?.comparison.improvement.resiliencePoints ?? 0) * rlPolicyRecoveryProgress;
  const scenarioClock = useMemo(
    () => new Date(baseScenarioTime.getTime() + elapsedMinutes * 60_000),
    [baseScenarioTime, elapsedMinutes],
  );
  const scenarioClockLabel = formatScenarioDateTime(scenarioClock);
  const simulationProgressPercent = Math.min(100, ((elapsedMinutes % 180) / 180) * 100);
  const displayedEventLog = useMemo(
    () => [...injectedEvents, ...baseScenario.eventLog].slice(0, 4),
    [injectedEvents, baseScenario.eventLog],
  );
  const eventImpact = useMemo(() => {
    const portImpactById = new Map<
      string,
      {
        queueDelta: number;
        congestionDelta: number;
        berthCountDelta: number;
        berthUtilizationDelta: number;
        waitingHoursDelta: number;
      }
    >();
    const channelImpactById = new Map<
      string,
      {
        congestionDelta: number;
        delayMinutesDelta: number;
        speedKnotsDelta: number;
        riskDelayMinutesDelta: number;
      }
    >();
    const routeImpactById = new Map<
      string,
      {
        delayMinutesDelta: number;
        speedKnotsDelta: number;
        riskDelayMinutesDelta: number;
      }
    >();
    const strategyScoreBoostByType: Partial<Record<StrategyType, number>> = {};
    const weather = {
      windSpeedMsDelta: 0,
      waveHeightMDelta: 0,
      visibilityKmDelta: 0,
      currentSpeedKnotsDelta: 0,
    };

    let incidentPressure = 0;
    let carbonMultiplierDelta = 0;

    injectedEvents.forEach((event) => {
      const impact = event.impact;

      incidentPressure += impact.incidentPressureDelta * rlOperationalImpactRemainingFactor;
      carbonMultiplierDelta +=
        (impact.carbonMultiplierDelta ?? 0) * rlOperationalImpactRemainingFactor;
      weather.windSpeedMsDelta += impact.weather?.windSpeedMsDelta ?? 0;
      weather.waveHeightMDelta += impact.weather?.waveHeightMDelta ?? 0;
      weather.visibilityKmDelta += impact.weather?.visibilityKmDelta ?? 0;
      weather.currentSpeedKnotsDelta += impact.weather?.currentSpeedKnotsDelta ?? 0;

      impact.portIds?.forEach((portId) => {
        const current = portImpactById.get(portId) ?? {
          queueDelta: 0,
          congestionDelta: 0,
          berthCountDelta: 0,
          berthUtilizationDelta: 0,
          waitingHoursDelta: 0,
        };

        portImpactById.set(portId, {
          queueDelta:
            current.queueDelta + (impact.portQueueDelta ?? 0) * rlOperationalImpactRemainingFactor,
          congestionDelta:
            current.congestionDelta +
            (impact.portCongestionDelta ?? 0) * rlOperationalImpactRemainingFactor,
          berthCountDelta:
            current.berthCountDelta +
            (impact.portBerthCountDelta ?? 0) * rlOperationalImpactRemainingFactor,
          berthUtilizationDelta:
            current.berthUtilizationDelta +
            (impact.portBerthUtilizationDelta ?? 0) * rlOperationalImpactRemainingFactor,
          waitingHoursDelta:
            current.waitingHoursDelta +
            (impact.portWaitingHoursDelta ?? 0) * rlOperationalImpactRemainingFactor,
        });
      });

      impact.channelIds?.forEach((channelId) => {
        const current = channelImpactById.get(channelId) ?? {
          congestionDelta: 0,
          delayMinutesDelta: 0,
          speedKnotsDelta: 0,
          riskDelayMinutesDelta: 0,
        };

        channelImpactById.set(channelId, {
          congestionDelta:
            current.congestionDelta +
            (impact.channelCongestionDelta ?? 0) * rlOperationalImpactRemainingFactor,
          delayMinutesDelta:
            current.delayMinutesDelta +
            (impact.channelDelayMinutesDelta ?? 0) * rlOperationalImpactRemainingFactor,
          speedKnotsDelta:
            current.speedKnotsDelta +
            (impact.routeSpeedKnotsDelta ?? 0) * rlOperationalImpactRemainingFactor,
          riskDelayMinutesDelta:
            current.riskDelayMinutesDelta +
            (impact.riskDelayMinutesDelta ?? 0) * rlOperationalImpactRemainingFactor,
        });
      });

      impact.routeIds?.forEach((routeId) => {
        const current = routeImpactById.get(routeId) ?? {
          delayMinutesDelta: 0,
          speedKnotsDelta: 0,
          riskDelayMinutesDelta: 0,
        };

        routeImpactById.set(routeId, {
          delayMinutesDelta:
            current.delayMinutesDelta +
            (impact.routeDelayMinutesDelta ?? 0) * rlOperationalImpactRemainingFactor,
          speedKnotsDelta:
            current.speedKnotsDelta +
            ((impact.routeSpeedKnotsDelta ?? 0) +
              (impact.vesselSpeedKnotsDelta ?? 0) * 0.35) *
              rlOperationalImpactRemainingFactor,
          riskDelayMinutesDelta:
            current.riskDelayMinutesDelta +
            (impact.riskDelayMinutesDelta ?? 0) * rlOperationalImpactRemainingFactor,
        });
      });

      Object.entries(impact.strategyScoreBoostByType ?? {}).forEach(([strategyType, boost]) => {
        const typedStrategyType = strategyType as StrategyType;
        strategyScoreBoostByType[typedStrategyType] =
          (strategyScoreBoostByType[typedStrategyType] ?? 0) + (boost ?? 0);
      });
    });

    return {
      incidentPressure,
      carbonMultiplierDelta,
      weather,
      portImpactById,
      channelImpactById,
      routeImpactById,
      strategyScoreBoostByType,
      activeSummaries: injectedEvents.map((event) => event.impact.summary),
    };
  }, [injectedEvents, rlOperationalImpactRemainingFactor]);
  const latestInjectedEvent = injectedEvents[0] ?? null;
  const activeInjectedEventTemplate = latestInjectedEvent
    ? eventInjectionTemplates.find((template) => template.id === latestInjectedEvent.templateId) ?? null
    : null;
  const rlVesselRecoveryLabel =
    !rlPolicyApplied || rlPolicyRecoveryProgress <= 0
      ? activeInjectedEventTemplate?.vesselEffectShortLabel ?? '受扰'
      : rlPolicyRecoveryProgress < 0.34
        ? '受控'
        : rlPolicyRecoveryProgress < 0.68
          ? '疏导'
          : rlPolicyRecoveryProgress < 1
            ? '恢复'
            : '通畅';
  const selectedEventTemplate =
    eventInjectionTemplates.find((template) => template.id === selectedEventTemplateId) ??
    eventInjectionTemplates[0];
  const affectedVesselIdSet = useMemo(() => {
    if (!latestInjectedEvent) return new Set<string>();

    const { impact } = latestInjectedEvent;
    return new Set(
      baseScenario.vesselMarkers
        .filter(
          (vessel) =>
            impact.routeIds?.includes(vessel.flowId) ||
            impact.channelIds?.includes(vessel.assignedChannelId) ||
            impact.portIds?.includes(vessel.destinationPortId),
        )
        .map((vessel) => vessel.id),
    );
  }, [baseScenario.vesselMarkers, latestInjectedEvent]);
  const rlPolicyEventContext: RlPolicyInferenceEventContext | null =
    activeInjectedEventTemplate && latestInjectedEvent
      ? {
          templateId: activeInjectedEventTemplate.id,
          label: activeInjectedEventTemplate.label,
          category: activeInjectedEventTemplate.category,
          scopeLabel: activeInjectedEventTemplate.scopeLabel,
          effectMode: activeInjectedEventTemplate.vesselEffectMode,
          effectLabel: activeInjectedEventTemplate.vesselEffectLabel,
          affectedVesselCount: affectedVesselIdSet.size,
          impact: {
            incidentPressure: latestInjectedEvent.impact.incidentPressureDelta,
            congestionPoints:
              latestInjectedEvent.impact.portCongestionDelta ??
              latestInjectedEvent.impact.channelCongestionDelta ??
              0,
            delayMinutes: Math.max(
              latestInjectedEvent.impact.routeDelayMinutesDelta ?? 0,
              latestInjectedEvent.impact.channelDelayMinutesDelta ?? 0,
            ),
            speedKnotsDelta:
              latestInjectedEvent.impact.vesselSpeedKnotsDelta ??
              latestInjectedEvent.impact.routeSpeedKnotsDelta ??
              0,
            carbonPercentDelta: (latestInjectedEvent.impact.carbonMultiplierDelta ?? 0) * 100,
            weatherSeverity:
              Math.abs(latestInjectedEvent.impact.weather?.windSpeedMsDelta ?? 0) / 5 +
              Math.abs(latestInjectedEvent.impact.weather?.waveHeightMDelta ?? 0) / 0.55 +
              Math.abs(latestInjectedEvent.impact.weather?.visibilityKmDelta ?? 0) / 3,
          },
        }
      : null;
  const effectiveWeather = {
    ...baseScenario.weather,
    windSpeedMs: Number(
      clampNumber(baseScenario.weather.windSpeedMs + eventImpact.weather.windSpeedMsDelta, 0, 32).toFixed(1),
    ),
    visibilityKm: Number(
      clampNumber(baseScenario.weather.visibilityKm + eventImpact.weather.visibilityKmDelta, 1, 20).toFixed(1),
    ),
    waveHeightM: Number(
      clampNumber(baseScenario.weather.waveHeightM + eventImpact.weather.waveHeightMDelta, 0.2, 5).toFixed(1),
    ),
    currentSpeedKnots: Number(
      clampNumber(
        baseScenario.weather.currentSpeedKnots + eventImpact.weather.currentSpeedKnotsDelta,
        0.1,
        3,
      ).toFixed(1),
    ),
  };
  const runtimeChannels = baseScenario.channels.map((channel) => {
    const impact = eventImpact.channelImpactById.get(channel.id);
    const recoveryCongestionRelief = impact ? rlCongestionReliefPoints * 0.72 : 0;
    const recoveryDelayRelief = impact ? rlDelayReliefMinutes * 0.58 : 0;
    const congestionPercent = Math.round(
      clampNumber(
        channel.congestionPercent + (impact?.congestionDelta ?? 0) - recoveryCongestionRelief,
        0,
        100,
      ),
    );
    const delayMinutes = Math.round(
      clampNumber(
        channel.delayMinutes + (impact?.delayMinutesDelta ?? 0) - recoveryDelayRelief,
        0,
        180,
      ),
    );
    const tone: StatusTone =
      congestionPercent >= 76 || delayMinutes >= 45
        ? 'danger'
        : congestionPercent >= 54 || delayMinutes >= 20
          ? 'warning'
          : 'ok';
    const status =
      tone === 'danger'
        ? delayMinutes >= 45
          ? '封航管制'
          : '严重拥堵'
        : tone === 'warning'
          ? '轻度拥堵'
          : '正常';

    return {
      ...channel,
      congestionPercent,
      delayMinutes,
      tone,
      status,
    };
  });
  const runtimeRouteOverlays = baseScenario.routeOverlays.map((route) => {
    const routeImpact = eventImpact.routeImpactById.get(route.id);
    const channelImpact = eventImpact.channelImpactById.get(route.channelId);
    const isRecoveryRoute = Boolean(routeImpact || channelImpact);
    const recoveryDelayRelief = isRecoveryRoute ? rlDelayReliefMinutes * 0.68 : 0;
    const delayMinutes = Math.round(
      clampNumber(
        route.delayMinutes +
          (routeImpact?.delayMinutesDelta ?? 0) +
          (channelImpact?.delayMinutesDelta ?? 0) * 0.35 -
          recoveryDelayRelief,
        0,
        240,
      ),
    );
    const averageSpeedKnots = Number(
      clampNumber(
        route.averageSpeedKnots +
          (routeImpact?.speedKnotsDelta ?? 0) +
          (channelImpact?.speedKnotsDelta ?? 0) * 0.35,
        6,
        22,
      ).toFixed(1),
    );
    const tone: StatusTone =
      delayMinutes >= 45 || (!isRecoveryRoute && route.tone === 'danger')
        ? 'danger'
        : delayMinutes >= 18 || (!isRecoveryRoute && route.tone === 'warning')
          ? 'warning'
          : 'ok';

    return {
      ...route,
      delayMinutes,
      averageSpeedKnots,
      tone,
      carbonEmissionTons: Math.round(
        Math.max(0, route.carbonEmissionTons * (1 + eventImpact.carbonMultiplierDelta)),
      ),
    };
  });
  const runtimePorts = baseScenario.ports.map((port) => {
    const impact = eventImpact.portImpactById.get(port.id);
    const recoveryCongestionRelief = impact ? rlCongestionReliefPoints : 0;
    const recoveryQueueRelief = impact ? rlCongestionReliefPoints * 0.38 : 0;
    const recoveryWaitingRelief = impact ? rlDelayReliefMinutes / 60 : 0;
    const queueVessels = Math.round(
      clampNumber(
        port.queueVessels + (impact?.queueDelta ?? 0) - recoveryQueueRelief,
        0,
        180,
      ),
    );
    const congestionPercent = Math.round(
      clampNumber(
        port.congestionPercent + (impact?.congestionDelta ?? 0) - recoveryCongestionRelief,
        0,
        100,
      ),
    );
    const berthUtilizationPercent = Math.round(
      clampNumber(
        port.berthUtilizationPercent +
          (impact?.berthUtilizationDelta ?? 0) -
          recoveryCongestionRelief * 0.42,
        0,
        100,
      ),
    );
    const averageWaitingHours = Number(
      clampNumber(
        port.averageWaitingHours +
          (impact?.waitingHoursDelta ?? 0) -
          recoveryWaitingRelief,
        0.2,
        12,
      ).toFixed(1),
    );
    const tone = getPortCongestionTone(getPortCongestionLevel(congestionPercent));

    return {
      ...port,
      queueVessels,
      congestionPercent,
      berthUtilizationPercent,
      averageWaitingHours,
      berthCount: Math.max(1, Math.round(port.berthCount + (impact?.berthCountDelta ?? 0))),
      tone,
      status: tone === 'danger' ? '拥堵' : tone === 'warning' ? '预警' : '正常',
    };
  });
  const runtimeVesselMarkers = baseScenario.vesselMarkers.map((vessel) => {
    const routeImpact = eventImpact.routeImpactById.get(vessel.flowId);
    const channelImpact = eventImpact.channelImpactById.get(vessel.assignedChannelId);

    return {
      ...vessel,
      speedKnots: Number(
        clampNumber(
          vessel.speedKnots +
            (routeImpact?.speedKnotsDelta ?? 0) +
            (channelImpact?.speedKnotsDelta ?? 0) +
            (channelImpact ? -0.25 : 0),
          6,
          24,
        ).toFixed(1),
      ),
    };
  });
  const scenario = {
    ...baseScenario,
    ports: runtimePorts,
    channels: runtimeChannels,
    routeOverlays: runtimeRouteOverlays,
    vesselMarkers: runtimeVesselMarkers,
    weather: effectiveWeather,
  };

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpandedPanelTitle(null);
        setIsEventInjectionPanelOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!isSimulationRunning) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setSandboxRuntime((runtime) => ({
        ...runtime,
        elapsedMinutes: runtime.elapsedMinutes + simulationSpeed,
        policyRecovery: advanceRlPolicyRecovery(runtime.policyRecovery, simulationSpeed),
      }));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isSimulationRunning, simulationSpeed]);

  useEffect(() => {
    const persisted = {
      ...rlTraining,
      backend: { ...rlTraining.backend, authToken: '' },
    };
    window.localStorage.setItem(RL_TRAINING_STORAGE_KEY, JSON.stringify(persisted));
  }, [rlTraining]);

  useEffect(() => {
    if (rlBenchmark) {
      window.localStorage.setItem(RL_BENCHMARK_STORAGE_KEY, JSON.stringify(rlBenchmark));
    } else {
      window.localStorage.removeItem(RL_BENCHMARK_STORAGE_KEY);
    }
  }, [rlBenchmark]);

  useEffect(() => {
    if (!rlTraining.jobId || !['queued', 'running', 'completed'].includes(rlTraining.status)) {
      return undefined;
    }
    const controller = new AbortController();
    let timer: number | undefined;
    const poll = async () => {
      try {
        const job = await fetchRlTrainingJob(
          rlTraining.jobId!,
          rlTraining.backend.authToken,
          controller.signal,
        );
        setRlTrainingJob(job);
        if (job.result) {
          setRlBenchmark(job.result);
          const best = job.result.results.find((result) => result.id === job.result?.bestAlgorithmId);
          setRlBenchmarkMessage(
            `验证集选优完成 · 最优 ${best?.label ?? job.result.bestAlgorithmId} · 最终测试待显式执行 · 数据指纹 ${job.result.dataset.fingerprint}`,
          );
        }
        const stageId: RlTrainingStageId =
          job.phase === 'loading-dataset' ? 'snapshot-build'
            : job.phase === 'training' && job.progressPercent < 72 ? 'baseline-warmup'
              : job.phase === 'training' ? 'policy-rollout'
                : job.phase === 'evaluating' ? 'evaluation'
                  : job.phase === 'checkpointing' || job.phase === 'completed' ? 'interface-package'
                    : getRlTrainingStageByProgress(job.progressPercent).id;
        setSandboxRuntime((runtime) => ({
          ...runtime,
          rlTraining: {
            ...runtime.rlTraining,
            status: job.status,
            selectedAlgorithmId: job.status === 'completed' && job.result
              ? job.result.bestAlgorithmId
              : runtime.rlTraining.selectedAlgorithmId,
            progressPercent: job.progressPercent,
            currentStageId: stageId,
            startedAt: job.startedAt,
            startedAtEpochMs: job.startedAt ? Date.parse(job.startedAt) : runtime.rlTraining.startedAtEpochMs,
            episodeCursor: job.completedEpisodes,
            completedAt: job.completedAt,
            backend: {
              ...runtime.rlTraining.backend,
              status: job.status === 'failed' ? 'failed' : 'connected',
              lastMessage: job.message,
            },
            policyTest: {
              ...runtime.rlTraining.policyTest,
              status:
                job.status === 'completed' && runtime.rlTraining.policyTest.status === 'locked'
                  ? 'idle'
                  : runtime.rlTraining.policyTest.status,
            },
          },
        }));
        if (job.status === 'queued' || job.status === 'running') {
          timer = window.setTimeout(() => void poll(), 650);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setSandboxRuntime((runtime) => ({
          ...runtime,
          rlTraining: {
            ...runtime.rlTraining,
            status: 'failed',
            backend: {
              ...runtime.rlTraining.backend,
              status: 'failed',
              lastMessage: error instanceof Error ? error.message : '训练任务轮询失败',
            },
          },
        }));
      }
    };
    void poll();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [rlTraining.backend.authToken, rlTraining.jobId, rlTraining.status]);

  useEffect(() => {
    if (rlTraining.policyTest.status !== 'running' || !rlPolicyEvaluation) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setSandboxRuntime((runtime) => {
        if (runtime.rlTraining.policyTest.status !== 'running') {
          return runtime;
        }

        const nextCursor = Math.min(
          rlPolicyEvaluation.trace.length - 1,
          runtime.rlTraining.policyTest.logCursor + 1,
        );
        const nextProgress = (nextCursor + 1) / Math.max(1, rlPolicyEvaluation.trace.length) * 100;
        const isCompleted = nextCursor >= rlPolicyEvaluation.trace.length - 1;

        return {
          ...runtime,
          rlTraining: {
            ...runtime.rlTraining,
            policyTest: {
              ...runtime.rlTraining.policyTest,
              status: isCompleted ? 'completed' : 'running',
              progressPercent: nextProgress,
              logCursor: nextCursor,
              completedAt: isCompleted ? scenarioClockLabel : null,
            },
          },
        };
      });
    }, 650);

    return () => window.clearInterval(timer);
  }, [rlPolicyEvaluation, rlTraining.policyTest.status, scenarioClockLabel]);

  useEffect(() => {
    if (rlTraining.status !== 'completed') {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setRlTrainingWindowState((windowState) => ({
        ...windowState,
        isOpen: true,
        isMinimized: false,
        isCollapsed: false,
        closedCardIds: windowState.closedCardIds.filter((cardId) => cardId !== 'policy-test'),
        collapsedCardIds: windowState.collapsedCardIds.filter((cardId) => cardId !== 'policy-test'),
      }));
    }, 0);

    return () => window.clearTimeout(timer);
  }, [rlTraining.status]);

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', syncFullscreenState);
    syncFullscreenState();

    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
    };
  }, []);

  useEffect(() => {
    let canceled = false;

    const checkGodotSimulator = async () => {
      setGodotSimulatorStatus('checking');

      try {
        const response = await fetch(GODOT_SIMULATOR_URL, {
          cache: 'no-store',
          method: 'HEAD',
        });

        if (!canceled) {
          setGodotSimulatorStatus(response.ok ? 'available' : 'missing');
        }
      } catch {
        try {
          const response = await fetch(GODOT_SIMULATOR_URL, { cache: 'no-store' });

          if (!canceled) {
            setGodotSimulatorStatus(response.ok ? 'available' : 'missing');
          }
        } catch {
          if (!canceled) {
            setGodotSimulatorStatus('missing');
          }
        }
      }
    };

    void checkGodotSimulator();

    return () => {
      canceled = true;
    };
  }, [godotSimulatorReloadKey]);

  useEffect(() => {
    const receiveGodotMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !event.data || typeof event.data !== 'object') {
        return;
      }
      const envelope = event.data as { type?: string; payload?: unknown };
      if (
        envelope.type !== 'godot.validation.result' &&
        envelope.type !== 'malacca.godot.validation.result'
      ) {
        return;
      }
      const result = envelope.payload as Partial<GodotValidationResult> | undefined;
      if (result?.requestId && result.vesselId && result.status) {
        godotResultReceiverRef.current(result as GodotValidationResult);
      }
    };
    window.addEventListener('message', receiveGodotMessage);
    return () => window.removeEventListener('message', receiveGodotMessage);
  }, []);

  useEffect(() => {
    if (!isGodotSimulatorOpen || !generatedGodotRequest || godotSimulatorStatus !== 'available') {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      godotSimulatorFrameRef.current?.contentWindow?.postMessage(
        {
          source: 'malacca-port-resilience-sandbox',
          type: 'godot.validation.request',
          protocolVersion: 'godot-validation.v1',
          payload: generatedGodotRequest,
        },
        window.location.origin,
      );
    }, 650);
    return () => window.clearTimeout(timer);
  }, [generatedGodotRequest, godotSimulatorStatus, isGodotSimulatorOpen]);

  useEffect(() => {
    if (portDataConfig.mode === 'demo') return undefined;

    let canceled = false;
    let activeController: AbortController | null = null;

    const refresh = async () => {
      activeController?.abort();
      activeController = new AbortController();
      setPortDataStatus('connecting');
      setPortDataMessage(`正在同步 ${portDataConfig.endpoint}`);

      try {
        const timeout = window.setTimeout(() => activeController?.abort(), 8000);
        const result = await loadPortTelemetry(
          portDataConfig,
          malaccaScenario,
          activeController.signal,
        ).finally(() => window.clearTimeout(timeout));
        if (canceled) return;
        setBaseScenario(result.scenario);
        setPortDataObservedAt(result.observedAt);
        setPublicEvidence(result.evidence ?? null);
        setPortDataStatus(portDataConfig.mode === 'public' ? 'public' : 'live');
        setPortDataMessage(`${result.source} · ${new Date(result.observedAt).toLocaleString()}`);
      } catch (error) {
        if (canceled) return;
        setBaseScenario(malaccaScenario);
        setPublicEvidence(null);
        setPortDataObservedAt(null);
        setPortDataStatus('fallback');
        setPortDataMessage(
          `${error instanceof Error ? error.message : '数据接口不可用'}；等待接入港口，当前仅保留明确标注的仿真沙盘，不作为实证数据`,
        );
      }
    };

    void refresh();
    const timer = window.setInterval(refresh, portDataConfig.pollingSeconds * 1000);
    return () => {
      canceled = true;
      activeController?.abort();
      window.clearInterval(timer);
    };
  }, [portDataConfig, portDataRefreshToken]);

  const setPortDataMode = (mode: PortDataConfig['mode']) => {
    setPortDataConfig((config) => ({
      ...config,
      mode,
      endpoint:
        mode === 'public'
          ? '/api/public-data/snapshot'
          : mode === 'live' && config.endpoint === '/api/public-data/snapshot'
            ? 'http://127.0.0.1:8090/api/v1/port-network/snapshot'
            : config.endpoint,
    }));
    if (mode === 'demo') {
      setBaseScenario(malaccaScenario);
      setPublicEvidence(null);
      setPortDataObservedAt(null);
      setPortDataStatus('demo');
      setPortDataMessage('内置合成示例已加载；仅用于界面和接口验证，不作为港口实证');
    }
  };

  const updatePortDataConfig = (
    field: 'endpoint' | 'apiKey' | 'pollingSeconds',
    value: string | number,
  ) => {
    setPortDataConfig((config) => ({ ...config, [field]: value }));
  };

  const toggleSimulation = () => {
    setSandboxRuntime((runtime) => ({
      ...runtime,
      isSimulationRunning: !runtime.isSimulationRunning,
    }));
  };

  const resetSimulation = () => {
    setSandboxRuntime(createInitialSandboxRuntime());
    setIsGodotSimulatorOpen(false);
    setHasPreviewedGodotSimulator(false);
    setIsEventInjectionPanelOpen(false);
    setIsRlDecisionPanelOpen(false);
    setRlInferenceStatus('idle');
    setRlInferenceProgress(0);
    setRlPolicyInference(null);
    setRlPolicyApplied(false);
    setRlDisturbance({ type: 'none', intensity: 0 });
    setOpenMapOverlays({
      congestion: false,
      delay: false,
      carbon: false,
      strategy: false,
      propagation: false,
    });
  };

  const advanceSimulation = () => {
    setSandboxRuntime((runtime) => ({
      ...runtime,
      elapsedMinutes: runtime.elapsedMinutes + advanceMinutesStep,
      policyRecovery: advanceRlPolicyRecovery(runtime.policyRecovery, advanceMinutesStep),
    }));
  };

  const openEventInjectionPanel = () => {
    setSelectedEventTemplateId(
      eventInjectionTemplates[sandboxRuntime.injectionCursor % eventInjectionTemplates.length].id,
    );
    setIsRlDecisionPanelOpen(false);
    setIsEventInjectionPanelOpen(true);
  };

  const injectScenarioEvent = (templateId: string) => {
    const eventTemplate =
      eventInjectionTemplates.find((template) => template.id === templateId) ??
      eventInjectionTemplates[0];
    const firstAffectedVessel = baseScenario.vesselMarkers.find(
      (vessel) =>
        eventTemplate.impact.routeIds?.includes(vessel.flowId) ||
        eventTemplate.impact.channelIds?.includes(vessel.assignedChannelId) ||
        eventTemplate.impact.portIds?.includes(vessel.destinationPortId),
    );

    setHasPreviewedGodotSimulator(false);
    setRlPolicyApplied(false);
    setRlDisturbance({ type: 'none', intensity: 0 });
    setIsEventInjectionPanelOpen(false);
    setIsRlDecisionPanelOpen(false);
    setRlInferenceStatus('idle');
    setRlInferenceProgress(0);
    setRlInferenceRunId(0);
    setRlPolicyInference(null);
    setOpenMapOverlays((panels) => ({
      ...panels,
      delay: true,
      propagation: true,
      strategy: false,
    }));
    setRouteLayerFilter('all');
    setVesselCategoryFilter('all');
    if (firstAffectedVessel) {
      setValidationSelection({ type: 'vessel', id: firstAffectedVessel.id });
    }
    setSandboxRuntime((runtime) => {
      return {
        ...runtime,
        injectedEvents: [
          {
            id: `injected-${runtime.injectionCursor}`,
            time: formatScenarioTime(scenarioClock),
            message: eventTemplate.message,
            tone: eventTemplate.tone,
            templateId: eventTemplate.id,
            impact: eventTemplate.impact,
          },
          ...runtime.injectedEvents,
        ].slice(0, 5),
        injectionCursor: runtime.injectionCursor + 1,
        activeDemoCaseId: null,
        generatedGodotRequest: null,
        importedGodotResult: null,
        policyRecovery: {
          status: 'idle',
          advancedMinutes: 0,
          targetMinutes: defaultRlPolicyRecoveryMinutes,
        },
        phases: patchSandboxPhases(runtime.phases, [
          {
            id: 'event-sensing',
            status: 'completed',
            completedAt: scenarioClockLabel,
            completedMinute: runtime.elapsedMinutes,
            summary: eventTemplate.message.replace('事件注入：', ''),
          },
          {
            id: 'pressure-spread',
            status: 'completed',
            startedAt: scenarioClockLabel,
            startedMinute: runtime.elapsedMinutes,
            completedAt: scenarioClockLabel,
            completedMinute: runtime.elapsedMinutes,
            summary: eventTemplate.impact.summary,
          },
          {
            id: 'vessel-dispatch',
            status: 'pending',
            startedAt: pendingPhaseStartLabel,
            startedMinute: 0,
            completedAt: undefined,
            completedMinute: undefined,
            summary: '事件影响已完成传播计算，等待点击 RL 策略推理',
          },
          {
            id: 'micro-validation',
            status: 'pending',
            startedAt: pendingPhaseStartLabel,
            startedMinute: 0,
            completedAt: undefined,
            completedMinute: undefined,
            summary: sandboxPhaseDefinitions['micro-validation'].initialSummary,
          },
          {
            id: 'metric-feedback',
            status: 'pending',
            startedAt: pendingPhaseStartLabel,
            startedMinute: 0,
            completedAt: undefined,
            completedMinute: undefined,
            summary: sandboxPhaseDefinitions['metric-feedback'].initialSummary,
          },
        ]),
      };
    });
  };

  const selectValidationVessel = (vesselId: string) => {
    setValidationSelection({ type: 'vessel', id: vesselId });
    setSandboxRuntime((runtime) => ({
      ...runtime,
      generatedGodotRequest: null,
      importedGodotResult: null,
      activeDemoCaseId: null,
      phases: patchSandboxPhases(runtime.phases, [
        {
          id: 'event-sensing',
          status: 'completed',
          completedAt: scenarioClockLabel,
          completedMinute: runtime.elapsedMinutes,
          summary:
            runtime.injectedEvents[0]?.message.replace('事件注入：', '') ??
            '运行态势信号已完成归档',
        },
        {
          id: 'pressure-spread',
          status: 'completed',
          startedAt: scenarioClockLabel,
          startedMinute: runtime.elapsedMinutes,
          completedAt: scenarioClockLabel,
          completedMinute: runtime.elapsedMinutes,
          summary: '已沿当前港口与航线完成影响传播，等待调度对象刷新',
        },
        {
          id: 'vessel-dispatch',
          status: 'running',
          startedAt: scenarioClockLabel,
          startedMinute: runtime.elapsedMinutes,
          completedAt: undefined,
          completedMinute: undefined,
          summary: '验证对象已切换，等待生成信息流刷新调度方案',
        },
        {
          id: 'micro-validation',
          status: 'pending',
          startedAt: pendingPhaseStartLabel,
          startedMinute: 0,
          completedAt: undefined,
          completedMinute: undefined,
          summary: sandboxPhaseDefinitions['micro-validation'].initialSummary,
        },
        {
          id: 'metric-feedback',
          status: 'pending',
          startedAt: pendingPhaseStartLabel,
          startedMinute: 0,
          completedAt: undefined,
          completedMinute: undefined,
          summary: sandboxPhaseDefinitions['metric-feedback'].initialSummary,
        },
      ]),
    }));
    setActiveModule('sandbox');
    setIsGodotSimulatorOpen(false);
    setHasPreviewedGodotSimulator(false);
  };

  const selectValidationRoute = (routeId: string) => {
    setValidationSelection({ type: 'route', id: routeId });
    setSandboxRuntime((runtime) => ({
      ...runtime,
      generatedGodotRequest: null,
      importedGodotResult: null,
      activeDemoCaseId: null,
      phases: patchSandboxPhases(runtime.phases, [
        {
          id: 'event-sensing',
          status: 'completed',
          completedAt: scenarioClockLabel,
          completedMinute: runtime.elapsedMinutes,
          summary:
            runtime.injectedEvents[0]?.message.replace('事件注入：', '') ??
            '运行态势信号已完成归档',
        },
        {
          id: 'pressure-spread',
          status: 'completed',
          startedAt: scenarioClockLabel,
          startedMinute: runtime.elapsedMinutes,
          completedAt: scenarioClockLabel,
          completedMinute: runtime.elapsedMinutes,
          summary: '已沿当前港口与航线完成影响传播，等待调度对象刷新',
        },
        {
          id: 'vessel-dispatch',
          status: 'running',
          startedAt: scenarioClockLabel,
          startedMinute: runtime.elapsedMinutes,
          completedAt: undefined,
          completedMinute: undefined,
          summary: '验证对象已切换，等待生成信息流刷新调度方案',
        },
        {
          id: 'micro-validation',
          status: 'pending',
          startedAt: pendingPhaseStartLabel,
          startedMinute: 0,
          completedAt: undefined,
          completedMinute: undefined,
          summary: sandboxPhaseDefinitions['micro-validation'].initialSummary,
        },
        {
          id: 'metric-feedback',
          status: 'pending',
          startedAt: pendingPhaseStartLabel,
          startedMinute: 0,
          completedAt: undefined,
          completedMinute: undefined,
          summary: sandboxPhaseDefinitions['metric-feedback'].initialSummary,
        },
      ]),
    }));
    setActiveModule('sandbox');
    setIsGodotSimulatorOpen(false);
    setHasPreviewedGodotSimulator(false);
  };

  const portById = new Map(scenario.ports.map((port) => [port.id, port]));
  const portNameById = new Map(scenario.ports.map((port) => [port.id, port.name]));
  const channelById = new Map(scenario.channels.map((channel) => [channel.id, channel]));
  const routeById = new Map(scenario.routeOverlays.map((route) => [route.id, route]));
  const maxRouteVolume = Math.max(...scenario.routeOverlays.map((route) => route.vesselVolume));
  const trendValues = scenario.carbon.hourlyTrend;
  const maxTrendValue = Math.max(...trendValues.map((item) => item.value));
  const trendPolyline = trendValues
    .map((item, index) => {
      const x = (index / (trendValues.length - 1)) * 260;
      const y = 96 - (item.value / maxTrendValue) * 72;
      return `${x.toFixed(0)},${y.toFixed(0)}`;
    })
    .join(' ');
  const carbonAxisLabels = trendValues
    .filter((item) => ['00时', '06时', '12时', '18时', '24时'].includes(item.hour))
    .map((item) => item.hour);
  const carbonLatestTrend = trendValues[trendValues.length - 1];
  const carbonPeakTrend = trendValues.reduce((peak, item) =>
    item.value > peak.value ? item : peak,
  );
  const windDirectionDeg =
    windDirectionDegreesByName[scenario.weather.windDirection] ?? 0;
  const weatherCards = [
    {
      id: 'wind-speed',
      label: '风速',
      value: scenario.weather.windSpeedMs,
      unit: 'm/s',
      detail: scenario.weather.windDirection,
      icon: Wind,
    },
    {
      id: 'wind-direction',
      label: '风向',
      value: scenario.weather.windDirection,
      unit: '',
      detail: `${windDirectionDeg}°`,
      icon: Compass,
    },
    {
      id: 'wave-height',
      label: '浪高',
      value: scenario.weather.waveHeightM,
      unit: 'm',
      detail: '海峡平均',
      icon: Waves,
    },
    {
      id: 'current-speed',
      label: '流速',
      value: scenario.weather.currentSpeedKnots,
      unit: 'kn',
      detail: '表层海流',
      icon: Gauge,
    },
    {
      id: 'water-temperature',
      label: '水温',
      value: scenario.weather.waterTemperatureC,
      unit: '°C',
      detail: '海面温度',
      icon: ThermometerSun,
    },
    {
      id: 'pressure',
      label: '气压',
      value: scenario.weather.pressureHpa,
      unit: 'hPa',
      detail: '海平面',
      icon: CloudSun,
    },
    {
      id: 'visibility',
      label: '能见度',
      value: scenario.weather.visibilityKm,
      unit: 'km',
      detail: '航道视距',
      icon: CircleGauge,
    },
  ];
  const vesselTotal = scenario.vesselTypeStats.reduce((total, item) => total + item.count, 0);
  const vesselRingGradient = scenario.vesselTypeStats
    .reduce(
      (acc, item) => {
        const color = vesselColorByCategory[item.category];
        const start = acc.cursor;
        const end = Math.min(100, start + item.percent);
        return {
          cursor: end,
          segments: [...acc.segments, `${color} ${start}% ${end}%`],
        };
      },
      { cursor: 0, segments: [] as string[] },
    )
    .segments
    .join(', ');
  const overviewStats = [
    {
      id: 'port-count',
      label: '港口数量',
      value: scenario.overview.portCount,
      unit: '座',
      detail: `核心节点 ${scenario.ports.length}`,
      icon: Anchor,
      tone: 'ok',
    },
    {
      id: 'channel-count',
      label: '航道数量',
      value: scenario.overview.channelCount,
      unit: '条',
      detail: `动态航线 ${scenario.routeOverlays.length}`,
      icon: Route,
      tone: 'ok',
    },
    {
      id: 'anchorage-count',
      label: '锚地数量',
      value: scenario.overview.anchorageCount,
      unit: '处',
      detail: '覆盖海峡全域',
      icon: MapPinned,
      tone: 'warning',
    },
    {
      id: 'vessel-total',
      label:
        portDataStatus === 'public'
          ? '月度到港船舶'
          : portDataStatus === 'live'
            ? '实时船舶总数'
            : '代表船统计',
      value: scenario.overview.monitoredVesselCount,
      unit: '艘',
      detail:
        portDataStatus === 'public'
          ? `MPA ${publicEvidence?.mpa.period ?? '公开数据期'}`
          : portDataStatus === 'live'
            ? '授权 AIS 在线监测'
            : '合成场景映射',
      icon: Ship,
      tone: 'ok',
    },
  ];
  const heatmapRoutes = scenario.routeOverlays.map((route) => {
    const channel = channelById.get(route.channelId);
    const congestion = (channel?.congestionPercent ?? 0) / 100;
    const delayRisk = Math.min(1, route.delayMinutes / 40);
    const density = Math.min(1, route.vesselVolume / maxRouteVolume);
    const toneRisk = route.tone === 'danger' ? 0.82 : route.tone === 'warning' ? 0.58 : 0.32;
    const intensity = Math.min(1, Math.max(congestion, delayRisk, density * 0.8, toneRisk));
    const tone = getHeatmapTone(intensity);

    return {
      ...route,
      channel,
      density,
      intensity,
      tone,
    };
  });
  const heatmapHotspots = scenario.congestionHeatmap.hotspots.flatMap((hotspot) => {
    const port = portById.get(hotspot.nodeId);

    if (!port) {
      return [];
    }

    const isRecoveryHotspot = eventImpact.portImpactById.has(hotspot.nodeId);
    const queueRisk =
      Math.min(1, port.queueVessels / 80) *
      (isRecoveryHotspot ? 1 - rlPolicyRecoveryProgress * 0.72 : 1);
    const hotspotFloor = isRecoveryHotspot
      ? hotspot.intensity * (1 - rlPolicyRecoveryProgress * 0.72)
      : hotspot.intensity;
    const intensity = Math.min(
      1,
      Math.max(hotspotFloor, port.congestionPercent / 100, queueRisk),
    );
    const tone = getHeatmapTone(intensity);

    return [
      {
        ...hotspot,
        port,
        intensity,
        tone,
      },
    ];
  });
  const incidentPressure = eventImpact.incidentPressure;
  const monitoredRuntimePorts = monitoredPorts.map((port) => portById.get(port.id) ?? port);
  const portCongestionSimulations = monitoredRuntimePorts.map((port, index): PortCongestionSimulation => {
    const cycle = Math.floor(elapsedMinutes / 15) + index;
    const arrivalPulse = 0.88 + (cycle % 5) * 0.06;
    const arrivingVessels = Math.max(1, Math.round(port.vesselCount * 0.045 * arrivalPulse));
    const activeBerths = Math.max(1, Math.round(port.berthCount * (port.berthUtilizationPercent / 100)));
    const berthingVessels = Math.max(1, Math.min(port.berthCount, activeBerths));
    const handlingVessels = Math.max(1, Math.round(berthingVessels * 0.68));
    const departingVessels = Math.max(1, Math.round(berthingVessels * 0.22 + (cycle % 3)));
    const queueingVessels = Math.max(0, port.queueVessels + arrivingVessels - departingVessels);
    const queuePressure = Math.min(100, (queueingVessels / Math.max(1, port.berthCount)) * 38);
    const recoveryCongestionRelief = eventImpact.portImpactById.has(port.id)
      ? rlCongestionReliefPoints * 0.58
      : 0;
    const congestionScore = clampNumber(
      Math.round(
        port.congestionPercent * 0.42 +
          port.berthUtilizationPercent * 0.28 +
          queuePressure * 0.3 +
          incidentPressure -
          recoveryCongestionRelief,
      ),
      0,
      100,
    );
    const congestionLevel = getPortCongestionLevel(congestionScore);
    const expectedWaitingHours = Math.max(
      0.2,
      port.averageWaitingHours +
        (queueingVessels / Math.max(1, port.berthCount)) * 0.24 +
        (congestionScore / 100) * 0.65,
    );

    return {
      portId: port.id,
      portName: port.name,
      arrivingVessels,
      queueingVessels,
      berthingVessels,
      handlingVessels,
      departingVessels,
      expectedWaitingHours,
      congestionScore,
      congestionLevel,
      tone: getPortCongestionTone(congestionLevel),
    };
  });
  const rankedPortCongestion = [...portCongestionSimulations].sort(
    (left, right) => right.congestionScore - left.congestionScore,
  );
  const peakPortCongestion = rankedPortCongestion[0];
  const peakStageMax = Math.max(
    1,
    ...portCongestionStages.map((stage) => peakPortCongestion[stage.key]),
  );
  const portCongestionById = new Map(
    portCongestionSimulations.map((item) => [item.portId, item]),
  );
  const weatherDelayBase = Math.round(
    Math.max(0, scenario.weather.waveHeightM - 0.8) * 7 +
      Math.max(0, scenario.weather.windSpeedMs - 10) * 0.9 +
      Math.max(0, 10 - scenario.weather.visibilityKm) * 1.4 +
      Math.max(0, scenario.weather.currentSpeedKnots - 0.6) * 5 +
      Math.max(0, eventImpact.weather.windSpeedMsDelta) * 0.6 +
      Math.max(0, -eventImpact.weather.visibilityKmDelta) * 1.8,
  );
  const vesselDelaySimulations = scenario.vesselMarkers.flatMap((vessel): VesselDelaySimulation[] => {
    const route = routeById.get(vessel.flowId);

    if (!route) {
      return [];
    }

    const destinationPort = portById.get(vessel.destinationPortId);
    const destinationCongestion = portCongestionById.get(vessel.destinationPortId);
    const channel = channelById.get(vessel.assignedChannelId) ?? channelById.get(route.channelId);
    const policyDelayRelief = affectedVesselIdSet.has(vessel.id)
      ? rlDelayReliefMinutes
      : 0;
    const rawCongestionDelayMinutes = Math.round(
      (destinationCongestion?.congestionScore ?? destinationPort?.congestionPercent ?? 0) * 0.26 +
        (destinationCongestion?.queueingVessels ?? destinationPort?.queueVessels ?? 0) * 0.12,
    );
    const congestionDelayMinutes = Math.max(
      0,
      Math.round(rawCongestionDelayMinutes - policyDelayRelief * 0.7),
    );
    const weatherDelayMinutes = Math.round(weatherDelayBase * (1 + vessel.progressPercent / 180));
    const speedGap = Math.max(0, route.averageSpeedKnots - vessel.speedKnots);
    const speedDelayMinutes = Math.round(speedGap * 4.5);
    const channelToneRisk = route.tone === 'danger' || channel?.tone === 'danger'
      ? 18
      : route.tone === 'warning' || channel?.tone === 'warning'
        ? 9
        : 3;
    const routeImpact = eventImpact.routeImpactById.get(route.id);
    const channelImpact = eventImpact.channelImpactById.get(channel?.id ?? '');
    const riskDelayMinutes = Math.max(
      0,
      Math.round(
        channelToneRisk +
          (channel?.delayMinutes ?? route.delayMinutes) * 0.32 +
          incidentPressure * 0.45 +
          (routeImpact?.riskDelayMinutesDelta ?? 0) * 0.42 +
          (channelImpact?.riskDelayMinutesDelta ?? 0) * 0.34 -
          policyDelayRelief * 0.3,
      ),
    );
    const delayParts = [
      { label: '拥堵', value: congestionDelayMinutes },
      { label: '天气', value: weatherDelayMinutes },
      { label: '航速', value: speedDelayMinutes },
      { label: '风险', value: riskDelayMinutes },
    ];
    const dominantFactor = delayParts.reduce((peak, item) =>
      item.value > peak.value ? item : peak,
    ).label;
    const delayMinutes = Math.round(
      congestionDelayMinutes + weatherDelayMinutes + speedDelayMinutes + riskDelayMinutes,
    );

    return [
      {
        vesselId: vessel.id,
        vesselName: vessel.name,
        routeLabel: route.label,
        destinationPortName: destinationPort?.name ?? vessel.destinationPortId,
        delayMinutes,
        congestionDelayMinutes,
        weatherDelayMinutes,
        speedDelayMinutes,
        riskDelayMinutes,
        dominantFactor,
        tone: getDelayTone(delayMinutes),
      },
    ];
  });
  const vesselDelayById = new Map(
    vesselDelaySimulations.map((item) => [item.vesselId, item]),
  );
  const rankedVesselDelays = [...vesselDelaySimulations].sort(
    (left, right) => right.delayMinutes - left.delayMinutes,
  );
  const peakVesselDelay = rankedVesselDelays[0];
  const vesselEmissionSimulations = scenario.vesselMarkers.flatMap((vessel): VesselEmissionSimulation[] => {
    const route = routeById.get(vessel.flowId);

    if (!route) {
      return [];
    }

    const profile = fuelProfileByCategory[vessel.category];
    const distanceNm = routeDistanceNmById[route.id] ?? 260;
    const destinationPort = portById.get(vessel.destinationPortId);
    const destinationCongestion = portCongestionById.get(vessel.destinationPortId);
    const vesselDelay = vesselDelayById.get(vessel.id);
    const waitingHours = Math.max(
      0.1,
      (destinationCongestion?.expectedWaitingHours ?? destinationPort?.averageWaitingHours ?? 0.8) +
        (vesselDelay?.delayMinutes ?? 0) / 120,
    );
    const safeSpeed = Math.max(6, vessel.speedKnots);
    const sailingHours = distanceNm / safeSpeed;
    const speedLoadFactor = Math.pow(safeSpeed / profile.referenceSpeedKnots, 3);
    const sailingFuelTons = profile.dailyFuelTons * (sailingHours / 24) * speedLoadFactor;
    const waitingFuelTons = profile.waitingFuelTonsPerHour * waitingHours;
    const fuelTons = sailingFuelTons + waitingFuelTons;
    const baselineSailingHours = distanceNm / Math.max(6, route.averageSpeedKnots);
    const baselineSpeedLoadFactor = Math.pow(route.averageSpeedKnots / profile.referenceSpeedKnots, 3);
    const baselineWaitingHours = Math.max(0.1, destinationPort?.averageWaitingHours ?? 0.8);
    const baselineFuelTons =
      profile.dailyFuelTons * (baselineSailingHours / 24) * baselineSpeedLoadFactor +
      profile.waitingFuelTonsPerHour * baselineWaitingHours;
    const carbonTons =
      fuelTons * carbonTonsPerFuelTon * clampNumber(1 + eventImpact.carbonMultiplierDelta, 0.68, 1.35);
    const baselineCarbonTons = baselineFuelTons * carbonTonsPerFuelTon;
    const carbonChangePercent =
      ((carbonTons - baselineCarbonTons) / Math.max(1, baselineCarbonTons)) * 100;

    return [
      {
        vesselId: vessel.id,
        vesselName: vessel.name,
        vesselCategory: vessel.category,
        routeLabel: route.label,
        distanceNm,
        speedKnots: vessel.speedKnots,
        waitingHours,
        fuelTons,
        carbonTons,
        carbonChangePercent,
        baselineCarbonTons,
        tone: getEmissionTone(carbonChangePercent),
      },
    ];
  });
  const rankedVesselEmissions = [...vesselEmissionSimulations].sort(
    (left, right) => right.carbonTons - left.carbonTons,
  );
  const peakVesselEmission = rankedVesselEmissions[0];
  const totalFuelTons = vesselEmissionSimulations.reduce((total, item) => total + item.fuelTons, 0);
  const totalCarbonTons = vesselEmissionSimulations.reduce((total, item) => total + item.carbonTons, 0);
  const totalBaselineCarbonTons = vesselEmissionSimulations.reduce(
    (total, item) => total + item.baselineCarbonTons,
    0,
  );
  const totalCarbonChangePercent =
    ((totalCarbonTons - totalBaselineCarbonTons) / Math.max(1, totalBaselineCarbonTons)) * 100;
  const emissionPanelTone = getEmissionTone(totalCarbonChangePercent);
  const totalDelayMinutes = vesselDelaySimulations.reduce(
    (total, item) => total + item.delayMinutes,
    0,
  );
  const greenStrategyComparisons = scenario.strategies.map((strategy): GreenStrategyComparison => {
    const strategyEventScoreBoost = eventImpact.strategyScoreBoostByType[strategy.type] ?? 0;
    const statusMultiplier =
      strategy.status === 'recommended' ? 1.08 : strategy.status === 'standby' ? 0.86 : 1;
    const eventMultiplier =
      1 +
      Math.max(0, incidentPressure) * 0.015 +
      Math.min(0.08, elapsedMinutes / 1440) +
      strategyEventScoreBoost * 0.004;
    let affectedVesselIds = new Set(scenario.vesselMarkers.map((vessel) => vessel.id));
    let affectedDelayMinutes = Math.max(1, totalDelayMinutes);
    let affectedCarbonTons = Math.max(1, totalCarbonTons);
    let congestionReference = peakPortCongestion.congestionScore;

    if (strategy.type === 'slow-steaming') {
      const targetChannel = scenario.channels.find(
        (channel) =>
          strategy.target.includes(channel.label) ||
          channel.label.includes(strategy.target) ||
          channel.id === 'eastbound-lane',
      );

      affectedVesselIds = new Set(
        scenario.vesselMarkers
          .filter((vessel) => {
            const route = routeById.get(vessel.flowId);

            return (
              vessel.assignedChannelId === targetChannel?.id ||
              route?.channelId === targetChannel?.id
            );
          })
          .map((vessel) => vessel.id),
      );
      congestionReference = targetChannel?.congestionPercent ?? congestionReference;
    } else if (strategy.type === 'port-diversion') {
      const targetPort = scenario.ports.find(
        (port) => strategy.target.includes(port.name) || strategy.target.includes(port.englishName),
      );

      affectedVesselIds = new Set(
        scenario.vesselMarkers
          .filter((vessel) => vessel.destinationPortId === targetPort?.id)
          .map((vessel) => vessel.id),
      );
      congestionReference =
        portCongestionById.get(targetPort?.id ?? '')?.congestionScore ?? congestionReference;
    } else if (strategy.type === 'off-peak-arrival') {
      const targetPort = scenario.ports.find(
        (port) => strategy.target.includes(port.name) || strategy.target.includes(port.englishName),
      );

      affectedVesselIds = new Set(
        scenario.vesselMarkers
          .filter((vessel) => vessel.destinationPortId === targetPort?.id)
          .map((vessel) => vessel.id),
      );
      const targetCongestion = portCongestionById.get(targetPort?.id ?? '');
      congestionReference = targetCongestion?.congestionScore ?? congestionReference;
      affectedDelayMinutes =
        targetCongestion && affectedVesselIds.size === 0
          ? Math.max(1, targetCongestion.expectedWaitingHours * 60 * 0.62)
          : affectedDelayMinutes;
      affectedCarbonTons =
        affectedVesselIds.size === 0
          ? Math.max(1, totalCarbonTons * 0.22)
          : affectedCarbonTons;
    } else if (strategy.type === 'priority-berthing') {
      affectedVesselIds = new Set(
        scenario.vesselMarkers
          .filter((vessel) => vessel.category === 'container' || vessel.category === 'tanker')
          .map((vessel) => vessel.id),
      );
    } else if (strategy.type === 'route-adjustment') {
      affectedVesselIds = new Set(
        scenario.vesselMarkers
          .filter((vessel) => {
            const route = routeById.get(vessel.flowId);
            const channel = channelById.get(vessel.assignedChannelId) ?? channelById.get(route?.channelId ?? '');

            return (
              route?.tone === 'danger' ||
              route?.tone === 'warning' ||
              channel?.tone === 'danger' ||
              channel?.tone === 'warning'
            );
          })
          .map((vessel) => vessel.id),
      );
      const riskyChannels = scenario.channels.filter(
        (channel) => channel.tone === 'danger' || channel.tone === 'warning',
      );
      congestionReference =
        riskyChannels.reduce((total, channel) => total + channel.congestionPercent, 0) /
        Math.max(1, riskyChannels.length);
    }

    const affectedDelayItems = vesselDelaySimulations.filter((item) =>
      affectedVesselIds.has(item.vesselId),
    );
    const affectedEmissionItems = vesselEmissionSimulations.filter((item) =>
      affectedVesselIds.has(item.vesselId),
    );
    const resolvedAffectedVessels = Math.max(
      1,
      affectedVesselIds.size ||
        Math.round((congestionReference / 100) * Math.max(1, peakPortCongestion.arrivingVessels)),
    );

    if (affectedDelayItems.length > 0) {
      affectedDelayMinutes = affectedDelayItems.reduce((total, item) => total + item.delayMinutes, 0);
    }

    if (affectedEmissionItems.length > 0) {
      affectedCarbonTons = affectedEmissionItems.reduce((total, item) => total + item.carbonTons, 0);
    }

    const delayReductionMinutes = Math.max(
      1,
      Math.round(
        affectedDelayMinutes *
          (strategy.expectedDelayReductionPercent / 100) *
          eventMultiplier *
          statusMultiplier,
      ),
    );
    const carbonReductionTons =
      affectedCarbonTons *
      (strategy.expectedCarbonReductionPercent / 100) *
      eventMultiplier *
      statusMultiplier;
    const fuelSavingTons = carbonReductionTons / carbonTonsPerFuelTon;
    const congestionReductionPercent = Math.min(
      24,
      Math.max(
        2,
        strategy.expectedDelayReductionPercent * 0.42 +
          resolvedAffectedVessels * 0.55 +
          congestionReference * 0.035 +
          incidentPressure * 0.25,
      ),
    );
    let validationScoreBoost = 0;
    if (importedGodotResult) {
      const requestedSpeed = generatedGodotRequest?.speedProfile.targetKnots ?? 0;
      const recommendsSlowerSpeed =
        requestedSpeed > 0 && importedGodotResult.recommendedSpeedKnots < requestedSpeed - 0.2;

      if (strategy.type === 'slow-steaming' && recommendsSlowerSpeed) {
        validationScoreBoost += importedGodotResult.carbonDeltaTons < 0 ? 22 : 12;
      }

      if (
        strategy.type === 'route-adjustment' &&
        (!importedGodotResult.safePass ||
          importedGodotResult.riskLevel === 'high' ||
          importedGodotResult.riskLevel === 'critical')
      ) {
        validationScoreBoost += importedGodotResult.riskLevel === 'critical' ? 28 : 18;
      }

      if (
        strategy.type === 'off-peak-arrival' &&
        importedGodotResult.estimatedTravelMinutes >= 90
      ) {
        validationScoreBoost += 10;
      }
    }
    const score = Math.round(
      delayReductionMinutes * 0.28 +
        carbonReductionTons * 0.22 +
        fuelSavingTons * 1.8 +
        congestionReductionPercent * 1.6 +
        (strategy.status === 'recommended' ? 8 : 0) +
        validationScoreBoost +
        strategyEventScoreBoost,
    );

    return {
      strategyId: strategy.id,
      type: strategy.type,
      label: strategy.label,
      target: strategy.target,
      status:
        validationScoreBoost >= 18 || strategyEventScoreBoost >= 12
          ? 'recommended'
          : strategy.status,
      affectedVessels: resolvedAffectedVessels,
      delayReductionMinutes,
      fuelSavingTons,
      carbonReductionTons,
      congestionReductionPercent,
      score,
      actionSummary:
        validationScoreBoost > 0
          ? `${strategyActionSummaryByType[strategy.type]}；已吸收单船验证结果`
          : strategyEventScoreBoost > 0
            ? `${strategyActionSummaryByType[strategy.type]}；已吸收事件影响引擎`
          : strategyActionSummaryByType[strategy.type],
      tone: getGreenStrategyTone(score),
    };
  });
  const rankedGreenStrategies = [...greenStrategyComparisons].sort(
    (left, right) => right.score - left.score,
  );
  const bestGreenStrategy = rankedGreenStrategies[0];
  const totalStrategyDelayReduction = greenStrategyComparisons.reduce(
    (total, item) => total + item.delayReductionMinutes,
    0,
  );
  const totalStrategyCarbonReduction = greenStrategyComparisons.reduce(
    (total, item) => total + item.carbonReductionTons,
    0,
  );
  const resilienceAssessment: NetworkResilienceAssessment = (() => {
    const bestCongestionRelief = bestGreenStrategy?.congestionReductionPercent ?? 0;
    const routePressureByPortId = new Map(
      scenario.ports.map((port) => {
        const connectedRoutes = scenario.routeOverlays.filter(
          (route) => route.originPortId === port.id || route.destinationPortId === port.id,
        );
        const connectedChannelPressure = port.connectedChannelIds.reduce((total, channelId) => {
          const channel = channelById.get(channelId);

          return total + (channel?.congestionPercent ?? 0) + (channel?.delayMinutes ?? 0) * 0.6;
        }, 0);
        const connectedRoutePressure = connectedRoutes.reduce(
          (total, route) =>
            total +
            Math.min(100, route.vesselVolume / 9) * 0.45 +
            route.delayMinutes * 0.7 +
            (route.tone === 'danger' ? 16 : route.tone === 'warning' ? 9 : 3),
          0,
        );

        return [
          port.id,
          (connectedChannelPressure + connectedRoutePressure) /
            Math.max(1, port.connectedChannelIds.length + connectedRoutes.length),
        ];
      }),
    );
    const nodePressures = monitoredRuntimePorts.map((port) => {
      const congestion = portCongestionById.get(port.id);
      const destinationDelays = vesselDelaySimulations.filter(
        (item) => item.destinationPortName === port.name,
      );
      const averageDestinationDelay =
        destinationDelays.reduce((total, item) => total + item.delayMinutes, 0) /
        Math.max(1, destinationDelays.length);
      const affectedRouteCount = scenario.routeOverlays.filter(
        (route) => route.originPortId === port.id || route.destinationPortId === port.id,
      ).length;
      const pressureScore = clampNumber(
        (congestion?.congestionScore ?? port.congestionPercent) * 0.44 +
          port.berthUtilizationPercent * 0.18 +
          (port.queueVessels / Math.max(1, port.berthCount)) * 24 +
          (routePressureByPortId.get(port.id) ?? 0) * 0.16 +
          averageDestinationDelay * 0.12 +
          incidentPressure * 0.9 -
          bestCongestionRelief * 0.28,
        0,
        100,
      );
      const recoveryHours = clampNumber(
        0.6 +
          pressureScore / 24 +
          (congestion?.queueingVessels ?? port.queueVessels) / Math.max(1, port.berthCount) +
          incidentPressure * 0.08 -
          bestCongestionRelief * 0.035,
        0.3,
        9.5,
      );

      return {
        nodeId: port.id,
        nodeName: port.name,
        pressureScore,
        weightedStress: pressureScore * port.resilienceWeight,
        recoveryHours,
        affectedRouteCount,
        tone: getPressureTone(pressureScore),
      };
    });
    const rankedNodePressures = [...nodePressures].sort(
      (left, right) => right.weightedStress - left.weightedStress,
    );
    const totalNodeWeight = monitoredRuntimePorts.reduce(
      (total, port) => total + port.resilienceWeight,
      0,
    );
    const weightedStressAverage =
      nodePressures.reduce((total, item) => {
        const port = portById.get(item.nodeId);

        return total + item.pressureScore * (port?.resilienceWeight ?? 1);
      }, 0) / Math.max(1, totalNodeWeight);
    const routeRiskAverage =
      scenario.channels.reduce(
        (total, channel) => total + channel.congestionPercent * 0.7 + channel.delayMinutes * 0.65,
        0,
      ) / Math.max(1, scenario.channels.length);
    const stressedNodeCount = nodePressures.filter((item) => item.pressureScore >= 52).length;
    const riskyRouteCount = scenario.routeOverlays.filter((route) => {
      const channel = channelById.get(route.channelId);

      return (
        route.tone !== 'ok' ||
        route.delayMinutes >= 20 ||
        (channel?.tone ?? 'ok') !== 'ok' ||
        (channel?.congestionPercent ?? 0) >= 58
      );
    }).length;
    const averageRecoveryHours =
      nodePressures.reduce((total, item) => total + item.recoveryHours, 0) /
      Math.max(1, nodePressures.length);
    const congestionRecoveryAbility = Math.round(
      clampNumber(
        100 -
          averageRecoveryHours * 8.6 -
          (peakPortCongestion.congestionScore ?? 0) * 0.12 +
          bestCongestionRelief * 0.85 -
          incidentPressure * 0.42,
        0,
        100,
      ),
    );
    const riskSpreadRangePercent = Math.round(
      clampNumber(
        (stressedNodeCount / Math.max(1, monitoredRuntimePorts.length)) * 48 +
          (riskyRouteCount / Math.max(1, scenario.routeOverlays.length)) * 34 +
          incidentPressure * 1.8 +
          Math.max(0, 100 - congestionRecoveryAbility) * 0.14,
        0,
        100,
      ),
    );
    const strategySupport = Math.min(
      7,
      totalStrategyDelayReduction / 120 + totalStrategyCarbonReduction / 260,
    );
    const networkResilienceIndex = Number(
      clampNumber(
        100 -
          weightedStressAverage * 0.38 -
          routeRiskAverage * 0.16 -
          riskSpreadRangePercent * 0.11 -
          Math.max(0, 100 - congestionRecoveryAbility) * 0.12 -
          incidentPressure * 0.48 +
          strategySupport +
          rlResilienceGainPoints,
        0,
        100,
      ).toFixed(1),
    );

    return {
      networkResilienceIndex,
      congestionRecoveryAbility,
      averageRecoveryHours,
      criticalNodePressure: Math.round(rankedNodePressures[0]?.pressureScore ?? 0),
      riskSpreadRangePercent,
      stressedNodeCount,
      affectedRouteCount: riskyRouteCount,
      keyNodePressures: rankedNodePressures,
      tone: getResilienceTone(networkResilienceIndex),
    };
  })();
  const impactPropagationNodes: ImpactPropagationNode[] =
    resilienceAssessment.keyNodePressures.slice(0, 6).flatMap((node) => {
      const port = portById.get(node.nodeId);

      if (!port) {
        return [];
      }

      const congestion = portCongestionById.get(port.id);
      const pressureScore = Math.round(node.pressureScore);

      return [
        {
          id: node.nodeId,
          label: node.nodeName,
          x: parseScreenPercent(port.position.x),
          y: parseScreenPercent(port.position.y),
          pressureScore,
          queueVessels: congestion?.queueingVessels ?? port.queueVessels,
          recoveryHours: node.recoveryHours,
          affectedRouteCount: node.affectedRouteCount,
          intensity: clampNumber(pressureScore / 100, 0.18, 1),
          radius: Math.round(clampNumber(18 + pressureScore * 0.32, 22, 52)),
          tone: node.tone,
        },
      ];
    });
  const impactPropagationNodeById = new Map(
    impactPropagationNodes.map((node) => [node.id, node]),
  );
  const impactPropagationLinks: ImpactPropagationLink[] = [...scenario.routeOverlays]
    .map((route, index) => {
      const channel = channelById.get(route.channelId);
      const originPressure = impactPropagationNodeById.get(route.originPortId)?.pressureScore ?? 0;
      const destinationPressure =
        impactPropagationNodeById.get(route.destinationPortId)?.pressureScore ?? 0;
      const routePressureScore = Math.round(
        clampNumber(
          route.delayMinutes * 1.35 +
            route.vesselVolume / Math.max(1, maxRouteVolume) * 31 +
            (channel?.congestionPercent ?? 0) * 0.34 +
            Math.max(originPressure, destinationPressure) * 0.28 +
            incidentPressure * 1.2 +
            (route.tone === 'danger' ? 18 : route.tone === 'warning' ? 9 : 0),
          0,
          100,
        ),
      );

      return {
        id: route.id,
        label: route.label,
        svgPath: route.svgPath,
        pressureScore: routePressureScore,
        delayMinutes: route.delayMinutes,
        vesselVolume: route.vesselVolume,
        tone: getPressureTone(routePressureScore),
        animationDelaySeconds: index * 0.42,
      };
    })
    .sort((left, right) => right.pressureScore - left.pressureScore)
    .slice(0, 5);
  const peakPropagationNode = impactPropagationNodes[0];
  const peakPropagationLink = impactPropagationLinks[0];
  const propagationTone = getPressureTone(
    Math.max(
      peakPropagationNode?.pressureScore ?? 0,
      peakPropagationLink?.pressureScore ?? 0,
      resilienceAssessment.riskSpreadRangePercent,
    ),
  );
  const propagationEventSummary =
    eventImpact.activeSummaries[0] ??
    scenario.riskAlerts[0]?.estimatedImpact ??
    '港口、航道与风险信号正在联动计算';
  const strategyFlowVectors: StrategyFlowVector[] = rankedGreenStrategies
    .slice(0, 4)
    .flatMap((strategy, index) => {
      let sourcePort: PortNode | undefined;
      let targetPort: PortNode | undefined;
      let routePath: string | undefined;
      const riskyRoute =
        scenario.routeOverlays.find((route) => route.tone === 'danger') ??
        scenario.routeOverlays.find((route) => route.tone === 'warning') ??
        scenario.routeOverlays[0];

      if (strategy.type === 'slow-steaming') {
        const targetChannel = scenario.channels.find(
          (channel) => strategy.target.includes(channel.label) || channel.label.includes(strategy.target),
        );
        const targetRoute =
          scenario.routeOverlays.find((route) => route.channelId === targetChannel?.id) ?? riskyRoute;
        sourcePort = portById.get(targetRoute?.originPortId ?? '');
        targetPort = portById.get(targetRoute?.destinationPortId ?? '');
        routePath = targetRoute?.svgPath;
      } else if (strategy.type === 'port-diversion') {
        sourcePort =
          portById.get('singapore') ??
          portById.get(peakPortCongestion.portId) ??
          scenario.ports[0];
        targetPort = portById.get('tanjung-pelepas') ?? portById.get('batam');
      } else if (strategy.type === 'off-peak-arrival') {
        targetPort =
          scenario.ports.find(
            (port) => strategy.target.includes(port.name) || strategy.target.includes(port.englishName),
          ) ?? portById.get('port-klang');
        sourcePort = portById.get('penang') ?? scenario.ports[0];
      } else if (strategy.type === 'priority-berthing') {
        sourcePort = portById.get('port-klang') ?? scenario.ports[0];
        targetPort = portById.get('singapore') ?? portById.get(peakPortCongestion.portId);
      } else if (strategy.type === 'route-adjustment') {
        sourcePort = portById.get(riskyRoute?.originPortId ?? '') ?? portById.get('port-klang');
        targetPort = portById.get('tanjung-pelepas') ?? portById.get(riskyRoute?.destinationPortId ?? '');
      }

      if (!sourcePort || !targetPort) {
        return [];
      }

      const startPoint = screenPositionToSvgPoint(sourcePort.position);
      const endPoint = screenPositionToSvgPoint(targetPort.position);

      return [
        {
          id: strategy.strategyId,
          label: strategy.label,
          target: strategy.target,
          metric: `${strategy.delayReductionMinutes}分 / ${strategy.carbonReductionTons.toFixed(0)}t`,
          svgPath: routePath ?? buildCurvedSvgPath(sourcePort, targetPort, index),
          startX: startPoint.x,
          startY: startPoint.y,
          endX: endPoint.x,
          endY: endPoint.y,
          tone: strategy.tone,
          score: strategy.score,
          animationDelaySeconds: index * 0.58,
        },
      ];
    });
  const displayedMetrics = scenario.metrics.map((item) => {
    if (item.id !== 'resilience-index') {
      return item;
    }

    return {
      ...item,
      value: resilienceAssessment.networkResilienceIndex.toFixed(1),
      unit: resilienceAssessment.tone === 'ok' ? 'A' : resilienceAssessment.tone === 'warning' ? 'B' : 'C',
      detail: `恢复能力 ${resilienceAssessment.congestionRecoveryAbility}%`,
      trendLabel: `扩散范围 ${resilienceAssessment.riskSpreadRangePercent}%`,
      tone: resilienceAssessment.tone,
    };
  });
  const aiDecisionRecommendation: AiDecisionRecommendation = (() => {
    const peakCongestionPort = portById.get(peakPortCongestion.portId);
    const queueToBerthRatio =
      peakPortCongestion.queueingVessels / Math.max(1, peakCongestionPort?.berthCount ?? 1);
    const arrivalGap = peakPortCongestion.arrivingVessels - peakPortCongestion.departingVessels;
    const congestionCause =
      (peakCongestionPort?.berthUtilizationPercent ?? 0) >= 85 && queueToBerthRatio >= 1
        ? '泊位高占用叠加排队积压'
        : arrivalGap > 0
          ? '到港节奏快于离港释放'
          : '航道延误向港口传导';
    const riskyChannelsForAi = scenario.channels.filter(
      (channel) =>
        channel.tone !== 'ok' ||
        channel.delayMinutes >= 25 ||
        channel.congestionPercent >= 58,
    );
    const highestRiskAlert = scenario.riskAlerts.find((alert) => alert.tone === 'danger') ??
      scenario.riskAlerts.find((alert) => alert.tone === 'warning');
    const carbonStrategy =
      rankedGreenStrategies.find((strategy) => strategy.type === 'slow-steaming') ??
      rankedGreenStrategies.find((strategy) => strategy.carbonReductionTons > 0) ??
      bestGreenStrategy;
    const microRiskTone = importedGodotResult
      ? rlPolicyApplied
        ? rlPolicyRecoveryTone
        : godotRiskToneByLevel[importedGodotResult.riskLevel]
      : undefined;
    const microRiskLabel = importedGodotResult
      ? rlPolicyApplied
        ? rlPolicyRecoveryTone === 'ok'
          ? '低风险'
          : rlPolicyRecoveryTone === 'warning'
            ? '中风险'
            : godotRiskLevelLabelByLevel[importedGodotResult.riskLevel]
        : godotRiskLevelLabelByLevel[importedGodotResult.riskLevel]
      : '';
    const microValidationEvidence = importedGodotResult
      ? `单船验证${rlPolicyApplied && policyRecovery.advancedMinutes > 0 ? '策略恢复中' : importedGodotResult.safePass ? '安全通过' : '未安全通过'} / ${microRiskLabel} / 推荐 ${importedGodotResult.recommendedSpeedKnots.toFixed(1)}kn / 预计 ${Math.max(15, importedGodotResult.estimatedTravelMinutes - rlDelayReliefMinutes).toFixed(0)}分`
      : '';
    const adviceItems = [
      {
        topic: 'congestion-cause',
        title: '拥堵原因',
        summary: `${peakPortCongestion.portName}${congestionCause}`,
        evidence: `拥堵 ${peakPortCongestion.congestionScore}% / 排队 ${peakPortCongestion.queueingVessels} 艘 / 预计等待 ${peakPortCongestion.expectedWaitingHours.toFixed(1)}h`,
        priority: peakPortCongestion.congestionScore,
        tone: peakPortCongestion.tone,
      },
      {
        topic: 'risk-judgement',
        title: '风险判断',
        summary: importedGodotResult
          ? `微观验证判定${microRiskLabel}`
          : resilienceAssessment.riskSpreadRangePercent >= 68
            ? '风险已跨节点扩散'
            : resilienceAssessment.riskSpreadRangePercent >= 42
              ? '局部风险持续外溢'
              : '风险仍处可控区间',
        evidence: importedGodotResult
          ? `${microValidationEvidence} / 最小间距 ${importedGodotResult.minClearanceMeters.toFixed(1)}m`
          : `${highestRiskAlert?.label ?? '无高等级预警'} / 受压节点 ${resilienceAssessment.stressedNodeCount} 个 / 风险航线 ${resilienceAssessment.affectedRouteCount} 条`,
        priority: importedGodotResult
          ? 82 + (importedGodotResult.safePass ? 0 : 12)
          : resilienceAssessment.riskSpreadRangePercent,
        tone: microRiskTone ?? resilienceAssessment.tone,
      },
      {
        topic: 'dispatch-suggestion',
        title: '调度建议',
        summary: importedGodotResult
          ? `按 ${importedGodotResult.recommendedSpeedKnots.toFixed(1)}kn 执行单船调度`
          : bestGreenStrategy
            ? `优先执行${bestGreenStrategy.label}`
            : '维持当前靠泊与航线计划',
        evidence: importedGodotResult
          ? `${microValidationEvidence} / 结果已回传调度面板`
          : bestGreenStrategy
            ? `预计削减延误 ${bestGreenStrategy.delayReductionMinutes} 分 / 降低拥堵 ${bestGreenStrategy.congestionReductionPercent.toFixed(1)}%`
            : '暂无可用策略收益',
        priority: importedGodotResult ? 88 : bestGreenStrategy?.score ?? 0,
        tone: microRiskTone ?? bestGreenStrategy?.tone ?? 'warning',
      },
      {
        topic: 'carbon-optimization',
        title: '碳排优化',
        summary: importedGodotResult
          ? importedGodotResult.carbonDeltaTons <= 0
            ? `单船验证预计减排 ${Math.abs(importedGodotResult.carbonDeltaTons).toFixed(1)}t`
            : `单船验证增排 ${importedGodotResult.carbonDeltaTons.toFixed(1)}t`
          : totalCarbonChangePercent > 6
            ? `优先压降${peakVesselEmission?.vesselName ?? '高排放船舶'}能耗`
            : `保持${carbonStrategy?.label ?? '绿色调度'}窗口`,
        evidence: importedGodotResult
          ? `推荐航速 ${importedGodotResult.recommendedSpeedKnots.toFixed(1)}kn / 碳排变化 ${importedGodotResult.carbonDeltaTons.toFixed(1)}t`
          : carbonStrategy
            ? `可减排 ${carbonStrategy.carbonReductionTons.toFixed(0)}t CO₂ / 节油 ${carbonStrategy.fuelSavingTons.toFixed(1)}t`
            : `当前总碳排 ${totalCarbonTons.toFixed(0)}t CO₂`,
        priority: importedGodotResult
          ? Math.abs(importedGodotResult.carbonDeltaTons) * 12 + 60
          : Math.max(0, totalCarbonChangePercent) + (carbonStrategy?.carbonReductionTons ?? 0) / 10,
        tone: importedGodotResult
          ? importedGodotResult.carbonDeltaTons <= 0
            ? 'ok'
            : 'warning'
          : emissionPanelTone,
      },
    ] satisfies AiDecisionRecommendation['recommendations'];
    const recommendationTone: StatusTone = adviceItems.some((item) => item.tone === 'danger')
      ? 'danger'
      : adviceItems.some((item) => item.tone === 'warning')
        ? 'warning'
        : 'ok';
    const confidenceScore = Math.round(
      clampNumber(
        68 +
          Math.min(14, scenario.vesselMarkers.length * 1.4) +
          Math.min(8, scenario.channels.length) +
          Math.min(8, scenario.strategies.length * 1.2) -
          incidentPressure * 0.55 -
          riskyChannelsForAi.length * 0.8 +
          (importedGodotResult ? 6 : 0) -
          (importedGodotResult && !importedGodotResult.safePass ? 5 : 0),
        52,
        96,
      ),
    );

    return {
      generatedAt: scenarioClockLabel,
      confidenceScore,
      primaryAction: importedGodotResult
        ? `执行 ${importedGodotResult.recommendedSpeedKnots.toFixed(1)}kn 单船验证建议`
        : bestGreenStrategy?.label ?? '持续监测关键节点',
      recommendations: adviceItems.sort((left, right) => right.priority - left.priority),
      tone: recommendationTone,
    };
  })();
  const emergencyContingencyAssessment: EmergencyContingencyAssessment = (() => {
    const highestRiskChannel = [...scenario.channels].sort(
      (left, right) =>
        right.congestionPercent +
        right.delayMinutes * 1.3 +
        (right.tone === 'danger' ? 24 : right.tone === 'warning' ? 12 : 0) -
        (left.congestionPercent +
          left.delayMinutes * 1.3 +
          (left.tone === 'danger' ? 24 : left.tone === 'warning' ? 12 : 0)),
    )[0];
    const weatherSeverity = clampNumber(
      Math.max(0, scenario.weather.windSpeedMs - 10) * 3.2 +
        Math.max(0, scenario.weather.waveHeightM - 1) * 22 +
        Math.max(0, 8 - scenario.weather.visibilityKm) * 5.4 +
        scenario.riskAlerts.filter((alert) => alert.label.includes('台风')).length * 20,
      0,
      100,
    );
    const accidentSeverity = clampNumber(
      (highestRiskChannel?.congestionPercent ?? 0) * 0.42 +
        (highestRiskChannel?.delayMinutes ?? 0) * 1.35 +
        incidentPressure * 3.4 +
        displayedEventLog.filter((event) => event.message.includes('故障')).length * 18,
      0,
      100,
    );
    const portParalysisSeverity = clampNumber(
      peakPortCongestion.congestionScore * 0.58 +
        peakPortCongestion.queueingVessels * 0.34 +
        resilienceAssessment.criticalNodePressure * 0.22 +
        incidentPressure * 2.4,
      0,
      100,
    );
    const energyControlSeverity = clampNumber(
      Math.max(0, totalCarbonChangePercent) * 3.8 +
        totalCarbonTons / 20 +
        Math.max(0, scenario.carbon.todayEmission - 16) * 4.5 -
        totalStrategyCarbonReduction / 28,
      0,
      100,
    );
    const emergencyCarbonStrategy =
      rankedGreenStrategies.find((strategy) => strategy.type === 'slow-steaming') ??
      rankedGreenStrategies.find((strategy) => strategy.carbonReductionTons > 0) ??
      bestGreenStrategy;
    const makePlan = (
      scenarioType: EmergencyContingencyAssessment['plans'][number]['scenario'],
      label: string,
      affectedArea: string,
      trigger: string,
      priorityAction: string,
      supportAction: string,
      severityScore: number,
      recoveryBaseHours: number,
    ) => {
      const readinessPercent = Math.round(
        clampNumber(
          96 - severityScore * 0.34 + resilienceAssessment.congestionRecoveryAbility * 0.16,
          42,
          98,
        ),
      );
      const estimatedRecoveryHours = clampNumber(
        recoveryBaseHours + severityScore / 24 - readinessPercent / 60,
        0.8,
        12,
      );

      return {
        scenario: scenarioType,
        label,
        affectedArea,
        trigger,
        priorityAction,
        supportAction,
        readinessPercent,
        estimatedRecoveryHours,
        severityScore: Math.round(severityScore),
        tone: getPressureTone(severityScore),
      };
    };
    const plans = [
      makePlan(
        'accident-closure',
        '事故封航',
        highestRiskChannel?.label ?? '高风险航道',
        `航道延误 ${highestRiskChannel?.delayMinutes ?? 0} 分 / 事件压力 ${incidentPressure}`,
        `临时封控${highestRiskChannel?.label ?? '事故航段'}，启用单向放行窗口`,
        '发布绕航通告，拖轮与海巡力量前置到上下游分流点',
        accidentSeverity,
        2.4,
      ),
      makePlan(
        'extreme-weather',
        '极端天气',
        scenario.riskAlerts.find((alert) => alert.label.includes('台风'))?.affectedArea ?? '东部航道',
        `风速 ${scenario.weather.windSpeedMs}m/s / 浪高 ${scenario.weather.waveHeightM}m / 能见度 ${scenario.weather.visibilityKm}km`,
        '暂停高风险航段追越，低速编队通过主航道',
        '锚地容量预留，优先保障油轮和危险品船避风',
        weatherSeverity,
        3.2,
      ),
      makePlan(
        'port-paralysis',
        '港口瘫痪',
        peakPortCongestion.portName,
        `拥堵 ${peakPortCongestion.congestionScore}% / 排队 ${peakPortCongestion.queueingVessels} 艘`,
        `冻结${peakPortCongestion.portName}非紧急靠泊，执行分流港口预案`,
        bestGreenStrategy
          ? `联动${bestGreenStrategy.label}，优先释放高时效船舶`
          : '启用邻近港口泊位和锚地联动调度',
        portParalysisSeverity,
        4.1,
      ),
      makePlan(
        'energy-control',
        '能源管控',
        '全海峡重点船舶流',
        `总碳排 ${totalCarbonTons.toFixed(0)}t CO₂ / 较基准 ${totalCarbonChangePercent > 0 ? '+' : ''}${totalCarbonChangePercent.toFixed(1)}%`,
        '对高排放船舶下发低速航行和错峰进港指令',
        emergencyCarbonStrategy
          ? `优先使用${emergencyCarbonStrategy.label}，预计减排 ${emergencyCarbonStrategy.carbonReductionTons.toFixed(0)}t`
          : '启用岸电、锚地等待限时和燃油消耗阈值监测',
        energyControlSeverity,
        2.8,
      ),
    ];
    const rankedPlans = plans.sort((left, right) => right.severityScore - left.severityScore);
    const activePlan = rankedPlans[0];
    const assessmentTone: StatusTone = rankedPlans.some((plan) => plan.tone === 'danger')
      ? 'danger'
      : rankedPlans.some((plan) => plan.tone === 'warning')
        ? 'warning'
        : 'ok';

    return {
      generatedAt: scenarioClockLabel,
      activeScenario: activePlan.scenario,
      activePlanLabel: activePlan.label,
      readinessScore: Math.round(
        rankedPlans.reduce((total, plan) => total + plan.readinessPercent, 0) /
          Math.max(1, rankedPlans.length),
      ),
      plans: rankedPlans,
      tone: assessmentTone,
    };
  })();
  const selectedValidationRoute =
    validationSelection.type === 'route'
      ? routeById.get(validationSelection.id)
      : undefined;
  const selectedValidationVessel =
    validationSelection.type === 'vessel'
      ? scenario.vesselMarkers.find((vessel) => vessel.id === validationSelection.id)
      : [...scenario.vesselMarkers]
          .filter((vessel) => vessel.flowId === validationSelection.id)
          .sort(
            (left, right) =>
              (vesselDelayById.get(right.id)?.delayMinutes ?? 0) -
              (vesselDelayById.get(left.id)?.delayMinutes ?? 0),
          )[0];
  const selectedValidationResolvedRoute =
    routeById.get(selectedValidationVessel?.flowId ?? selectedValidationRoute?.id ?? '') ??
    selectedValidationRoute;
  const selectedValidationChannel = channelById.get(
    selectedValidationVessel?.assignedChannelId ??
      selectedValidationResolvedRoute?.channelId ??
      '',
  );
  const selectedValidationOriginPort = portById.get(
    selectedValidationResolvedRoute?.originPortId ?? '',
  );
  const selectedValidationDestinationPort = portById.get(
    selectedValidationVessel?.destinationPortId ??
      selectedValidationResolvedRoute?.destinationPortId ??
      '',
  );
  const selectedValidationDelay = selectedValidationVessel
    ? vesselDelayById.get(selectedValidationVessel.id)
    : undefined;
  const selectedValidationEmission = selectedValidationVessel
    ? vesselEmissionSimulations.find((item) => item.vesselId === selectedValidationVessel.id)
    : undefined;
  const selectedValidationTargetLabel =
    validationSelection.type === 'route'
      ? `${selectedValidationResolvedRoute?.label ?? '未选择航段'} / 代表船 ${
          selectedValidationVessel?.name ?? '无'
        }`
      : `${selectedValidationVessel?.name ?? '未选择船舶'} / ${
          selectedValidationResolvedRoute?.label ?? '未匹配航线'
        }`;
  const selectedValidationTone: StatusTone =
    selectedValidationDelay?.tone ??
    selectedValidationResolvedRoute?.tone ??
    selectedValidationChannel?.tone ??
    'ok';

  const buildGodotRiskEvents = (): GodotRiskEvent[] => {
    if (!selectedValidationResolvedRoute) {
      return [];
    }

    const events: GodotRiskEvent[] = [];
    const channelRiskTone: StatusTone =
      selectedValidationResolvedRoute.tone === 'danger' ||
      selectedValidationChannel?.tone === 'danger'
        ? 'danger'
        : selectedValidationResolvedRoute.tone === 'warning' ||
            selectedValidationChannel?.tone === 'warning' ||
            (selectedValidationChannel?.delayMinutes ?? 0) >= 20
          ? 'warning'
          : 'ok';

    if (channelRiskTone !== 'ok') {
      events.push({
        id: `risk-${selectedValidationChannel?.id ?? selectedValidationResolvedRoute.id}`,
        type: channelRiskTone === 'danger' ? 'channel-closure' : 'collision-risk',
        label: `${selectedValidationChannel?.label ?? selectedValidationResolvedRoute.label}通航风险`,
        affectedArea: selectedValidationResolvedRoute.label,
        severity: channelRiskTone,
        startMinute: elapsedMinutes,
        expectedDurationMinutes: Math.max(
          30,
          selectedValidationResolvedRoute.delayMinutes +
            (selectedValidationChannel?.delayMinutes ?? 0),
        ),
        recommendedAction: bestGreenStrategy?.label ?? '降速并保持安全距离',
      });
    }

    if (
      scenario.weather.waveHeightM >= 1.1 ||
      scenario.weather.windSpeedMs >= 12 ||
      scenario.weather.visibilityKm <= 8
    ) {
      events.push({
        id: 'risk-weather-sea-state',
        type: 'extreme-weather',
        label: '海况与能见度约束',
        affectedArea: selectedValidationResolvedRoute.label,
        severity: scenario.weather.waveHeightM >= 1.2 ? 'warning' : 'ok',
        startMinute: elapsedMinutes,
        expectedDurationMinutes: 120,
        recommendedAction: '降低目标航速并扩大安全距离',
      });
    }

    if (
      selectedValidationDestinationPort &&
      (portCongestionById.get(selectedValidationDestinationPort.id)?.congestionScore ?? 0) >= 70
    ) {
      const destinationCongestion = portCongestionById.get(selectedValidationDestinationPort.id);

      events.push({
        id: `risk-port-${selectedValidationDestinationPort.id}`,
        type: 'port-paralysis',
        label: `${selectedValidationDestinationPort.name}高拥堵靠泊风险`,
        affectedArea: selectedValidationDestinationPort.name,
        severity: destinationCongestion?.tone ?? 'warning',
        startMinute: elapsedMinutes,
        expectedDurationMinutes: Math.round(
          (destinationCongestion?.expectedWaitingHours ?? 1.5) * 60,
        ),
        recommendedAction: '验证低速到港、错峰靠泊或邻近港口分流',
      });
    }

    const primaryAlert =
      scenario.riskAlerts.find((alert) => alert.tone === 'danger') ??
      scenario.riskAlerts.find((alert) => alert.tone === 'warning');

    if (primaryAlert) {
      events.push({
        id: `risk-alert-${primaryAlert.id}`,
        type: primaryAlert.label.includes('台风') ? 'extreme-weather' : 'manual-event',
        label: primaryAlert.label,
        affectedArea: primaryAlert.affectedArea,
        severity: primaryAlert.tone,
        startMinute: elapsedMinutes,
        expectedDurationMinutes: 180,
        recommendedAction: primaryAlert.estimatedImpact,
      });
    }

    return events.slice(0, 4);
  };

  const buildGodotValidationRequest = (): GodotValidationRequest | null => {
    if (
      !selectedValidationVessel ||
      !selectedValidationResolvedRoute ||
      !selectedValidationOriginPort ||
      !selectedValidationDestinationPort
    ) {
      return null;
    }

    const routeIsRisky =
      selectedValidationResolvedRoute.tone !== 'ok' ||
      selectedValidationChannel?.tone !== 'ok' ||
      (selectedValidationChannel?.delayMinutes ?? 0) >= 20;
    const targetSpeedKnots = Number(
      clampNumber(
        Math.min(
          selectedValidationVessel.speedKnots,
          selectedValidationResolvedRoute.averageSpeedKnots - (routeIsRisky ? 1.2 : 0.4),
        ),
        8,
        Math.max(8, selectedValidationVessel.speedKnots),
      ).toFixed(1),
    );
    const relevantStrategyIds = rankedGreenStrategies
      .filter(
        (strategy) =>
          strategy.status === 'recommended' ||
          strategy.type === 'slow-steaming' ||
          (routeIsRisky && strategy.type === 'route-adjustment') ||
          (selectedValidationDestinationPort.id === 'singapore' &&
            (strategy.type === 'port-diversion' || strategy.type === 'off-peak-arrival')),
      )
      .slice(0, 3)
      .map((strategy) => strategy.strategyId);
    const requestStamp = scenarioClockLabel.replace(/\D/g, '').slice(0, 14);

    return {
      requestId: `malacca-validation-${requestStamp}-${selectedValidationVessel.id}`,
      vesselId: selectedValidationVessel.id,
      vesselName: selectedValidationVessel.name,
      imo: selectedValidationVessel.imo,
      category: selectedValidationVessel.category,
      routeId: selectedValidationResolvedRoute.id,
      channelId:
        selectedValidationVessel.assignedChannelId ||
        selectedValidationResolvedRoute.channelId,
      origin: {
        portId: selectedValidationOriginPort.id,
        portName: selectedValidationOriginPort.name,
        geo: selectedValidationOriginPort.geo,
      },
      destination: {
        portId: selectedValidationDestinationPort.id,
        portName: selectedValidationDestinationPort.name,
        geo: selectedValidationDestinationPort.geo,
      },
      speedProfile: {
        initialKnots: selectedValidationVessel.speedKnots,
        targetKnots: targetSpeedKnots,
        minSafeKnots: Number(Math.max(6, targetSpeedKnots * 0.65).toFixed(1)),
        maxSafeKnots: Number(
          Math.max(
            selectedValidationVessel.speedKnots + 2,
            selectedValidationResolvedRoute.averageSpeedKnots + 3,
          ).toFixed(1),
        ),
      },
      headingDeg: selectedValidationVessel.headingDeg,
      progressPercent: selectedValidationVessel.progressPercent,
      riskEvents: buildGodotRiskEvents(),
      dispatchStrategyIds: relevantStrategyIds,
      createdAt: scenarioClock.toISOString(),
    };
  };

  const buildLinkedDemoValidationRequest = (
    demoCase: LinkedDemoCaseDefinition,
  ): GodotValidationRequest | null => {
    const vessel = scenario.vesselMarkers.find((item) => item.id === demoCase.vesselId);
    const route = routeById.get(demoCase.routeId);
    const originPort = portById.get(route?.originPortId ?? '');
    const destinationPort = portById.get(vessel?.destinationPortId ?? route?.destinationPortId ?? '');

    if (!vessel || !route || !originPort || !destinationPort) {
      return null;
    }

    const requestStamp = scenarioClockLabel.replace(/\D/g, '').slice(0, 14);
    const targetKnots = demoCase.targetSpeedKnots;

    return {
      requestId: `malacca-demo-${demoCase.id}-${requestStamp}`,
      vesselId: vessel.id,
      vesselName: vessel.name,
      imo: vessel.imo,
      category: vessel.category,
      routeId: route.id,
      channelId: vessel.assignedChannelId || route.channelId,
      origin: {
        portId: originPort.id,
        portName: originPort.name,
        geo: originPort.geo,
      },
      destination: {
        portId: destinationPort.id,
        portName: destinationPort.name,
        geo: destinationPort.geo,
      },
      speedProfile: {
        initialKnots: vessel.speedKnots,
        targetKnots,
        minSafeKnots: Number(Math.max(6, targetKnots * 0.72).toFixed(1)),
        maxSafeKnots: Number(Math.max(vessel.speedKnots + 2, route.averageSpeedKnots + 3).toFixed(1)),
      },
      headingDeg: vessel.headingDeg,
      progressPercent: vessel.progressPercent,
      riskEvents: demoCase.riskEvents.map((event) => ({
        ...event,
        startMinute: elapsedMinutes,
      })),
      dispatchStrategyIds: demoCase.dispatchStrategyIds,
      createdAt: scenarioClock.toISOString(),
    };
  };

  const handleEnterMicroValidation = () => {
    const request = buildGodotValidationRequest();

    if (!request) {
      return;
    }

    const strategySummary = rlPolicyApplied && rlPolicyInference
      ? `${rlPolicyInference.model.policyId} / ${rlPolicyInference.selectedAction.label} / ${rlPolicyInference.selectedAction.commandSummary}`
      : bestGreenStrategy
        ? `${bestGreenStrategy.label}，目标 ${request.speedProfile.targetKnots.toFixed(1)}kn`
        : `目标航速 ${request.speedProfile.targetKnots.toFixed(1)}kn`;

    setSandboxRuntime((runtime) => {
      const eventPhase = runtime.phases.find((phase) => phase.id === 'event-sensing');
      const spreadPhase = runtime.phases.find((phase) => phase.id === 'pressure-spread');
      const spreadHasStarted = spreadPhase && spreadPhase.status !== 'pending';

      return {
        ...runtime,
        generatedGodotRequest: request,
        importedGodotResult: null,
        activeDemoCaseId: null,
        phases: patchSandboxPhases(runtime.phases, [
          {
            id: 'event-sensing',
            status: 'completed',
            completedAt: eventPhase?.completedAt ?? scenarioClockLabel,
            completedMinute: eventPhase?.completedMinute ?? runtime.elapsedMinutes,
            summary:
              runtime.injectedEvents[0]?.message.replace('事件注入：', '') ??
              '运行态势信号已完成归档',
          },
          {
            id: 'pressure-spread',
            status: 'completed',
            startedAt: spreadHasStarted ? spreadPhase.startedAt : scenarioClockLabel,
            startedMinute: spreadHasStarted ? spreadPhase.startedMinute : runtime.elapsedMinutes,
            completedAt: spreadPhase?.completedAt ?? scenarioClockLabel,
            completedMinute: spreadPhase?.completedMinute ?? runtime.elapsedMinutes,
            summary: `${peakPortCongestion.portName} 拥堵 ${peakPortCongestion.congestionScore}% / 排队 ${peakPortCongestion.queueingVessels} 艘`,
          },
          {
            id: 'vessel-dispatch',
            status: 'completed',
            completedAt: scenarioClockLabel,
            completedMinute: runtime.elapsedMinutes,
            summary: strategySummary,
          },
          {
            id: 'micro-validation',
            status: 'running',
            startedAt: scenarioClockLabel,
            startedMinute: runtime.elapsedMinutes,
            completedAt: undefined,
            completedMinute: undefined,
            summary: `已封装 ${request.vesselName} / 风险 ${request.riskEvents.length} 项 / 策略 ${request.dispatchStrategyIds.length} 项`,
          },
          {
            id: 'metric-feedback',
            status: 'pending',
            startedAt: pendingPhaseStartLabel,
            startedMinute: 0,
            completedAt: undefined,
            completedMinute: undefined,
            summary: sandboxPhaseDefinitions['metric-feedback'].initialSummary,
          },
        ]),
      };
    });
    setActiveModule('sandbox');
    setIsGodotSimulatorOpen(false);
    setHasPreviewedGodotSimulator(false);
  };

  const handleLocalValidationAndFeedback = () => {
    if (!generatedGodotRequest) return;
    const hasDangerRisk = generatedGodotRequest.riskEvents.some(
      (event) => event.severity === 'danger',
    );
    const hasWarningRisk = generatedGodotRequest.riskEvents.some(
      (event) => event.severity === 'warning',
    );
    const riskLevel: GodotRiskLevel = hasDangerRisk ? 'high' : hasWarningRisk ? 'medium' : 'low';
    const recommendedSpeedKnots = Number(
      clampNumber(
        generatedGodotRequest.speedProfile.targetKnots - (hasDangerRisk ? 0.8 : hasWarningRisk ? 0.3 : 0),
        generatedGodotRequest.speedProfile.minSafeKnots,
        generatedGodotRequest.speedProfile.maxSafeKnots,
      ).toFixed(1),
    );
    const estimatedTravelMinutes = Math.max(
      35,
      Math.round((selectedValidationDelay?.delayMinutes ?? 28) + (hasDangerRisk ? 48 : 36)),
    );
    const carbonDeltaTons = Number(
      (-Math.max(0.6, (selectedValidationEmission?.carbonTons ?? 24) * (hasDangerRisk ? 0.025 : 0.045))).toFixed(1),
    );
    const result: GodotValidationResult = {
      requestId: generatedGodotRequest.requestId,
      vesselId: generatedGodotRequest.vesselId,
      status: hasDangerRisk ? 'degraded' : 'passed',
      safePass: true,
      estimatedTravelMinutes,
      riskLevel,
      recommendedSpeedKnots,
      simulatedDurationSeconds: 4,
      reachedDestination: true,
      averageSpeedKnots: Number(Math.max(6, recommendedSpeedKnots - 0.2).toFixed(1)),
      minClearanceMeters: hasDangerRisk ? 28.6 : hasWarningRisk ? 43.2 : 61.5,
      collisionCount: 0,
      groundingCount: 0,
      riskEventResolvedCount: generatedGodotRequest.riskEvents.length,
      delayDeltaMinutes: hasDangerRisk ? -12 : -18,
      carbonDeltaTons,
      loadedScene: {
        routePointCount: 2,
        riskZoneCount: generatedGodotRequest.riskEvents.length,
        temporaryObstacleCount: hasDangerRisk ? 1 : 0,
      },
      summary: `本地单船参考验证完成：${generatedGodotRequest.vesselName} 以 ${recommendedSpeedKnots.toFixed(1)}kn ${hasDangerRisk ? '降级安全通过' : '安全通过'}，结果已回写主沙盘。`,
    };
    applyGodotValidationResult(result);
  };

  const handleLoadLinkedDemoCase = (demoCase: LinkedDemoCaseDefinition) => {
    const request = buildLinkedDemoValidationRequest(demoCase);

    if (!request) {
      return;
    }

    const result: GodotValidationResult = {
      ...demoCase.result,
      requestId: request.requestId,
      vesselId: request.vesselId,
    };

    setRlPolicyApplied(false);
    setValidationSelection({ type: 'vessel', id: demoCase.vesselId });
    setSandboxRuntime((runtime) => ({
      ...runtime,
      policyRecovery: {
        status: 'idle',
        advancedMinutes: 0,
        targetMinutes: defaultRlPolicyRecoveryMinutes,
      },
      generatedGodotRequest: request,
      importedGodotResult: result,
      activeDemoCaseId: demoCase.id,
      injectedEvents: [
        {
          id: `linked-demo-${demoCase.id}-${request.requestId}`,
          time: formatScenarioTime(scenarioClock),
          message: `联动演示：${demoCase.label} 已加载，AI/风险/调度/单船报告同步更新`,
          tone: demoCase.tone,
          templateId: `linked-demo-${demoCase.id}`,
          impact: passiveEventImpactProfile,
        },
          ...runtime.injectedEvents,
        ].slice(0, 5),
      phases: patchSandboxPhases(runtime.phases, [
        {
          id: 'event-sensing',
          status: 'completed',
          completedAt: scenarioClockLabel,
          completedMinute: runtime.elapsedMinutes,
          summary: `联动演示已加载：${demoCase.label}`,
        },
        {
          id: 'pressure-spread',
          status: 'completed',
          startedAt: scenarioClockLabel,
          startedMinute: runtime.elapsedMinutes,
          completedAt: scenarioClockLabel,
          completedMinute: runtime.elapsedMinutes,
          summary: demoCase.description,
        },
        {
          id: 'vessel-dispatch',
          status: 'completed',
          startedAt: scenarioClockLabel,
          startedMinute: runtime.elapsedMinutes,
          completedAt: scenarioClockLabel,
          completedMinute: runtime.elapsedMinutes,
          summary: `联动 ${demoCase.dispatchStrategyIds.length} 项策略，目标航速 ${request.speedProfile.targetKnots.toFixed(1)}kn`,
        },
        {
          id: 'micro-validation',
          status: 'completed',
          startedAt: scenarioClockLabel,
          startedMinute: runtime.elapsedMinutes,
          completedAt: scenarioClockLabel,
          completedMinute: runtime.elapsedMinutes,
          summary: result.summary,
        },
        {
          id: 'metric-feedback',
          status: 'completed',
          startedAt: scenarioClockLabel,
          startedMinute: runtime.elapsedMinutes,
          completedAt: scenarioClockLabel,
          completedMinute: runtime.elapsedMinutes,
          summary: `回写 ${result.recommendedSpeedKnots.toFixed(1)}kn / ${result.estimatedTravelMinutes.toFixed(0)}分 / 碳排 ${result.carbonDeltaTons.toFixed(1)}t`,
        },
      ]),
    }));
    setActiveModule('sandbox');
    setIsGodotSimulatorOpen(false);
    setOpenMapOverlays({
      congestion: false,
      delay: false,
      carbon: false,
      strategy: false,
      propagation: false,
    });
  };

  const applyGodotValidationResult = (parsed: GodotValidationResult) => {
      setSandboxRuntime((runtime) => ({
        ...runtime,
        importedGodotResult: parsed,
        activeDemoCaseId: null,
        phases: patchSandboxPhases(runtime.phases, [
          {
            id: 'event-sensing',
            status: 'completed',
            completedAt: scenarioClockLabel,
            completedMinute: runtime.elapsedMinutes,
            summary:
              runtime.injectedEvents[0]?.message.replace('事件注入：', '') ??
              '运行态势信号已完成归档',
          },
          {
            id: 'pressure-spread',
            status: 'completed',
            startedAt:
              runtime.phases.find((phase) => phase.id === 'pressure-spread')?.status ===
              'pending'
                ? scenarioClockLabel
                : runtime.phases.find((phase) => phase.id === 'pressure-spread')?.startedAt ??
                  scenarioClockLabel,
            startedMinute:
              runtime.phases.find((phase) => phase.id === 'pressure-spread')?.status ===
              'pending'
                ? runtime.elapsedMinutes
                : runtime.phases.find((phase) => phase.id === 'pressure-spread')?.startedMinute ??
                  runtime.elapsedMinutes,
            completedAt: scenarioClockLabel,
            completedMinute: runtime.elapsedMinutes,
            summary: `${parsed.vesselId} 微观验证结果已完成影响闭环`,
          },
          {
            id: 'vessel-dispatch',
            status: 'completed',
            completedAt: scenarioClockLabel,
            completedMinute: runtime.elapsedMinutes,
            summary: `已确认推荐航速 ${parsed.recommendedSpeedKnots.toFixed(1)}kn`,
          },
          {
            id: 'micro-validation',
            status: 'completed',
            completedAt: scenarioClockLabel,
            completedMinute: runtime.elapsedMinutes,
            summary:
              parsed.summary ??
              `微观验证完成：${parsed.status} / 推荐 ${parsed.recommendedSpeedKnots.toFixed(1)}kn`,
          },
          {
            id: 'metric-feedback',
            status: 'completed',
            startedAt: scenarioClockLabel,
            startedMinute: runtime.elapsedMinutes,
            completedAt: scenarioClockLabel,
            completedMinute: runtime.elapsedMinutes,
            summary: `回写 ${parsed.recommendedSpeedKnots.toFixed(1)}kn / ${parsed.estimatedTravelMinutes.toFixed(0)}分 / 碳排 ${parsed.carbonDeltaTons.toFixed(1)}t`,
          },
        ]),
      }));
  };
  godotResultReceiverRef.current = applyGodotValidationResult;

  const handleImportGodotResult = async (file: File | null) => {
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as GodotValidationResult;
      if (!parsed.requestId || !parsed.vesselId || !parsed.status) {
        throw new Error('Godot 结果缺少 requestId、vesselId 或 status');
      }
      applyGodotValidationResult(parsed);
    } catch {
      setSandboxRuntime((runtime) => ({
        ...runtime,
        importedGodotResult: null,
        phases: patchSandboxPhases(runtime.phases, [
          {
            id: 'micro-validation',
            status: runtime.generatedGodotRequest ? 'running' : 'pending',
            summary: runtime.generatedGodotRequest
              ? '结果文件无法解析，微观验证仍等待有效回传'
              : sandboxPhaseDefinitions['micro-validation'].initialSummary,
          },
          {
            id: 'metric-feedback',
            status: 'pending',
            startedAt: pendingPhaseStartLabel,
            startedMinute: 0,
            completedAt: undefined,
            completedMinute: undefined,
            summary: sandboxPhaseDefinitions['metric-feedback'].initialSummary,
          },
        ]),
      }));
    } finally {
      if (godotResultInputRef.current) {
        godotResultInputRef.current.value = '';
      }
    }
  };

  const pendingGodotRiskEventCount =
    generatedGodotRequest?.riskEvents.length ?? buildGodotRiskEvents().length;
  const pendingGodotStrategyCount =
    generatedGodotRequest?.dispatchStrategyIds.length ??
    rankedGreenStrategies.filter((strategy) => strategy.status === 'recommended').length;
  const pendingTargetSpeedKnots =
    generatedGodotRequest?.speedProfile.targetKnots ??
    (selectedValidationVessel
      ? Math.max(8, Math.min(selectedValidationVessel.speedKnots, selectedValidationVessel.speedKnots - 0.8))
      : 0);
  const importedResultTone = importedGodotResult
    ? rlPolicyApplied
      ? rlPolicyRecoveryTone
      : godotRiskToneByLevel[importedGodotResult.riskLevel] ??
        (importedGodotResult.status === 'failed' ? 'danger' : 'ok')
    : selectedValidationTone;
  const importedResultStatusLabel = importedGodotResult
    ? rlPolicyApplied && policyRecovery.status === 'stabilized'
      ? '策略验证通过'
      : rlPolicyApplied && policyRecovery.advancedMinutes > 0
        ? '策略恢复中'
        : importedGodotResult.safePass
          ? '安全通过'
          : importedGodotResult.status === 'degraded'
            ? '降级通过'
            : importedGodotResult.status === 'running'
              ? '验证中'
              : '未通过'
    : '';
  const recoveryAdjustedTravelMinutes = importedGodotResult
    ? Math.max(15, importedGodotResult.estimatedTravelMinutes - rlDelayReliefMinutes)
    : 0;
  const recoveryAdjustedCarbonTons = importedGodotResult
    ? importedGodotResult.carbonDeltaTons -
      (rlPolicyInference?.comparison.improvement.carbonTons ?? 0) * rlPolicyRecoveryProgress
    : 0;
  const recoveryAdjustedRiskLabel = importedGodotResult
    ? rlPolicyApplied
      ? rlPolicyRecoveryTone === 'ok'
        ? '低风险'
        : rlPolicyRecoveryTone === 'warning'
          ? '中风险'
          : godotRiskLevelLabelByLevel[importedGodotResult.riskLevel] ?? '高风险'
      : godotRiskLevelLabelByLevel[importedGodotResult.riskLevel] ?? '未知风险'
    : '待验证';
  const microValidationReport = importedGodotResult
    ? {
        vesselName:
          scenario.vesselMarkers.find((vessel) => vessel.id === importedGodotResult.vesselId)?.name ??
          importedGodotResult.vesselId,
        safetyLabel: importedResultStatusLabel,
        riskLabel: recoveryAdjustedRiskLabel,
        speedLabel: `${importedGodotResult.recommendedSpeedKnots.toFixed(1)}kn`,
        durationLabel: `${recoveryAdjustedTravelMinutes.toFixed(0)}分`,
        carbonLabel: `${recoveryAdjustedCarbonTons > 0 ? '+' : ''}${recoveryAdjustedCarbonTons.toFixed(1)}t`,
        strategyLabel:
          rlPolicyApplied && rlPolicyRecoveryTone === 'ok'
            ? '恢复通航并持续监测'
            : rlPolicyApplied && policyRecovery.advancedMinutes > 0
              ? '按推荐窗口持续疏导'
          : importedGodotResult.riskLevel === 'critical' || !importedGodotResult.safePass
            ? '限速等待并校核绕行'
            : importedGodotResult.riskLevel === 'high'
              ? '限速通过并保持避让'
              : '按推荐航速通过',
      }
    : null;
  const displayedRiskAlerts: RiskAlert[] = importedGodotResult
    ? [
        {
          id: 'godot-micro-validation-result',
          label: `微观验证：${microValidationReport?.vesselName ?? importedGodotResult.vesselId}`,
          description: `${microValidationReport?.safetyLabel ?? '结果回传'} / ${microValidationReport?.riskLabel ?? '未知风险'}`,
          tone: importedResultTone,
          affectedArea: selectedValidationResolvedRoute?.label ?? importedGodotResult.vesselId,
          estimatedImpact: `推荐 ${importedGodotResult.recommendedSpeedKnots.toFixed(1)}kn / 预计 ${recoveryAdjustedTravelMinutes.toFixed(0)}分 / 碳排 ${recoveryAdjustedCarbonTons.toFixed(1)}t`,
        },
        ...scenario.riskAlerts,
      ].slice(0, 4)
    : scenario.riskAlerts;
  const dispatchFocus = importedGodotResult
    ? {
        tone: importedResultTone,
        label: microValidationReport?.strategyLabel ?? '单船验证调度建议',
        detail: `推荐航速 ${importedGodotResult.recommendedSpeedKnots.toFixed(1)}kn / 耗时 ${recoveryAdjustedTravelMinutes.toFixed(0)}分 / 碳排 ${recoveryAdjustedCarbonTons.toFixed(1)}t`,
      }
    : rlPolicyApplied && rlPolicyInference
      ? {
          tone: 'ok' as StatusTone,
          label: `${rlPolicyInference.model.policyId} · ${rlPolicyInference.selectedAction.label}`,
          detail: `概率 ${rlPolicyInference.selectedAction.probability.toFixed(1)}% / ${rlPolicyInference.selectedAction.commandSummary}`,
        }
      : bestGreenStrategy
        ? {
            tone: bestGreenStrategy.tone,
            label: bestGreenStrategy.label,
            detail: `延误削减 ${bestGreenStrategy.delayReductionMinutes}分 / 碳减 ${bestGreenStrategy.carbonReductionTons.toFixed(0)}t`,
          }
        : null;
  const dangerAlertCount = displayedRiskAlerts.filter((alert) => alert.tone === 'danger').length;
  const warningAlertCount = displayedRiskAlerts.filter((alert) => alert.tone === 'warning').length;
  const selectedPort = selectedPortId ? portById.get(selectedPortId) : undefined;
  const activeMapViewDefinition =
    mapViewModes.find((mode) => mode.id === activeMapView) ?? mapViewModes[0];
  const godotSimulatorFrameSrc = `${GODOT_SIMULATOR_URL}?reload=${godotSimulatorReloadKey}`;
  const godotSimulatorStatusLabel =
    godotSimulatorStatus === 'available'
      ? 'Web 仿真已挂载'
      : godotSimulatorStatus === 'checking'
        ? '检测仿真导出'
        : '等待导出';
  const godotSimulatorStatusTone: StatusTone =
    godotSimulatorStatus === 'available'
      ? 'ok'
      : godotSimulatorStatus === 'checking'
        ? 'warning'
        : 'danger';
  const activeDemoCase = activeDemoCaseId
    ? linkedDemoCases.find((demoCase) => demoCase.id === activeDemoCaseId)
    : null;
  const validationFeedStatusLabel = importedGodotResult
    ? rlPolicyApplied && policyRecovery.advancedMinutes > 0
      ? `${rlPolicyRecoveryStageLabel} ${rlPolicyRecoveryPercent}%`
      : '模拟结果已回写'
    : generatedGodotRequest
      ? '信息流已生成'
      : '等待生成信息流';
  const validationFeedItems: ValidationFeedItem[] = [
    {
      id: 'validation-feed-target',
      label: generatedGodotRequest ? '参数封装' : '验证对象',
      value: selectedValidationVessel?.name ?? selectedValidationResolvedRoute?.label ?? '未选择',
      detail: generatedGodotRequest
        ? `${generatedGodotRequest.origin.portName} -> ${generatedGodotRequest.destination.portName}`
        : selectedValidationTargetLabel,
      tone: selectedValidationTone,
    },
    {
      id: 'validation-feed-risk',
      label: '风险校核',
      value: importedGodotResult
        ? recoveryAdjustedRiskLabel
        : `${pendingGodotRiskEventCount} 项`,
      detail: generatedGodotRequest?.riskEvents[0]?.label ?? displayedRiskAlerts[0]?.label ?? '当前航段低风险通行',
      tone: importedResultTone,
    },
    {
      id: 'validation-feed-dispatch',
      label: '策略推送',
      value: bestGreenStrategy?.label ?? '维持航速',
      detail: bestGreenStrategy
        ? `延误削减 ${bestGreenStrategy.delayReductionMinutes} 分 / 碳减 ${bestGreenStrategy.carbonReductionTons.toFixed(0)}t`
        : `目标航速 ${pendingTargetSpeedKnots.toFixed(1)}kn`,
      tone: bestGreenStrategy?.tone ?? 'ok',
    },
    {
      id: 'validation-feed-kpi',
      label: '指标回写',
      value: importedGodotResult
        ? `${importedGodotResult.recommendedSpeedKnots.toFixed(1)}kn`
        : `${resilienceAssessment.networkResilienceIndex.toFixed(1)}`,
      detail: importedGodotResult
        ? `耗时 ${recoveryAdjustedTravelMinutes.toFixed(0)}分 / 碳排 ${recoveryAdjustedCarbonTons.toFixed(1)}t`
        : `韧性 ${resilienceAssessment.networkResilienceIndex.toFixed(1)} / 拥堵 ${peakPortCongestion.congestionScore}%`,
      tone: importedGodotResult ? importedResultTone : resilienceAssessment.tone,
    },
  ];
  const renderSignalTone: StatusTone =
    dangerAlertCount > 0 ? 'danger' : warningAlertCount > 0 ? 'warning' : 'ok';
  const renderValidationLabel = importedGodotResult
    ? microValidationReport?.safetyLabel ?? importedResultStatusLabel
    : generatedGodotRequest
      ? '请求已生成'
      : '等待校核';
  const phaseById = new Map<SandboxPhaseId, SandboxPhaseState>(
    phases.map((phase) => [phase.id, phase]),
  );
  const getPhaseRenderState = (id: SandboxPhaseId) => {
    const phase = phaseById.get(id);
    const definition = sandboxPhaseDefinitions[id];
    const summary = phase?.summary ?? definition.initialSummary;

    return {
      id,
      label: definition.label,
      shortLabel: definition.shortLabel,
      detail: summary,
      status: phase?.status ?? 'pending',
      startedAt: phase?.startedAt ?? pendingPhaseStartLabel,
      startedMinute: phase?.startedMinute ?? 0,
      completedAt: phase?.completedAt,
      completedMinute: phase?.completedMinute,
      summary,
    };
  };
  const simulationRenderSteps: SimulationRenderStep[] = [
    {
      ...getPhaseRenderState('event-sensing'),
      detail:
        getPhaseRenderState('event-sensing').summary ||
        activeDemoCase?.description ||
        displayedRiskAlerts[0]?.label ||
        sandboxPhaseDefinitions['event-sensing'].initialSummary,
      value: String(displayedRiskAlerts.length + injectedEvents.length),
      unit: '信号',
      tone: renderSignalTone,
      x: 18,
      y: 31,
    },
    {
      ...getPhaseRenderState('pressure-spread'),
      detail: getPhaseRenderState('pressure-spread').summary,
      value: String(peakPortCongestion.congestionScore),
      unit: '%',
      tone: peakPortCongestion.tone,
      x: 35,
      y: 48,
    },
    {
      ...getPhaseRenderState('vessel-dispatch'),
      detail: getPhaseRenderState('vessel-dispatch').summary,
      value: bestGreenStrategy ? String(bestGreenStrategy.score) : pendingTargetSpeedKnots.toFixed(1),
      unit: bestGreenStrategy ? '评分' : 'kn',
      tone: bestGreenStrategy?.tone ?? selectedValidationTone,
      x: 52,
      y: 39,
    },
    {
      ...getPhaseRenderState('micro-validation'),
      detail: `${getPhaseRenderState('micro-validation').summary} / ${renderValidationLabel}`,
      value: importedGodotResult
        ? importedGodotResult.recommendedSpeedKnots.toFixed(1)
        : String(pendingGodotRiskEventCount),
      unit: importedGodotResult ? 'kn' : '风险',
      tone: importedResultTone,
      x: 68,
      y: 55,
    },
    {
      ...getPhaseRenderState('metric-feedback'),
      detail: getPhaseRenderState('metric-feedback').summary,
      value: resilienceAssessment.networkResilienceIndex.toFixed(1),
      unit: '韧性',
      tone: aiDecisionRecommendation.tone,
      x: 84,
      y: 34,
    },
  ];
  const runningSimulationRenderStepIndex = simulationRenderSteps.findIndex(
    (step) => step.status === 'running',
  );
  const completedSimulationRenderStepIndex = simulationRenderSteps.reduce(
    (activeIndex, step, index) => (step.status === 'completed' ? index : activeIndex),
    -1,
  );
  const activeSimulationRenderStepIndex =
    runningSimulationRenderStepIndex >= 0
      ? runningSimulationRenderStepIndex
      : Math.max(0, completedSimulationRenderStepIndex);
  const activeSimulationRenderStep =
    simulationRenderSteps[activeSimulationRenderStepIndex] ?? simulationRenderSteps[0];
  const getSimulationRenderStepProgressPercent = (step: SimulationRenderStep) => {
    if (step.status === 'completed') {
      return 100;
    }

    if (step.status === 'pending') {
      return 0;
    }

    return clampNumber(
      ((elapsedMinutes - step.startedMinute) / simulationRenderStepMinutes) * 100,
      8,
      96,
    );
  };
  const simulationRenderStepProgressPercent =
    getSimulationRenderStepProgressPercent(activeSimulationRenderStep);
  const phaseStatus = (phaseId: SandboxPhaseId) =>
    phases.find((phase) => phase.id === phaseId)?.status ?? 'pending';
  const eventInjectionStatus: SandboxPhaseStatus =
    activeDemoCaseId || injectedEvents.length > 0
      ? 'completed'
      : isSimulationRunning
        ? 'running'
        : 'pending';
  const coreClosureJourney: Array<{
    id: string;
    label: string;
    shortLabel: string;
    status: SandboxPhaseStatus;
    value: string;
  }> = [
    {
      id: 'data-input',
      label: '港口 / AIS / 气象数据',
      shortLabel: '数据输入',
      status: phaseStatus('event-sensing'),
      value:
        portDataStatus === 'live'
          ? '生产实时'
          : portDataStatus === 'public'
            ? '公开实证'
            : portDataStatus === 'connecting'
              ? '同步中'
              : '合成示例回退',
    },
    {
      id: 'event-injection',
      label: '事件注入',
      shortLabel: '事件注入',
      status: eventInjectionStatus,
      value: activeDemoCase ? activeDemoCase.shortLabel : `${injectedEvents.length}项`,
    },
    {
      id: 'simulation-engine',
      label: '拥堵 / 延误 / 碳排计算',
      shortLabel: '推演计算',
      status: phaseStatus('pressure-spread'),
      value: `${peakPortCongestion.congestionScore}%`,
    },
    {
      id: 'resilience',
      label: '网络韧性评估',
      shortLabel: '韧性评估',
      status: phaseStatus('pressure-spread'),
      value: resilienceAssessment.networkResilienceIndex.toFixed(1),
    },
    {
      id: 'ai-dispatch',
      label: '已训练策略检查点推理',
      shortLabel: 'RL策略',
      status: rlPolicyApplied ? 'completed' : phaseStatus('vessel-dispatch'),
      value: rlPolicyApplied && rlPolicyInference
        ? rlPolicyInference.selectedAction.label
        : rlInferenceStatus === 'running'
          ? `${rlInferenceProgress.toFixed(2)}%`
          : rlPolicyInference
            ? `置信 ${rlPolicyInference.inference.confidencePercent.toFixed(1)}%`
            : '待推理',
    },
    {
      id: 'godot-validation',
      label: 'Godot 单船验证接口',
      shortLabel: '单船接口',
      status: phaseStatus('micro-validation'),
      value: importedGodotResult
        ? recoveryAdjustedRiskLabel
        : generatedGodotRequest
          ? '请求已生成'
          : '待生成',
    },
    {
      id: 'result-feedback',
      label: '验证结果回写',
      shortLabel: '结果回写',
      status: phaseStatus('metric-feedback'),
      value: importedGodotResult ? `${importedGodotResult.recommendedSpeedKnots.toFixed(1)}kn` : '待回写',
    },
    {
      id: 'report-update',
      label: '指标 / 风险 / 报告更新',
      shortLabel: '指标报告',
      status: phaseStatus('metric-feedback'),
      value: phaseStatus('metric-feedback') === 'completed' ? '已更新' : '待更新',
    },
  ];
  const completedClosureStepCount = coreClosureJourney.filter(
    (step) => step.status === 'completed',
  ).length;
  const downloadClosureReport = () => {
    const report = {
      protocolVersion: 'malacca-closure-report.v1',
      generatedAt: new Date().toISOString(),
      title: '马六甲港航网络韧性数字孪生闭环报告',
      dataMode: portDataStatus,
      dataEvidence: publicEvidence,
      scenario: {
        id: scenario.id,
        name: scenario.name,
        observedAt: portDataObservedAt ?? scenario.currentTime,
        overview: scenario.overview,
        weather: scenario.weather,
      },
      events: injectedEvents,
      calculationAudit: {
        congestion: {
          formula: '0.42×基础拥堵 + 0.28×泊位利用率 + 0.30×排队压力 + 事件压力',
          peakPort: peakPortCongestion,
        },
        delay: {
          formula: '拥堵延误 + 气象延误 + 航速差延误 + 航道/事件风险延误',
          totalMinutes: totalDelayMinutes,
          peakVessel: peakVesselDelay,
        },
        carbon: {
          formula: '航行燃油 + 等待燃油；航行负荷按速度三次方；CO₂ = fuel × IMO HFO 3.114',
          fuelTons: Number(totalFuelTons.toFixed(3)),
          carbonTons: Number(totalCarbonTons.toFixed(3)),
          baselineCarbonTons: Number(totalBaselineCarbonTons.toFixed(3)),
          changePercent: Number(totalCarbonChangePercent.toFixed(2)),
        },
        resilience: resilienceAssessment,
      },
      decision: {
        ai: aiDecisionRecommendation,
        rankedStrategies: rankedGreenStrategies,
        selectedStrategy: bestGreenStrategy,
      },
      reinforcementLearning: {
        onlinePolicyInference: rlPolicyInference,
        policyApplied: rlPolicyApplied,
        recovery: policyRecovery,
        baselineBenchmark: rlBenchmark,
        training: rlTraining,
      },
      godotValidation: {
        request: generatedGodotRequest,
        result: importedGodotResult,
      },
      closure: {
        completedSteps: completedClosureStepCount,
        totalSteps: coreClosureJourney.length,
        steps: coreClosureJourney,
        resultSynced: Boolean(importedGodotResult),
        reportUpdated: phaseStatus('metric-feedback') === 'completed',
      },
      disclaimer: publicEvidence?.weather.navigationDisclaimer ?? '本报告用于数字孪生推演与决策支持，不替代法定航行系统。',
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `malacca-closure-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };
  const sandboxRuntimeStatusLabel = rlPolicyApplied && policyRecovery.advancedMinutes > 0
    ? `${rlPolicyRecoveryStageLabel} ${rlPolicyRecoveryPercent}%`
    : importedGodotResult
      ? '结果已回写'
    : generatedGodotRequest
      ? '信息流已生成'
      : rlPolicyApplied
        ? 'RL策略已执行'
        : rlInferenceStatus === 'running'
          ? '检查点推理中'
      : isSimulationRunning
        ? '推演运行中'
        : injectedEvents.length > 0
          ? '事件已注入'
          : '推演待命';
  const sandboxRuntimeStatusTone: StatusTone = importedGodotResult
    ? importedResultTone
    : generatedGodotRequest || rlPolicyApplied || rlInferenceStatus === 'running' || isSimulationRunning
      ? 'ok'
      : injectedEvents.length > 0
        ? 'warning'
        : selectedValidationTone;
  const sandboxNextActionLabel = rlPolicyApplied && policyRecovery.status !== 'stabilized'
    ? `继续推进15分 · ${rlPolicyRecoveryPercent}%`
    : rlPolicyApplied && policyRecovery.status === 'stabilized'
      ? '网络已稳定 · 查看指标'
    : importedGodotResult
      ? '查看回写指标'
    : generatedGodotRequest
      ? hasPreviewedGodotSimulator
        ? '关闭视窗后本地回写'
        : '打开航行模拟器展示'
      : injectedEvents.length > 0
        ? rlPolicyApplied
          ? '生成单船验证信息流'
          : rlInferenceStatus === 'running'
            ? `查看RL推理 ${rlInferenceProgress.toFixed(2)}%`
            : rlPolicyInference
              ? '采用已训练策略'
              : '打开RL策略推理舱'
        : '启动或注入事件';
  const sandboxCapabilityItems: SandboxCapabilityItem[] = [
    {
      id: 'runtime-control',
      label: '控制',
      value: `${simulationSpeed}x`,
      tone: isSimulationRunning ? 'ok' : 'warning',
      detail: `已推进 ${elapsedMinutes} 分钟`,
    },
    {
      id: 'event-engine',
      label: '事件',
      value: String(injectedEvents.length),
      tone: rlPolicyApplied ? rlPolicyRecoveryTone : injectedEvents.length > 0 ? 'warning' : 'ok',
      detail:
        rlPolicyApplied
          ? `${rlPolicyRecoveryStageLabel} · 剩余影响 ${Math.round(rlOperationalImpactRemainingFactor * 100)}%`
          : eventImpact.activeSummaries[0] ??
        `当前信号 ${displayedRiskAlerts.length + injectedEvents.length}`,
    },
    {
      id: 'congestion',
      label: '拥堵',
      value: `${peakPortCongestion.congestionScore}%`,
      tone: peakPortCongestion.tone,
      detail: peakPortCongestion.portName,
    },
    {
      id: 'delay',
      label: '延误',
      value: `${peakVesselDelay?.delayMinutes ?? 0}分`,
      tone: peakVesselDelay?.tone ?? 'ok',
      detail: peakVesselDelay?.vesselName ?? '无高延误船舶',
    },
    {
      id: 'carbon',
      label: '碳排',
      value: `${totalCarbonTons.toFixed(0)}t`,
      tone: emissionPanelTone,
      detail: `较基准 ${totalCarbonChangePercent > 0 ? '+' : ''}${totalCarbonChangePercent.toFixed(1)}%`,
    },
    {
      id: 'strategy',
      label: 'RL策略',
      value: rlPolicyApplied
        ? `${rlPolicyRecoveryPercent}%`
        : rlPolicyInference
        ? `${rlPolicyInference.selectedAction.probability.toFixed(1)}%`
        : rlInferenceStatus === 'running'
          ? `${rlInferenceProgress.toFixed(0)}%`
          : '--',
      tone: rlPolicyApplied ? rlPolicyRecoveryTone : 'warning',
      detail: rlPolicyApplied
        ? `${rlPolicyRecoveryStageLabel} · ${policyRecovery.advancedMinutes}/${policyRecovery.targetMinutes}分`
        : rlPolicyInference?.selectedAction.label ?? '等待已训练策略推理',
    },
    {
      id: 'resilience',
      label: '韧性',
      value: resilienceAssessment.networkResilienceIndex.toFixed(1),
      tone: resilienceAssessment.tone,
      detail: `恢复 ${resilienceAssessment.congestionRecoveryAbility}%`,
    },
    {
      id: 'micro-validation',
      label: '验证',
      value: importedGodotResult ? '回写' : generatedGodotRequest ? '生成' : '待命',
      tone: importedGodotResult ? importedResultTone : generatedGodotRequest ? 'ok' : selectedValidationTone,
      detail: validationFeedStatusLabel,
    },
  ];
  const rlTrainingRewardWeights = {
    delay: rlTraining.parameters.rewardDelay,
    congestion: rlTraining.parameters.rewardCongestion,
    carbon: rlTraining.parameters.rewardCarbon,
    safety: rlTraining.parameters.rewardSafety,
    resilience: rlTraining.parameters.rewardResilience,
    throughput: rlTraining.parameters.rewardThroughput,
  };
  const activeRlAlgorithmOption =
    rlAlgorithmOptions.find((algorithm) => algorithm.id === rlTraining.selectedAlgorithmId) ??
    rlAlgorithmOptions[0];
  const activeRlTrainingBaseline =
    rlTrainingBaselines.find((baseline) => baseline.id === rlTraining.selectedBaselineId) ??
    rlTrainingBaselines[0];
  const activeRlTrainingObjective =
    rlTrainingObjectives.find((objective) => objective.id === rlTraining.selectedObjectiveId) ??
    rlTrainingObjectives[0];
  const activeRlBackendStatusTone = rlBackendStatusTone[rlTraining.backend.status];
  const activeRlTrainingStage =
    rlTrainingStages.find((stage) => stage.id === rlTraining.currentStageId) ??
    getRlTrainingStageByProgress(rlTraining.progressPercent);
  const activeRlTrainingStageProgress = clampNumber(
    ((rlTraining.progressPercent - activeRlTrainingStage.rangeStart) /
      Math.max(1, activeRlTrainingStage.rangeEnd - activeRlTrainingStage.rangeStart)) *
      100,
    0,
    100,
  );
  const rlTrainingStatusTone: StatusTone =
    rlTraining.status === 'completed'
      ? 'ok'
      : rlTraining.status === 'failed' || rlTraining.status === 'cancelled'
        ? 'danger'
      : rlTraining.status === 'running' || rlTraining.status === 'queued'
        ? activeRlTrainingStage.tone
        : activeRlTrainingBaseline.tone;
  const rlTrainingSettings: RlTrainingSettingItem[] = [
    {
      id: 'network-snapshot',
      label: '拓扑快照',
      value: `${scenario.overview.portCount}港/${scenario.overview.channelCount}航道`,
      detail: `锚地 ${scenario.overview.anchorageCount} 处，监控船舶 ${formatInteger(scenario.overview.monitoredVesselCount)} 艘`,
      tone: 'ok',
    },
    {
      id: 'vessel-state',
      label: '船舶状态',
      value: `${scenario.vesselMarkers.length}代表船`,
      detail: `${selectedValidationTargetLabel}，目标航速 ${pendingTargetSpeedKnots.toFixed(1)}kn`,
      tone: selectedValidationTone,
    },
    {
      id: 'event-disturbance',
      label: '事件扰动',
      value: `${injectedEvents.length}注入/${displayedRiskAlerts.length}风险`,
      detail: eventImpact.activeSummaries[0] ?? displayedRiskAlerts[0]?.label ?? '无新增扰动',
      tone: injectedEvents.length > 0 ? 'warning' : renderSignalTone,
    },
    {
      id: 'weather-sea-state',
      label: '气象海况',
      value: `${scenario.weather.windSpeedMs}m/s ${scenario.weather.waveHeightM}m`,
      detail: `${scenario.weather.windDirection} / 能见度 ${scenario.weather.visibilityKm}km / 流速 ${scenario.weather.currentSpeedKnots}kn`,
      tone:
        scenario.weather.visibilityKm <= 6 ||
        scenario.weather.windSpeedMs >= 16 ||
        scenario.weather.waveHeightM >= 1.6
          ? 'danger'
          : scenario.weather.windSpeedMs >= 12
            ? 'warning'
            : 'ok',
    },
    {
      id: 'congestion-delay',
      label: '拥堵延误',
      value: `${peakPortCongestion.congestionScore}%/${peakVesselDelay?.delayMinutes ?? 0}分`,
      detail: `${peakPortCongestion.portName} 排队 ${peakPortCongestion.queueingVessels} 艘，等待 ${peakPortCongestion.expectedWaitingHours.toFixed(1)}h`,
      tone: peakPortCongestion.tone,
    },
    {
      id: 'carbon-reward',
      label: '碳排奖励',
      value: `${totalCarbonTons.toFixed(0)}t`,
      detail: `碳权重 ${rlTrainingRewardWeights.carbon.toFixed(2)}，较基准 ${totalCarbonChangePercent > 0 ? '+' : ''}${totalCarbonChangePercent.toFixed(1)}%`,
      tone: emissionPanelTone,
    },
    {
      id: 'dispatch-action',
      label: '动作空间',
      value: bestGreenStrategy ? bestGreenStrategy.label : `${rankedGreenStrategies.length}策略`,
      detail: '动作包含航速、航线、到港窗口、分流港口和管制阈值',
      tone: bestGreenStrategy?.tone ?? 'warning',
    },
    {
      id: 'micro-validation',
      label: '验证回写',
      value: importedGodotResult ? '结果回写' : generatedGodotRequest ? '请求生成' : '待生成',
      detail: generatedGodotRequest
        ? `${generatedGodotRequest.vesselName} / 风险 ${generatedGodotRequest.riskEvents.length} 项`
        : validationFeedStatusLabel,
      tone: importedGodotResult ? importedResultTone : generatedGodotRequest ? 'ok' : selectedValidationTone,
    },
  ];
  const activeRlTrainingSetting =
    rlTrainingSettings.find((setting) => setting.id === rlTraining.activeSettingId) ??
    rlTrainingSettings[0];
  const selectedRlBenchmarkResult = rlBenchmark?.results.find(
    (result) => result.id === rlTraining.selectedAlgorithmId,
  );
  const simulatedRlDelayReductionLabel = selectedRlBenchmarkResult
    ? `${selectedRlBenchmarkResult.evaluation.delayReductionPercent >= 0 ? '-' : '+'}${Math.abs(selectedRlBenchmarkResult.evaluation.delayReductionPercent).toFixed(1)}%`
    : '--';
  const simulatedRlCarbonReduction = selectedRlBenchmarkResult
    ? selectedRlBenchmarkResult.evaluation.carbonReductionPercent
    : 0;
  const rlBenchmarkRewardValues = rlBenchmark?.results.flatMap((result) =>
    result.curve.map((point) => point.reward),
  ) ?? [];
  const rlBenchmarkRewardMin = rlBenchmarkRewardValues.length
    ? Math.min(...rlBenchmarkRewardValues)
    : -80;
  const rlBenchmarkRewardMax = rlBenchmarkRewardValues.length
    ? Math.max(...rlBenchmarkRewardValues)
    : 20;
  const rlBenchmarkEpisodeMax = rlBenchmark?.episodes ?? 300;
  const rlBenchmarkPolyline = (curve: Array<{ episode: number; reward: number }>) =>
    curve
      .map((point) => {
        const x = 14 + (point.episode / Math.max(1, rlBenchmarkEpisodeMax)) * 432;
        const y =
          132 -
          ((point.reward - rlBenchmarkRewardMin) /
            Math.max(1, rlBenchmarkRewardMax - rlBenchmarkRewardMin)) *
            112;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  const bestRlBenchmarkResult = rlBenchmark?.results.find(
    (result) => result.id === rlBenchmark.bestAlgorithmId,
  );
  const rlElapsedSeconds = (rlTrainingJob?.elapsedMs ?? 0) / 1000;
  const rlRemainingSeconds =
    rlTraining.status === 'running' && rlTraining.progressPercent > 0
      ? rlElapsedSeconds * (100 - rlTraining.progressPercent) / rlTraining.progressPercent
      : 0;
  const rlPlannedDurationSeconds = rlElapsedSeconds + rlRemainingSeconds;
  const formatTrainingDuration = (seconds: number) => {
    const normalized = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(normalized / 3600);
    const minutes = Math.floor((normalized % 3600) / 60);
    const remainingSeconds = normalized % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  };
  const formatTrainingClock = (epochMs: number | null) =>
    epochMs
      ? new Date(epochMs).toLocaleTimeString('zh-CN', { hour12: false })
      : '--:--:--';
  const rlEstimatedCompletionEpochMs = rlTraining.startedAtEpochMs && rlRemainingSeconds > 0
    ? Date.now() + rlRemainingSeconds * 1000
    : null;
  const rlEnvironmentSteps = rlTrainingJob?.environmentSteps ?? selectedRlBenchmarkResult?.training.environmentSteps ?? 0;
  const rlRewardEma = rlTrainingJob?.rewardEma ?? selectedRlBenchmarkResult?.evaluation.meanReward ?? 0;
  const rlSamplesPerSecond = rlTrainingJob?.samplesPerSecond ?? 0;
  const rlParameterUpdates = rlTrainingJob?.parameterUpdates ?? selectedRlBenchmarkResult?.training.parameterUpdates ?? 0;
  const rlVisitedStates = selectedRlBenchmarkResult?.training.visitedStates ?? 0;
  const rlDatasetRecordCount = rlTrainingJob?.dataset?.recordCount ?? rlBenchmark?.dataset.recordCount ?? 0;
  const rlTrainRecordCount = rlTrainingJob?.dataset?.trainRecordCount ?? rlBenchmark?.dataset.trainRecordCount ?? 0;
  const rlValidationRecordCount = rlTrainingJob?.dataset?.validationRecordCount ?? rlBenchmark?.dataset.validationRecordCount ?? 0;
  const rlTestRecordCount = rlTrainingJob?.dataset?.testRecordCount ?? rlBenchmark?.dataset.testRecordCount ?? 0;
  const rlDatasetQuality = rlTrainingJob?.dataset?.quality ?? rlBenchmark?.dataset.quality;
  const rlVisibleCurve = (curve: Array<{ episode: number; reward: number }>) => {
    if (rlTraining.status === 'idle') return [];
    const visibleCount = Math.min(
      curve.length,
      Math.max(2, Math.ceil(curve.length * (rlTraining.progressPercent / 100))),
    );
    return curve.slice(0, visibleCount);
  };
  const rlTrainingTelemetry = [
    { label: '当前算法', value: rlTrainingJob?.currentAlgorithmId ?? '--', detail: rlTrainingJob?.phase ?? 'idle' },
    { label: 'Environment Steps', value: formatInteger(rlEnvironmentSteps), detail: `${rlSamplesPerSecond} samples/s` },
    { label: '参数更新', value: formatInteger(rlParameterUpdates), detail: '真实 Bellman / planning updates' },
    { label: 'Reward EMA', value: rlRewardEma.toFixed(3), detail: '服务器端训练窗口' },
    { label: '已访问状态', value: formatInteger(rlVisitedStates), detail: '最终所选策略' },
    {
      label: '数据记录',
      value: formatInteger(rlDatasetRecordCount),
      detail: `train ${rlTrainRecordCount} / val ${rlValidationRecordCount} / test ${rlTestRecordCount} · capacity ${rlDatasetQuality?.capacityMode ?? '--'}`,
    },
  ];
  const rlTrainingDynamicLogs = rlTrainingJob?.logs.length
    ? rlTrainingJob.logs
    : [
        '训练任务尚未启动；前端不会生成伪造损失、GPU利用率或墙钟进度。',
        `奖励配置：delay ${rlTrainingRewardWeights.delay.toFixed(2)} / congestion ${rlTrainingRewardWeights.congestion.toFixed(2)} / carbon ${rlTrainingRewardWeights.carbon.toFixed(2)} / safety ${rlTrainingRewardWeights.safety.toFixed(2)} / throughput ${rlTrainingRewardWeights.throughput.toFixed(2)}`,
      ];
  const rlProgressDigits = 2;
  const formatRlParameterValue = (key: RlTrainingParameterKey, value: number) => {
    if (key === 'wallClockHours') {
      return value.toFixed(2);
    }
    if (key === 'learningRate') {
      return value.toFixed(4);
    }

    if (
      key === 'discountGamma' ||
      key.startsWith('reward')
    ) {
      return value.toFixed(2);
    }

    return formatInteger(Math.round(value));
  };
  const buildRlTrainingRequestContract = (
    trainingState: RlTrainingRuntimeState,
  ): RlTrainingRequestContract => ({
    protocolVersion: 'rl-training-job.v1',
    adapter:
      trainingState.backend.mode === 'websocket'
          ? 'websocket-json'
          : trainingState.backend.mode === 'ray-service'
            ? 'ray-job-api'
            : 'http-json',
    endpoint:
      trainingState.backend.mode === 'websocket'
        ? trainingState.backend.websocketUrl
        : trainingState.backend.endpoint,
    algorithmId: trainingState.selectedAlgorithmId,
    baselineId: trainingState.selectedBaselineId,
    objectiveId: trainingState.selectedObjectiveId,
    objectiveLabel:
      rlTrainingObjectives.find((objective) => objective.id === trainingState.selectedObjectiveId)?.label ??
      rlTrainingObjectives[0].label,
    selectedSettingId: trainingState.activeSettingId,
    createdAt: scenarioClock.toISOString(),
    backend: {
      mode: trainingState.backend.mode,
      endpoint: trainingState.backend.endpoint,
      websocketUrl: trainingState.backend.websocketUrl,
      projectName: trainingState.backend.projectName,
      status: trainingState.backend.status,
    },
    trainingParameters: trainingState.parameters,
    scenarioSnapshot: {
      scenarioId: scenario.id,
      ports: scenario.overview.portCount,
      channels: scenario.overview.channelCount,
      vessels: scenario.overview.monitoredVesselCount,
      injectedEvents: injectedEvents.length,
      peakCongestionPercent: peakPortCongestion.congestionScore,
      carbonTons: totalCarbonTons,
      networkResilienceIndex: resilienceAssessment.networkResilienceIndex,
    },
    observationSpace: [
      'port.congestionPercent',
      'channel.delayMinutes',
      'vessel.speedKnots',
      'route.carbonEmissionTons',
      'weather.windSpeedMs',
      'riskAlerts.tone',
      'microValidation.riskLevel',
    ],
    actionSpace: [
      'set_target_speed',
      'switch_route',
      'shift_arrival_window',
      'divert_destination_port',
      'apply_channel_control_threshold',
    ],
    rewardWeights: {
      delay: trainingState.parameters.rewardDelay,
      congestion: trainingState.parameters.rewardCongestion,
      carbon: trainingState.parameters.rewardCarbon,
      safety: trainingState.parameters.rewardSafety,
      resilience: trainingState.parameters.rewardResilience,
      throughput: trainingState.parameters.rewardThroughput,
    },
  });
  const rlInferenceSnapshotRef = useRef({
    congestionPercent: peakPortCongestion.congestionScore,
    delayMinutes: peakVesselDelay?.delayMinutes ?? 0,
    carbonTons: totalCarbonTons,
    resilienceIndex: resilienceAssessment.networkResilienceIndex,
    windSpeedMs: scenario.weather.windSpeedMs,
    waveHeightM: scenario.weather.waveHeightM,
    visibilityKm: scenario.weather.visibilityKm,
    queueVessels: peakPortCongestion.queueingVessels,
    eventCount: injectedEvents.length,
  });
  rlInferenceSnapshotRef.current = {
    congestionPercent: peakPortCongestion.congestionScore,
    delayMinutes: peakVesselDelay?.delayMinutes ?? 0,
    carbonTons: totalCarbonTons,
    resilienceIndex: resilienceAssessment.networkResilienceIndex,
    windSpeedMs: scenario.weather.windSpeedMs,
    waveHeightM: scenario.weather.waveHeightM,
    visibilityKm: scenario.weather.visibilityKm,
    queueVessels: peakPortCongestion.queueingVessels,
    eventCount: injectedEvents.length,
  };
  const rlDisturbanceRef = useRef(rlDisturbance);
  rlDisturbanceRef.current = rlDisturbance;
  const rlInferenceEventContextRef = useRef<RlPolicyInferenceEventContext | null>(
    rlPolicyEventContext,
  );
  rlInferenceEventContextRef.current = rlPolicyEventContext;

  useEffect(() => {
    if (rlInferenceRunId <= 0) return;
    if (rlTraining.status !== 'completed' || !rlTraining.jobId) {
      setRlInferenceStatus('failed');
      setRlInferenceProgress(0);
      return;
    }
    const controller = new AbortController();
    const requestId = `policy-inference-${Date.now()}-${rlInferenceRunId}`;
    setRlInferenceStatus('running');
    setRlInferenceProgress(10);
    setRlPolicyInference(null);
    void submitRlPolicyInference(
      {
        protocolVersion: 'rl-policy-inference.v2',
        requestId,
        jobId: rlTraining.jobId,
        algorithmId: rlTraining.selectedAlgorithmId,
        disturbance: rlDisturbanceRef.current,
        eventContext: rlInferenceEventContextRef.current,
        state: rlInferenceSnapshotRef.current,
      },
      controller.signal,
      rlTraining.backend.authToken,
    )
      .then((result) => {
        setRlPolicyInference(result);
        setRlInferenceProgress(100);
        setRlInferenceStatus('completed');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setRlInferenceStatus('failed');
        setRlInferenceProgress(0);
        console.error('RL policy inference failed', error);
      });

    return () => {
      controller.abort();
    };
  }, [rlInferenceRunId, rlTraining.backend.authToken, rlTraining.jobId, rlTraining.selectedAlgorithmId, rlTraining.status]);

  const runRlPolicyInference = (type: RlDisturbanceType, intensity: number) => {
    if (rlTraining.status !== 'completed' || !rlTraining.jobId) {
      setRlTrainingWindowState((windowState) => ({
        ...windowState,
        isOpen: true,
        isMinimized: false,
        isCollapsed: false,
      }));
      setSandboxRuntime((runtime) => ({
        ...runtime,
        rlTraining: {
          ...runtime.rlTraining,
          backend: {
            ...runtime.rlTraining.backend,
            lastMessage: '请先完成真实训练并生成检查点，再执行在线策略推理。',
          },
        },
      }));
      return;
    }
    setRlDisturbance({ type, intensity });
    setRlPolicyApplied(false);
    setIsRlDecisionPanelOpen(true);
    setSandboxRuntime((runtime) => ({
      ...runtime,
      policyRecovery: {
        status: 'idle',
        advancedMinutes: 0,
        targetMinutes: defaultRlPolicyRecoveryMinutes,
      },
      phases: patchSandboxPhases(runtime.phases, [
        {
          id: 'vessel-dispatch',
          status: 'running',
          startedAt: scenarioClockLabel,
          startedMinute: runtime.elapsedMinutes,
          completedAt: undefined,
          completedMinute: undefined,
          summary: '已训练检查点正在基于当前事件影响执行策略推理',
        },
      ]),
    }));
    setRlInferenceRunId((value) => value + 1);
  };

  const openRlDecisionPanel = () => {
    if (rlTraining.status !== 'completed' || !rlTraining.jobId) {
      openRlTrainingWindow();
      return;
    }
    setIsRlDecisionPanelOpen(true);
    if (rlInferenceRunId === 0 || rlInferenceStatus === 'failed') {
      setSandboxRuntime((runtime) => ({
        ...runtime,
        phases: patchSandboxPhases(runtime.phases, [
          {
            id: 'vessel-dispatch',
            status: 'running',
            startedAt: scenarioClockLabel,
            startedMinute: runtime.elapsedMinutes,
            completedAt: undefined,
            completedMinute: undefined,
            summary: '已训练检查点正在基于当前事件影响执行策略推理',
          },
        ]),
      }));
      setRlInferenceRunId((value) => value + 1);
    }
  };

  const applyRlPolicyDecision = () => {
    if (!rlPolicyInference || rlInferenceStatus !== 'completed') return;
    const mostLikelyForecast = [...rlPolicyInference.scenarioForecasts].sort(
      (left, right) => right.probability - left.probability,
    )[0];
    const recoveryTargetMinutes = clampNumber(
      Math.round((mostLikelyForecast?.recoveryMinutes ?? defaultRlPolicyRecoveryMinutes) / 15) * 15,
      60,
      120,
    );
    setRlPolicyApplied(true);
    setIsRlDecisionPanelOpen(false);
    setActiveModule('dispatch');
    setExpandedPanelTitle(null);
    setOpenMapOverlays((panels) => ({ ...panels, strategy: true, propagation: true }));
    setSandboxRuntime((runtime) => ({
      ...runtime,
      policyRecovery: {
        status: 'recovering',
        advancedMinutes: 0,
        targetMinutes: recoveryTargetMinutes,
      },
      phases: patchSandboxPhases(runtime.phases, [
        {
          id: 'vessel-dispatch',
          status: 'completed',
          completedAt: scenarioClockLabel,
          completedMinute: runtime.elapsedMinutes,
          summary: `${rlPolicyInference.model.policyId} 采用「${rlPolicyInference.selectedAction.label}」：${rlPolicyInference.selectedAction.commandSummary}`,
        },
      ]),
    }));
  };
  const activeRlTrainingRequest =
    rlTraining.trainingRequest ?? buildRlTrainingRequestContract(rlTraining);
  const activeRlPolicyTestCase =
    rlPolicyTestCases.find((testCase) => testCase.id === rlTraining.policyTest.selectedCaseId) ??
    rlPolicyTestCases[0];
  const isRlPolicyTestUnlocked = rlTraining.status === 'completed' || rlTraining.progressPercent >= 100;
  const rlPolicyTestTone: StatusTone =
    rlTraining.policyTest.status === 'completed'
      ? 'ok'
      : rlTraining.policyTest.status === 'running'
        ? activeRlPolicyTestCase.tone
        : isRlPolicyTestUnlocked
          ? activeRlPolicyTestCase.tone
          : 'warning';
  const rlPolicyTestProgressLabel =
    rlTraining.policyTest.status === 'locked'
      ? '待解锁'
      : `${rlTraining.policyTest.progressPercent.toFixed(1)}%`;
  const policyEvaluationMetrics = rlPolicyEvaluation?.metrics;
  const signedReduction = (value: number | undefined) =>
    value === undefined ? '--' : `${value >= 0 ? '-' : '+'}${Math.abs(value).toFixed(1)}`;
  const rlPolicyTestMetrics = [
    {
      label: '平均奖励',
      value: policyEvaluationMetrics?.meanReward.toFixed(3) ?? '--',
      unit: '',
      tone: 'ok' as StatusTone,
    },
    {
      label: '平均延误',
      value: signedReduction(policyEvaluationMetrics?.delayReductionPercent),
      unit: '%',
      tone: 'ok' as StatusTone,
    },
    {
      label: '平均拥堵',
      value: signedReduction(policyEvaluationMetrics?.congestionReductionPercent),
      unit: '%',
      tone: 'ok' as StatusTone,
    },
    {
      label: '碳排',
      value: signedReduction(policyEvaluationMetrics?.carbonReductionPercent),
      unit: '%',
      tone: 'ok' as StatusTone,
    },
    {
      label: '安全违规',
      value: policyEvaluationMetrics ? String(policyEvaluationMetrics.safetyViolations) : '--',
      unit: '项',
      tone: (policyEvaluationMetrics?.safetyViolations ?? 0) > 0 ? 'danger' as StatusTone : 'ok' as StatusTone,
    },
    {
      label: '回放记录',
      value: rlPolicyEvaluation ? String(rlPolicyEvaluation.trace.length) : '--',
      unit: '步',
      tone: 'warning' as StatusTone,
    },
  ];
  const rlPolicyTestHeaderLogs = [
    `检查点：${rlTraining.jobId ?? '等待训练'} / ${activeRlAlgorithmOption.label}`,
    rlBenchmark
      ? `最终测试集：${rlBenchmark.dataset.testRange.join(' → ')} / 从未参与训练与选优 / 数据指纹 ${rlBenchmark.dataset.fingerprint}`
      : `测试场景：${activeRlPolicyTestCase.label} / 等待真实评估轨迹`,
  ];
  const rlPolicyTestTraceLogs = (rlPolicyEvaluation?.trace ?? []).map((point) =>
    `${point.timestamp} · ${point.actionLabel} · queue ${point.queueVessels.toFixed(1)} · delay ${point.delayHours.toFixed(2)}h · reward ${point.reward.toFixed(3)}`,
  );
  const visibleRlPolicyTestLogs =
    rlTraining.policyTest.status === 'idle' || rlTraining.policyTest.status === 'locked'
      ? rlPolicyTestHeaderLogs
      : [
          ...rlPolicyTestHeaderLogs,
          ...rlPolicyTestTraceLogs.slice(0, Math.max(0, rlTraining.policyTest.logCursor + 1)),
        ];
  const askXiaoyiForRlTraining = async (scope: RlTrainingCardId | 'all') => {
    const requestedObjectiveId = rlTraining.selectedObjectiveId;
    const requestedObjectiveLabel = activeRlTrainingObjective.label;
    const requestId = xiaoyiAdviceRequestIdRef.current + 1;
    xiaoyiAdviceRequestIdRef.current = requestId;
    if (scope !== 'all') setXiaoyiAdvisorScope(scope);
    setXiaoyiAdvisorStatus('thinking');
    setXiaoyiRlAdvice(null);
    setXiaoyiAdviceObjectiveId(null);
    if (xiaoyiApplyFeedbackTimerRef.current !== null) {
      window.clearTimeout(xiaoyiApplyFeedbackTimerRef.current);
      xiaoyiApplyFeedbackTimerRef.current = null;
    }
    setXiaoyiApplyFeedback({ status: 'idle', scope: null, message: '', appliedAt: null });
    setIsXiaoyiAssistantOpen(true);
    setIsXiaoyiAssistantMinimized(false);
    try {
      const advice = await requestXiaoyiRlAdvice({
        objectiveId: requestedObjectiveId,
        objectiveLabel: requestedObjectiveLabel,
        requestedCard: scope,
        scenario: {
          peakCongestionPercent: peakPortCongestion.congestionScore,
          peakDelayMinutes: peakVesselDelay?.delayMinutes ?? 0,
          carbonTons: Number(totalCarbonTons.toFixed(1)),
          resilienceIndex: Number(resilienceAssessment.networkResilienceIndex.toFixed(1)),
          injectedEvents: injectedEvents.length,
          windSpeedMs: scenario.weather.windSpeedMs,
          waveHeightM: scenario.weather.waveHeightM,
        },
      }, undefined, rlTraining.backend.authToken);
      if (requestId !== xiaoyiAdviceRequestIdRef.current) return;
      setXiaoyiRlAdvice(advice);
      setXiaoyiAdviceObjectiveId(requestedObjectiveId);
      setXiaoyiAdvisorStatus('ready');
    } catch {
      if (requestId !== xiaoyiAdviceRequestIdRef.current) return;
      setXiaoyiAdvisorStatus('failed');
    }
  };

  const applyXiaoyiRlAdvice = (scope: RlTrainingCardId | 'all') => {
    if (!xiaoyiRlAdvice || xiaoyiAdviceObjectiveId !== rlTraining.selectedObjectiveId) return;
    const recommendation = xiaoyiRlAdvice.recommendation;
    const knownParameters = createInitialRlTrainingParameters();
    const parameterUpdates = Object.fromEntries(
      Object.entries(recommendation.parameters).filter(([key]) => key in knownParameters),
    ) as Partial<RlTrainingParameterState>;
    const applyAll = scope === 'all';
    const feedbackByScope: Record<RlTrainingCardId, string> = {
      algorithm: `算法已切换为 ${recommendation.algorithmLabel}`,
      baselines: `Baseline 已切换为 ${recommendation.baselineLabel}`,
      settings: `沙盘训练状态已切换为 ${recommendation.settingId}`,
      parameters: `参数已同步：步长 ${recommendation.parameters.learningRate} / 折扣 ${recommendation.parameters.discountGamma} / ${recommendation.parameters.maxEpisodes} episodes`,
      backend: `训练服务已配置为 ${recommendation.backendMode} / ${recommendation.backendEndpoint}`,
      progress: `真实 episode 进度、数据切分和 Checkpoint 参数已同步`,
      metrics: '训练指标读取方式已同步',
      curves: '训练曲线对照方式已同步',
      'policy-test': `训练后验证已切换为 ${recommendation.policyTestCaseId}`,
      contract: `接口契约已按 ${recommendation.algorithmLabel} 和当前优化目标重新生成`,
    };
    const feedbackMessage = applyAll
      ? `全部配置完成：${recommendation.algorithmLabel}、${recommendation.baselineLabel}、沙盘状态、超参数、训练服务、策略测试和接口契约已同步`
      : feedbackByScope[scope];
    if (xiaoyiApplyFeedbackTimerRef.current !== null) {
      window.clearTimeout(xiaoyiApplyFeedbackTimerRef.current);
    }
    setXiaoyiApplyFeedback({ status: 'applying', scope, message: feedbackMessage, appliedAt: null });
    setSandboxRuntime((runtime) => {
      const nextParameters =
        applyAll || scope === 'parameters' || scope === 'progress'
          ? { ...runtime.rlTraining.parameters, ...parameterUpdates }
          : runtime.rlTraining.parameters;
      const nextBackend =
        applyAll || scope === 'backend'
          ? {
              ...runtime.rlTraining.backend,
              mode: recommendation.backendMode,
              endpoint: recommendation.backendEndpoint,
              status: 'disconnected' as RlBackendStatus,
              lastMessage: `小懿已按「${activeRlTrainingObjective.label}」配置服务模式，等待测试接入。`,
            }
          : runtime.rlTraining.backend;
      const nextTraining: RlTrainingRuntimeState = {
          ...runtime.rlTraining,
          selectedAlgorithmId:
            applyAll || scope === 'algorithm'
              ? recommendation.algorithmId
              : runtime.rlTraining.selectedAlgorithmId,
          selectedBaselineId:
            applyAll || scope === 'baselines'
              ? recommendation.baselineId
              : runtime.rlTraining.selectedBaselineId,
          activeSettingId:
            applyAll || scope === 'settings'
              ? recommendation.settingId as RlTrainingSettingId
              : runtime.rlTraining.activeSettingId,
          parameters: nextParameters,
          backend: nextBackend,
          status: 'idle',
          progressPercent: 0,
          currentStageId: 'snapshot-build',
          startedAt: null,
          startedAtEpochMs: null,
          plannedDurationSeconds: nextParameters.wallClockHours * 60 * 60,
          completedAt: null,
          episodeCursor: 0,
          trainingRequest: null,
          policyTest: {
            ...createInitialRlPolicyTestState(),
            selectedCaseId:
              applyAll || scope === 'policy-test'
                ? recommendation.policyTestCaseId
                : runtime.rlTraining.policyTest.selectedCaseId,
          },
      };
      if (applyAll || scope === 'contract') {
        nextTraining.trainingRequest = buildRlTrainingRequestContract(nextTraining);
      }
      return {
        ...runtime,
        rlTraining: nextTraining,
      };
    });
    setXiaoyiAdvisorScope(scope);
    xiaoyiApplyFeedbackTimerRef.current = window.setTimeout(() => {
      setXiaoyiApplyFeedback({
        status: 'success',
        scope,
        message: feedbackMessage,
        appliedAt: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      });
      xiaoyiApplyFeedbackTimerRef.current = null;
    }, 320);
  };

  const isXiaoyiCardApplied = (cardId: RlTrainingCardId) =>
    xiaoyiApplyFeedback.status === 'success' &&
    (xiaoyiApplyFeedback.scope === 'all' || xiaoyiApplyFeedback.scope === cardId);

  const clampXiaoyiAssistantPosition = (position: { x: number; y: number }) => {
    const width = isXiaoyiAssistantMinimized ? 86 : 300;
    const height = isXiaoyiAssistantMinimized ? 86 : 430;
    return {
      x: clampNumber(position.x, 12, Math.max(12, window.innerWidth - width - 12)),
      y: clampNumber(position.y, 78, Math.max(78, window.innerHeight - height - 12)),
    };
  };

  const startXiaoyiAssistantDrag = (event: ReactMouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const initialPosition = xiaoyiAssistantPosition;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      setXiaoyiAssistantPosition(
        clampXiaoyiAssistantPosition({
          x: initialPosition.x + moveEvent.clientX - startX,
          y: initialPosition.y + moveEvent.clientY - startY,
        }),
      );
    };
    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };
  const selectRlTrainingObjective = (objectiveId: RlTrainingObjectiveId) => {
    const selectedObjective =
      rlTrainingObjectives.find((objective) => objective.id === objectiveId) ?? rlTrainingObjectives[0];
    const preset = getRlObjectivePreset(selectedObjective.id);
    if (!preset.supportedByAggregateEnvironment) return;

    setSandboxRuntime((runtime) => ({
      ...runtime,
      rlTraining: {
        ...runtime.rlTraining,
        selectedObjectiveId: selectedObjective.id,
        parameters: {
          ...runtime.rlTraining.parameters,
          rewardDelay: preset.weights.delay,
          rewardCongestion: preset.weights.congestion,
          rewardCarbon: preset.weights.carbon,
          rewardSafety: preset.weights.safety,
          rewardResilience: preset.weights.resilience,
          rewardThroughput: preset.weights.throughput,
        },
        status: 'idle',
        progressPercent: 0,
        currentStageId: 'snapshot-build',
        startedAt: null,
        startedAtEpochMs: null,
        plannedDurationSeconds: runtime.rlTraining.parameters.wallClockHours * 60 * 60,
        completedAt: null,
        episodeCursor: 0,
        trainingRequest: null,
        policyTest: createInitialRlPolicyTestState(),
        backend: {
          ...runtime.rlTraining.backend,
          lastMessage: `训练目标已切换为「${selectedObjective.label}」，六项奖励权重已同步；可继续人工微调。`,
        },
      },
    }));
    xiaoyiAdviceRequestIdRef.current += 1;
    if (xiaoyiApplyFeedbackTimerRef.current !== null) {
      window.clearTimeout(xiaoyiApplyFeedbackTimerRef.current);
      xiaoyiApplyFeedbackTimerRef.current = null;
    }
    setXiaoyiRlAdvice(null);
    setXiaoyiAdviceObjectiveId(null);
    setXiaoyiApplyFeedback({ status: 'idle', scope: null, message: '', appliedAt: null });
    setXiaoyiAdvisorStatus('idle');
    setXiaoyiAdvisorScope('all');
  };
  const selectRlPolicyTestCase = (testCaseId: RlPolicyTestCaseId) => {
    setSandboxRuntime((runtime) => ({
      ...runtime,
      rlTraining: {
        ...runtime.rlTraining,
        policyTest: {
          ...runtime.rlTraining.policyTest,
          selectedCaseId: testCaseId,
          status:
            runtime.rlTraining.status === 'completed' || runtime.rlTraining.progressPercent >= 100
              ? 'idle'
              : 'locked',
          progressPercent: 0,
          startedAt: null,
          completedAt: null,
          logCursor: 0,
        },
      },
    }));
  };
  const startRlPolicyTest = async () => {
    if (rlTraining.status !== 'completed' || !rlTraining.jobId) return;
    setRlPolicyEvaluation(null);
    setSandboxRuntime((runtime) => ({
      ...runtime,
      rlTraining: {
        ...runtime.rlTraining,
        policyTest: {
          ...runtime.rlTraining.policyTest,
          status: 'running',
          progressPercent: 0,
          startedAt: scenarioClockLabel,
          completedAt: null,
          logCursor: -1,
        },
      },
    }));
    try {
      const evaluation = await evaluateRlTrainingJob(
        rlTraining.jobId,
        rlTraining.selectedAlgorithmId,
        rlTraining.policyTest.selectedCaseId,
        rlTraining.backend.authToken,
      );
      setRlPolicyEvaluation(evaluation);
    } catch (error) {
      setSandboxRuntime((runtime) => ({
        ...runtime,
        rlTraining: {
          ...runtime.rlTraining,
          policyTest: {
            ...runtime.rlTraining.policyTest,
            status: 'idle',
          },
          backend: {
            ...runtime.rlTraining.backend,
            status: 'failed',
            lastMessage: error instanceof Error ? error.message : '最终测试集评估失败',
          },
        },
      }));
    }
  };
  const resetRlPolicyTest = () => {
    setRlPolicyEvaluation(null);
    setSandboxRuntime((runtime) => ({
      ...runtime,
      rlTraining: {
        ...runtime.rlTraining,
        policyTest: {
          ...createInitialRlPolicyTestState(),
          selectedCaseId: runtime.rlTraining.policyTest.selectedCaseId,
          status:
            runtime.rlTraining.status === 'completed' || runtime.rlTraining.progressPercent >= 100
              ? 'idle'
              : 'locked',
        },
      },
    }));
  };
  const selectRlAlgorithm = (algorithmId: RlAlgorithmId) => {
    const selectedAlgorithm =
      rlAlgorithmOptions.find((algorithm) => algorithm.id === algorithmId) ?? rlAlgorithmOptions[0];

    setSandboxRuntime((runtime) => ({
      ...runtime,
      rlTraining: {
        ...runtime.rlTraining,
        selectedAlgorithmId: selectedAlgorithm.id,
        status: 'idle',
        progressPercent: 0,
        currentStageId: 'snapshot-build',
        startedAt: null,
        startedAtEpochMs: null,
        plannedDurationSeconds: runtime.rlTraining.parameters.wallClockHours * 60 * 60,
        completedAt: null,
        episodeCursor: 0,
        trainingRequest: null,
        policyTest: createInitialRlPolicyTestState(),
        backend: {
          ...runtime.rlTraining.backend,
          mode: selectedAlgorithm.defaultBackendMode,
          endpoint: rlBackendModeDefaults[selectedAlgorithm.defaultBackendMode].endpoint,
          websocketUrl: rlBackendModeDefaults[selectedAlgorithm.defaultBackendMode].websocketUrl,
          status: 'disconnected',
          lastMessage: `${selectedAlgorithm.label} 已选中，后台接入模式切换为 ${rlBackendModeLabel[selectedAlgorithm.defaultBackendMode]}。`,
        },
      },
    }));
  };
  const selectRlTrainingBaseline = (baselineId: RlTrainingBaselineId) => {
    setSandboxRuntime((runtime) => ({
      ...runtime,
      rlTraining: {
        ...createInitialRlTrainingState(),
        selectedAlgorithmId: runtime.rlTraining.selectedAlgorithmId,
        selectedBaselineId: baselineId,
        selectedObjectiveId: runtime.rlTraining.selectedObjectiveId,
        activeSettingId: runtime.rlTraining.activeSettingId,
        parameters: runtime.rlTraining.parameters,
        backend: runtime.rlTraining.backend,
      },
    }));
  };
  const selectRlTrainingSetting = (settingId: RlTrainingSettingId) => {
    setSandboxRuntime((runtime) => ({
      ...runtime,
      rlTraining: {
        ...runtime.rlTraining,
        activeSettingId: settingId,
        trainingRequest: null,
      },
    }));
  };
  const updateRlTrainingParameter = (
    key: RlTrainingParameterKey,
    value: number,
    min: number,
    max: number,
  ) => {
    const normalizedValue = clampNumber(value, min, max);

    setSandboxRuntime((runtime) => ({
      ...runtime,
      rlTraining: {
        ...runtime.rlTraining,
        parameters: {
          ...runtime.rlTraining.parameters,
          [key]: normalizedValue,
        },
        trainingRequest: null,
        backend: {
          ...runtime.rlTraining.backend,
          lastMessage: `${key} 已更新为 ${formatRlParameterValue(key, normalizedValue)}，等待同步到训练请求。`,
        },
      },
    }));
  };
  const setRlBackendMode = (mode: RlBackendMode) => {
    setSandboxRuntime((runtime) => ({
      ...runtime,
      rlTraining: {
        ...runtime.rlTraining,
        trainingRequest: null,
        backend: {
          ...runtime.rlTraining.backend,
          mode,
          endpoint: rlBackendModeDefaults[mode].endpoint,
          websocketUrl: rlBackendModeDefaults[mode].websocketUrl,
          status: 'disconnected',
          lastMessage: `后台接入模式已切换为 ${rlBackendModeLabel[mode]}，请测试连接或同步参数。`,
        },
      },
    }));
  };
  const updateRlBackendField = (field: RlBackendEditableField, value: string) => {
    setSandboxRuntime((runtime) => ({
      ...runtime,
      rlTraining: {
        ...runtime.rlTraining,
        trainingRequest: null,
        backend: {
          ...runtime.rlTraining.backend,
          [field]: value,
          status: 'disconnected',
          lastMessage: '后台接入参数已修改，等待重新测试连接。',
        },
      },
    }));
  };
  const testRlBackendConnection = async () => {
    const backend = rlTraining.backend;
    setSandboxRuntime((runtime) => ({
      ...runtime,
      rlTraining: {
        ...runtime.rlTraining,
        backend: {
          ...runtime.rlTraining.backend,
          status: 'checking',
          lastMessage: `正在检测 ${rlBackendModeLabel[runtime.rlTraining.backend.mode]} 接入配置。`,
        },
      },
    }));

    try {
      if (backend.mode === 'websocket') {
        await new Promise<void>((resolve, reject) => {
          const socket = new WebSocket(backend.websocketUrl);
          const timeout = window.setTimeout(() => {
            socket.close();
            reject(new Error('WebSocket 握手超时'));
          }, 5000);
          socket.addEventListener('open', () => {
            window.clearTimeout(timeout);
            socket.close(1000, 'connectivity-check');
            resolve();
          });
          socket.addEventListener('error', () => {
            window.clearTimeout(timeout);
            reject(new Error('WebSocket 握手失败'));
          });
        });
      } else {
        const endpoint = new URL(backend.endpoint, window.location.origin);
        endpoint.pathname =
          backend.mode === 'ray-service'
            ? '/api/version'
            : endpoint.pathname.endsWith('/api/rl/jobs')
              ? '/api/rl/health'
            : endpoint.pathname.replace(/\/(?:start|benchmark)\/?$/, '/health');
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 5000);
        const response = await fetch(endpoint, {
          headers: backend.authToken ? { Authorization: `Bearer ${backend.authToken}` } : undefined,
          signal: controller.signal,
        }).finally(() => window.clearTimeout(timeout));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      }

      setSandboxRuntime((runtime) => ({
        ...runtime,
        rlTraining: {
          ...runtime.rlTraining,
          backend: {
            ...runtime.rlTraining.backend,
            status: 'connected',
            lastMessage: `真实握手成功：${backend.projectName} / ${backend.mode === 'websocket' ? backend.websocketUrl : backend.endpoint}`,
          },
        },
      }));
    } catch (error) {
      setSandboxRuntime((runtime) => ({
        ...runtime,
        rlTraining: {
          ...runtime.rlTraining,
          backend: {
            ...runtime.rlTraining.backend,
            status: 'failed',
            lastMessage: `${error instanceof Error ? error.message : '连接失败'}；请检查 HTTP Job API 与认证配置。`,
          },
        },
      }));
    }
  };
  const disconnectRlBackend = () => {
    setSandboxRuntime((runtime) => ({
      ...runtime,
      rlTraining: {
        ...runtime.rlTraining,
        backend: {
          ...runtime.rlTraining.backend,
          status: 'disconnected',
          lastMessage: '后台训练服务已断开，保留当前参数但不推送。',
        },
      },
    }));
  };
  const syncRlTrainingRequestContract = () => {
    setSandboxRuntime((runtime) => ({
      ...runtime,
      rlTraining: {
        ...runtime.rlTraining,
        trainingRequest: buildRlTrainingRequestContract(runtime.rlTraining),
        backend: {
          ...runtime.rlTraining.backend,
          lastMessage: '当前算法、参数、奖励权重和沙盘快照已写入请求契约。',
        },
      },
    }));
  };
  const startRlTraining = async () => {
    const request = buildRlTrainingRequestContract(rlTraining);
    const backend = rlTraining.backend;
    setSandboxRuntime((runtime) => ({
      ...runtime,
      rlTraining: {
        ...runtime.rlTraining,
        status: 'queued',
        progressPercent: 0,
        currentStageId: 'snapshot-build',
        startedAt: null,
        startedAtEpochMs: null,
        plannedDurationSeconds: runtime.rlTraining.parameters.wallClockHours * 60 * 60,
        completedAt: null,
        episodeCursor: 0,
        jobId: null,
        trainingRequest: request,
        policyTest: {
          ...createInitialRlPolicyTestState(),
          selectedCaseId: runtime.rlTraining.policyTest.selectedCaseId,
        },
        backend: {
          ...runtime.rlTraining.backend,
          status: 'checking',
          lastMessage: '正在创建服务器端训练任务；训练阶段不会生成沙盘渲染帧。',
        },
      },
    }));
    setRlTrainingWindowState((windowState) => ({
      ...windowState,
      isOpen: true,
      isMinimized: false,
      isCollapsed: false,
    }));
    setRlBenchmark(null);
    setRlTrainingJob(null);
    setRlPolicyEvaluation(null);
    setRlBenchmarkMessage('服务器正在读取训练段；当前不会渲染或回放策略效果');
    try {
      if (backend.mode === 'websocket' || backend.mode === 'ray-service') {
        throw new Error('当前开源内置实现使用 HTTP Job API；外部适配器需实现 rl-training-job.v1 协议');
      }
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8_000);
      const job = await createRlTrainingJob(
        backend.endpoint || '/api/rl/jobs',
        request,
        backend.authToken,
        controller.signal,
      ).finally(() => window.clearTimeout(timeout));
      setRlTrainingJob(job);
      setSandboxRuntime((runtime) => ({
        ...runtime,
        rlTraining: {
          ...runtime.rlTraining,
          status: job.status,
          jobId: job.jobId,
          progressPercent: job.progressPercent,
          backend: {
            ...runtime.rlTraining.backend,
            status: 'connected',
            lastMessage: `${job.message} / ${job.jobId}`,
          },
        },
      }));
    } catch (error) {
      setSandboxRuntime((runtime) => ({
        ...runtime,
        rlTraining: {
          ...runtime.rlTraining,
          status: 'failed',
          backend: {
            ...runtime.rlTraining.backend,
            status: 'failed',
            lastMessage: error instanceof Error ? error.message : '训练任务提交失败',
          },
        },
      }));
    }
  };
  const resetRlTraining = () => {
    if (rlTraining.jobId && (rlTraining.status === 'queued' || rlTraining.status === 'running')) {
      void cancelRlTrainingJob(rlTraining.jobId, rlTraining.backend.authToken);
    }
    setRlBenchmark(null);
    setRlTrainingJob(null);
    setRlPolicyEvaluation(null);
    setRlBenchmarkMessage('等待提交四种RL算法与MPC控制基线训练');
    setSandboxRuntime((runtime) => ({
      ...runtime,
      rlTraining: {
        ...createInitialRlTrainingState(),
        selectedAlgorithmId: runtime.rlTraining.selectedAlgorithmId,
        selectedBaselineId: runtime.rlTraining.selectedBaselineId,
        selectedObjectiveId: runtime.rlTraining.selectedObjectiveId,
        activeSettingId: runtime.rlTraining.activeSettingId,
        parameters: runtime.rlTraining.parameters,
        backend: runtime.rlTraining.backend,
      },
    }));
  };
  const openRlTrainingWindow = () => {
    setActiveModule('sandbox');
    setIsXiaoyiAssistantOpen(true);
    setRlTrainingWindowState((windowState) => ({
      ...windowState,
      isOpen: true,
      isMinimized: false,
      isCollapsed: false,
    }));
  };
  const closeRlTrainingWindow = () => {
    setRlTrainingWindowState((windowState) => ({
      ...windowState,
      isOpen: false,
    }));
  };
  const minimizeRlTrainingWindow = () => {
    setRlTrainingWindowState((windowState) => ({
      ...windowState,
      isOpen: true,
      isMinimized: true,
      isCollapsed: false,
    }));
  };
  const toggleCollapseRlTrainingWindow = () => {
    setRlTrainingWindowState((windowState) => ({
      ...windowState,
      isOpen: true,
      isMinimized: false,
      isCollapsed: !windowState.isCollapsed,
    }));
  };
  const restoreRlTrainingWindow = () => {
    setRlTrainingWindowState((windowState) => ({
      ...windowState,
      isOpen: true,
      isMinimized: false,
      isCollapsed: false,
    }));
  };
  const toggleRlTrainingCardCompact = (cardId: RlTrainingCardId) => {
    setRlTrainingWindowState((windowState) => ({
      ...windowState,
      compactCardIds: windowState.compactCardIds.includes(cardId)
        ? windowState.compactCardIds.filter((id) => id !== cardId)
        : [...windowState.compactCardIds, cardId],
    }));
  };
  const toggleRlTrainingCardCollapse = (cardId: RlTrainingCardId) => {
    setRlTrainingWindowState((windowState) => ({
      ...windowState,
      collapsedCardIds: windowState.collapsedCardIds.includes(cardId)
        ? windowState.collapsedCardIds.filter((id) => id !== cardId)
        : [...windowState.collapsedCardIds, cardId],
    }));
  };
  const closeRlTrainingCard = (cardId: RlTrainingCardId) => {
    setRlTrainingWindowState((windowState) => ({
      ...windowState,
      closedCardIds: windowState.closedCardIds.includes(cardId)
        ? windowState.closedCardIds
        : [...windowState.closedCardIds, cardId],
    }));
  };
  const restoreRlTrainingCards = () => {
    setRlTrainingWindowState((windowState) => ({
      ...windowState,
      compactCardIds: [],
      collapsedCardIds: [],
      closedCardIds: [],
    }));
  };
  const isRlTrainingCardClosed = (cardId: RlTrainingCardId) =>
    rlTrainingWindowState.closedCardIds.includes(cardId);
  const isRlTrainingCardCollapsed = (cardId: RlTrainingCardId) =>
    rlTrainingWindowState.collapsedCardIds.includes(cardId);
  const isRlTrainingCardCompact = (cardId: RlTrainingCardId) =>
    rlTrainingWindowState.compactCardIds.includes(cardId);
  const hiddenRlTrainingCardCount = rlTrainingWindowState.closedCardIds.length;
  const clampContextInspectorWindow = (
    windowState: ContextInspectorWindowState,
  ): ContextInspectorWindowState => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = clampNumber(windowState.width, 360, Math.max(360, viewportWidth - 36));
    const height = windowState.isCollapsed
      ? 46
      : clampNumber(windowState.height, 220, Math.max(220, viewportHeight - 110));

    return {
      ...windowState,
      width,
      height,
      x: clampNumber(windowState.x, 18, Math.max(18, viewportWidth - width - 18)),
      y: clampNumber(windowState.y, 74, Math.max(74, viewportHeight - height - 18)),
    };
  };
  const startContextInspectorDrag = (event: ReactMouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const initialWindow = contextInspectorWindow;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      setContextInspectorWindow((windowState) =>
        clampContextInspectorWindow({
          ...windowState,
          x: initialWindow.x + moveEvent.clientX - startX,
          y: initialWindow.y + moveEvent.clientY - startY,
        }),
      );
    };
    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };
  const startContextInspectorResize = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const initialWindow = contextInspectorWindow;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      setContextInspectorWindow((windowState) =>
        clampContextInspectorWindow({
          ...windowState,
          width: initialWindow.width + moveEvent.clientX - startX,
          height: initialWindow.height + moveEvent.clientY - startY,
        }),
      );
    };
    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };
  const openInspectorPanel = (panel: InspectorPanel) => {
    setContextInspectorWindow(getCenteredContextInspectorWindowState());
    setInspectorPanel(panel);
  };

  const closeMapOverlayPanel = (panelId: MapOverlayPanelId) => {
    setOpenMapOverlays((panels) => ({
      ...panels,
      [panelId]: false,
    }));
  };

  const toggleMapOverlayPanel = (panelId: MapOverlayPanelId) => {
    setOpenMapOverlays((panels) => ({
      ...panels,
      [panelId]: !panels[panelId],
    }));
  };

  const refreshGodotSimulator = () => {
    setIsGodotSimulatorOpen(true);
    setGodotSimulatorReloadKey((value) => value + 1);
  };

  const openGodotSimulatorStandalone = () => {
    window.open(GODOT_SIMULATOR_URL, '_blank', 'noopener,noreferrer');
  };

  const setMapView = (modeId: MapViewMode) => {
    const viewMode = mapViewModes.find((item) => item.id === modeId);

    if (!viewMode) {
      return;
    }

    setActiveMapView(viewMode.id);
    setActiveModule(viewMode.module);
    openInspectorPanel({
      id: `map-view-${viewMode.id}`,
      title: '视角切换',
      subtitle: viewMode.label,
      body: viewMode.detail,
      tone: viewMode.id === 'emergency' ? 'danger' : viewMode.id === 'congestion' ? 'warning' : 'ok',
      metrics: [
        { label: '当前模块', value: dashboardModules.find((item) => item.id === viewMode.module)?.label ?? viewMode.module },
        { label: '航道筛选', value: routeLayerFilter === 'all' ? '全部' : channelRoleLabelByRole[routeLayerFilter] },
        { label: '船型筛选', value: vesselCategoryFilter === 'all' ? '全部' : vesselCategoryLabelByCategory[vesselCategoryFilter] },
      ],
    });
  };

  const cycleMapView = () => {
    const activeIndex = mapViewModes.findIndex((mode) => mode.id === activeMapView);
    const nextMode = mapViewModes[(activeIndex + 1) % mapViewModes.length];
    setMapView(nextMode.id);
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      openInspectorPanel({
        id: 'fullscreen-failed',
        title: '全屏显示',
        subtitle: '浏览器暂未允许全屏',
        body: '当前浏览器环境拒绝了全屏请求，可以继续使用窗口模式进行推演。',
        tone: 'warning',
        metrics: [
          { label: '当前状态', value: isFullscreen ? '全屏' : '窗口' },
          { label: '推演时间', value: scenarioClockLabel },
        ],
      });
    }
  };

  const openMetricInspector = (item: (typeof displayedMetrics)[number]) => {
    const metricModuleById: Record<string, DashboardModuleId> = {
      'active-vessels': 'overview',
      'transit-vessels': 'sandbox',
      'cargo-throughput': 'resilience',
      'carbon-emission': 'dispatch',
      'resilience-index': 'resilience',
    };
    const targetModule = metricModuleById[item.id] ?? 'overview';

    setActiveModule(targetModule);
    openInspectorPanel({
      id: `metric-${item.id}`,
      title: item.label,
      subtitle: item.detail,
      body: `指标已联动到底部${dashboardModules.find((module) => module.id === targetModule)?.label ?? '模块'}。${item.trendLabel}`,
      tone: item.tone,
      metrics: [
        { label: '当前值', value: item.value, unit: item.unit, tone: item.tone },
        { label: '趋势', value: item.trendLabel },
        { label: '推演时间', value: scenarioClockLabel },
      ],
      action: { label: '查看联动模块', module: targetModule },
    });
  };

  const openOverviewStatInspector = (item: (typeof overviewStats)[number]) => {
    setActiveModule('overview');
    openInspectorPanel({
      id: `overview-${item.id}`,
      title: item.label,
      subtitle: item.detail,
      body: '总览指标已联动当前港航网络基础态势，可继续点击港口、航道或船舶进入更细的验证对象。',
      tone: item.tone as StatusTone,
      metrics: [
        { label: '数量', value: formatInteger(item.value), unit: item.unit },
        { label: '核心港口', value: String(monitoredPorts.length), unit: '处' },
        { label: '可验证船舶', value: String(scenario.vesselMarkers.length), unit: '艘' },
      ],
    });
  };

  const openPortInspector = (port: PortNode) => {
    const congestion = portCongestionById.get(port.id);
    const pressure = resilienceAssessment.keyNodePressures.find((item) => item.nodeId === port.id);
    const tone = congestion?.tone ?? pressure?.tone ?? port.tone;

    setSelectedPortId(port.id);
    setActiveMapView('congestion');
    setActiveModule('resilience');
    openInspectorPanel({
      id: `port-${port.id}`,
      title: port.name,
      subtitle: `${port.englishName} / ${port.country}`,
      body: `${port.name}已设为地图关注节点。右侧关键节点监控和底部韧性评估将用于判断它的排队、恢复和风险扩散压力。`,
      tone,
      metrics: [
        { label: '船舶', value: formatInteger(port.vesselCount), unit: '艘' },
        { label: '排队', value: String(congestion?.queueingVessels ?? port.queueVessels), unit: '艘', tone },
        { label: '等待', value: `${(congestion?.expectedWaitingHours ?? port.averageWaitingHours).toFixed(1)}h` },
        { label: '压力', value: `${(pressure?.pressureScore ?? port.congestionPercent).toFixed(0)}%`, tone },
      ],
      action: { label: '查看韧性评估', module: 'resilience' },
    });
  };

  const openRouteInspector = (route: RouteOverlay) => {
    const channel = channelById.get(route.channelId);
    const originName = portNameById.get(route.originPortId) ?? route.originPortId;
    const destinationName = portNameById.get(route.destinationPortId) ?? route.destinationPortId;

    selectValidationRoute(route.id);
    setRouteLayerFilter(route.role);
    setActiveMapView('congestion');
    openInspectorPanel({
      id: `route-${route.id}`,
      title: route.label,
      subtitle: `${originName} -> ${destinationName}`,
      body: '航段已设为微观验证对象。底部沙盘推演模块可以直接生成该航段代表船的 Godot 验证请求。',
      tone: route.tone,
      metrics: [
        { label: '流量', value: formatInteger(route.vesselVolume), unit: '艘/日' },
        { label: '航速', value: route.averageSpeedKnots.toFixed(1), unit: 'kn' },
        { label: '延误', value: String(route.delayMinutes), unit: '分', tone: getDelayTone(route.delayMinutes) },
        { label: '拥堵', value: `${channel?.congestionPercent ?? 0}%`, tone: channel?.tone ?? route.tone },
      ],
      action: { label: '生成验证信息流', module: 'sandbox' },
    });
  };

  const openVesselInspector = (vessel: VesselMarker) => {
    const route = routeById.get(vessel.flowId);
    const delay = vesselDelayById.get(vessel.id);
    const emission = vesselEmissionSimulations.find((item) => item.vesselId === vessel.id);

    selectValidationVessel(vessel.id);
    setVesselCategoryFilter(vessel.category);
    openInspectorPanel({
      id: `vessel-${vessel.id}`,
      title: vessel.name,
      subtitle: `${vessel.imo} / ${vesselCategoryLabelByCategory[vessel.category]}`,
      body: '船舶已设为单船验证对象。可以在底部微观验证入口生成滚动信息流，或手动打开航行模拟器做深度验证。',
      tone: delay?.tone ?? route?.tone ?? 'ok',
      metrics: [
        { label: '航线', value: route?.label ?? vessel.flowId },
        { label: '航速', value: vessel.speedKnots.toFixed(1), unit: 'kn' },
        { label: '延误', value: String(delay?.delayMinutes ?? 0), unit: '分', tone: delay?.tone },
        { label: '碳排', value: `${emission?.carbonTons.toFixed(0) ?? vessel.carbonEmissionTonsPerHour.toFixed(1)}t` },
      ],
      action: { label: '进入微观验证', module: 'sandbox' },
    });
  };

  const openRiskInspector = (risk: RiskAlert) => {
    setActiveMapView('emergency');
    setActiveModule('emergency');
    openInspectorPanel({
      id: `risk-${risk.id}`,
      title: risk.label,
      subtitle: risk.affectedArea,
      body: `${risk.description}。${risk.estimatedImpact}`,
      tone: risk.tone,
      metrics: [
        { label: '等级', value: riskLevelLabelByTone[risk.tone], tone: risk.tone },
        { label: '预案', value: emergencyContingencyAssessment.activePlanLabel },
        { label: '准备度', value: String(emergencyContingencyAssessment.readinessScore), unit: '%' },
      ],
      action: { label: '查看应急预案', module: 'emergency' },
    });
  };

  const openWeatherInspector = (weatherItem?: (typeof weatherCards)[number]) => {
    setActiveMapView('emergency');
    setActiveModule('emergency');
    openInspectorPanel({
      id: `weather-${weatherItem?.id ?? 'radar'}`,
      title: weatherItem?.label ?? '风场雷达',
      subtitle: weatherItem
        ? `${weatherItem.value}${weatherItem.unit} / ${weatherItem.detail}`
        : `${scenario.weather.windDirection} ${scenario.weather.windSpeedMs}m/s`,
      body: '气象海况已联动应急预案模块，用于判断低能见度、风浪和海流对航段通行窗口的影响。',
      tone: scenario.weather.waveHeightM >= 1.2 || scenario.weather.visibilityKm <= 8 ? 'warning' : 'ok',
      metrics: [
        { label: '风速', value: String(scenario.weather.windSpeedMs), unit: 'm/s' },
        { label: '浪高', value: String(scenario.weather.waveHeightM), unit: 'm' },
        { label: '能见度', value: String(scenario.weather.visibilityKm), unit: 'km' },
      ],
      action: { label: '查看天气预案', module: 'emergency' },
    });
  };

  const openCarbonInspector = () => {
    setActiveMapView('carbon');
    setActiveModule('dispatch');
    openInspectorPanel({
      id: 'carbon-monitor',
      title: '碳排放监测',
      subtitle: `今日 ${scenario.carbon.todayEmission}${scenario.carbon.todayUnit}`,
      body: bestGreenStrategy
        ? `当前推荐${bestGreenStrategy.label}，预计减排 ${bestGreenStrategy.carbonReductionTons.toFixed(0)}t CO₂。`
        : '当前暂无推荐策略，继续监控船速、等待时间和靠泊节奏。',
      tone: emissionPanelTone,
      metrics: [
        { label: '总碳排', value: totalCarbonTons.toFixed(0), unit: 't' },
        { label: '较基准', value: `${totalCarbonChangePercent > 0 ? '+' : ''}${totalCarbonChangePercent.toFixed(1)}%`, tone: emissionPanelTone },
        { label: '峰值时段', value: carbonPeakTrend.hour },
      ],
      action: { label: '查看调度优化', module: 'dispatch' },
    });
  };

  const openStrategyInspector = (strategy: GreenStrategyComparison) => {
    setActiveMapView('carbon');
    setActiveModule('dispatch');
    openInspectorPanel({
      id: `strategy-${strategy.strategyId}`,
      title: strategy.label,
      subtitle: strategy.target,
      body: strategy.actionSummary,
      tone: strategy.tone,
      metrics: [
        { label: '得分', value: String(strategy.score), tone: strategy.tone },
        { label: '延误削减', value: String(strategy.delayReductionMinutes), unit: '分' },
        { label: '碳减排', value: strategy.carbonReductionTons.toFixed(0), unit: 't' },
        { label: '影响船舶', value: String(strategy.affectedVessels), unit: '艘' },
      ],
      action: { label: '查看调度优化', module: 'dispatch' },
    });
  };

  const openAlertSummary = (tone: StatusTone) => {
    const matchingAlerts = displayedRiskAlerts.filter((alert) => alert.tone === tone);

    setActiveMapView(tone === 'danger' ? 'emergency' : 'congestion');
    setActiveModule(tone === 'danger' ? 'emergency' : 'overview');
    openInspectorPanel({
      id: `alert-summary-${tone}`,
      title: tone === 'danger' ? '高风险告警' : '中等级告警',
      subtitle: `${matchingAlerts.length} 条正在监控`,
      body: matchingAlerts.map((alert) => `${alert.label}：${alert.affectedArea}`).join(' / ') || '当前没有该等级告警。',
      tone,
      metrics: [
        { label: '高风险', value: String(dangerAlertCount), tone: 'danger' },
        { label: '中风险', value: String(warningAlertCount), tone: 'warning' },
        { label: '事件流', value: String(displayedEventLog.length), unit: '条' },
      ],
      action: { label: tone === 'danger' ? '查看应急预案' : '查看态势总览', module: tone === 'danger' ? 'emergency' : 'overview' },
    });
  };

  const handleRouteLayerFilter = (filter: RouteLayerFilter) => {
    setRouteLayerFilter(filter);
    openInspectorPanel({
      id: `route-layer-${filter}`,
      title: '图层筛选',
      subtitle: filter === 'all' ? '全部航道' : channelRoleLabelByRole[filter],
      body: filter === 'all' ? '地图已恢复显示全部航道。' : `地图已突出显示${channelRoleLabelByRole[filter]}，其他航道将弱化显示。`,
      tone: filter === 'traffic-separation' ? 'warning' : 'ok',
      metrics: [
        {
          label: '匹配航段',
          value: String(filter === 'all' ? scenario.routeOverlays.length : scenario.routeOverlays.filter((route) => route.role === filter).length),
          unit: '条',
        },
        { label: '当前视角', value: activeMapViewDefinition.label },
      ],
    });
  };

  const handleVesselCategoryFilter = (category: VesselCategoryFilter) => {
    setVesselCategoryFilter(category);
    setActiveModule('overview');
    openInspectorPanel({
      id: `vessel-category-${category}`,
      title: '船型筛选',
      subtitle: category === 'all' ? '全部船型' : vesselCategoryLabelByCategory[category],
      body: category === 'all' ? '地图已恢复显示全部示例船舶。' : `地图已突出显示${vesselCategoryLabelByCategory[category]}，便于观察该船型延误和碳排表现。`,
      tone: 'ok',
      metrics: [
        {
          label: '示例船舶',
          value: String(category === 'all' ? scenario.vesselMarkers.length : scenario.vesselMarkers.filter((vessel) => vessel.category === category).length),
          unit: '艘',
        },
        { label: 'AIS 总量', value: formatInteger(vesselTotal), unit: '艘' },
      ],
    });
  };
  const getPanelExpandProps = (title: string) => ({
    isExpanded: expandedPanelTitle === title,
    onClose: () => setExpandedPanelTitle(null),
    onExpand: () => {
      setIsSettingsOpen(false);
      setInspectorPanel(null);
      setExpandedPanelTitle(title);
    },
  });

  return (
    <main
      className={[
        'dashboard-shell',
        `dashboard-shell--view-${activeMapView}`,
        motionEnabled ? '' : 'dashboard-shell--motion-paused',
        rlTraining.status === 'queued' || rlTraining.status === 'running'
          ? 'dashboard-shell--training-headless'
          : '',
        rlTraining.policyTest.status === 'running' ? 'dashboard-shell--policy-replay' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <header className="top-bar">
        <div className="top-bar__left">
          <button
            className={`port-data-indicator port-data-indicator--${portDataStatusTone[portDataStatus]}`}
            onClick={() => setIsSettingsOpen(true)}
            title={portDataMessage}
            type="button"
          >
            <RadioTower size={14} />
            {portDataStatusLabel[portDataStatus]}
          </button>
          <span>
            <CalendarClock size={15} />
            {scenarioClockLabel}
          </span>
          <span>
            <ThermometerSun size={15} />
            {scenario.weather.temperatureC}°C
          </span>
          <span>
            <Wind size={15} />
            {scenario.weather.windDirection} {scenario.weather.windSpeedMs}m/s
          </span>
          <span>
            <CircleGauge size={15} />
            能见度 {scenario.weather.visibilityKm}km
          </span>
        </div>
        <div className="system-title">
          <div className="system-title__main">
            <h1>港航网络韧性数字孪生沙盘推演系统</h1>
            <p>V1.0 · Port Resilience Digital Twin Sandbox</p>
          </div>
          <div className="system-title__developer" aria-label="研发者 温家懿">
            <span>
              研发者：<strong>温家懿</strong>
            </span>
            <em>Developer: Wen Jiayi</em>
          </div>
        </div>
        <div className="top-bar__right">
          <button
            aria-expanded={isSettingsOpen}
            data-xiaoyi-action="open-settings"
            onClick={() => setIsSettingsOpen((value) => !value)}
            title="打开系统设置"
            type="button"
          >
            <Settings size={15} />
            <BilingualText className="bilingual-label--button" text="系统设置" />
          </button>
          <button
            data-xiaoyi-action="cycle-map-view"
            onClick={cycleMapView}
            title={`当前视角：${activeMapViewDefinition.label}\n${activeMapViewDefinition.detail}`}
            type="button"
          >
            <Compass size={15} />
            <BilingualText className="bilingual-label--button" text={activeMapViewDefinition.label} />
          </button>
          <button data-xiaoyi-action="toggle-fullscreen" onClick={() => void toggleFullscreen()} type="button">
            {isFullscreen ? <Minimize size={15} /> : <Expand size={15} />}
            <BilingualText
              className="bilingual-label--button"
              text={isFullscreen ? '退出全屏' : '全屏显示'}
            />
          </button>
          <button
            aria-label="查看高风险告警"
            className="alert-pill"
            onClick={() => openAlertSummary('danger')}
            title="查看高风险告警"
            type="button"
          >
            <AlertTriangle size={15} />
            {dangerAlertCount}
          </button>
          <button
            aria-label="查看中等级告警"
            className="alert-pill alert-pill--warning"
            onClick={() => openAlertSummary('warning')}
            title="查看中等级告警"
            type="button"
          >
            <Bell size={15} />
            {warningAlertCount}
          </button>
        </div>
      </header>

      {expandedPanelTitle && (
        <button
          aria-label="关闭放大卡片"
          className="hud-panel-zoom-backdrop"
          onClick={() => setExpandedPanelTitle(null)}
          type="button"
        />
      )}

      <section className="kpi-bar" aria-label="核心运行指标">
        {displayedMetrics.map((item) => {
          const Icon = kpiIconById[item.id as keyof typeof kpiIconById] ?? Activity;

          return (
            <article
              className={`kpi-card kpi-card--${item.tone}`}
              key={item.id}
              onClick={() => openMetricInspector(item)}
              onKeyDown={(event) => handleValidationKeyDown(event, () => openMetricInspector(item))}
              role="button"
              tabIndex={0}
              title={`${item.label}\n${item.detail}\n${item.trendLabel}`}
            >
              <span className="kpi-card__icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <div className="kpi-card__content">
                <BilingualText className="kpi-card__label" text={item.label} />
                <strong className="kpi-card__value">
                  <RollingMetricValue value={item.value} />
                  <em>{item.unit}</em>
                </strong>
                <span className="kpi-card__detail">{item.detail}</span>
              </div>
              <small className="kpi-card__trend">{item.trendLabel}</small>
            </article>
          );
        })}
      </section>

      <aside
        className={`side-rail side-rail--left${[
          '港航网络总览',
          '船舶态势',
          '航道通航状态',
          '风险预警',
        ].includes(expandedPanelTitle ?? '') ? ' side-rail--has-expanded' : ''}`}
      >
        <Panel title="港航网络总览" {...getPanelExpandProps('港航网络总览')}>
          <div className="network-overview">
            <div className="mini-map" aria-label="港航网络小地图">
              <svg className="mini-map__routes" viewBox="0 0 1000 720" aria-hidden="true">
                {scenario.routeOverlays.map((route) => (
                  <path
                    className={`mini-map__route mini-map__route--${route.tone}`}
                    d={route.svgPath}
                    key={route.id}
                  />
                ))}
              </svg>
              {scenario.ports.map((port) => (
                <button
                  aria-label={`小地图查看港口 ${port.name}`}
                  className={`mini-map__port mini-map__port--${port.role} mini-map__port--${port.tone}${selectedPort?.id === port.id ? ' mini-map__port--selected' : ''}`}
                  key={port.id}
                  onClick={() => openPortInspector(port)}
                  style={{ left: port.position.x, top: port.position.y }}
                  title={`${port.name} / 船舶 ${port.vesselCount} 艘 / ${port.status}`}
                  type="button"
                />
              ))}
              <div className="mini-map__window">
                <BilingualText text="主监控区" />
              </div>
            </div>
            <ul className="overview-stats">
              {overviewStats.map((item) => {
                const Icon = item.icon;

                return (
                  <li
                    className={`overview-stat overview-stat--${item.tone}`}
                    key={item.id}
                    onClick={() => openOverviewStatInspector(item)}
                    onKeyDown={(event) =>
                      handleValidationKeyDown(event, () => openOverviewStatInspector(item))
                    }
                    role="button"
                    tabIndex={0}
                  >
                    <span className="overview-stat__icon" aria-hidden="true">
                      <Icon size={13} />
                    </span>
                    <BilingualText className="overview-stat__label" text={item.label} />
                <strong>
                      <RollingMetricValue value={formatInteger(item.value)} />
                      <em>{item.unit}</em>
                    </strong>
                    <small>{item.detail}</small>
                  </li>
                );
              })}
            </ul>
          </div>
        </Panel>

        <Panel title="船舶态势" {...getPanelExpandProps('船舶态势')}>
          <div className="ship-status">
            <ul className="metric-list">
              {scenario.vesselTypeStats.map((item) => (
                <li
                  className={vesselCategoryFilter === item.category ? 'metric-list__item--active' : ''}
                  key={item.label}
                  onClick={() => handleVesselCategoryFilter(item.category)}
                  onKeyDown={(event) =>
                    handleValidationKeyDown(event, () => handleVesselCategoryFilter(item.category))
                  }
                  role="button"
                  style={
                    {
                      '--ship-category-color': vesselColorByCategory[item.category],
                      '--ship-category-percent': `${item.percent}%`,
                    } as CSSProperties
                  }
                  tabIndex={0}
                  title={`${item.label} ${formatInteger(item.count)} 艘 / ${formatPercent(item.percent)}`}
                >
                  <span className="ship-category-dot" aria-hidden="true" />
                  <span className="ship-category-name">{item.label}</span>
                <strong>{formatInteger(item.count)}</strong>
                  <em>{formatPercent(item.percent)}</em>
                  <i className="ship-category-bar" aria-hidden="true" />
                </li>
              ))}
            </ul>
            <div
              className="ship-ring"
              onClick={() => handleVesselCategoryFilter('all')}
              onKeyDown={(event) =>
                handleValidationKeyDown(event, () => handleVesselCategoryFilter('all'))
              }
              role="button"
              style={
                {
                  '--ship-ring-gradient': vesselRingGradient,
                } as CSSProperties
              }
              tabIndex={0}
              title={`船舶分类总数 ${formatInteger(vesselTotal)} 艘`}
            >
              <BilingualText text="分类总数" />
              <strong>
                <RollingMetricValue value={formatInteger(vesselTotal)} />
              </strong>
              <em>艘</em>
            </div>
          </div>
        </Panel>

        <Panel title="航道通航状态" {...getPanelExpandProps('航道通航状态')}>
          <ul className="status-list">
            {scenario.channels.map((item) => (
              <li
                className={routeLayerFilter === item.role ? 'status-list__item--active' : ''}
                key={item.label}
                onClick={() => {
                  const route = scenario.routeOverlays.find((routeItem) => routeItem.channelId === item.id);
                  setRouteLayerFilter(item.role);
                  if (route) {
                    openRouteInspector(route);
                  }
                }}
                onKeyDown={(event) =>
                  handleValidationKeyDown(event, () => {
                    const route = scenario.routeOverlays.find((routeItem) => routeItem.channelId === item.id);
                    setRouteLayerFilter(item.role);
                    if (route) {
                      openRouteInspector(route);
                    }
                  })
                }
                role="button"
                style={
                  {
                    '--channel-congestion-percent': `${item.congestionPercent}%`,
                    '--channel-status-color': statusColorByTone[item.tone],
                  } as CSSProperties
                }
                tabIndex={0}
                title={`拥堵 ${item.congestionPercent}% / 延误 ${item.delayMinutes} 分钟`}
              >
                <span className={`status-dot status-dot--${item.tone}`} />
                <span className="status-channel-name">
                  {item.label}
                  <small>{channelRoleLabelByRole[item.role]}</small>
                </span>
                <em>{item.delayMinutes}分</em>
                <strong className={`status-badge status-badge--${item.tone}`}>{item.status}</strong>
                <i className="status-congestion-bar" aria-hidden="true" />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="风险预警" {...getPanelExpandProps('风险预警')}>
          <ul className="risk-list">
            {displayedRiskAlerts.map((item) => (
              <li
                className={`risk-item risk-item--${item.tone}`}
                key={item.id}
                onClick={() => openRiskInspector(item)}
                onKeyDown={(event) => handleValidationKeyDown(event, () => openRiskInspector(item))}
                role="button"
                style={
                  {
                    '--risk-status-color': statusColorByTone[item.tone],
                  } as CSSProperties
                }
                tabIndex={0}
                title={`${item.label}\n${item.description}\n${item.affectedArea}\n${item.estimatedImpact}`}
              >
                <span className={`risk-icon risk-icon--${item.tone}`}>
                  <AlertTriangle size={15} />
                </span>
                <strong>{item.label}</strong>
                <span className="risk-level">{riskLevelLabelByTone[item.tone]}</span>
                <em>{item.description}</em>
                <small>{item.affectedArea}</small>
                <p>{item.estimatedImpact}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </aside>

      <section className="map-stage" aria-label="马六甲海峡沙盘地图">
        <div className="map-country map-country--malaysia">
          <span>🇲🇾</span>
          <strong>马来西亚</strong>
          <em>Malaysia</em>
        </div>
        <div className="map-country map-country--indonesia">
          <span>🇮🇩</span>
          <strong>印度尼西亚</strong>
          <em>Indonesia</em>
        </div>
        <div className="map-country map-country--singapore">
          <span>🇸🇬</span>
          <strong>新加坡</strong>
          <em>Singapore</em>
        </div>

        <div className="strait-title">
          <strong>马六甲海峡</strong>
          <span>Malacca Strait</span>
        </div>

        {showCoreClosure && (
          <section
            aria-label="推演阶段状态机"
            className={`simulation-render-layer simulation-render-layer--${activeSimulationRenderStep.tone}${isSimulationRunning || activeSimulationRenderStep.status === 'running' ? ' simulation-render-layer--running' : ''}`}
            style={
              {
                '--simulation-render-color': statusColorByTone[activeSimulationRenderStep.tone],
                '--simulation-render-progress': `${simulationRenderStepProgressPercent}%`,
                '--core-closure-progress': `${(completedClosureStepCount / coreClosureJourney.length) * 100}%`,
              } as CSSProperties
            }
          >
            <header className="core-closure-header">
              <span>
                <RadioTower size={13} />
                核心业务闭环
              </span>
              <strong>{activeDemoCase?.label ?? activeSimulationRenderStep.label}</strong>
              <em>
                {completedClosureStepCount}/8 · {sandboxPhaseStatusLabel[activeSimulationRenderStep.status]}
              </em>
              <button
                aria-label="关闭核心业务闭环卡片"
                className="map-card-close core-closure-close"
                onClick={() => setShowCoreClosure(false)}
                title="关闭核心业务闭环卡片"
                type="button"
              >
                <X size={13} />
              </button>
            </header>
            <ol className="core-closure-rail">
              {coreClosureJourney.map((step, index) => (
                <li
                  className={`core-closure-step core-closure-step--${step.status}`}
                  key={step.id}
                  title={`${step.label}：${sandboxPhaseStatusLabel[step.status]} / ${step.value}`}
                >
                  <span>{index + 1}</span>
                  <strong>{step.shortLabel}</strong>
                  <em>{step.value}</em>
                </li>
              ))}
            </ol>
            <div className="core-closure-progress" aria-hidden="true">
              <b />
            </div>
          </section>
        )}

        {activeInjectedEventTemplate && latestInjectedEvent && (
          <section
            aria-label="当前注入事件影响"
            className={`event-impact-banner event-impact-banner--${rlPolicyApplied ? rlPolicyRecoveryTone : latestInjectedEvent.tone}`}
            style={
              {
                '--event-impact-color': rlPolicyApplied
                  ? rlPolicyRecoveryColor
                  : statusColorByTone[latestInjectedEvent.tone],
                '--event-recovery-progress': `${rlPolicyRecoveryPercent}%`,
              } as CSSProperties
            }
          >
            <header>
              <span>
                {rlPolicyApplied ? <Activity size={13} /> : <AlertTriangle size={13} />}
                {rlPolicyApplied ? 'RL滚动恢复' : activeInjectedEventTemplate.category}
              </span>
              <strong>
                {activeInjectedEventTemplate.label} · {rlPolicyRecoveryStageLabel}
              </strong>
              <em>
                {rlPolicyApplied
                  ? `${policyRecovery.advancedMinutes}/${policyRecovery.targetMinutes}分`
                  : latestInjectedEvent.time}
              </em>
            </header>
            <p>
              {rlPolicyApplied && rlPolicyInference
                ? `${rlPolicyInference.selectedAction.label}正在执行；拥堵、延误与传播压力按15分钟决策窗滚动回落`
                : latestInjectedEvent.impact.summary}
            </p>
            {rlPolicyApplied && (
              <div className="event-impact-banner__recovery" aria-label={`RL策略恢复进度 ${rlPolicyRecoveryPercent}%`}>
                <b />
              </div>
            )}
            <footer>
              <span>影响船舶 <strong>{affectedVesselIdSet.size}</strong> 艘</span>
              <span>
                {rlPolicyApplied
                  ? `船舶状态：${rlVesselRecoveryLabel}`
                  : activeInjectedEventTemplate.vesselEffectLabel}
              </span>
              <em>
                {rlPolicyApplied
                  ? `剩余影响 ${Math.round(rlOperationalImpactRemainingFactor * 100)}%`
                  : activeInjectedEventTemplate.metricPreview}
              </em>
            </footer>
          </section>
        )}

        {openMapOverlays.propagation && (
          <svg className="impact-propagation-layer" viewBox="0 0 1000 720" aria-hidden="true">
            {impactPropagationLinks.map((link) => (
              <g
                key={link.id}
                style={
                  {
                    '--impact-link-color': statusColorByTone[link.tone],
                    '--impact-link-width': `${2.2 + link.pressureScore / 22}px`,
                    '--impact-link-delay': `${link.animationDelaySeconds}s`,
                  } as CSSProperties
                }
              >
                <path className="impact-propagation-link" d={link.svgPath}>
                  <title>
                    {`${link.label}\n传播压力 ${link.pressureScore}% / 延误 ${link.delayMinutes} 分钟 / 流量 ${link.vesselVolume} 艘/日`}
                  </title>
                </path>
                <path className="impact-propagation-spark" d={link.svgPath} />
              </g>
            ))}
          </svg>
        )}

        {openMapOverlays.strategy && strategyFlowVectors.length > 0 && (
          <svg className="strategy-flow-layer" viewBox="0 0 1000 720" aria-hidden="true">
            {strategyFlowVectors.map((vector) => (
              <g
                key={vector.id}
                style={
                  {
                    '--strategy-flow-color': statusColorByTone[vector.tone],
                    '--strategy-flow-delay': `${vector.animationDelaySeconds}s`,
                  } as CSSProperties
                }
              >
                <path className="strategy-flow-line" d={vector.svgPath}>
                  <title>
                    {`${vector.label}\n${vector.target}\n收益 ${vector.metric} / 得分 ${vector.score}`}
                  </title>
                </path>
                <path
                  className="strategy-flow-motion-path"
                  d={vector.svgPath}
                  id={`strategy-flow-path-${vector.id}`}
                />
                <circle className="strategy-flow-dot" r="5">
                  <animateMotion
                    begin={`${vector.animationDelaySeconds}s`}
                    dur="5.8s"
                    repeatCount="indefinite"
                    rotate="auto"
                  >
                    <mpath href={`#strategy-flow-path-${vector.id}`} />
                  </animateMotion>
                </circle>
                <text
                  className="strategy-flow-label"
                  x={clampNumber(vector.endX + 12, 24, 960)}
                  y={clampNumber(vector.endY - 12, 24, 690)}
                >
                  {vector.metric}
                </text>
              </g>
            ))}
          </svg>
        )}

        <svg className="route-layer" viewBox="0 0 1000 720" aria-label="可点击航段与船舶验证入口">
          {scenario.routeOverlays.map((route) => {
            const isRouteSelected = selectedValidationResolvedRoute?.id === route.id;
            const isRouteMuted = routeLayerFilter !== 'all' && route.role !== routeLayerFilter;

            return (
              <g key={route.id}>
                <path
                  aria-label={`选择航段 ${route.label}`}
                  className={`route-hitbox${isRouteSelected ? ' route-hitbox--selected' : ''}${isRouteMuted ? ' route-hitbox--muted' : ''}`}
                  d={route.svgPath}
                  onClick={() => openRouteInspector(route)}
                  onKeyDown={(event) =>
                    handleValidationKeyDown(event, () => openRouteInspector(route))
                  }
                  role="button"
                  tabIndex={0}
                />
                <path
                  className={`route-line route-line--${routeClassByRole[route.role]} route-line--tone-${route.tone}${isRouteSelected ? ' route-line--selected' : ''}${isRouteMuted ? ' route-line--muted' : ''}`}
                  d={route.svgPath}
                  id={`flow-path-${route.id}`}
                >
                  <title>
                    {getRouteTitle(
                      route,
                      portNameById.get(route.originPortId) ?? route.originPortId,
                      portNameById.get(route.destinationPortId) ?? route.destinationPortId,
                    )}
                  </title>
                </path>
                <path
                  aria-hidden="true"
                  className={`route-flow-trace route-flow-trace--${routeClassByRole[route.role]} route-flow-trace--tone-${route.tone}${isRouteSelected ? ' route-flow-trace--selected' : ''}${isRouteMuted ? ' route-flow-trace--muted' : ''}`}
                  d={route.svgPath}
                  style={
                    {
                      '--route-flow-delay': `${route.animationSeconds * 0.12}s`,
                      '--route-flow-duration': `${Math.max(5, route.animationSeconds * 0.34)}s`,
                    } as CSSProperties
                  }
                />
              </g>
            );
          })}

          {scenario.vesselMarkers.map((vessel) => {
            const assignedRoute = routeById.get(vessel.flowId);
            const delaySimulation = vesselDelayById.get(vessel.id);
            const isVesselSelected = selectedValidationVessel?.id === vessel.id;
            const isVesselAffected = affectedVesselIdSet.has(vessel.id);
            const eventEffectMode =
              rlPolicyApplied && rlPolicyRecoveryProgress >= 0.68
                ? 'divert'
                : activeInjectedEventTemplate?.vesselEffectMode;
            const isVesselMuted =
              vesselCategoryFilter !== 'all' && vessel.category !== vesselCategoryFilter;

            if (!assignedRoute) {
              return null;
            }

            const baseVessel = baseScenario.vesselMarkers.find((item) => item.id === vessel.id) ?? vessel;
            const eventMotionPressureMultiplier =
              isVesselAffected && eventEffectMode === 'hold'
                ? 2.5
                : isVesselAffected && eventEffectMode === 'queue'
                  ? 2
                  : isVesselAffected && eventEffectMode === 'slow'
                    ? 1.65
                    : isVesselAffected && eventEffectMode === 'eco'
                      ? 1.45
                      : isVesselAffected && eventEffectMode === 'divert'
                        ? 1.18
                        : 1;
            const eventMotionMultiplier =
              1 +
              (eventMotionPressureMultiplier - 1) *
                (isVesselAffected ? rlOperationalImpactRemainingFactor : 1);
            const vesselAnimationSeconds = clampNumber(
              assignedRoute.animationSeconds *
                (baseVessel.speedKnots / Math.max(6, vessel.speedKnots)) *
                eventMotionMultiplier,
              4,
              48,
            );

            return (
              <g
                className={`flow-vessel flow-vessel--${vessel.category} flow-vessel--delay-${delaySimulation?.tone ?? 'ok'}${isVesselAffected && eventEffectMode ? ` flow-vessel--event flow-vessel--event-${eventEffectMode}` : ''}${isVesselSelected ? ' flow-vessel--selected' : ''}${isVesselMuted ? ' flow-vessel--muted' : ''}`}
                key={vessel.id}
                style={
                  {
                    '--vessel-delay-color': statusColorByTone[delaySimulation?.tone ?? 'ok'],
                    '--vessel-event-color': activeInjectedEventTemplate
                      ? rlPolicyApplied
                        ? rlPolicyRecoveryColor
                        : statusColorByTone[activeInjectedEventTemplate.tone]
                      : statusColorByTone.ok,
                  } as CSSProperties
                }
              >
                <title>
                  {[
                    getVesselTitle(
                      vessel,
                      assignedRoute,
                      portNameById.get(vessel.destinationPortId) ?? vessel.destinationPortId,
                    ),
                    delaySimulation
                      ? `预计延误 ${delaySimulation.delayMinutes} 分钟 / 主因 ${delaySimulation.dominantFactor}`
                      : '预计延误 暂无',
                    delaySimulation
                      ? `拥堵 ${delaySimulation.congestionDelayMinutes} / 天气 ${delaySimulation.weatherDelayMinutes} / 航速 ${delaySimulation.speedDelayMinutes} / 风险 ${delaySimulation.riskDelayMinutes} 分钟`
                      : '',
                  ].join('\n')}
                </title>
                <animateMotion
                  begin={`${vessel.animationDelaySeconds}s`}
                  dur={`${vesselAnimationSeconds}s`}
                  repeatCount="indefinite"
                  rotate="auto"
                >
                  <mpath href={`#flow-path-${assignedRoute.id}`} />
                </animateMotion>
                <path className="flow-vessel__wake flow-vessel__wake--wide" d="M-32 0 L-8 -6 L-8 6 Z" />
                <path className="flow-vessel__wake" d="M-20 0 L-7 -3 L-7 3 Z" />
                <path className="flow-vessel__trail flow-vessel__trail--upper" d="M-30 -4 C-22 -2 -16 -2 -9 -1" />
                <path className="flow-vessel__trail flow-vessel__trail--lower" d="M-30 4 C-22 2 -16 2 -9 1" />
                <path className="flow-vessel__hull" d="M-9 -5 L9 0 L-9 5 L-4 0 Z" />
                {isVesselAffected && activeInjectedEventTemplate && (
                  <>
                    <circle className="flow-vessel__event-ring" cx="0" cy="0" r="16" />
                    <text className="flow-vessel__event-state" x="12" y="10">
                      {rlVesselRecoveryLabel}
                    </text>
                  </>
                )}
                {delaySimulation && (
                  <text className="flow-vessel__delay" x="12" y="-7">
                    {delaySimulation.delayMinutes}分
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {scenario.vesselMarkers.map((vessel) => {
          const assignedRoute = routeById.get(vessel.flowId);
          const delaySimulation = vesselDelayById.get(vessel.id);
          const isVesselSelected = selectedValidationVessel?.id === vessel.id;
          const isVesselAffected = affectedVesselIdSet.has(vessel.id);
          const eventEffectMode =
            rlPolicyApplied && rlPolicyRecoveryProgress >= 0.68
              ? 'divert'
              : activeInjectedEventTemplate?.vesselEffectMode;
          const isVesselMuted =
            vesselCategoryFilter !== 'all' && vessel.category !== vesselCategoryFilter;

          if (!assignedRoute) {
            return null;
          }

          return (
            <button
              aria-label={`选择船舶 ${vessel.name}${isVesselAffected && activeInjectedEventTemplate ? `，事件状态 ${rlVesselRecoveryLabel}` : ''}`}
              className={`vessel-validation-marker vessel-validation-marker--${delaySimulation?.tone ?? 'ok'}${isVesselAffected && eventEffectMode ? ` vessel-validation-marker--event vessel-validation-marker--event-${eventEffectMode}` : ''}${isVesselSelected ? ' vessel-validation-marker--selected' : ''}${isVesselMuted ? ' vessel-validation-marker--muted' : ''}`}
              key={vessel.id}
              onClick={() => openVesselInspector(vessel)}
              style={
                {
                  '--vessel-marker-color': statusColorByTone[delaySimulation?.tone ?? 'ok'],
                  '--vessel-event-color': activeInjectedEventTemplate
                    ? rlPolicyApplied
                      ? rlPolicyRecoveryColor
                      : statusColorByTone[activeInjectedEventTemplate.tone]
                    : statusColorByTone.ok,
                  left: vessel.position.x,
                  top: vessel.position.y,
                } as CSSProperties
              }
              title={[
                getVesselTitle(
                  vessel,
                  assignedRoute,
                  portNameById.get(vessel.destinationPortId) ?? vessel.destinationPortId,
                ),
                delaySimulation
                  ? `预计延误 ${delaySimulation.delayMinutes} 分钟 / 主因 ${delaySimulation.dominantFactor}`
                  : '预计延误 暂无',
              ].join('\n')}
              type="button"
            >
              <Ship size={12} />
              <span>{delaySimulation?.delayMinutes ?? 0}</span>
              {isVesselAffected && activeInjectedEventTemplate && (
                <em>{rlVesselRecoveryLabel}</em>
              )}
            </button>
          );
        })}

        {openMapOverlays.propagation &&
          impactPropagationNodes.map((node) => (
            <div
              className={`impact-node-halo impact-node-halo--${node.tone}`}
              key={node.id}
              style={
                {
                  '--impact-node-color': statusColorByTone[node.tone],
                  '--impact-node-radius': `${node.radius}px`,
                  '--impact-node-intensity': node.intensity,
                  left: `${node.x}%`,
                  top: `${node.y}%`,
                } as CSSProperties
              }
              title={[
                `${node.label}压力 ${node.pressureScore}%`,
                `排队 ${node.queueVessels} 艘 / 恢复 ${node.recoveryHours.toFixed(1)}h`,
                `影响航段 ${node.affectedRouteCount} 条`,
              ].join('\n')}
            >
              <span aria-hidden="true">
                <RadioTower size={13} />
              </span>
              <strong>{node.label}</strong>
              <em>{node.pressureScore}%</em>
            </div>
          ))}

        {scenario.ports.map((port) => (
          <button
            aria-label={`查看港口 ${port.name}`}
            className={`port-marker${selectedPort?.id === port.id ? ' port-marker--selected' : ''}`}
            key={port.name}
            onClick={() => openPortInspector(port)}
            style={{ left: port.position.x, top: port.position.y }}
            title={getPortNodeTitle(port)}
            type="button"
          >
            <span>
              <Anchor size={15} />
            </span>
            <strong>{port.name}</strong>
            <em>{port.englishName}</em>
          </button>
        ))}

        {showLegend && (
          <>
            <div className="legend-box">
              <strong>图例</strong>
              {routeLayerFilters.map((filter) => (
                <button
                  aria-pressed={routeLayerFilter === filter.id}
                  className={`legend-option${routeLayerFilter === filter.id ? ' legend-option--active' : ''}`}
                  key={filter.id}
                  onClick={() => handleRouteLayerFilter(filter.id)}
                  title={filter.label}
                  type="button"
                >
                  {filter.icon === 'anchor' && <Layers size={14} />}
                  {filter.icon === 'main' && <i className="legend-line legend-line--main" />}
                  {filter.icon === 'secondary' && <i className="legend-line legend-line--secondary" />}
                  {filter.icon === 'warning' && <i className="legend-line legend-line--warning" />}
                </button>
              ))}
              <button
                aria-pressed={vesselCategoryFilter !== 'all'}
                className={`legend-option${vesselCategoryFilter !== 'all' ? ' legend-option--active' : ''}`}
                onClick={() => handleVesselCategoryFilter(vesselCategoryFilter === 'all' ? 'container' : 'all')}
                title={vesselCategoryFilter === 'all' ? '突出集装箱船' : '恢复全部船型'}
                type="button"
              >
                <Ship size={14} />
              </button>
            </div>

            <section className="map-overlay-dock" aria-label="地图浮层开关">
              <header className="map-overlay-dock__header">
                <BilingualText text="浮层" />
                <button
                  aria-label="关闭地图图例卡片"
                  className="map-card-close map-legend-close"
                  onClick={() => setShowLegend(false)}
                  title="关闭地图图例卡片"
                  type="button"
                >
                  <X size={13} />
                </button>
              </header>
          <button
            aria-pressed={openMapOverlays.propagation}
            className={openMapOverlays.propagation ? 'map-overlay-button map-overlay-button--active' : 'map-overlay-button'}
            onClick={() => toggleMapOverlayPanel('propagation')}
            title="打开或关闭影响传播与韧性扩散"
            type="button"
          >
            <RadioTower size={14} />
            <strong>
              <BilingualText text="传播" />
            </strong>
            <em>{resilienceAssessment.riskSpreadRangePercent}%</em>
          </button>
          <button
            aria-pressed={openMapOverlays.congestion}
            className={openMapOverlays.congestion ? 'map-overlay-button map-overlay-button--active' : 'map-overlay-button'}
            onClick={() => toggleMapOverlayPanel('congestion')}
            title="打开或关闭港口拥堵推演"
            type="button"
          >
            <Anchor size={14} />
            <strong>
              <BilingualText text="拥堵" />
            </strong>
            <em>{peakPortCongestion.congestionScore}%</em>
          </button>
          <button
            aria-pressed={openMapOverlays.delay}
            className={openMapOverlays.delay ? 'map-overlay-button map-overlay-button--active' : 'map-overlay-button'}
            disabled={!peakVesselDelay}
            onClick={() => toggleMapOverlayPanel('delay')}
            title="打开或关闭船舶延误推演"
            type="button"
          >
            <Clock size={14} />
            <strong>
              <BilingualText text="延误" />
            </strong>
            <em>{peakVesselDelay ? `${peakVesselDelay.delayMinutes}分` : '--'}</em>
          </button>
          <button
            aria-pressed={openMapOverlays.carbon}
            className={openMapOverlays.carbon ? 'map-overlay-button map-overlay-button--active' : 'map-overlay-button'}
            disabled={!peakVesselEmission}
            onClick={() => toggleMapOverlayPanel('carbon')}
            title="打开或关闭燃油与碳排核算"
            type="button"
          >
            <CloudSun size={14} />
            <strong>
              <BilingualText text="碳排" />
            </strong>
            <em>{totalCarbonTons.toFixed(0)}t</em>
          </button>
          <button
            aria-pressed={openMapOverlays.strategy}
            className={openMapOverlays.strategy ? 'map-overlay-button map-overlay-button--active' : 'map-overlay-button'}
            disabled={!bestGreenStrategy}
            onClick={() => toggleMapOverlayPanel('strategy')}
            title="打开或关闭绿色调度策略对比"
            type="button"
          >
            <Route size={14} />
            <strong>
              <BilingualText text="策略" />
            </strong>
            <em>{bestGreenStrategy ? bestGreenStrategy.score : '--'}</em>
          </button>
            </section>
          </>
        )}

        {openMapOverlays.propagation && peakPropagationNode && (
          <section
            aria-label="影响传播与韧性扩散"
            className={`impact-propagation-sim impact-propagation-sim--${propagationTone}`}
            style={{ '--impact-propagation-color': statusColorByTone[propagationTone] } as CSSProperties}
          >
            <header className="impact-propagation-sim__header">
              <BilingualText text="影响传播 / 韧性扩散" />
              <button
                aria-label="关闭影响传播与韧性扩散"
                className="map-card-close"
                onClick={() => closeMapOverlayPanel('propagation')}
                type="button"
              >
                <X size={13} />
              </button>
              <strong>{peakPropagationNode.label}</strong>
              <em>{peakPropagationNode.pressureScore}%</em>
            </header>
            <div className="impact-propagation-summary">
              <span>
                扩散范围
                <strong>{resilienceAssessment.riskSpreadRangePercent}%</strong>
              </span>
              <span>
                受压节点
                <strong>{resilienceAssessment.stressedNodeCount}</strong>
              </span>
              <span>
                恢复能力
                <strong>{resilienceAssessment.congestionRecoveryAbility}%</strong>
              </span>
            </div>
            <ol className="impact-propagation-list">
              {impactPropagationNodes.slice(0, 4).map((node) => (
                <li
                  key={node.id}
                  style={
                    {
                      '--impact-node-color': statusColorByTone[node.tone],
                      '--impact-node-percent': `${Math.max(8, node.pressureScore)}%`,
                    } as CSSProperties
                  }
                >
                  <span>{node.label}</span>
                  <strong>{node.pressureScore}%</strong>
                  <em>{node.recoveryHours.toFixed(1)}h</em>
                  <i aria-hidden="true" />
                </li>
              ))}
            </ol>
            <div className="impact-propagation-event">
              <RadioTower size={13} />
              <span>{peakPropagationLink?.label ?? '全网传播链路'}</span>
              <em>{propagationEventSummary}</em>
            </div>
          </section>
        )}

        {openMapOverlays.congestion && (
        <section
          className={`port-congestion-sim port-congestion-sim--${peakPortCongestion.tone}`}
          style={{ '--port-congestion-color': statusColorByTone[peakPortCongestion.tone] } as CSSProperties}
          aria-label="港口拥堵推演"
        >
          <header className="port-congestion-sim__header">
            <BilingualText text="港口拥堵推演" />
            <button
              aria-label="关闭港口拥堵推演"
              className="map-card-close"
              onClick={() => closeMapOverlayPanel('congestion')}
              type="button"
            >
              <X size={13} />
            </button>
            <strong>{peakPortCongestion.portName}</strong>
            <em>{portCongestionLevelLabel[peakPortCongestion.congestionLevel]}</em>
          </header>
          <div className="port-congestion-sim__summary">
            <span>
              预计等待
              <strong>{peakPortCongestion.expectedWaitingHours.toFixed(1)}h</strong>
            </span>
            <span>
              拥堵分值
              <strong>{peakPortCongestion.congestionScore}%</strong>
            </span>
            <span>
              排队船舶
              <strong>{peakPortCongestion.queueingVessels}</strong>
            </span>
          </div>
          <ul className="port-stage-list">
            {portCongestionStages.map((stage) => {
              const stageValue = peakPortCongestion[stage.key];
              const stageTone: StatusTone =
                stage.key === 'queueingVessels'
                  ? peakPortCongestion.tone
                  : stage.key === 'departingVessels'
                    ? 'ok'
                    : 'warning';

              return (
                <li
                  key={stage.key}
                  style={
                    {
                      '--port-stage-color': statusColorByTone[stageTone],
                      '--port-stage-percent': `${Math.max(7, (stageValue / peakStageMax) * 100)}%`,
                    } as CSSProperties
                  }
                >
                  <span>{stage.label}</span>
                  <strong>{stageValue}</strong>
                  <i aria-hidden="true" />
                </li>
              );
            })}
          </ul>
          <table className="port-congestion-table">
            <thead>
              <tr>
                <th>港口</th>
                <th>等待</th>
                <th>等级</th>
              </tr>
            </thead>
            <tbody>
              {rankedPortCongestion.slice(0, 4).map((item) => (
                <tr
                  key={item.portId}
                  onClick={() => {
                    const port = portById.get(item.portId);
                    if (port) {
                      openPortInspector(port);
                    }
                  }}
                  style={{ '--port-congestion-color': statusColorByTone[item.tone] } as CSSProperties}
                >
                  <td>{item.portName}</td>
                  <td>{item.expectedWaitingHours.toFixed(1)}h</td>
                  <td>
                    <span>{portCongestionLevelLabel[item.congestionLevel]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        )}

        {peakVesselDelay && openMapOverlays.delay && (
          <section
            className={`vessel-delay-sim vessel-delay-sim--${peakVesselDelay.tone}`}
            style={{ '--vessel-delay-color': statusColorByTone[peakVesselDelay.tone] } as CSSProperties}
            aria-label="船舶延误推演"
          >
            <header className="vessel-delay-sim__header">
              <BilingualText text="船舶延误推演" />
              <button
                aria-label="关闭船舶延误推演"
                className="map-card-close"
                onClick={() => closeMapOverlayPanel('delay')}
                type="button"
              >
                <X size={13} />
              </button>
              <strong>{peakVesselDelay.vesselName}</strong>
              <em>{peakVesselDelay.delayMinutes}分</em>
            </header>
            <div className="vessel-delay-factor-grid">
              <span>
                拥堵
                <strong>{peakVesselDelay.congestionDelayMinutes}</strong>
              </span>
              <span>
                天气
                <strong>{peakVesselDelay.weatherDelayMinutes}</strong>
              </span>
              <span>
                航速
                <strong>{peakVesselDelay.speedDelayMinutes}</strong>
              </span>
              <span>
                风险
                <strong>{peakVesselDelay.riskDelayMinutes}</strong>
              </span>
            </div>
            <table className="vessel-delay-table">
              <thead>
                <tr>
                  <th>船舶</th>
                  <th>目的港</th>
                  <th>延误</th>
                  <th>主因</th>
                </tr>
              </thead>
              <tbody>
                {rankedVesselDelays.slice(0, 4).map((item) => (
                  <tr
                    key={item.vesselId}
                    onClick={() => {
                      const vessel = scenario.vesselMarkers.find((marker) => marker.id === item.vesselId);
                      if (vessel) {
                        openVesselInspector(vessel);
                      }
                    }}
                    style={{ '--vessel-delay-color': statusColorByTone[item.tone] } as CSSProperties}
                  >
                    <td>{item.vesselName}</td>
                    <td>{item.destinationPortName}</td>
                    <td>{item.delayMinutes}分</td>
                    <td>
                      <span>{item.dominantFactor}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {peakVesselEmission && openMapOverlays.carbon && (
          <section
            className={`fuel-carbon-sim fuel-carbon-sim--${emissionPanelTone}`}
            style={{ '--fuel-carbon-color': statusColorByTone[emissionPanelTone] } as CSSProperties}
            aria-label="燃油与碳排核算"
          >
            <header className="fuel-carbon-sim__header">
              <BilingualText text="燃油与碳排核算" />
              <button
                aria-label="关闭燃油与碳排核算"
                className="map-card-close"
                onClick={() => closeMapOverlayPanel('carbon')}
                type="button"
              >
                <X size={13} />
              </button>
              <strong>{peakVesselEmission.vesselName}</strong>
              <em>{peakVesselEmission.carbonTons.toFixed(0)}t CO₂</em>
            </header>
            <div className="fuel-carbon-summary">
              <span>
                总燃油
                <strong>{totalFuelTons.toFixed(1)}t</strong>
              </span>
              <span>
                总碳排
                <strong>{totalCarbonTons.toFixed(0)}t</strong>
              </span>
              <span>
                较基准
                <strong>
                  {totalCarbonChangePercent > 0 ? '+' : ''}
                  {totalCarbonChangePercent.toFixed(1)}%
                </strong>
              </span>
            </div>
            <table className="fuel-carbon-table">
              <thead>
                <tr>
                  <th>船舶</th>
                  <th>船型</th>
                  <th>燃油</th>
                  <th>碳排</th>
                  <th>变化</th>
                </tr>
              </thead>
              <tbody>
                {rankedVesselEmissions.slice(0, 4).map((item) => (
                  <tr
                    key={item.vesselId}
                    onClick={() => {
                      const vessel = scenario.vesselMarkers.find((marker) => marker.id === item.vesselId);
                      if (vessel) {
                        openVesselInspector(vessel);
                      }
                    }}
                    style={{ '--fuel-carbon-color': statusColorByTone[item.tone] } as CSSProperties}
                    title={[
                      item.routeLabel,
                      `航程 ${item.distanceNm}nm / 航速 ${item.speedKnots}kn / 等待 ${item.waitingHours.toFixed(1)}h`,
                      `燃油 ${item.fuelTons.toFixed(1)}t / 碳排 ${item.carbonTons.toFixed(0)}t CO₂`,
                    ].join('\n')}
                  >
                    <td>{item.vesselName}</td>
                    <td>{vesselCategoryLabelByCategory[item.vesselCategory]}</td>
                    <td>{item.fuelTons.toFixed(1)}t</td>
                    <td>{item.carbonTons.toFixed(0)}t</td>
                    <td>
                      <span>
                        {item.carbonChangePercent > 0 ? '+' : ''}
                        {item.carbonChangePercent.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {bestGreenStrategy && openMapOverlays.strategy && (
          <section
            className={`green-strategy-sim green-strategy-sim--${bestGreenStrategy.tone}`}
            style={{ '--green-strategy-color': statusColorByTone[bestGreenStrategy.tone] } as CSSProperties}
            aria-label="绿色调度策略对比"
          >
            <header className="green-strategy-sim__header">
              <BilingualText text="绿色调度策略对比" />
              <button
                aria-label="关闭绿色调度策略对比"
                className="map-card-close"
                onClick={() => closeMapOverlayPanel('strategy')}
                type="button"
              >
                <X size={13} />
              </button>
              <strong>{bestGreenStrategy.label}</strong>
              <em>{strategyStatusLabelByStatus[bestGreenStrategy.status]}</em>
            </header>
            <div className="green-strategy-summary">
              <span>
                推荐得分
                <strong>{bestGreenStrategy.score}</strong>
              </span>
              <span>
                延误削减
                <strong>{totalStrategyDelayReduction}分</strong>
              </span>
              <span>
                碳减排
                <strong>{totalStrategyCarbonReduction.toFixed(0)}t</strong>
              </span>
            </div>
            <table className="green-strategy-table">
              <thead>
                <tr>
                  <th>策略</th>
                  <th>船舶</th>
                  <th>延误</th>
                  <th>碳减</th>
                  <th>拥堵</th>
                </tr>
              </thead>
              <tbody>
                {rankedGreenStrategies.map((item) => (
                  <tr
                    key={item.strategyId}
                    onClick={() => openStrategyInspector(item)}
                    style={{ '--green-strategy-color': statusColorByTone[item.tone] } as CSSProperties}
                    title={[
                      item.target,
                      item.actionSummary,
                      `类型 ${strategyTypeLabelByType[item.type]} / 状态 ${strategyStatusLabelByStatus[item.status]}`,
                      `节油 ${item.fuelSavingTons.toFixed(1)}t / 碳减 ${item.carbonReductionTons.toFixed(0)}t / 拥堵降低 ${item.congestionReductionPercent.toFixed(1)}%`,
                    ].join('\n')}
                  >
                    <td>
                      <span>{strategyTypeLabelByType[item.type]}</span>
                      <small>{item.label}</small>
                    </td>
                    <td>{item.affectedVessels}</td>
                    <td>{item.delayReductionMinutes}分</td>
                    <td>{item.carbonReductionTons.toFixed(0)}t</td>
                    <td>
                      <strong>{item.congestionReductionPercent.toFixed(1)}%</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

      </section>

      {activeModule === 'sandbox' && isEventInjectionPanelOpen && (
        <section
          aria-label="事件注入选择面板"
          className={`event-injection-cockpit event-injection-cockpit--${selectedEventTemplate.tone}`}
          style={
            {
              '--event-injection-color': statusColorByTone[selectedEventTemplate.tone],
            } as CSSProperties
          }
        >
          <header className="event-injection-cockpit__header">
            <span>
              <PlusCircle size={16} />
              <strong>选择要注入的事件</strong>
              <small>EVENT SCENARIO INJECTION</small>
            </span>
            <em>注入后先更新地图与船舶状态，RL 策略仍需手动触发</em>
            <button
              aria-label="关闭事件注入选择面板"
              onClick={() => setIsEventInjectionPanelOpen(false)}
              type="button"
            >
              <X size={14} />
            </button>
          </header>

          <div className="event-injection-options" role="list">
            {eventInjectionTemplates.map((template, index) => (
              <button
                aria-pressed={selectedEventTemplateId === template.id}
                className={`event-injection-option event-injection-option--${template.tone}`}
                key={template.id}
                onClick={() => setSelectedEventTemplateId(template.id)}
                role="listitem"
                style={
                  {
                    '--event-option-color': statusColorByTone[template.tone],
                  } as CSSProperties
                }
                type="button"
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <small>{template.category}</small>
                  <strong>{template.label}</strong>
                  <p>{template.scopeLabel}</p>
                </div>
                <em>{template.metricPreview}</em>
                <footer>{template.vesselEffectLabel}</footer>
              </button>
            ))}
          </div>

          <footer className="event-injection-cockpit__footer">
            <div>
              <small>当前选择</small>
              <strong>{selectedEventTemplate.label}</strong>
              <span>{selectedEventTemplate.impact.summary}</span>
            </div>
            <div>
              <span><Ship size={13} /> {selectedEventTemplate.vesselEffectLabel}</span>
              <em>{selectedEventTemplate.metricPreview}</em>
            </div>
            <button
              className="control-button control-button--warning"
              onClick={() => injectScenarioEvent(selectedEventTemplate.id)}
              type="button"
            >
              <PlusCircle size={15} />
              确认注入该事件
            </button>
          </footer>
        </section>
      )}

      {activeModule === 'sandbox' && isRlDecisionPanelOpen && (
        <section
          aria-label="RL 在线策略推理舱"
          className={`rl-decision-cockpit rl-decision-cockpit--${rlInferenceStatus}${rlPolicyApplied ? ' rl-decision-cockpit--applied' : ''}`}
          style={
            {
              '--rl-inference-progress': `${rlInferenceProgress.toFixed(2)}%`,
            } as CSSProperties
          }
        >
          <header className="rl-decision-cockpit__header">
            <div>
              <Activity size={16} />
              <span>
                <strong>RL 在线策略推理舱</strong>
                <small>ONLINE POLICY INFERENCE · UNCERTAINTY-AWARE WHAT-IF</small>
              </span>
            </div>
            <div className="rl-decision-cockpit__model">
              <strong>{rlPolicyInference?.model.policyId ?? '等待真实训练检查点'}</strong>
              <span>{rlInferenceStatus === 'running' ? `神经网络前向推理 ${rlInferenceProgress.toFixed(2)}%` : rlPolicyApplied ? '策略已下发沙盘' : rlInferenceStatus === 'completed' ? '推理完成 · 等待采用' : '策略服务待命'}</span>
            </div>
            <div className="rl-decision-cockpit__header-actions">
              <button aria-label="打开RL训练中心" onClick={openRlTrainingWindow} type="button">
                <Gauge size={13} />
                训练中心
              </button>
              <button aria-label="关闭RL策略推理舱" onClick={() => setIsRlDecisionPanelOpen(false)} type="button">
                <X size={13} />
              </button>
            </div>
          </header>

          <div className="rl-inference-pipeline" aria-label="RL推理流水线进度">
            {['状态离散化', '检查点决策', '动作价值归一化', '单步模型投影', '安全人工约束'].map((stage, index) => {
              const threshold = (index + 1) * 20;
              const stageProgress = clampNumber((rlInferenceProgress - index * 20) * 5, 0, 100);
              return (
                <span className={rlInferenceProgress >= threshold ? 'is-complete' : rlInferenceProgress > index * 20 ? 'is-running' : ''} key={stage}>
                  <small>{String(index + 1).padStart(2, '0')}</small>
                  <strong>{stage}</strong>
                  <i><b style={{ width: `${stageProgress}%` }} /></i>
                  <em>{stageProgress.toFixed(0)}%</em>
                </span>
              );
            })}
          </div>

          <div className="rl-decision-cockpit__body">
            <section className="rl-decision-card rl-decision-card--model">
              <header><span>01</span><strong>已部署神经网络与状态张量</strong></header>
              <div className="rl-model-metadata">
                <span><small>算法</small><strong>{rlPolicyInference?.model.algorithm ?? activeRlAlgorithmOption.shortLabel}</strong></span>
                <span><small>结构</small><strong>{rlPolicyInference?.model.architecture ?? '等待检查点'}</strong></span>
                <span><small>Checkpoint</small><strong>Episode 3,000</strong></span>
                <span><small>评估</small><strong>500 Episodes</strong></span>
              </div>
              <div className="rl-state-tensor" aria-label="RL输入状态张量">
                {(rlPolicyInference?.inputTensor ?? [
                  { id: 'c', label: '拥堵度', raw: peakPortCongestion.congestionScore, normalized: peakPortCongestion.congestionScore / 100, unit: '%' },
                  { id: 'd', label: '延误', raw: peakVesselDelay?.delayMinutes ?? 0, normalized: (peakVesselDelay?.delayMinutes ?? 0) / 180, unit: '分' },
                  { id: 'r', label: '韧性', raw: resilienceAssessment.networkResilienceIndex, normalized: resilienceAssessment.networkResilienceIndex / 100, unit: '' },
                  { id: 'w', label: '风速', raw: scenario.weather.windSpeedMs, normalized: scenario.weather.windSpeedMs / 30, unit: 'm/s' },
                ]).slice(0, 6).map((item) => (
                  <span key={item.id}>
                    <small>{item.label}</small>
                    <strong>{item.raw}{item.unit}</strong>
                    <i><b style={{ width: `${clampNumber(item.normalized * 100, 0, 100)}%` }} /></i>
                    <em>x={item.normalized.toFixed(3)}</em>
                  </span>
                ))}
              </div>
              <footer>
                <span>Value <strong>{rlPolicyInference?.inference.valueEstimate.toFixed(3) ?? '--'}</strong></span>
                <span>Entropy <strong>{rlPolicyInference?.inference.policyEntropy.toFixed(4) ?? '--'}</strong></span>
                <span>Latency <strong>{rlPolicyInference ? `${rlPolicyInference.inference.latencyMs.toFixed(1)}ms` : '--'}</strong></span>
                <span>决策次数 <strong>{rlPolicyInference?.inference.ensembleRuns ?? 1}</strong></span>
              </footer>
            </section>

            <section className="rl-decision-card rl-decision-card--forecast">
              <header><span>02</span><strong>扰动后多情景概率预测</strong></header>
              <div className="rl-disturbance-controls">
                {([
                  ['arrival-surge', '到港突增', 0.62],
                  ['weather-shock', '风浪冲击', 0.68],
                  ['capacity-loss', '能力损失', 0.58],
                ] as Array<[RlDisturbanceType, string, number]>).map(([type, label, intensity]) => (
                  <button
                    aria-pressed={rlDisturbance.type === type}
                    disabled={rlInferenceStatus === 'running'}
                    key={type}
                    onClick={() => runRlPolicyInference(type, intensity)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="rl-disturbance-intensity">
                <span>扰动强度 <strong>{Math.round(rlDisturbance.intensity * 100)}%</strong></span>
                <input
                  max="1"
                  min="0"
                  onChange={(event) => setRlDisturbance((current) => ({ ...current, intensity: Number(event.currentTarget.value) }))}
                  step="0.01"
                  type="range"
                  value={rlDisturbance.intensity}
                />
                <button disabled={rlInferenceStatus === 'running'} onClick={() => runRlPolicyInference(rlDisturbance.type, rlDisturbance.intensity)} type="button">重新预测</button>
              </label>
              <div className="rl-scenario-forecast-list">
                {(rlPolicyInference?.scenarioForecasts ?? []).map((forecast, index) => (
                  <article key={forecast.id}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>{forecast.label}<em>{forecast.probability.toFixed(1)}%</em></strong>
                    <i><b style={{ width: `${forecast.probability}%` }} /></i>
                    <small>拥堵 {forecast.congestionPercent.toFixed(1)}% · 延误 {forecast.delayMinutes}分 · 恢复 {forecast.recoveryMinutes}分 · 碳 {forecast.carbonDeltaTons > 0 ? '+' : ''}{forecast.carbonDeltaTons.toFixed(1)}t</small>
                  </article>
                ))}
                {rlInferenceStatus === 'running' && <p>正在执行 32 次策略集成与情景 rollout，概率分布将在推理完成后刷新。</p>}
              </div>
            </section>

            <section className="rl-decision-card rl-decision-card--action">
              <header><span>03</span><strong>策略动作概率与收益对照</strong></header>
              {rlPolicyInference && (
                <div className="rl-selected-action">
                  <small>
                    已训练策略事件推荐 · {rlPolicyInference.eventContext?.label ?? '常规态势'} · 置信{' '}
                    {rlPolicyInference.inference.confidencePercent.toFixed(1)}%
                  </small>
                  <strong>{rlPolicyInference.selectedAction.label}</strong>
                  <span>{rlPolicyInference.selectedAction.commandSummary}</span>
                  <p>{rlPolicyInference.selectedAction.rationale}</p>
                  <ol aria-label="策略执行步骤">
                    {rlPolicyInference.selectedAction.executionSteps.map((step, index) => (
                      <li key={step}><span>{index + 1}</span>{step}</li>
                    ))}
                  </ol>
                  <em>影响范围：{rlPolicyInference.selectedAction.affectedScope} · {rlPolicyInference.inference.safetyShield}</em>
                </div>
              )}
              <div className="rl-action-distribution">
                {(rlPolicyInference?.actionDistribution ?? []).map((action, index) => (
                  <span className={index === 0 ? 'is-selected' : ''} key={action.id}>
                    <small>{action.label}</small>
                    <strong>{action.probability.toFixed(1)}% <em>±{action.uncertainty.toFixed(2)}</em></strong>
                    <i><b style={{ width: `${action.probability}%` }} /></i>
                  </span>
                ))}
              </div>
              {rlPolicyInference && (
                <div className="rl-policy-comparison">
                  <span><small>拥堵下降</small><strong>-{rlPolicyInference.comparison.improvement.congestionPoints.toFixed(1)}pt</strong></span>
                  <span><small>延误下降</small><strong>-{rlPolicyInference.comparison.improvement.delayMinutes}分</strong></span>
                  <span><small>碳排下降</small><strong>-{rlPolicyInference.comparison.improvement.carbonTons.toFixed(1)}t</strong></span>
                  <span><small>韧性提升</small><strong>+{rlPolicyInference.comparison.improvement.resiliencePoints.toFixed(1)}</strong></span>
                </div>
              )}
              <div className="rl-decision-actions">
                <button
                  className="control-button control-button--primary"
                  disabled={!rlPolicyInference || rlInferenceStatus !== 'completed' || rlPolicyApplied}
                  onClick={applyRlPolicyDecision}
                  type="button"
                >
                  <Play size={14} />
                  {rlPolicyApplied ? '已训练策略已采用' : '采用已训练策略'}
                </button>
                <button className="control-button" onClick={openRlTrainingWindow} type="button">
                  <Gauge size={14} />
                  查看训练参数
                </button>
              </div>
            </section>
          </div>
        </section>
      )}

      {activeModule === 'sandbox' && isGodotSimulatorOpen && (
        <section
          aria-label="Godot 微观仿真视窗"
          className={`godot-simulator-dock godot-simulator-dock--${godotSimulatorStatusTone}`}
          style={
            {
              '--godot-simulator-color': statusColorByTone[godotSimulatorStatusTone],
            } as CSSProperties
          }
        >
          <header className="godot-simulator-dock__header">
            <span>
              <Ship size={14} />
              微观仿真视窗
            </span>
            <strong>{godotSimulatorStatusLabel}</strong>
            <div className="godot-simulator-dock__actions">
              <button aria-label="刷新 Godot 仿真视窗" onClick={refreshGodotSimulator} type="button">
                <RefreshCw size={13} />
              </button>
              <button aria-label="独立打开 Godot 仿真页" onClick={openGodotSimulatorStandalone} type="button">
                <ExternalLink size={13} />
              </button>
              <button aria-label="关闭 Godot 仿真视窗" onClick={() => setIsGodotSimulatorOpen(false)} type="button">
                <X size={13} />
              </button>
            </div>
          </header>
          <div className="godot-simulator-dock__body">
            {godotSimulatorStatus === 'available' ? (
              <iframe
                allow="fullscreen; gamepad; autoplay; clipboard-read; clipboard-write"
                className="godot-simulator-frame"
                onLoad={() => {
                  if (!generatedGodotRequest) return;
                  godotSimulatorFrameRef.current?.contentWindow?.postMessage(
                    {
                      source: 'malacca-port-resilience-sandbox',
                      type: 'godot.validation.request',
                      protocolVersion: 'godot-validation.v1',
                      payload: generatedGodotRequest,
                    },
                    window.location.origin,
                  );
                }}
                ref={godotSimulatorFrameRef}
                src={godotSimulatorFrameSrc}
                title="Godot Web micro simulator"
              />
            ) : (
              <div className="godot-simulator-placeholder">
                <strong>
                  {godotSimulatorStatus === 'checking' ? '正在检测 Godot Web 导出物' : '尚未导出 Godot Web 仿真'}
                </strong>
                <span>pnpm demo:godot:web</span>
                <small>导出完成后刷新视窗即可在大屏内运行微观航行模拟。</small>
              </div>
            )}
          </div>
          <footer className="godot-simulator-dock__footer">
            <span>{selectedValidationTargetLabel}</span>
            <em>{generatedGodotRequest ? generatedGodotRequest.requestId : '等待验证请求'}</em>
          </footer>
        </section>
      )}

      {activeModule === 'sandbox' && rlTrainingWindowState.isOpen && (
        <section
          className={`rl-training-window rl-training-window--${rlTrainingStatusTone}${rlTrainingWindowState.isMinimized ? ' rl-training-window--minimized' : ''}${rlTrainingWindowState.isCollapsed ? ' rl-training-window--collapsed' : ''}`}
          style={
            {
              '--rl-training-color': statusColorByTone[rlTrainingStatusTone],
              '--rl-training-progress': `${rlTraining.progressPercent.toFixed(3)}%`,
              '--rl-stage-progress': `${activeRlTrainingStageProgress.toFixed(1)}%`,
            } as CSSProperties
          }
          aria-label="港口控制算法真实训练中央窗口"
        >
          <header className="rl-training-window__header">
            <div>
              <span>
                <Gauge size={15} />
                <BilingualText text="港口控制算法训练中心" />
              </span>
              <strong>
                <BilingualText text={rlTrainingStatusLabel[rlTraining.status]} /> / 策略{' '}
                <BilingualText text={activeRlAlgorithmOption.label} /> / 对照 {activeRlTrainingBaseline.shortLabel} /{' '}
                {rlTraining.progressPercent.toFixed(rlProgressDigits)}%
              </strong>
            </div>
            <div className="rl-training-window__controls">
              <button
                aria-label="让小懿按优化目标智能配置训练"
                className="rl-xiaoyi-global-button"
                data-xiaoyi-action="rl-xiaoyi-configure"
                disabled={xiaoyiAdvisorStatus === 'thinking'}
                onClick={() => void askXiaoyiForRlTraining('all')}
                type="button"
              >
                <Sparkles size={12} />
                <span>{xiaoyiAdvisorStatus === 'thinking' ? '小懿分析中' : '小懿智能配置'}</span>
              </button>
              {hiddenRlTrainingCardCount > 0 && (
                <button aria-label="恢复全部训练卡片" onClick={restoreRlTrainingCards} type="button">
                  <RefreshCw size={12} />
                  {hiddenRlTrainingCardCount}
                </button>
              )}
              <button
                aria-label={rlTrainingWindowState.isMinimized ? '还原训练窗口' : '缩小训练窗口'}
                onClick={rlTrainingWindowState.isMinimized ? restoreRlTrainingWindow : minimizeRlTrainingWindow}
                type="button"
              >
                {rlTrainingWindowState.isMinimized ? <Expand size={12} /> : <Minimize size={12} />}
              </button>
              <button
                aria-label={rlTrainingWindowState.isCollapsed ? '展开训练窗口' : '收起训练窗口'}
                onClick={toggleCollapseRlTrainingWindow}
                type="button"
              >
                {rlTrainingWindowState.isCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
              </button>
              <button aria-label="关闭训练窗口" onClick={closeRlTrainingWindow} type="button">
                <X size={12} />
              </button>
            </div>
          </header>

          {rlTrainingWindowState.isMinimized ? (
            <div className="rl-training-window__minimized">
              <div className="rl-training-progress__track" aria-hidden="true">
                <b />
                <span />
              </div>
              <strong>
                <BilingualText text={activeRlTrainingStage.label} />
              </strong>
              <button className="control-button control-button--primary" onClick={restoreRlTrainingWindow} type="button">
                <Expand size={14} />
                <BilingualText text="还原窗口" />
              </button>
            </div>
          ) : (
            !rlTrainingWindowState.isCollapsed && (
              <div className="rl-training-window__body">
                <div className="rl-training-sticky-console">
                  <div className="rl-training-lifecycle" aria-label="RL模型全生命周期">
                    {[
                      ['01', '数据校验', rlTraining.progressPercent >= 6],
                      ['02', '时间切分', rlTraining.progressPercent >= 8],
                      ['03', '环境奖励', rlTraining.progressPercent >= 18],
                      ['04', '四种RL', rlTraining.progressPercent >= 72],
                      ['05', 'MPC辨识', rlTraining.progressPercent >= 82],
                      ['06', '验证选优', rlTraining.progressPercent >= 96],
                      ['07', 'Checkpoint', rlTraining.progressPercent >= 100],
                      ['08', '测试回放', rlTraining.policyTest.status === 'completed'],
                    ].map(([index, label, completed]) => (
                      <span className={completed ? 'is-complete' : rlTraining.status === 'running' ? 'is-running' : ''} key={String(index)}>
                        <small>{String(index)}</small>
                        <strong>{String(label)}</strong>
                        <i />
                      </span>
                    ))}
                  </div>
                  <section
                    aria-label="真实训练任务常驻控制台"
                    className={`rl-training-command-center rl-training-command-center--${rlTraining.status}`}
                  >
                    <div className="rl-training-command-center__launch">
                      <span>
                        <Play size={13} />
                        训练任务控制
                      </span>
                      <strong>
                        {rlTraining.status === 'running' || rlTraining.status === 'queued'
                          ? '训练进程运行中'
                          : rlTraining.status === 'completed'
                            ? '训练任务已完成'
                            : rlTraining.status === 'failed'
                              ? '训练任务失败'
                              : '等待启动真实训练'}
                      </strong>
                      <button
                        className={rlTraining.status === 'running' || rlTraining.status === 'queued' ? 'is-running' : ''}
                        disabled={rlTraining.status === 'running' || rlTraining.status === 'queued'}
                        onClick={startRlTraining}
                        type="button"
                      >
                        <Play size={16} />
                        <span>
                          {rlTraining.status === 'completed'
                            ? '重新训练'
                            : rlTraining.status === 'running' || rlTraining.status === 'queued'
                              ? '训练进行中'
                              : '启动训练'}
                        </span>
                      </button>
                      <small>进度=服务器已完成工作量 · 训练阶段不渲染 · 完成后保存 Checkpoint</small>
                    </div>
                    <div className="rl-training-command-center__monitor">
                      <header>
                        <span>
                          <b>{activeRlTrainingStage.label}</b>
                          <em>{activeRlTrainingStage.output}</em>
                        </span>
                        <strong>{rlTraining.progressPercent.toFixed(rlProgressDigits)}%</strong>
                      </header>
                      <div className="rl-training-command-center__progress">
                        <b aria-hidden="true" />
                        <i aria-hidden="true" />
                      </div>
                      <div className="rl-training-command-center__clocks">
                        <span><small>预计总耗时</small><strong>{rlPlannedDurationSeconds > 0 ? formatTrainingDuration(rlPlannedDurationSeconds) : '--:--:--'}</strong></span>
                        <span><small>开始时间</small><strong>{formatTrainingClock(rlTraining.startedAtEpochMs)}</strong></span>
                        <span><small>已训练</small><strong>{formatTrainingDuration(rlElapsedSeconds)}</strong></span>
                        <span><small>剩余时间</small><strong>{formatTrainingDuration(rlRemainingSeconds)}</strong></span>
                        <span><small>预计完成</small><strong>{formatTrainingClock(rlEstimatedCompletionEpochMs)}</strong></span>
                      </div>
                      <div className="rl-training-command-center__telemetry">
                        <span><small>Episode</small><strong>{formatInteger(rlTraining.episodeCursor)}</strong></span>
                        <span><small>Env Step</small><strong>{formatInteger(rlEnvironmentSteps)}</strong></span>
                        <span><small>Sampling</small><strong>{rlSamplesPerSecond} SPS</strong></span>
                        <span><small>Reward EMA</small><strong>{rlRewardEma.toFixed(2)}</strong></span>
                        <span><small>Updates</small><strong>{formatInteger(rlParameterUpdates)}</strong></span>
                        <span><small>Train/Val/Test</small><strong>{rlTrainRecordCount}/{rlValidationRecordCount}/{rlTestRecordCount}</strong></span>
                      </div>
                      <p>
                        <i aria-hidden="true" />
                        <strong>
                          {rlTraining.status === 'idle'
                            ? `等待启动：${activeRlTrainingObjective.label} / 主策略 ${activeRlAlgorithmOption.shortLabel} / 4 RL + 1 MPC`
                            : rlTrainingDynamicLogs.at(-1)}
                        </strong>
                      </p>
                    </div>
                    <div className="rl-training-command-center__stage">
                      <span>阶段进度</span>
                      <strong>{activeRlTrainingStageProgress.toFixed(1)}%</strong>
                      <div><b aria-hidden="true" /></div>
                      <small>{activeRlTrainingStage.detail}</small>
                      <button onClick={resetRlTraining} type="button">
                        <RotateCcw size={13} />
                        重置训练
                      </button>
                    </div>
                  </section>
                </div>
                {!isRlTrainingCardClosed('algorithm') && (
                  <RlTrainingCard
                    id="algorithm"
                    isCollapsed={isRlTrainingCardCollapsed('algorithm')}
                    isCompact={isRlTrainingCardCompact('algorithm')}
                    label="算法选择"
                    onAskXiaoyi={askXiaoyiForRlTraining}
                    onClose={closeRlTrainingCard}
                    onToggleCollapse={toggleRlTrainingCardCollapse}
                    onToggleCompact={toggleRlTrainingCardCompact}
                    subtitle={activeRlAlgorithmOption.shortLabel}
                    tone={activeRlAlgorithmOption.tone}
                    xiaoyiApplied={isXiaoyiCardApplied('algorithm')}
                    xiaoyiBusy={xiaoyiAdvisorStatus === 'thinking'}
                    xiaoyiSelected={xiaoyiAdvisorScope === 'algorithm'}
                  >
                    <div className="rl-training-algorithms" aria-label="训练算法选择">
                      {rlAlgorithmOptions.map((algorithm) => (
                        <button
                          aria-pressed={rlTraining.selectedAlgorithmId === algorithm.id}
                          className={`rl-algorithm-button rl-algorithm-button--${algorithm.tone}${rlTraining.selectedAlgorithmId === algorithm.id ? ' rl-algorithm-button--active' : ''}`}
                          key={algorithm.id}
                          onClick={() => selectRlAlgorithm(algorithm.id)}
                          title={`${algorithm.label}\n${algorithm.family}\n${algorithm.detail}\n${algorithm.backendHint}`}
                          type="button"
                        >
                          <span>{algorithm.shortLabel}</span>
                          <strong>
                            <BilingualText text={algorithm.label} />
                          </strong>
                          <small>
                            <BilingualText text={algorithm.family} />
                          </small>
                        </button>
                      ))}
                    </div>
                    <p className="rl-training-note">
                      {activeRlAlgorithmOption.detail}
                      <span>{activeRlAlgorithmOption.backendHint}</span>
                    </p>
                  </RlTrainingCard>
                )}

                {!isRlTrainingCardClosed('baselines') && (
                  <RlTrainingCard
                    id="baselines"
                    isCollapsed={isRlTrainingCardCollapsed('baselines')}
                    isCompact={isRlTrainingCardCompact('baselines')}
                    label="Baseline 对照"
                    onAskXiaoyi={askXiaoyiForRlTraining}
                    onClose={closeRlTrainingCard}
                    onToggleCollapse={toggleRlTrainingCardCollapse}
                    onToggleCompact={toggleRlTrainingCardCompact}
                    subtitle={activeRlTrainingBaseline.shortLabel}
                    tone={activeRlTrainingBaseline.tone}
                    xiaoyiApplied={isXiaoyiCardApplied('baselines')}
                    xiaoyiBusy={xiaoyiAdvisorStatus === 'thinking'}
                    xiaoyiSelected={xiaoyiAdvisorScope === 'baselines'}
                  >
                    <div className="rl-training-baselines" aria-label="强化学习 baseline">
                      {rlTrainingBaselines.map((baseline) => (
                        <button
                          aria-pressed={rlTraining.selectedBaselineId === baseline.id}
                          className={`rl-baseline-button rl-baseline-button--${baseline.tone}${rlTraining.selectedBaselineId === baseline.id ? ' rl-baseline-button--active' : ''}`}
                          key={baseline.id}
                          onClick={() => selectRlTrainingBaseline(baseline.id)}
                          title={`${baseline.label}\n${baseline.family}\n${baseline.detail}\n接口 ${baseline.interfaceKey}`}
                          type="button"
                        >
                          <span>{baseline.shortLabel}</span>
                          <strong>
                            <BilingualText text={baseline.label} />
                          </strong>
                        </button>
                      ))}
                    </div>
                  </RlTrainingCard>
                )}

                {!isRlTrainingCardClosed('settings') && (
                  <RlTrainingCard
                    id="settings"
                    isCollapsed={isRlTrainingCardCollapsed('settings')}
                    isCompact={isRlTrainingCardCompact('settings')}
                    label="沙盘信息设置"
                    onAskXiaoyi={askXiaoyiForRlTraining}
                    onClose={closeRlTrainingCard}
                    onToggleCollapse={toggleRlTrainingCardCollapse}
                    onToggleCompact={toggleRlTrainingCardCompact}
                    subtitle={activeRlTrainingSetting.label}
                    tone={activeRlTrainingSetting.tone}
                    xiaoyiApplied={isXiaoyiCardApplied('settings')}
                    xiaoyiBusy={xiaoyiAdvisorStatus === 'thinking'}
                    xiaoyiSelected={xiaoyiAdvisorScope === 'settings'}
                  >
                    <div className="rl-training-settings" aria-label="沙盘推演训练信息设置">
                      {rlTrainingSettings.map((setting) => (
                        <button
                          aria-pressed={rlTraining.activeSettingId === setting.id}
                          className={`rl-setting-button rl-setting-button--${setting.tone}${rlTraining.activeSettingId === setting.id ? ' rl-setting-button--active' : ''}`}
                          key={setting.id}
                          onClick={() => selectRlTrainingSetting(setting.id)}
                          title={`${setting.label}：${setting.value}\n${setting.detail}`}
                          type="button"
                        >
                          <span>
                            <BilingualText text={setting.label} />
                          </span>
                          <strong>{setting.value}</strong>
                        </button>
                      ))}
                    </div>
                  </RlTrainingCard>
                )}

                {!isRlTrainingCardClosed('parameters') && (
                  <RlTrainingCard
                    id="parameters"
                    isCollapsed={isRlTrainingCardCollapsed('parameters')}
                    isCompact={isRlTrainingCardCompact('parameters')}
                    label="训练参数"
                    onAskXiaoyi={askXiaoyiForRlTraining}
                    onClose={closeRlTrainingCard}
                    onToggleCollapse={toggleRlTrainingCardCollapse}
                    onToggleCompact={toggleRlTrainingCardCompact}
                    subtitle={`lr ${formatRlParameterValue('learningRate', rlTraining.parameters.learningRate)}`}
                    tone={activeRlAlgorithmOption.tone}
                    xiaoyiApplied={isXiaoyiCardApplied('parameters')}
                    xiaoyiBusy={xiaoyiAdvisorStatus === 'thinking'}
                    xiaoyiSelected={xiaoyiAdvisorScope === 'parameters'}
                  >
                    <label className="rl-objective-select">
                      <span>
                        <BilingualText text="训练优化目标" />
                        <em>
                          <BilingualText text={activeRlTrainingObjective.shortLabel} />
                        </em>
                      </span>
                      <select
                        onChange={(event) =>
                          selectRlTrainingObjective(event.currentTarget.value as RlTrainingObjectiveId)
                        }
                        value={rlTraining.selectedObjectiveId}
                      >
                        {rlTrainingObjectives.map((objective) => (
                          <option
                            disabled={!getRlObjectivePreset(objective.id).supportedByAggregateEnvironment}
                            key={objective.id}
                            value={objective.id}
                          >
                            {formatBilingualPlainText(objective.label)}
                            {!getRlObjectivePreset(objective.id).supportedByAggregateEnvironment ? '（需扩展环境）' : ''}
                          </option>
                        ))}
                      </select>
                      <strong>{activeRlTrainingObjective.detail}</strong>
                      <small>
                        {activeRlTrainingObjective.rewardFocus} · 所需证据：
                        {getRlObjectivePreset(activeRlTrainingObjective.id).requiredEvidence.join(' / ')}
                      </small>
                    </label>
                    <div className="rl-parameter-groups" aria-label="强化学习训练参数设置">
                      <section className="rl-parameter-group">
                        <span>
                          <BilingualText text="优化器" />
                        </span>
                        <div className="rl-parameter-grid">
                          {rlOptimizationParameterControls.map((control) => (
                            <label className="rl-parameter-control" key={control.key}>
                              <span>
                                <BilingualText text={control.label} />
                                <em>
                                  {formatRlParameterValue(control.key, rlTraining.parameters[control.key])}
                                  {control.unit}
                                </em>
                              </span>
                              <input
                                max={control.max}
                                min={control.min}
                                onChange={(event) =>
                                  updateRlTrainingParameter(
                                    control.key,
                                    Number(event.currentTarget.value),
                                    control.min,
                                    control.max,
                                  )
                                }
                                step={control.step}
                                type="number"
                                value={rlTraining.parameters[control.key]}
                              />
                            </label>
                          ))}
                        </div>
                      </section>
                      <section className="rl-parameter-group">
                        <span>
                          <BilingualText text="采样与回放" />
                        </span>
                        <div className="rl-parameter-grid rl-parameter-grid--rollout">
                          {rlRolloutParameterControls.map((control) => (
                            <label className="rl-parameter-control" key={control.key}>
                              <span>
                                <BilingualText text={control.label} />
                                <em>
                                  {formatRlParameterValue(control.key, rlTraining.parameters[control.key])}
                                  {control.unit}
                                </em>
                              </span>
                              <input
                                max={control.max}
                                min={control.min}
                                onChange={(event) =>
                                  updateRlTrainingParameter(
                                    control.key,
                                    Number(event.currentTarget.value),
                                    control.min,
                                    control.max,
                                  )
                                }
                                step={control.step}
                                type="number"
                                value={rlTraining.parameters[control.key]}
                              />
                            </label>
                          ))}
                        </div>
                      </section>
                      <section className="rl-parameter-group">
                        <span>
                          <BilingualText text="奖励函数权重" />
                        </span>
                        <div className="rl-reward-grid">
                          {rlRewardParameterControls.map((control) => (
                            <label className="rl-reward-control" key={control.key}>
                              <span>
                                <BilingualText text={control.label} />
                                <em>{formatRlParameterValue(control.key, rlTraining.parameters[control.key])}</em>
                              </span>
                              <input
                                max={control.max}
                                min={control.min}
                                onChange={(event) =>
                                  updateRlTrainingParameter(
                                    control.key,
                                    Number(event.currentTarget.value),
                                    control.min,
                                    control.max,
                                  )
                                }
                                step={control.step}
                                type="range"
                                value={rlTraining.parameters[control.key]}
                              />
                            </label>
                          ))}
                        </div>
                      </section>
                    </div>
                  </RlTrainingCard>
                )}

                {!isRlTrainingCardClosed('backend') && (
                  <RlTrainingCard
                    id="backend"
                    isCollapsed={isRlTrainingCardCollapsed('backend')}
                    isCompact={isRlTrainingCardCompact('backend')}
                    label="后台算法接入"
                    onAskXiaoyi={askXiaoyiForRlTraining}
                    onClose={closeRlTrainingCard}
                    onToggleCollapse={toggleRlTrainingCardCollapse}
                    onToggleCompact={toggleRlTrainingCardCompact}
                    subtitle={rlBackendStatusLabel[rlTraining.backend.status]}
                    tone={activeRlBackendStatusTone}
                    xiaoyiApplied={isXiaoyiCardApplied('backend')}
                    xiaoyiBusy={xiaoyiAdvisorStatus === 'thinking'}
                    xiaoyiSelected={xiaoyiAdvisorScope === 'backend'}
                  >
                    <div className="rl-backend-panel" aria-label="后台训练算法接入设置">
                      <div className="rl-backend-modes">
                        {(['http'] as RlBackendMode[]).map((mode) => (
                          <button
                            aria-pressed={rlTraining.backend.mode === mode}
                            className={rlTraining.backend.mode === mode ? 'rl-backend-mode--active' : ''}
                            key={mode}
                            onClick={() => setRlBackendMode(mode as RlBackendMode)}
                            type="button"
                          >
                            <BilingualText text={rlBackendModeLabel[mode]} />
                          </button>
                        ))}
                        <span>外部服务需实现 rl-training-job.v1</span>
                      </div>
                      <div className="rl-backend-fields">
                        <label>
                          <span>HTTP Endpoint</span>
                          <input
                            onChange={(event) => updateRlBackendField('endpoint', event.currentTarget.value)}
                            spellCheck={false}
                            value={rlTraining.backend.endpoint}
                          />
                        </label>
                        <label>
                          <span>Project</span>
                          <input
                            onChange={(event) => updateRlBackendField('projectName', event.currentTarget.value)}
                            spellCheck={false}
                            value={rlTraining.backend.projectName}
                          />
                        </label>
                        <label>
                          <span>Token</span>
                          <input
                            onChange={(event) => updateRlBackendField('authToken', event.currentTarget.value)}
                            placeholder="optional"
                            spellCheck={false}
                            type="password"
                            value={rlTraining.backend.authToken}
                          />
                        </label>
                      </div>
                      <div className={`rl-backend-status rl-backend-status--${activeRlBackendStatusTone}`}>
                        <strong>
                          <BilingualText text={rlBackendStatusLabel[rlTraining.backend.status]} />
                        </strong>
                        <span>{rlTraining.backend.lastMessage}</span>
                      </div>
                      <div className="rl-backend-actions">
                        <button
                          className="control-button control-button--primary"
                          disabled={rlTraining.backend.status === 'checking'}
                          onClick={testRlBackendConnection}
                          type="button"
                        >
                          <RadioTower size={14} />
                          <BilingualText text="测试接入" />
                        </button>
                        <button className="control-button" onClick={syncRlTrainingRequestContract} type="button">
                          <Settings size={14} />
                          <BilingualText text="同步参数" />
                        </button>
                        <button className="control-button" onClick={disconnectRlBackend} type="button">
                          <Pause size={14} />
                          <BilingualText text="断开接入" />
                        </button>
                      </div>
                    </div>
                  </RlTrainingCard>
                )}

                {!isRlTrainingCardClosed('progress') && (
                  <RlTrainingCard
                    id="progress"
                    isCollapsed={isRlTrainingCardCollapsed('progress')}
                    isCompact={isRlTrainingCardCompact('progress')}
                    label="训练进度"
                    onAskXiaoyi={askXiaoyiForRlTraining}
                    onClose={closeRlTrainingCard}
                    onToggleCollapse={toggleRlTrainingCardCollapse}
                    onToggleCompact={toggleRlTrainingCardCompact}
                    subtitle={activeRlTrainingStage.label}
                    tone={activeRlTrainingStage.tone}
                    xiaoyiApplied={isXiaoyiCardApplied('progress')}
                    xiaoyiBusy={xiaoyiAdvisorStatus === 'thinking'}
                    xiaoyiSelected={xiaoyiAdvisorScope === 'progress'}
                  >
                    <div className="rl-training-progress">
                      <div
                        className="rl-training-progress__track"
                        title={`${activeRlTrainingStage.label}\n${activeRlTrainingStage.detail}\n输出 ${activeRlTrainingStage.output}`}
                      >
                        <b aria-hidden="true" />
                        <span aria-hidden="true" />
                      </div>
                      <strong>{rlTraining.progressPercent.toFixed(rlProgressDigits)}%</strong>
                    </div>
                    <div className="rl-training-wall-clock" aria-label="服务器训练耗时">
                      <span>
                        <small>开始时间</small>
                        <strong>{formatTrainingClock(rlTraining.startedAtEpochMs)}</strong>
                      </span>
                      <span>
                        <small>已训练</small>
                        <strong>{formatTrainingDuration(rlElapsedSeconds)}</strong>
                      </span>
                      <span>
                        <small>剩余时间</small>
                        <strong>{formatTrainingDuration(rlRemainingSeconds)}</strong>
                      </span>
                      <span>
                        <small>预计完成</small>
                        <strong>{formatTrainingClock(rlEstimatedCompletionEpochMs)}</strong>
                      </span>
                    </div>
                    <div className="rl-training-live-layout">
                      <div className="rl-training-telemetry" aria-label="训练动态遥测">
                        {rlTrainingTelemetry.map((item) => (
                          <span key={item.label}>
                            <small>{item.label}</small>
                            <strong>{item.value}</strong>
                            <em>{item.detail}</em>
                          </span>
                        ))}
                      </div>
                      <ol className="rl-training-live-log" aria-label="训练动态详细日志">
                        {rlTrainingDynamicLogs.map((log, index) => (
                          <li key={log}>
                            <span>{String(index + 1).padStart(2, '0')}</span>
                            <strong>{log}</strong>
                          </li>
                        ))}
                      </ol>
                    </div>
                    <div className="rl-training-stage-detail">
                      <span>
                        <BilingualText text={activeRlTrainingStage.label} />
                      </span>
                      <strong>{activeRlTrainingStage.detail}</strong>
                      <em>
                        {formatBilingualPlainText(activeRlTrainingObjective.shortLabel)} /{' '}
                        {formatBilingualPlainText(activeRlTrainingSetting.label)} /{' '}
                        {formatBilingualPlainText(activeRlAlgorithmOption.family)} / {activeRlTrainingRequest.endpoint}
                      </em>
                    </div>
                    <div className="rl-training-actions">
                      <button
                        className={`control-button control-button--primary${rlTraining.status === 'running' || rlTraining.status === 'queued' ? ' control-button--active' : ''}`}
                        data-xiaoyi-action="rl-start-training"
                        data-xiaoyi-state={rlTraining.status}
                        disabled={rlTraining.status === 'running' || rlTraining.status === 'queued'}
                        onClick={startRlTraining}
                        type="button"
                      >
                        <Play size={15} />
                        <BilingualText
                          text={
                            rlTraining.status === 'completed'
                              ? '重新训练'
                              : rlTraining.status === 'running' || rlTraining.status === 'queued'
                                ? '训练中'
                                : '启动训练'
                          }
                        />
                      </button>
                      <button className="control-button" onClick={resetRlTraining} type="button">
                        <RotateCcw size={15} />
                        <BilingualText text="重置训练" />
                      </button>
                    </div>
                  </RlTrainingCard>
                )}

                {!isRlTrainingCardClosed('metrics') && (
                  <RlTrainingCard
                    id="metrics"
                    isCollapsed={isRlTrainingCardCollapsed('metrics')}
                    isCompact={isRlTrainingCardCompact('metrics')}
                    label="训练指标"
                    onClose={closeRlTrainingCard}
                    onToggleCollapse={toggleRlTrainingCardCollapse}
                    onToggleCompact={toggleRlTrainingCardCompact}
                    subtitle={`Reward EMA ${rlRewardEma.toFixed(1)}`}
                    tone={rlTrainingStatusTone}
                  >
                    <div className="rl-training-metrics" aria-label="训练指标预览">
                      {rlTrainingTelemetry.map((metric) => (
                        <span key={metric.label} title={metric.detail}>
                          <small>{metric.label}</small>
                          <strong>{metric.value}</strong>
                        </span>
                      ))}
                      <span>
                        <small><BilingualText text="延误改善" /></small>
                        <strong>{simulatedRlDelayReductionLabel}</strong>
                      </span>
                      <span>
                        <small><BilingualText text="碳排改善" /></small>
                        <strong>{selectedRlBenchmarkResult ? `${simulatedRlCarbonReduction >= 0 ? '-' : '+'}${Math.abs(simulatedRlCarbonReduction).toFixed(1)}%` : '--'}</strong>
                      </span>
                    </div>
                  </RlTrainingCard>
                )}

                {!isRlTrainingCardClosed('curves') && (
                  <RlTrainingCard
                    id="curves"
                    isCollapsed={isRlTrainingCardCollapsed('curves')}
                    isCompact={isRlTrainingCardCompact('curves')}
                    label="四种RL训练 + MPC辨识曲线"
                    onClose={closeRlTrainingCard}
                    onToggleCollapse={toggleRlTrainingCardCollapse}
                    onToggleCompact={toggleRlTrainingCardCompact}
                    subtitle={
                      rlTraining.status === 'completed' && bestRlBenchmarkResult
                        ? `Best ${bestRlBenchmarkResult.label}`
                        : rlTraining.status === 'running'
                          ? `服务器更新 ${rlTraining.progressPercent.toFixed(rlProgressDigits)}%`
                          : '等待训练'
                    }
                    tone={rlBenchmark ? 'ok' : 'warning'}
                  >
                    <div className="rl-benchmark-results" aria-label="四种强化学习与MPC控制基线结果曲线">
                      <div className="rl-benchmark-chart">
                        <svg role="img" viewBox="0 0 460 146" aria-label="Episode reward 对比曲线">
                          {[20, 48, 76, 104, 132].map((y) => (
                            <line key={y} x1="14" x2="446" y1={y} y2={y} />
                          ))}
                          {rlBenchmark?.results.map((result) => (
                            <polyline
                              fill="none"
                              key={result.id}
                              points={rlBenchmarkPolyline(rlVisibleCurve(result.curve))}
                              stroke={result.color}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={
                                rlTraining.status === 'completed' && result.id === rlBenchmark.bestAlgorithmId
                                  ? 3
                                  : 1.8
                              }
                            />
                          ))}
                          {!rlBenchmark && (
                            <text x="230" y="78" textAnchor="middle">完成服务器训练后读取真实参数更新曲线</text>
                          )}
                        </svg>
                        <span>Reward {rlBenchmarkRewardMax.toFixed(0)}</span>
                        <em>{rlBenchmarkRewardMin.toFixed(0)}</em>
                        <small>Episode 0 → {rlBenchmarkEpisodeMax}</small>
                      </div>
                      <div className="rl-benchmark-legend">
                        {(rlBenchmark?.results ?? rlTrainingBaselines.map((baseline, index) => ({
                          id: baseline.id,
                          label: baseline.shortLabel,
                          color: ['#35e6c2', '#45b8ff', '#b985ff', '#ffbd45', '#ff6d72'][index],
                          evaluation: null,
                        }))).map((result) => {
                          const visibleCurve = 'curve' in result ? rlVisibleCurve(result.curve) : [];
                          const latestPoint = visibleCurve.at(-1);
                          return (
                            <span key={result.id} style={{ '--rl-line-color': result.color } as CSSProperties}>
                              <i />
                              <strong>{result.label}</strong>
                              <em>
                                {rlTraining.status === 'completed' && result.evaluation
                                  ? `${result.evaluation.meanReward.toFixed(1)} / 延误-${result.evaluation.delayReductionPercent}%`
                                  : latestPoint
                                    ? `Ep ${latestPoint.episode} / R ${latestPoint.reward.toFixed(1)}`
                                    : '等待采样'}
                              </em>
                            </span>
                          );
                        })}
                      </div>
                      <p>{rlBenchmarkMessage}</p>
                      {rlTraining.status === 'completed' && bestRlBenchmarkResult && (
                        <div className="rl-benchmark-best">
                          <span><small>拥堵</small><strong>-{bestRlBenchmarkResult.evaluation.congestionReductionPercent}%</strong></span>
                          <span><small>碳排</small><strong>-{bestRlBenchmarkResult.evaluation.carbonReductionPercent}%</strong></span>
                          <span><small>韧性</small><strong>+{bestRlBenchmarkResult.evaluation.resilienceGain}</strong></span>
                          <span><small>服务率</small><strong>{bestRlBenchmarkResult.evaluation.modeled.meanServiceLevelPercent}%</strong></span>
                          <span><small>安全违规</small><strong>{bestRlBenchmarkResult.evaluation.safetyViolations}</strong></span>
                        </div>
                      )}
                    </div>
                  </RlTrainingCard>
                )}

                {!isRlTrainingCardClosed('policy-test') && (
                  <RlTrainingCard
                    id="policy-test"
                    isCollapsed={isRlTrainingCardCollapsed('policy-test')}
                    isCompact={isRlTrainingCardCompact('policy-test')}
                    label="训练后策略测试"
                    onAskXiaoyi={askXiaoyiForRlTraining}
                    onClose={closeRlTrainingCard}
                    onToggleCollapse={toggleRlTrainingCardCollapse}
                    onToggleCompact={toggleRlTrainingCardCompact}
                    subtitle={rlPolicyTestStatusLabel[rlTraining.policyTest.status]}
                    tone={rlPolicyTestTone}
                    xiaoyiApplied={isXiaoyiCardApplied('policy-test')}
                    xiaoyiBusy={xiaoyiAdvisorStatus === 'thinking'}
                    xiaoyiSelected={xiaoyiAdvisorScope === 'policy-test'}
                  >
                    <div
                      className={`rl-policy-test rl-policy-test--${rlPolicyTestTone}`}
                      style={
                        {
                          '--rl-policy-test-progress': `${rlTraining.policyTest.progressPercent.toFixed(1)}%`,
                          '--rl-policy-test-color': statusColorByTone[rlPolicyTestTone],
                        } as CSSProperties
                      }
                      aria-label="训练后策略测试窗口"
                    >
                      <div className="rl-policy-test__cases" aria-label="策略测试场景">
                        {rlPolicyTestCases.map((testCase) => (
                          <button
                            aria-pressed={rlTraining.policyTest.selectedCaseId === testCase.id}
                            className={`rl-policy-test-case rl-policy-test-case--${testCase.tone}${rlTraining.policyTest.selectedCaseId === testCase.id ? ' rl-policy-test-case--active' : ''}`}
                            key={testCase.id}
                            onClick={() => selectRlPolicyTestCase(testCase.id)}
                            title={`${testCase.label}\n${testCase.detail}`}
                            type="button"
                          >
                            <span>
                              <BilingualText text={testCase.shortLabel} />
                            </span>
                            <strong>
                              <BilingualText text={testCase.label} />
                            </strong>
                          </button>
                        ))}
                      </div>
                      <div className="rl-policy-test__status">
                        <div className="rl-policy-test__progress">
                          <b aria-hidden="true" />
                          <span aria-hidden="true" />
                        </div>
                        <strong>
                          <BilingualText text={rlPolicyTestProgressLabel} />
                        </strong>
                        <em>
                          {isRlPolicyTestUnlocked
                            ? `${activeRlPolicyTestCase.detail} / checkpoint ${activeRlAlgorithmOption.shortLabel}`
                            : '训练进度达到 100% 后解锁测试按钮和模型回放信息流'}
                        </em>
                      </div>
                      <div className="rl-policy-test__actions">
                        <button
                          className={`control-button control-button--primary${rlTraining.policyTest.status === 'running' ? ' control-button--active' : ''}`}
                          data-xiaoyi-action="rl-policy-test"
                          disabled={!isRlPolicyTestUnlocked || rlTraining.policyTest.status === 'running'}
                          onClick={startRlPolicyTest}
                          type="button"
                        >
                          <Play size={15} />
                          <BilingualText
                            text={
                              rlTraining.policyTest.status === 'running'
                                ? '测试中'
                                : rlTraining.policyTest.status === 'completed'
                                  ? '重新测试'
                                  : '启动测试'
                            }
                          />
                        </button>
                        <button className="control-button" onClick={resetRlPolicyTest} type="button">
                          <RotateCcw size={15} />
                          <BilingualText text="重置测试" />
                        </button>
                      </div>
                      <div className="rl-policy-test__metrics" aria-label="策略测试指标">
                        {rlPolicyTestMetrics.map((metric) => (
                          <span
                            className={`rl-policy-test-metric rl-policy-test-metric--${metric.tone}`}
                            key={metric.label}
                          >
                            <small>
                              <BilingualText text={metric.label} />
                            </small>
                            <strong>
                              {metric.value}
                              <em>{metric.unit}</em>
                            </strong>
                          </span>
                        ))}
                      </div>
                      <ol className="rl-policy-test__logs" aria-label="策略测试日志">
                        {visibleRlPolicyTestLogs.map((log, index) => (
                          <li key={`${activeRlPolicyTestCase.id}-${index}`}>
                            <span>{String(index + 1).padStart(2, '0')}</span>
                            <strong>{log}</strong>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </RlTrainingCard>
                )}

                {!isRlTrainingCardClosed('contract') && (
                  <RlTrainingCard
                    id="contract"
                    isCollapsed={isRlTrainingCardCollapsed('contract')}
                    isCompact={isRlTrainingCardCompact('contract')}
                    label="接口预留"
                    onAskXiaoyi={askXiaoyiForRlTraining}
                    onClose={closeRlTrainingCard}
                    onToggleCollapse={toggleRlTrainingCardCollapse}
                    onToggleCompact={toggleRlTrainingCardCompact}
                    subtitle={activeRlTrainingRequest.protocolVersion}
                    tone="ok"
                    xiaoyiApplied={isXiaoyiCardApplied('contract')}
                    xiaoyiBusy={xiaoyiAdvisorStatus === 'thinking'}
                    xiaoyiSelected={xiaoyiAdvisorScope === 'contract'}
                  >
                    <div className="rl-training-contract">
                      <span>
                        <small>Endpoint</small>
                        <strong>{activeRlTrainingRequest.endpoint}</strong>
                      </span>
                      <span>
                        <small>Algorithm</small>
                        <strong>{activeRlTrainingRequest.algorithmId}</strong>
                      </span>
                      <span>
                        <small>Objective</small>
                        <strong>{activeRlTrainingRequest.objectiveLabel}</strong>
                      </span>
                      <span>
                        <small>Baseline</small>
                        <strong>{activeRlTrainingRequest.baselineId}</strong>
                      </span>
                      <span>
                        <small>Backend</small>
                        <strong>
                          {formatBilingualPlainText(rlBackendModeLabel[activeRlTrainingRequest.backend.mode])} /{' '}
                          {formatBilingualPlainText(rlBackendStatusLabel[activeRlTrainingRequest.backend.status])}
                        </strong>
                      </span>
                      <span>
                        <small>Parameters</small>
                        <strong>
                          lr {formatRlParameterValue('learningRate', activeRlTrainingRequest.trainingParameters.learningRate)} / gamma{' '}
                          {formatRlParameterValue('discountGamma', activeRlTrainingRequest.trainingParameters.discountGamma)} / episodes{' '}
                          {formatRlParameterValue('maxEpisodes', activeRlTrainingRequest.trainingParameters.maxEpisodes)} / seed{' '}
                          {formatRlParameterValue('seed', activeRlTrainingRequest.trainingParameters.seed)} / tune{' '}
                          {formatRlParameterValue('tuningTrials', activeRlTrainingRequest.trainingParameters.tuningTrials)}
                        </strong>
                      </span>
                      <span>
                        <small>Observation</small>
                        <strong>{activeRlTrainingRequest.observationSpace.slice(0, 4).join(' / ')}</strong>
                      </span>
                      <span>
                        <small>Action</small>
                        <strong>{activeRlTrainingRequest.actionSpace.slice(0, 4).join(' / ')}</strong>
                      </span>
                      <span>
                        <small>Reward</small>
                        <strong>
                          delay {activeRlTrainingRequest.rewardWeights.delay} / carbon{' '}
                          {activeRlTrainingRequest.rewardWeights.carbon} / safety{' '}
                          {activeRlTrainingRequest.rewardWeights.safety} / throughput{' '}
                          {activeRlTrainingRequest.rewardWeights.throughput}
                        </strong>
                      </span>
                    </div>
                  </RlTrainingCard>
                )}
              </div>
            )
          )}
        </section>
      )}

      {activeModule === 'sandbox' && rlTrainingWindowState.isOpen && isXiaoyiAssistantOpen && (
        <section
          aria-label="可拖拽的小懿RL训练助手"
          className={`xiaoyi-rl-assistant${isXiaoyiAssistantMinimized ? ' xiaoyi-rl-assistant--minimized' : ''} xiaoyi-rl-assistant--${xiaoyiAdvisorStatus}${xiaoyiApplyFeedback.status === 'success' ? ' xiaoyi-rl-assistant--applied' : ''}`}
          style={
            {
              '--xiaoyi-x': `${xiaoyiAssistantPosition.x}px`,
              '--xiaoyi-y': `${xiaoyiAssistantPosition.y}px`,
            } as CSSProperties
          }
        >
          {isXiaoyiAssistantMinimized ? (
            <div className="xiaoyi-rl-assistant__mini-handle" onMouseDown={startXiaoyiAssistantDrag}>
              <GripVertical size={12} />
              <button aria-label="展开小懿RL训练助手" onClick={() => setIsXiaoyiAssistantMinimized(false)} type="button">
                <img alt="小懿AI港航训练助手" src="/assets/xiaoyi-maritime-officer.svg" />
                <span>小懿</span>
              </button>
            </div>
          ) : (
            <>
              <header className="xiaoyi-rl-assistant__header" onMouseDown={startXiaoyiAssistantDrag}>
                <GripVertical size={13} />
                <span>
                  <strong>小懿AI · 控制算法训练助理</strong>
                  <small>拖拽移动 · 操作员友好配置</small>
                </span>
                <i className={xiaoyiRlAdvice?.externalConnected ? 'is-online' : ''} />
                <button aria-label="最小化小懿助手" onClick={() => setIsXiaoyiAssistantMinimized(true)} type="button">
                  <Minimize size={12} />
                </button>
                <button aria-label="关闭小懿助手" onClick={() => setIsXiaoyiAssistantOpen(false)} type="button">
                  <X size={12} />
                </button>
              </header>
              <div className="xiaoyi-rl-assistant__hero">
                <img alt="小懿AI港航训练助手动画形象" src="/assets/xiaoyi-maritime-officer.svg" />
                <span className="xiaoyi-rl-assistant__scan" />
                <i className="xiaoyi-rl-assistant__pulse xiaoyi-rl-assistant__pulse--one" />
                <i className="xiaoyi-rl-assistant__pulse xiaoyi-rl-assistant__pulse--two" />
                <div>
                  <strong>小懿AI</strong>
                  <span>{xiaoyiRlAdvice?.externalConnected ? '已连接小懿AI 8010' : '内置规则顾问（非大模型）'}</span>
                </div>
              </div>
              <div className="xiaoyi-rl-assistant__message">
                <span>
                  {xiaoyiAdvisorStatus === 'thinking'
                    ? '正在读取优化目标、沙盘压力和训练约束…'
                    : xiaoyiAdvisorStatus === 'failed'
                      ? '顾问请求暂时不可用，请重试；当前训练参数未被修改。'
                      : xiaoyiRlAdvice
                        ? xiaoyiRlAdvice.operatorSummary
                        : `你只需要选择“${activeRlTrainingObjective.label}”，其余算法和参数可以交给我。`}
                </span>
                {xiaoyiAdvisorStatus === 'thinking' && <i><b /></i>}
                {xiaoyiApplyFeedback.status !== 'idle' && (
                  <div
                    aria-live="polite"
                    className={`xiaoyi-rl-assistant__apply-feedback xiaoyi-rl-assistant__apply-feedback--${xiaoyiApplyFeedback.status}`}
                    role="status"
                  >
                    {xiaoyiApplyFeedback.status === 'applying' ? (
                      <RefreshCw className="is-spinning" size={15} />
                    ) : (
                      <CheckCircle2 size={16} />
                    )}
                    <span>
                      <strong>
                        {xiaoyiApplyFeedback.status === 'applying' ? '正在应用推荐配置…' : '配置已生效'}
                      </strong>
                      <small>{xiaoyiApplyFeedback.message}</small>
                    </span>
                    {xiaoyiApplyFeedback.appliedAt && <em>{xiaoyiApplyFeedback.appliedAt}</em>}
                  </div>
                )}
              </div>
              {xiaoyiRlAdvice && (
                <div className="xiaoyi-rl-assistant__recommendation">
                  <header>
                    <span>推荐置信度</span>
                    <strong>{xiaoyiRlAdvice.confidencePercent.toFixed(0)}%</strong>
                  </header>
                  <div>
                    <span><small>算法</small><strong>{xiaoyiRlAdvice.recommendation.algorithmLabel}</strong></span>
                    <span><small>Baseline</small><strong>{xiaoyiRlAdvice.recommendation.baselineLabel}</strong></span>
                  </div>
                  <p>{xiaoyiRlAdvice.cardAdvice[xiaoyiAdvisorScope === 'all' ? 'parameters' : xiaoyiAdvisorScope] ?? xiaoyiRlAdvice.reasons[0]}</p>
                  <ul>
                    {xiaoyiRlAdvice.reasons.slice(0, 2).map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                </div>
              )}
              <footer className="xiaoyi-rl-assistant__actions">
                <button
                  disabled={xiaoyiAdvisorStatus === 'thinking'}
                  onClick={() => void askXiaoyiForRlTraining(xiaoyiAdvisorScope)}
                  type="button"
                >
                  <Sparkles size={12} />
                  {xiaoyiRlAdvice ? '重新推荐' : '生成推荐'}
                </button>
                {xiaoyiAdvisorScope !== 'all' && (
                  <button
                    className={`is-primary${xiaoyiApplyFeedback.status === 'success' && xiaoyiApplyFeedback.scope === xiaoyiAdvisorScope ? ' is-applied' : ''}`}
                    disabled={!xiaoyiRlAdvice || xiaoyiApplyFeedback.status === 'applying'}
                    onClick={() => applyXiaoyiRlAdvice(xiaoyiAdvisorScope)}
                    type="button"
                  >
                    {xiaoyiApplyFeedback.status === 'applying' && xiaoyiApplyFeedback.scope === xiaoyiAdvisorScope ? (
                      <><RefreshCw className="is-spinning" size={11} />应用中</>
                    ) : xiaoyiApplyFeedback.status === 'success' && xiaoyiApplyFeedback.scope === xiaoyiAdvisorScope ? (
                      <><CheckCircle2 size={11} />已应用本卡</>
                    ) : '应用本卡'}
                  </button>
                )}
                <button
                  className={`is-primary${xiaoyiApplyFeedback.status === 'success' && xiaoyiApplyFeedback.scope === 'all' ? ' is-applied' : ''}`}
                  disabled={!xiaoyiRlAdvice || xiaoyiApplyFeedback.status === 'applying'}
                  onClick={() => applyXiaoyiRlAdvice('all')}
                  type="button"
                >
                  {xiaoyiApplyFeedback.status === 'applying' && xiaoyiApplyFeedback.scope === 'all' ? (
                    <><RefreshCw className="is-spinning" size={11} />配置中</>
                  ) : xiaoyiApplyFeedback.status === 'success' && xiaoyiApplyFeedback.scope === 'all' ? (
                    <><CheckCircle2 size={11} />全部已配置</>
                  ) : '一键配置全部'}
                </button>
              </footer>
            </>
          )}
        </section>
      )}

      <aside
        className={`side-rail side-rail--right${[
          '气象与海况',
          '碳排放监测',
          '航道拥堵热力图',
          '关键节点监控',
        ].includes(expandedPanelTitle ?? '') ? ' side-rail--has-expanded' : ''}`}
      >
        <Panel title="气象与海况" {...getPanelExpandProps('气象与海况')}>
          <div className="weather-grid">
            <div
              className="radar-widget"
              onClick={() => openWeatherInspector()}
              onKeyDown={(event) => handleValidationKeyDown(event, () => openWeatherInspector())}
              role="button"
              style={
                {
                  '--wind-direction-deg': `${windDirectionDeg}deg`,
                } as CSSProperties
              }
              tabIndex={0}
              title={`风向 ${scenario.weather.windDirection} / 风速 ${scenario.weather.windSpeedMs} m/s`}
            >
              <i>
                <small className="radar-widget__sweep" aria-hidden="true" />
                <small className="radar-widget__ping radar-widget__ping--one" aria-hidden="true" />
                <small className="radar-widget__ping radar-widget__ping--two" aria-hidden="true" />
                <b />
              </i>
              <span>N</span>
              <strong>{scenario.weather.windDirection}</strong>
              <em>风速 {scenario.weather.windSpeedMs} m/s</em>
            </div>
            {weatherCards.map((item) => {
              const Icon = item.icon;

              return (
                <div
                  className="weather-card"
                  key={item.id}
                  onClick={() => openWeatherInspector(item)}
                  onKeyDown={(event) =>
                    handleValidationKeyDown(event, () => openWeatherInspector(item))
                  }
                  role="button"
                  tabIndex={0}
                >
                  <Icon size={16} />
                  <BilingualText text={item.label} />
                  <strong>
                    {item.value}
                    {item.unit && <em>{item.unit}</em>}
                  </strong>
                  <small>{item.detail}</small>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="碳排放监测" {...getPanelExpandProps('碳排放监测')}>
          <div
            className="carbon-head"
            onClick={openCarbonInspector}
            onKeyDown={(event) => handleValidationKeyDown(event, openCarbonInspector)}
            role="button"
            tabIndex={0}
          >
            <span className="carbon-stat carbon-stat--primary">
              <BilingualText text="今日碳排放" />
              <strong>
                <RollingMetricValue value={String(scenario.carbon.todayEmission)} />
              </strong>
              <em>{scenario.carbon.todayUnit}</em>
            </span>
            <span className="carbon-stat">
              <BilingualText text="较昨日" />
              <strong className="tone-ok">
                {scenario.carbon.changeVsYesterdayPercent > 0 ? '+' : ''}
                {scenario.carbon.changeVsYesterdayPercent}%
              </strong>
              <em>
                <BilingualText text="绿色调度后" />
              </em>
            </span>
          </div>
          <svg className="chart-line" viewBox="0 0 260 110" aria-hidden="true">
            <polyline points={trendPolyline} />
          </svg>
          <div className="chart-axis">
            {carbonAxisLabels.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="carbon-foot">
            <span>
              <BilingualText text="当前小时" />
              <strong>
                <RollingMetricValue value={String(carbonLatestTrend.value)} />
              </strong>
              <em>{scenario.carbon.trendUnit}</em>
            </span>
            <span>
              <BilingualText text="峰值时段" />
              <strong>{carbonPeakTrend.hour}</strong>
              <em>{carbonPeakTrend.value} {scenario.carbon.trendUnit}</em>
            </span>
          </div>
        </Panel>

        <Panel title="航道拥堵热力图" {...getPanelExpandProps('航道拥堵热力图')}>
          <div className="heatmap-module">
            <div className="heatmap-card" aria-label={scenario.congestionHeatmap.label}>
              <div className="heatmap-glow" />
              <svg className="heatmap-routes" viewBox="0 0 1000 720" aria-hidden="true">
                {heatmapRoutes.map((route) => (
                  <path
                    className="heatmap-route"
                    d={route.svgPath}
                    key={route.id}
                    style={
                      {
                        '--heat-color': statusColorByTone[route.tone],
                        '--heat-route-opacity': 0.36 + route.intensity * 0.54,
                        '--heat-route-width': `${2 + route.intensity * 5}px`,
                      } as CSSProperties
                    }
                  >
                    <title>
                      {[
                        route.label,
                        `拥堵 ${route.channel?.congestionPercent ?? 0}% / 密度 ${formatHeatPercent(route.density)}`,
                        `延误 ${route.delayMinutes} 分钟 / ${heatLevelLabelByTone[route.tone]}`,
                      ].join('\n')}
                    </title>
                  </path>
                ))}
              </svg>
              {heatmapHotspots.map((hotspot) => (
                <span
                  className={`heatmap-hotspot heatmap-hotspot--${hotspot.tone}`}
                  key={hotspot.nodeId}
                  onClick={() => openPortInspector(hotspot.port)}
                  onKeyDown={(event) =>
                    handleValidationKeyDown(event, () => openPortInspector(hotspot.port))
                  }
                  role="button"
                  style={
                    {
                      '--heat-color': statusColorByTone[hotspot.tone],
                      '--heat-size': `${18 + hotspot.intensity * 14}px`,
                      left: hotspot.port.position.x,
                      top: hotspot.port.position.y,
                    } as CSSProperties
                  }
                  tabIndex={0}
                  title={`${hotspot.port.name}\n拥堵 ${portById.get(hotspot.nodeId)?.congestionPercent ?? 0}% / 排队 ${hotspot.port.queueVessels} 艘\n${heatLevelLabelByTone[hotspot.tone]}`}
                >
                  <i>{formatHeatPercent(hotspot.intensity)}</i>
                </span>
              ))}
              <div className="heatmap-scale">
                <span>{scenario.congestionHeatmap.lowLabel}</span>
                <i />
                <span>{scenario.congestionHeatmap.highLabel}</span>
              </div>
            </div>
            <ul className="heatmap-hotspot-list">
              {heatmapHotspots.map((hotspot) => (
                <li
                  className={`heatmap-hotspot-item heatmap-hotspot-item--${hotspot.tone}`}
                  key={hotspot.nodeId}
                  onClick={() => openPortInspector(hotspot.port)}
                  onKeyDown={(event) =>
                    handleValidationKeyDown(event, () => openPortInspector(hotspot.port))
                  }
                  role="button"
                  style={{ '--heat-color': statusColorByTone[hotspot.tone] } as CSSProperties}
                  tabIndex={0}
                >
                  <span>{hotspot.port.name}</span>
                  <strong>{formatHeatPercent(hotspot.intensity)}</strong>
                  <em>{heatLevelLabelByTone[hotspot.tone]}</em>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        <Panel title="关键节点监控" {...getPanelExpandProps('关键节点监控')}>
          <table className="node-table">
            <thead>
              <tr>
                <th>节点</th>
                <th>船舶</th>
                <th>拥堵度</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {monitoredRuntimePorts.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => openPortInspector(row)}
                  style={
                    {
                      '--node-status-color': statusColorByTone[row.tone],
                      '--node-congestion-percent': `${row.congestionPercent}%`,
                    } as CSSProperties
                  }
                  title={[
                    getPortNodeTitle(row),
                    `拥堵度 ${row.congestionPercent}%`,
                    `排队 ${row.queueVessels} 艘 / 平均等待 ${row.averageWaitingHours}h`,
                  ].join('\n')}
                >
                  <td>{row.name}</td>
                  <td>{formatInteger(row.vesselCount)}</td>
                  <td>
                    <span className="node-congestion">
                      <strong className={`tone-${row.tone}`}>{row.congestionPercent}%</strong>
                      <i aria-hidden="true" />
                    </span>
                  </td>
                  <td>
                    <span className={`status-badge status-badge--${row.tone}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </aside>

      <footer className={`bottom-console${isSimulationRunning ? ' bottom-console--running' : ''}`}>
        <section className={`module-panel module-panel--${activeModule}`} aria-live="polite">
          {activeModule === 'overview' && (
            <>
              <div className="event-feed">
                {displayedEventLog.map((entry) => (
                  <span className={`event-feed__item event-feed__item--${entry.tone}`} key={entry.id}>
                    <RadioTower size={14} />
                    <strong>{entry.time}</strong>
                    {entry.message}
                  </span>
                ))}
              </div>
              <div className="module-overview-cards" aria-label="态势总览模块摘要">
                {displayedMetrics.map((item) => (
                  <button
                    className={`module-overview-card module-overview-card--${item.tone}`}
                    key={item.id}
                    onClick={() => openMetricInspector(item)}
                    type="button"
                  >
                    <small>{item.label}</small>
                    <strong>
                      <RollingMetricValue value={item.value} />
                      <em>{item.unit}</em>
                    </strong>
                  </button>
                ))}
              </div>
            </>
          )}

          {activeModule === 'sandbox' && (
            <>
              <section className="sandbox-control" aria-label="沙盘推演控制">
                <div className="linked-demo-cases" aria-label="联动演示场景">
                  {linkedDemoCases.map((demoCase) => (
                    <button
                      aria-pressed={activeDemoCaseId === demoCase.id}
                      className={`demo-case-button demo-case-button--${demoCase.tone}${activeDemoCaseId === demoCase.id ? ' demo-case-button--active' : ''}`}
                      data-xiaoyi-action={`demo-${demoCase.id}`}
                      key={demoCase.id}
                      onClick={() => handleLoadLinkedDemoCase(demoCase)}
                      title={`${demoCase.label}\n${demoCase.description}`}
                      type="button"
                    >
                      <BilingualText className="demo-case-button__short" text={demoCase.shortLabel} />
                      <strong>
                        <BilingualText text={demoCase.label} />
                      </strong>
                    </button>
                  ))}
                </div>
                <div className="control-actions">
                  <button
                    className={`control-button control-button--primary${isSimulationRunning ? ' control-button--active' : ''}`}
                    data-xiaoyi-action="simulation-toggle"
                    data-xiaoyi-state={isSimulationRunning ? 'running' : 'idle'}
                    onClick={toggleSimulation}
                    type="button"
                  >
                    {isSimulationRunning ? <Pause size={17} /> : <Play size={17} />}
                    <BilingualText text={isSimulationRunning ? '暂停' : '开始'} />
                  </button>
                  <button className="control-button" data-xiaoyi-action="simulation-reset" onClick={resetSimulation} type="button">
                    <RotateCcw size={16} />
                    <BilingualText text="重置" />
                  </button>
                  <button className="control-button" data-xiaoyi-action="simulation-step" onClick={advanceSimulation} type="button">
                    <Clock size={16} />
                    <span className="control-button__combo">
                      <BilingualText text="推进" />
                      <em>{advanceMinutesStep}分</em>
                    </span>
                  </button>
                  <button
                    aria-pressed={isEventInjectionPanelOpen}
                    className={`control-button control-button--warning${isEventInjectionPanelOpen ? ' control-button--active' : ''}`}
                    data-xiaoyi-action="inject-event"
                    onClick={openEventInjectionPanel}
                    type="button"
                  >
                    <PlusCircle size={16} />
                    <BilingualText text="事件注入" />
                  </button>
                  <button
                    className={`control-button${rlInferenceStatus === 'running' || rlPolicyApplied ? ' control-button--active' : ''}`}
                    data-xiaoyi-action="open-rl-decision"
                    onClick={openRlDecisionPanel}
                    type="button"
                  >
                    <Activity size={16} />
                    <BilingualText text="RL策略推理" />
                  </button>
                  <button className="control-button" data-xiaoyi-action="open-rl-training" onClick={openRlTrainingWindow} type="button">
                    <Gauge size={16} />
                    <BilingualText text="训练中心" />
                  </button>
                  <button className="control-button" data-xiaoyi-action="export-report" onClick={downloadClosureReport} type="button">
                    <Download size={16} />
                    <BilingualText text="导出报告" />
                  </button>
                </div>
                <div className="speed-selector" aria-label="倍速控制">
                  <span>
                    <FastForward size={14} />
                    <BilingualText text="倍速" />
                  </span>
                  {simulationSpeeds.map((speed) => (
                    <button
                      aria-pressed={simulationSpeed === speed}
                      className={simulationSpeed === speed ? 'speed-button speed-button--active' : 'speed-button'}
                      key={speed}
                      onClick={() =>
                        setSandboxRuntime((runtime) => ({
                          ...runtime,
                          simulationSpeed: speed,
                        }))
                      }
                      type="button"
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
                <div
                  className={`sandbox-status-panel sandbox-status-panel--${sandboxRuntimeStatusTone}`}
                  style={{
                    '--sandbox-status-color': rlPolicyApplied
                      ? rlPolicyRecoveryColor
                      : statusColorByTone[sandboxRuntimeStatusTone],
                  } as CSSProperties}
                  aria-label="当前功能清单和推演状态"
                >
                  <header className="sandbox-status-panel__header">
                    <BilingualText text="当前功能清单" />
                    <strong>
                      <BilingualText text={sandboxRuntimeStatusLabel} />
                    </strong>
                  </header>
                  <div className="sandbox-status-panel__meta">
                    <span>
                      <small>
                        <BilingualText text="阶段" />
                      </small>
                      <strong>
                        {activeSimulationRenderStep.shortLabel}·
                        {sandboxPhaseStatusLabel[activeSimulationRenderStep.status]}
                      </strong>
                    </span>
                    <span>
                      <small>
                        <BilingualText text="微观" />
                      </small>
                      <strong>{validationFeedStatusLabel}</strong>
                    </span>
                    <span>
                      <small>
                        <BilingualText text="下一步" />
                      </small>
                      <strong>
                        <BilingualText text={sandboxNextActionLabel} />
                      </strong>
                    </span>
                  </div>
                  <ol className="sandbox-capability-list">
                    {sandboxCapabilityItems.map((item) => (
                      <li
                        className={`sandbox-capability-list__item sandbox-capability-list__item--${item.tone}`}
                        key={item.id}
                        style={{ '--capability-color': statusColorByTone[item.tone] } as CSSProperties}
                        title={`${item.label}：${item.value}\n${item.detail}`}
                      >
                        <BilingualText text={item.label} />
                        <strong>{item.value}</strong>
                      </li>
                    ))}
                  </ol>
                </div>
              </section>
              <section
                className={`micro-validation-console micro-validation-console--${importedResultTone}${importedGodotResult ? ' micro-validation-console--result' : ''}`}
                style={{
                  '--micro-validation-color': rlPolicyApplied
                    ? rlPolicyRecoveryColor
                    : statusColorByTone[importedResultTone],
                } as CSSProperties}
                aria-label="微观单船验证入口"
              >
                <header className="micro-validation-console__header">
                  <BilingualText
                    text={
                      importedGodotResult && rlPolicyApplied && policyRecovery.advancedMinutes > 0
                        ? 'RL滚动恢复回写'
                        : importedGodotResult
                          ? '闭环结果回写'
                          : '滚动验证信息流'
                    }
                  />
                  <strong>
                    <BilingualText text={validationFeedStatusLabel} />
                  </strong>
                </header>
                {importedGodotResult && microValidationReport && (
                  <div className="micro-validation-highlight" aria-label="单船验证回写四项核心结果">
                    <span>
                      <small><BilingualText text="推荐航速" /></small>
                      <strong>{importedGodotResult.recommendedSpeedKnots.toFixed(1)}<em>kn</em></strong>
                    </span>
                    <span>
                      <small><BilingualText text="风险等级" /></small>
                      <strong>{microValidationReport.riskLabel}</strong>
                    </span>
                    <span>
                      <small><BilingualText text="预计耗时" /></small>
                      <strong>{recoveryAdjustedTravelMinutes.toFixed(0)}<em>分</em></strong>
                    </span>
                    <span>
                      <small><BilingualText text="碳排变化" /></small>
                      <strong>
                        {recoveryAdjustedCarbonTons > 0 ? '+' : ''}
                        {recoveryAdjustedCarbonTons.toFixed(1)}<em>t</em>
                      </strong>
                    </span>
                  </div>
                )}
                <div className="micro-validation-console__body">
                  <div className="micro-validation-summary">
                    <span>{selectedValidationTargetLabel}</span>
                    <strong>
                      {(importedGodotResult?.recommendedSpeedKnots ?? pendingTargetSpeedKnots).toFixed(1)}kn
                      <em>
                        <BilingualText text={importedGodotResult ? '推荐航速' : '目标航速'} />
                      </em>
                    </strong>
                    {importedGodotResult ? (
                      <small>
                        {recoveryAdjustedRiskLabel} / 耗时 {recoveryAdjustedTravelMinutes.toFixed(0)}分 / 碳排{' '}
                        {recoveryAdjustedCarbonTons.toFixed(1)}t
                      </small>
                    ) : (
                      <small>
                        风险 {pendingGodotRiskEventCount} / 策略 {pendingGodotStrategyCount} / 延误{' '}
                        {selectedValidationDelay?.delayMinutes ?? 0}分 / 碳排{' '}
                        {selectedValidationEmission?.carbonTons.toFixed(0) ?? 0}t
                      </small>
                    )}
                  </div>
                  <div className="micro-validation-actions">
                    <div className="micro-validation-action-row">
                      <button
                        className="control-button control-button--primary micro-validation-button"
                        disabled={
                          !selectedValidationVessel ||
                          !selectedValidationResolvedRoute ||
                          (injectedEvents.length > 0 && !rlPolicyApplied)
                        }
                        onClick={handleEnterMicroValidation}
                        title={
                          injectedEvents.length > 0 && !rlPolicyApplied
                            ? '请先在 RL 策略推理舱完成推理并采用策略'
                            : '生成单船验证信息流'
                        }
                        type="button"
                      >
                        <Ship size={16} />
                        <BilingualText text="生成信息流" />
                      </button>
                      <button
                        className={`control-button micro-validation-button${isGodotSimulatorOpen ? ' control-button--active' : ''}`}
                        disabled={!generatedGodotRequest}
                        onClick={() => {
                          setHasPreviewedGodotSimulator(true);
                          setIsGodotSimulatorOpen((value) => !value);
                        }}
                        type="button"
                      >
                        <Expand size={16} />
                        <BilingualText text="航行模拟器" />
                      </button>
                      <button
                        className="control-button control-button--primary micro-validation-button"
                        disabled={!generatedGodotRequest || Boolean(importedGodotResult)}
                        onClick={handleLocalValidationAndFeedback}
                        type="button"
                      >
                        <RefreshCw size={16} />
                        <BilingualText text="本地验证回写" />
                      </button>
                      <button
                        className="control-button micro-validation-button"
                        onClick={() => godotResultInputRef.current?.click()}
                        type="button"
                      >
                        <RadioTower size={16} />
                        <BilingualText text="导入模拟结果" />
                      </button>
                      <input
                        accept="application/json,.json"
                        hidden
                        onChange={(event) => {
                          void handleImportGodotResult(event.currentTarget.files?.[0] ?? null);
                        }}
                        ref={godotResultInputRef}
                        type="file"
                      />
                    </div>
                    <div className="micro-validation-feed" aria-label="滚动验证信息流">
                      <header>
                        <BilingualText text="本地渲染流" />
                        <strong>
                          <BilingualText text={validationFeedStatusLabel} />
                        </strong>
                      </header>
                      <div className="micro-validation-feed__viewport">
                        <ul>
                          {[...validationFeedItems, ...validationFeedItems].map((item, index) => (
                            <li
                              className={`micro-validation-feed__item micro-validation-feed__item--${item.tone}`}
                              key={`${item.id}-${index}`}
                              style={
                                {
                                  '--feed-item-color': statusColorByTone[item.tone],
                                } as CSSProperties
                              }
                            >
                              <BilingualText text={item.label} />
                              <strong>{item.value}</strong>
                              <em>{item.detail}</em>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
              <section
                className="simulation-clock"
                style={{ '--simulation-progress': `${simulationProgressPercent}%` } as CSSProperties}
                aria-label="推演时间推进"
              >
                <BilingualText text={isSimulationRunning ? '推演运行中' : '推演已暂停'} />
                <strong>{scenarioClockLabel}</strong>
                <ol className="simulation-render-strip" aria-label="推演渲染阶段">
                  {simulationRenderSteps.map((step, index) => (
                    <li
                      aria-current={
                        index === activeSimulationRenderStepIndex && step.status === 'running'
                          ? 'step'
                          : undefined
                      }
                      className={`simulation-render-strip__item simulation-render-strip__item--${step.status}${index === activeSimulationRenderStepIndex ? ' simulation-render-strip__item--active' : ''}`}
                      key={step.id}
                      style={
                        {
                          '--render-step-color': statusColorByTone[step.tone],
                          '--render-step-progress': `${getSimulationRenderStepProgressPercent(step)}%`,
                        } as CSSProperties
                      }
                      title={`${step.label}：${sandboxPhaseStatusLabel[step.status]}\n开始 ${step.startedAt}${
                        step.completedAt ? ` / 完成 ${step.completedAt}` : ''
                      }\n输出：${step.summary}`}
                    >
                      <span className="simulation-render-strip__label">
                        <strong>{step.shortLabel}</strong>
                        <em>{sandboxPhaseStatusLabel[step.status]}</em>
                      </span>
                      <i aria-hidden="true">
                        <b />
                      </i>
                    </li>
                  ))}
                </ol>
                <i aria-hidden="true">
                  <b />
                </i>
                <small>
                  <BilingualText text="已推进" /> {elapsedMinutes} min / <BilingualText text="注入事件" />{' '}
                  {injectedEvents.length}
                </small>
              </section>
            </>
          )}

          {activeModule === 'resilience' && (
            <>
              <section
                className="module-focus-card"
                style={{ '--module-focus-color': statusColorByTone[resilienceAssessment.tone] } as CSSProperties}
                aria-label="韧性评估模块摘要"
              >
                <BilingualText text="网络韧性指数" />
                <strong>{resilienceAssessment.networkResilienceIndex.toFixed(1)}</strong>
                <em>恢复能力 {resilienceAssessment.congestionRecoveryAbility}%</em>
              </section>
              <div
                className="resilience-console"
                style={{ '--resilience-color': statusColorByTone[resilienceAssessment.tone] } as CSSProperties}
                title={resilienceAssessment.keyNodePressures
                  .slice(0, 3)
                  .map(
                    (item) =>
                      `${item.nodeName}：压力 ${item.pressureScore.toFixed(1)} / 恢复 ${item.recoveryHours.toFixed(1)}h / 航线 ${item.affectedRouteCount}`,
                  )
                  .join('\n')}
              >
                <span>
                  恢复
                  <strong>{resilienceAssessment.congestionRecoveryAbility}%</strong>
                </span>
                <span>
                  压力
                  <strong>{resilienceAssessment.criticalNodePressure}</strong>
                </span>
                <span>
                  扩散
                  <strong>{resilienceAssessment.riskSpreadRangePercent}%</strong>
                </span>
                <span>
                  节点
                  <strong>{resilienceAssessment.stressedNodeCount}</strong>
                </span>
              </div>
              <ul className="module-rank-list">
                {resilienceAssessment.keyNodePressures.slice(0, 3).map((item) => (
                  <li
                    key={item.nodeId}
                    onClick={() => {
                      const port = portById.get(item.nodeId);
                      if (port) {
                        openPortInspector(port);
                      }
                    }}
                    style={{ '--module-rank-color': statusColorByTone[item.tone] } as CSSProperties}
                  >
                    <span>{item.nodeName}</span>
                    <strong>{item.pressureScore.toFixed(0)}</strong>
                    <em>{item.recoveryHours.toFixed(1)}h</em>
                  </li>
                ))}
              </ul>
            </>
          )}

          {activeModule === 'dispatch' && (
            <>
              {rlPolicyApplied && rlPolicyInference ? (
                <section className="rl-applied-dispatch" aria-label="已训练策略下发结果">
                  <header>
                    <span>
                      <Activity size={15} />
                      已训练策略已下发
                    </span>
                    <strong>{rlPolicyInference.model.policyId}</strong>
                    <em>置信 {rlPolicyInference.inference.confidencePercent.toFixed(1)}%</em>
                  </header>
                  <div className="rl-applied-dispatch__action">
                    <small>执行动作</small>
                    <strong>{rlPolicyInference.selectedAction.label}</strong>
                    <span>{rlPolicyInference.selectedAction.commandSummary}</span>
                    <p>{rlPolicyInference.selectedAction.rationale}</p>
                    <em>{rlPolicyInference.selectedAction.affectedScope} · {rlPolicyInference.inference.safetyShield}</em>
                  </div>
                  <div className="rl-applied-dispatch__metrics">
                    <span><small>拥堵下降</small><strong>-{rlPolicyInference.comparison.improvement.congestionPoints.toFixed(1)}pt</strong></span>
                    <span><small>延误下降</small><strong>-{rlPolicyInference.comparison.improvement.delayMinutes}分</strong></span>
                    <span><small>碳排下降</small><strong>-{rlPolicyInference.comparison.improvement.carbonTons.toFixed(1)}t</strong></span>
                    <span><small>韧性提升</small><strong>+{rlPolicyInference.comparison.improvement.resiliencePoints.toFixed(1)}</strong></span>
                    <span><small>最高概率情景</small><strong>{rlPolicyInference.scenarioForecasts[0]?.label ?? '--'} {rlPolicyInference.scenarioForecasts[0]?.probability.toFixed(1) ?? '--'}%</strong></span>
                  </div>
                  <div className="rl-applied-dispatch__actions">
                    <button className="control-button control-button--primary" onClick={() => setActiveModule('sandbox')} type="button">
                      <Play size={14} />
                      返回沙盘继续闭环
                    </button>
                    <button className="control-button" onClick={() => {
                      setActiveModule('sandbox');
                      setIsRlDecisionPanelOpen(true);
                    }} type="button">
                      <RefreshCw size={14} />
                      重新打开策略推理
                    </button>
                  </div>
                </section>
              ) : (
                <section
                className={`ai-decision-panel ai-decision-panel--${aiDecisionRecommendation.tone}`}
                style={{ '--ai-decision-color': statusColorByTone[aiDecisionRecommendation.tone] } as CSSProperties}
                aria-label="AI 决策建议模块"
                title={[
                  `生成时间 ${aiDecisionRecommendation.generatedAt}`,
                  `主建议 ${aiDecisionRecommendation.primaryAction}`,
                  `置信度 ${aiDecisionRecommendation.confidenceScore}%`,
                ].join('\n')}
              >
                <header className="ai-decision-panel__header">
                  <span>规则 AI 决策建议</span>
                  <strong>{aiDecisionRecommendation.confidenceScore}%</strong>
                </header>
                <ul className="ai-advice-list">
                  {aiDecisionRecommendation.recommendations.map((item) => (
                    <li
                      key={item.topic}
                      onClick={() => {
                        const moduleByTopic: Record<AiDecisionRecommendation['recommendations'][number]['topic'], DashboardModuleId> = {
                          'congestion-cause': 'resilience',
                          'risk-judgement': 'emergency',
                          'dispatch-suggestion': 'dispatch',
                          'carbon-optimization': 'dispatch',
                        };
                        setActiveModule(moduleByTopic[item.topic]);
                        openInspectorPanel({
                          id: `ai-${item.topic}`,
                          title: item.title,
                          subtitle: item.summary,
                          body: item.evidence,
                          tone: item.tone,
                          metrics: [
                            { label: '优先级', value: item.priority.toFixed(0), tone: item.tone },
                            { label: '置信度', value: String(aiDecisionRecommendation.confidenceScore), unit: '%' },
                          ],
                          action: { label: '查看关联模块', module: moduleByTopic[item.topic] },
                        });
                      }}
                      style={{ '--ai-advice-color': statusColorByTone[item.tone] } as CSSProperties}
                      title={[item.title, item.summary, item.evidence].join('\n')}
                    >
                      <span>{item.title}</span>
                      <strong>{item.summary}</strong>
                    </li>
                  ))}
                </ul>
                </section>
              )}
              {dispatchFocus && (
                <section
                  className="module-focus-card"
                  style={{ '--module-focus-color': statusColorByTone[dispatchFocus.tone] } as CSSProperties}
                  aria-label="调度优化模块摘要"
                >
                  <BilingualText text={importedGodotResult ? '微观调度建议' : '推荐策略'} />
                  <strong>{dispatchFocus.label}</strong>
                  <em>{dispatchFocus.detail}</em>
                </section>
              )}
            </>
          )}

          {activeModule === 'emergency' && (
            <section
              className={`emergency-plan-panel emergency-plan-panel--${emergencyContingencyAssessment.tone}`}
              style={{ '--emergency-color': statusColorByTone[emergencyContingencyAssessment.tone] } as CSSProperties}
              aria-label="应急预案模块"
              title={[
                `生成时间 ${emergencyContingencyAssessment.generatedAt}`,
                `激活预案 ${emergencyContingencyAssessment.activePlanLabel}`,
                `平均准备度 ${emergencyContingencyAssessment.readinessScore}%`,
              ].join('\n')}
            >
              <header className="emergency-plan-panel__header">
                <BilingualText text="应急预案" />
                <strong>{emergencyContingencyAssessment.activePlanLabel}</strong>
                <em>{emergencyContingencyAssessment.readinessScore}%</em>
              </header>
              <ul className="emergency-plan-list">
                {emergencyContingencyAssessment.plans.map((plan) => (
                  <li
                    key={plan.scenario}
                    onClick={() => {
                      setActiveMapView('emergency');
                      openInspectorPanel({
                        id: `plan-${plan.scenario}`,
                        title: plan.label,
                        subtitle: plan.affectedArea,
                        body: `${plan.priorityAction}。${plan.supportAction}`,
                        tone: plan.tone,
                        metrics: [
                          { label: '严重度', value: String(plan.severityScore), tone: plan.tone },
                          { label: '准备度', value: String(plan.readinessPercent), unit: '%' },
                          { label: '恢复', value: plan.estimatedRecoveryHours.toFixed(1), unit: 'h' },
                        ],
                      });
                    }}
                    style={{ '--emergency-plan-color': statusColorByTone[plan.tone] } as CSSProperties}
                    title={[
                      plan.label,
                      plan.affectedArea,
                      `触发：${plan.trigger}`,
                      `主动作：${plan.priorityAction}`,
                      `支撑动作：${plan.supportAction}`,
                      `准备度 ${plan.readinessPercent}% / 恢复 ${plan.estimatedRecoveryHours.toFixed(1)}h`,
                    ].join('\n')}
                  >
                    <span>{plan.label}</span>
                    <strong>{plan.priorityAction}</strong>
                    <em>{plan.readinessPercent}%</em>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>

        <nav className="module-switcher" aria-label="Web 页面模块切换">
          {dashboardModules.map((module) => {
            const Icon = module.icon;

            return (
              <button
                aria-pressed={activeModule === module.id}
                className={`module-button${activeModule === module.id ? ' module-button--active' : ''}`}
                data-xiaoyi-action={`module-${module.id}`}
                key={module.id}
                onClick={() => {
                  setExpandedPanelTitle(null);
                  setActiveModule(module.id);
                }}
                type="button"
              >
                <Icon size={16} />
                <BilingualText text={module.label} />
              </button>
            );
          })}
        </nav>
      </footer>

      <XiaoyiSystemAssistant />

      {isSettingsOpen && (
        <aside className="settings-popover" aria-label="系统设置">
          <header>
            <span>
              <Settings size={15} />
              系统设置
            </span>
            <button aria-label="关闭系统设置" onClick={() => setIsSettingsOpen(false)} type="button">
              <X size={14} />
            </button>
          </header>
          <div className="settings-popover__body">
            <section className="port-data-settings" aria-label="港口数据接入">
              <header>
                <span>港口数据源</span>
                <strong className={`tone-${portDataStatusTone[portDataStatus]}`}>
                  {portDataStatusLabel[portDataStatus]}
                </strong>
              </header>
              <div className="port-data-settings__modes">
                <button
                  aria-pressed={portDataConfig.mode === 'demo'}
                  onClick={() => setPortDataMode('demo')}
                  type="button"
                >
                  合成示例（非实证）
                </button>
                <button
                  aria-pressed={portDataConfig.mode === 'public'}
                  onClick={() => setPortDataMode('public')}
                  type="button"
                >
                  公开实证
                </button>
                <button
                  aria-pressed={portDataConfig.mode === 'live'}
                  onClick={() => setPortDataMode('live')}
                  type="button"
                >
                  生产接口
                </button>
              </div>
              <label>
                <span>Snapshot Endpoint</span>
                <input
                  onChange={(event) => updatePortDataConfig('endpoint', event.currentTarget.value)}
                  spellCheck={false}
                  value={portDataConfig.endpoint}
                />
              </label>
              <div className="port-data-settings__row">
                <label>
                  <span>Bearer Token</span>
                  <input
                    onChange={(event) => updatePortDataConfig('apiKey', event.currentTarget.value)}
                    placeholder="可选"
                    type="password"
                    value={portDataConfig.apiKey}
                  />
                </label>
                <label>
                  <span>轮询秒数</span>
                  <input
                    max={3600}
                    min={5}
                    onChange={(event) =>
                      updatePortDataConfig(
                        'pollingSeconds',
                        Math.max(5, Number(event.currentTarget.value) || 30),
                      )
                    }
                    type="number"
                    value={portDataConfig.pollingSeconds}
                  />
                </label>
              </div>
              <p>{portDataMessage}</p>
              {portDataConfig.mode !== 'demo' && (
                <button
                  className="port-data-settings__refresh"
                  disabled={portDataStatus === 'connecting'}
                  onClick={() => setPortDataRefreshToken((token) => token + 1)}
                  type="button"
                >
                  <RefreshCw size={13} />
                  立即同步
                </button>
              )}
              {portDataObservedAt && <small>数据时标：{portDataObservedAt}</small>}
              {publicEvidence && (
                <div className="public-evidence-list" aria-label="公开数据证据链">
                  <a href={publicEvidence.mpa.url} rel="noreferrer" target="_blank">
                    <strong>MPA 港口统计</strong>
                    <span>{publicEvidence.mpa.period} · {formatInteger(publicEvidence.mpa.monthlyVessels)} 艘/月</span>
                    <small>data.gov.sg collection {publicEvidence.mpa.collectionId}</small>
                  </a>
                  <a href={publicEvidence.weather.url} rel="noreferrer" target="_blank">
                    <strong>Open-Meteo 海洋场</strong>
                    <span>{publicEvidence.weather.observedAt} · 1.22°N 103.75°E</span>
                    <small>风浪、海流、海温 · 模型值</small>
                  </a>
                  <a href={`https://doi.org/${publicEvidence.ais.doi}`} rel="noreferrer" target="_blank">
                    <strong>AIS 公开研究基线</strong>
                    <span>{publicEvidence.ais.period} · DOI {publicEvidence.ais.doi}</span>
                    <small>{publicEvidence.ais.liveEndpointConfigured ? '授权实时接口已配置' : '原始实时船位需授权接入'}</small>
                  </a>
                  <a href={publicEvidence.carbon.url} rel="noreferrer" target="_blank">
                    <strong>IMO 碳因子</strong>
                    <span>HFO {publicEvidence.carbon.factorsKgCo2PerKgFuel.HFO} kgCO₂/kg fuel</span>
                    <small>Fourth IMO GHG Study 2020</small>
                  </a>
                </div>
              )}
            </section>
            <button
              aria-pressed={motionEnabled}
              className={motionEnabled ? 'settings-toggle settings-toggle--active' : 'settings-toggle'}
              onClick={() => setMotionEnabled((value) => !value)}
              type="button"
            >
              <span>动态图层</span>
              <strong>{motionEnabled ? '开启' : '暂停'}</strong>
            </button>
            <button
              aria-pressed={showLegend}
              className={showLegend ? 'settings-toggle settings-toggle--active' : 'settings-toggle'}
              onClick={() => setShowLegend((value) => !value)}
              type="button"
            >
              <span>地图图例</span>
              <strong>{showLegend ? '显示' : '隐藏'}</strong>
            </button>
            <button
              aria-pressed={showCoreClosure}
              className={showCoreClosure ? 'settings-toggle settings-toggle--active' : 'settings-toggle'}
              onClick={() => setShowCoreClosure((value) => !value)}
              type="button"
            >
              <span>业务闭环卡片</span>
              <strong>{showCoreClosure ? '显示' : '隐藏'}</strong>
            </button>
            <button
              aria-pressed={routeLayerFilter !== 'all'}
              className={routeLayerFilter !== 'all' ? 'settings-toggle settings-toggle--active' : 'settings-toggle'}
              onClick={() => handleRouteLayerFilter(routeLayerFilter === 'all' ? 'main' : 'all')}
              type="button"
            >
              <span>航道筛选</span>
              <strong>{routeLayerFilter === 'all' ? '全部' : channelRoleLabelByRole[routeLayerFilter]}</strong>
            </button>
            <button
              aria-pressed={vesselCategoryFilter !== 'all'}
              className={vesselCategoryFilter !== 'all' ? 'settings-toggle settings-toggle--active' : 'settings-toggle'}
              onClick={() => handleVesselCategoryFilter(vesselCategoryFilter === 'all' ? 'container' : 'all')}
              type="button"
            >
              <span>船型筛选</span>
              <strong>{vesselCategoryFilter === 'all' ? '全部' : vesselCategoryLabelByCategory[vesselCategoryFilter]}</strong>
            </button>
          </div>
        </aside>
      )}

      {inspectorPanel && (
        <aside
          className={`context-inspector context-inspector--${inspectorPanel.tone}${contextInspectorWindow.isCollapsed ? ' context-inspector--collapsed' : ''}`}
          style={
            {
              '--inspector-color': statusColorByTone[inspectorPanel.tone],
              '--inspector-x': `${contextInspectorWindow.x}px`,
              '--inspector-y': `${contextInspectorWindow.y}px`,
              '--inspector-width': `${contextInspectorWindow.width}px`,
              '--inspector-height': `${contextInspectorWindow.height}px`,
            } as CSSProperties
          }
          aria-label="交互详情"
        >
          <header className="context-inspector__header" onMouseDown={startContextInspectorDrag}>
            <span>
              <Info size={15} />
              {inspectorPanel.title}
            </span>
            <div className="context-inspector__controls">
              <button
                aria-label="详情居中"
                onClick={() => setContextInspectorWindow(getCenteredContextInspectorWindowState())}
                type="button"
              >
                <Expand size={13} />
              </button>
              <button
                aria-label={contextInspectorWindow.isCollapsed ? '展开详情' : '收起详情'}
                onClick={() =>
                  setContextInspectorWindow((windowState) => ({
                    ...windowState,
                    isCollapsed: !windowState.isCollapsed,
                  }))
                }
                type="button"
              >
                {contextInspectorWindow.isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
              <button aria-label="关闭详情" onClick={() => setInspectorPanel(null)} type="button">
                <X size={14} />
              </button>
            </div>
          </header>
          {!contextInspectorWindow.isCollapsed && (
            <div className="context-inspector__body">
              <strong>{inspectorPanel.subtitle}</strong>
              <p>{inspectorPanel.body}</p>
              <div className="context-inspector__metrics">
                {inspectorPanel.metrics.map((metric) => (
                  <span
                    className={metric.tone ? `context-inspector__metric context-inspector__metric--${metric.tone}` : 'context-inspector__metric'}
                    key={`${inspectorPanel.id}-${metric.label}`}
                  >
                    <small>{metric.label}</small>
                    <b>
                      {metric.value}
                      {metric.unit && <em>{metric.unit}</em>}
                    </b>
                  </span>
                ))}
              </div>
              {inspectorPanel.action && (
                <button
                  className="context-inspector__action"
                  onClick={() => setActiveModule(inspectorPanel.action?.module ?? activeModule)}
                  type="button"
                >
                  {inspectorPanel.action.label}
                </button>
              )}
            </div>
          )}
          {!contextInspectorWindow.isCollapsed && (
            <button
              aria-label="调整详情窗口大小"
              className="context-inspector__resize"
              onMouseDown={startContextInspectorResize}
              type="button"
            />
          )}
        </aside>
      )}

    </main>
  );
}
