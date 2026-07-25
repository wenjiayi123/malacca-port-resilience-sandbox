export type StatusTone = 'ok' | 'warning' | 'danger';

export type PortRole = 'major' | 'secondary' | 'anchorage';

export type VesselCategory =
  | 'cargo'
  | 'tanker'
  | 'container'
  | 'bulk'
  | 'other';

export type ChannelRole = 'main' | 'secondary' | 'traffic-separation';

export type PortCongestionLevel = 'low' | 'medium' | 'high' | 'severe';

export type StrategyType =
  | 'slow-steaming'
  | 'off-peak-arrival'
  | 'port-diversion'
  | 'priority-berthing'
  | 'route-adjustment';

export type AiDecisionTopic =
  | 'congestion-cause'
  | 'risk-judgement'
  | 'dispatch-suggestion'
  | 'carbon-optimization';

export type EmergencyScenarioType =
  | 'accident-closure'
  | 'extreme-weather'
  | 'port-paralysis'
  | 'energy-control';

export type GodotBridgeMode = 'file-json' | 'http' | 'websocket';

export type GodotRiskEventType =
  | 'channel-closure'
  | 'extreme-weather'
  | 'collision-risk'
  | 'port-paralysis'
  | 'energy-control'
  | 'manual-event';

export type GodotValidationStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'degraded';

export type GodotRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ScreenPosition {
  x: string;
  y: string;
}

export interface GeoCoordinate {
  lat: number;
  lon: number;
}

export interface GodotRouteEndpoint {
  portId: string;
  portName: string;
  geo: GeoCoordinate;
}

export interface GodotSpeedProfile {
  initialKnots: number;
  targetKnots: number;
  minSafeKnots: number;
  maxSafeKnots: number;
}

export interface GodotRiskEvent {
  id: string;
  type: GodotRiskEventType;
  label: string;
  affectedArea: string;
  severity: StatusTone;
  startMinute: number;
  expectedDurationMinutes: number;
  recommendedAction: string;
}

export interface GodotValidationRequest {
  requestId: string;
  vesselId: string;
  vesselName: string;
  imo: string;
  category: VesselCategory;
  routeId: string;
  channelId: string;
  origin: GodotRouteEndpoint;
  destination: GodotRouteEndpoint;
  speedProfile: GodotSpeedProfile;
  headingDeg: number;
  progressPercent: number;
  riskEvents: GodotRiskEvent[];
  dispatchStrategyIds: string[];
  createdAt: string;
}

export interface GodotValidationResult {
  requestId: string;
  vesselId: string;
  status: GodotValidationStatus;
  safePass: boolean;
  estimatedTravelMinutes: number;
  riskLevel: GodotRiskLevel;
  recommendedSpeedKnots: number;
  simulatedDurationSeconds: number;
  reachedDestination: boolean;
  averageSpeedKnots: number;
  minClearanceMeters: number;
  collisionCount: number;
  groundingCount: number;
  riskEventResolvedCount: number;
  delayDeltaMinutes: number;
  carbonDeltaTons: number;
  loadedScene?: {
    routePointCount: number;
    riskZoneCount: number;
    temporaryObstacleCount: number;
  };
  summary: string;
}

export interface GodotIntegrationContract {
  protocolVersion: string;
  bridgeMode: GodotBridgeMode;
  godotProjectPath: string;
  requestFilePath: string;
  resultFilePath: string;
  request: GodotValidationRequest;
  validationResult?: GodotValidationResult;
}

export interface MetricCard {
  id: string;
  label: string;
  value: string;
  unit: string;
  detail: string;
  trendLabel: string;
  tone: StatusTone;
}

export interface NetworkOverview {
  portCount: number;
  channelCount: number;
  anchorageCount: number;
  monitoredVesselCount: number;
}

export interface VesselTypeStat {
  category: VesselCategory;
  label: string;
  count: number;
  percent: number;
}

export interface PortNode {
  id: string;
  name: string;
  englishName: string;
  country: 'Malaysia' | 'Indonesia' | 'Singapore' | 'China';
  role: PortRole;
  position: ScreenPosition;
  geo: GeoCoordinate;
  connectedChannelIds: string[];
  vesselCount: number;
  congestionPercent: number;
  berthUtilizationPercent: number;
  queueVessels: number;
  averageWaitingHours: number;
  dailyThroughputMillionTons: number;
  berthCount: number;
  anchorageCount: number;
  carbonIntensityKgPerTon: number;
  resilienceWeight: number;
  status: string;
  tone: StatusTone;
}

export interface PortCongestionSimulation {
  portId: string;
  portName: string;
  arrivingVessels: number;
  queueingVessels: number;
  berthingVessels: number;
  handlingVessels: number;
  departingVessels: number;
  expectedWaitingHours: number;
  congestionScore: number;
  congestionLevel: PortCongestionLevel;
  tone: StatusTone;
}

export interface ChannelStatus {
  id: string;
  label: string;
  role: ChannelRole;
  status: string;
  tone: StatusTone;
  congestionPercent: number;
  delayMinutes: number;
}

export interface RouteOverlay {
  id: string;
  label: string;
  role: ChannelRole;
  tone: StatusTone;
  channelId: string;
  originPortId: string;
  destinationPortId: string;
  svgPath: string;
  vesselVolume: number;
  averageSpeedKnots: number;
  delayMinutes: number;
  carbonEmissionTons: number;
  animationSeconds: number;
}

export interface VesselMarker {
  id: string;
  name: string;
  imo: string;
  category: VesselCategory;
  position: ScreenPosition;
  flowId: string;
  destinationPortId: string;
  progressPercent: number;
  speedKnots: number;
  headingDeg: number;
  assignedChannelId: string;
  carbonEmissionTonsPerHour: number;
  animationDelaySeconds: number;
}

export interface VesselDelaySimulation {
  vesselId: string;
  vesselName: string;
  routeLabel: string;
  destinationPortName: string;
  delayMinutes: number;
  congestionDelayMinutes: number;
  weatherDelayMinutes: number;
  speedDelayMinutes: number;
  riskDelayMinutes: number;
  dominantFactor: string;
  tone: StatusTone;
}

export interface VesselEmissionSimulation {
  vesselId: string;
  vesselName: string;
  vesselCategory: VesselCategory;
  routeLabel: string;
  distanceNm: number;
  speedKnots: number;
  waitingHours: number;
  fuelTons: number;
  carbonTons: number;
  carbonChangePercent: number;
  baselineCarbonTons: number;
  tone: StatusTone;
}

export interface WeatherSeaState {
  windSpeedMs: number;
  windDirection: string;
  temperatureC: number;
  visibilityKm: number;
  waveHeightM: number;
  currentSpeedKnots: number;
  waterTemperatureC: number;
  pressureHpa: number;
}

export interface RiskAlert {
  id: string;
  label: string;
  description: string;
  tone: StatusTone;
  affectedArea: string;
  estimatedImpact: string;
}

export interface CarbonSnapshot {
  todayEmission: number;
  todayUnit: string;
  changeVsYesterdayPercent: number;
  trendUnit: string;
  hourlyTrend: Array<{
    hour: string;
    value: number;
  }>;
}

export interface CongestionHeatmap {
  id: string;
  label: string;
  lowLabel: string;
  highLabel: string;
  hotspots: Array<{
    nodeId: string;
    intensity: number;
  }>;
}

export interface GreenSchedulingStrategy {
  id: string;
  type: StrategyType;
  label: string;
  target: string;
  expectedDelayReductionPercent: number;
  expectedCarbonReductionPercent: number;
  status: 'available' | 'recommended' | 'standby';
}

export interface GreenStrategyComparison {
  strategyId: string;
  type: StrategyType;
  label: string;
  target: string;
  status: GreenSchedulingStrategy['status'];
  affectedVessels: number;
  delayReductionMinutes: number;
  fuelSavingTons: number;
  carbonReductionTons: number;
  congestionReductionPercent: number;
  score: number;
  actionSummary: string;
  tone: StatusTone;
}

export interface CriticalNodePressure {
  nodeId: string;
  nodeName: string;
  pressureScore: number;
  weightedStress: number;
  recoveryHours: number;
  affectedRouteCount: number;
  tone: StatusTone;
}

export interface NetworkResilienceAssessment {
  networkResilienceIndex: number;
  congestionRecoveryAbility: number;
  averageRecoveryHours: number;
  criticalNodePressure: number;
  riskSpreadRangePercent: number;
  stressedNodeCount: number;
  affectedRouteCount: number;
  keyNodePressures: CriticalNodePressure[];
  tone: StatusTone;
}

export interface AiDecisionAdvice {
  topic: AiDecisionTopic;
  title: string;
  summary: string;
  evidence: string;
  priority: number;
  tone: StatusTone;
}

export interface AiDecisionRecommendation {
  generatedAt: string;
  confidenceScore: number;
  primaryAction: string;
  recommendations: AiDecisionAdvice[];
  tone: StatusTone;
}

export interface EmergencyContingencyPlan {
  scenario: EmergencyScenarioType;
  label: string;
  affectedArea: string;
  trigger: string;
  priorityAction: string;
  supportAction: string;
  readinessPercent: number;
  estimatedRecoveryHours: number;
  severityScore: number;
  tone: StatusTone;
}

export interface EmergencyContingencyAssessment {
  generatedAt: string;
  activeScenario: EmergencyScenarioType;
  activePlanLabel: string;
  readinessScore: number;
  plans: EmergencyContingencyPlan[];
  tone: StatusTone;
}

export interface EventLogEntry {
  id: string;
  time: string;
  message: string;
  tone: StatusTone;
}

export interface MalaccaScenario {
  id: string;
  name: string;
  profileId?: string;
  regionLabel?: string;
  regionEnglishName?: string;
  mapBackgroundAsset?: string;
  evidenceMode?: 'synthetic-scene-template' | 'public-evidence' | 'operator-live';
  mapLabels?: Array<{
    id: string;
    flag: string;
    label: string;
    englishName: string;
    position: ScreenPosition;
  }>;
  currentTime: string;
  metrics: MetricCard[];
  overview: NetworkOverview;
  vesselTypeStats: VesselTypeStat[];
  ports: PortNode[];
  channels: ChannelStatus[];
  routeOverlays: RouteOverlay[];
  vesselMarkers: VesselMarker[];
  weather: WeatherSeaState;
  riskAlerts: RiskAlert[];
  carbon: CarbonSnapshot;
  congestionHeatmap: CongestionHeatmap;
  strategies: GreenSchedulingStrategy[];
  eventLog: EventLogEntry[];
}
