export type RlBaselineAlgorithmId =
  | 'q-learning'
  | 'sarsa'
  | 'expected-sarsa'
  | 'dyna-q'
  | 'mpc';

export interface RlBenchmarkPoint {
  episode: number;
  reward: number;
}

export interface RlOperationalMetrics {
  meanDelayHours: number;
  p95DelayHours: number;
  meanCongestionPercent: number;
  carbonIndexTotal: number;
  meanResilienceIndex: number;
  meanServiceLevelPercent: number;
  throughputRetentionPercent: number;
  finalDeferredBacklogVessels: number;
  safetyViolationRatePercent: number;
}

export interface RlBenchmarkResult {
  id: RlBaselineAlgorithmId;
  label: string;
  color: string;
  family: 'reinforcement-learning' | 'control-theory';
  curve: RlBenchmarkPoint[];
  training: {
    episodes: number;
    environmentSteps: number;
    parameterUpdates: number;
    visitedStates: number;
    elapsedMs: number;
    tuningTrials: number;
    executedEpisodes: number;
  };
  hyperparameters: {
    learningRate: number | null;
    discountGamma: number | null;
    epsilonStart: number | null;
    epsilonEnd: number | null;
    planningSteps: number;
  };
  tuning: {
    candidateCount: number;
    selectionSplit: 'validation-tuning';
    selectedScore: number;
    selectedMeanReward: number;
    selectedSafetyViolations: number;
  };
  selectionScore: number;
  evaluation: {
    meanReward: number;
    delayReductionPercent: number;
    congestionReductionPercent: number;
    carbonReductionPercent: number;
    resilienceGain: number;
    safetyViolations: number;
    modeled: RlOperationalMetrics;
    baseline: RlOperationalMetrics;
  };
}

export interface RlBenchmarkResponse {
  protocolVersion: 'rl-benchmark.v2';
  engine: 'dataset-calibrated-port-control';
  generatedAt: string;
  scenarioId: string;
  episodes: number;
  horizon: number;
  bestAlgorithmId: RlBaselineAlgorithmId;
  dataset: {
    id: string;
    label: string;
    portId: string;
    source: string;
    sourceUrl: string;
    license: string;
    fingerprint: string;
    samplingInterval: 'monthly' | 'operator-defined';
    evidenceLevel: 'public-aggregate-proxy' | 'operator-supplied';
    quality: {
      rawRecordCount: number;
      rejectedRecordCount: number;
      availablePortIds: string[];
      duplicateTimestampCount: 0;
      capacityCoveragePercent: number;
      windCoveragePercent: number;
      waveCoveragePercent: number;
      visibilityCoveragePercent: number;
      weatherCoveragePercent: number;
      safetyCoveragePercent: number;
      capacityMode: 'measured' | 'mixed' | 'empirical-proxy';
      capacityProxyCalibratedOn: 'train-only' | null;
      operationalClaimAllowed: boolean;
      validationArrivalDriftPercent: number;
      testArrivalDriftPercent: number;
    };
    recordCount: number;
    trainRecordCount: number;
    validationRecordCount: number;
    testRecordCount: number;
    trainRange: [string, string];
    validationRange: [string, string];
    validationTuningRange: [string, string];
    validationSelectionRange: [string, string];
    testRange: [string, string];
  };
  selectionSplit: 'validation';
  results: RlBenchmarkResult[];
  notes: string[];
}

export interface RlTrainingJobSnapshot {
  protocolVersion: 'rl-training-job.v1';
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  phase: 'queued' | 'loading-dataset' | 'training' | 'evaluating' | 'checkpointing' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  elapsedMs: number;
  progressPercent: number;
  currentAlgorithmId: RlBaselineAlgorithmId | null;
  completedEpisodes: number;
  totalEpisodes: number;
  environmentSteps: number;
  parameterUpdates: number;
  rewardEma: number | null;
  samplesPerSecond: number;
  message: string;
  dataset: null | {
    id: string;
    label: string;
    portId: string;
    source: string;
    license: string;
    fingerprint: string;
    samplingInterval: 'monthly' | 'operator-defined';
    evidenceLevel: 'public-aggregate-proxy' | 'operator-supplied';
    quality: RlBenchmarkResponse['dataset']['quality'];
    recordCount: number;
    trainRecordCount: number;
    validationRecordCount: number;
    testRecordCount: number;
    trainRange: [string, string];
    validationRange: [string, string];
    testRange: [string, string];
  };
  result: RlBenchmarkResponse | null;
  artifactPath: string | null;
  logs: string[];
  error: string | null;
  restoredFromCheckpoint: boolean;
}

export interface RlPolicyEvaluationTracePoint {
  step: number;
  timestamp: string;
  actionId: string;
  actionLabel: string;
  arrivals: number;
  processedVessels: number;
  divertedVessels: number;
  deferredBacklogVessels: number;
  serviceLevelPercent: number;
  throughputRetentionPercent: number;
  queueVessels: number;
  delayHours: number;
  congestionPercent: number;
  carbonIndex: number;
  resilienceIndex: number;
  reward: number;
  safetyViolation: number;
}

export interface RlPolicyEvaluationResponse {
  protocolVersion: 'rl-policy-evaluation.v1';
  jobId: string;
  algorithmId: RlBaselineAlgorithmId;
  algorithmLabel: string;
  testCaseId: 'closed-loop-replay' | 'peak-congestion-stress' | 'weather-disturbance-generalization';
  generatedAt: string;
  datasetFingerprint: string;
  split: 'test';
  metrics: RlBenchmarkResult['evaluation'];
  trace: RlPolicyEvaluationTracePoint[];
  notes: string[];
}

const authorizedHeaders = (authToken: string, json = false) => ({
  ...(json ? { 'Content-Type': 'application/json' } : {}),
  ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
});

const checkedJson = async <T>(response: Response): Promise<T> => {
  const payload = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(payload.message ?? `RL service HTTP ${response.status}`);
  return payload;
};

export const createRlTrainingJob = async (
  endpoint: string,
  request: unknown,
  authToken = '',
  signal?: AbortSignal,
) => checkedJson<RlTrainingJobSnapshot>(await fetch(endpoint, {
  method: 'POST',
  headers: authorizedHeaders(authToken, true),
  body: JSON.stringify(request),
  signal,
}));

export const fetchRlTrainingJob = async (
  jobId: string,
  authToken = '',
  signal?: AbortSignal,
) => checkedJson<RlTrainingJobSnapshot>(await fetch(`/api/rl/jobs/${encodeURIComponent(jobId)}`, {
  headers: authorizedHeaders(authToken),
  signal,
}));

export const cancelRlTrainingJob = async (jobId: string, authToken = '') =>
  checkedJson<RlTrainingJobSnapshot>(await fetch(`/api/rl/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    headers: authorizedHeaders(authToken),
  }));

export const evaluateRlTrainingJob = async (
  jobId: string,
  algorithmId: RlBaselineAlgorithmId,
  testCaseId: RlPolicyEvaluationResponse['testCaseId'],
  authToken = '',
) => checkedJson<RlPolicyEvaluationResponse>(await fetch(
  `/api/rl/jobs/${encodeURIComponent(jobId)}/evaluate`,
  {
    method: 'POST',
    headers: authorizedHeaders(authToken, true),
    body: JSON.stringify({ algorithmId, testCaseId }),
  },
));
