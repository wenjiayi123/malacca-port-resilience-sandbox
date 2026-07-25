import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  runRlPolicyInference,
  type RlPolicyInferenceRequest,
} from './rlPolicyInference.ts';
import {
  cancelRlTrainingJob,
  createRlTrainingJob,
  evaluateRlTrainingJob,
  ensureRlTrainingJobsRestored,
  getRlServiceStatus,
  getRlTrainingCheckpoint,
  getRlTrainingJob,
  inferRlTrainingJob,
  listRlTrainingJobs,
  RlTrainingCapacityError,
} from './rlTrainingJobs.ts';
import { loadResolvedRlTrainingDataset } from './rlDatasetResolver.ts';
import { loadPortOperationalManifest } from './portOperationalManifest.ts';
import {
  RL_ACTIONS,
  RL_OBSERVATION_CONTRACT,
  type RlAlgorithmId,
  type RlPolicyEvaluationResponse,
  type RlTrainingRequest,
} from './rlTrainingEngine.ts';
import { getRlObjectivePreset } from '../shared/rlObjectivePresets.ts';
import {
  PORT_OPERATIONAL_ACTIONS,
  PORT_OPERATIONAL_FIELDS,
  PORT_OPERATIONAL_OBSERVATIONS,
} from '../shared/portOperationalContract.ts';
import {
  buildXiaoyiRlAdvisorResponse,
  parseXiaoyiRlExternalDecision,
  type XiaoyiRlAdvisorRequest,
} from './xiaoyiRlAdvisor.ts';
import { validatePortCallEvent } from './portCallContract.ts';
import { readBoundedIntegerEnvironment, validateRuntimeSecurityConfiguration } from './runtimeSecurity.ts';

const MPA_TOTAL_DATASET = 'd_d48c5a038904f6da3c603cd854b6c191';
const MPA_BREAKDOWN_DATASET = 'd_8f264219109e61fffa87ac64dd5a9a65';
const CACHE_TTL_MS = 10 * 60_000;
const MAX_BODY_BYTES = 1_048_576;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_WRITES = readBoundedIntegerEnvironment('API_RATE_LIMIT_PER_MINUTE', 120, 1, 10_000);
const configuredApiToken = validateRuntimeSecurityConfiguration(
  process.env.HOST || '127.0.0.1',
  process.env.PORT_API_TOKEN,
).token;
const ALGORITHMS = ['q-learning', 'sarsa', 'expected-sarsa', 'dyna-q', 'mpc'] as const;
const TEST_CASES = ['closed-loop-replay', 'peak-congestion-stress', 'weather-disturbance-generalization'] as const;

class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const serviceStartedAt = Date.now();
const serviceMetrics = {
  requests: 0,
  errors: 0,
  rateLimited: 0,
  trainingJobsCreated: 0,
  evaluationsRun: 0,
  inferencesRun: 0,
  portCallEventsValidated: 0,
};
const rateBuckets = new Map<string, { resetAt: number; count: number }>();

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

let publicSnapshotCache: CacheEntry | null = null;

interface DataGovRecord {
  month: string;
  number_of_vessels: string;
  gross_tonnage: string;
  vessel_type?: string;
}

interface DataGovResponse {
  success: boolean;
  result: { records: DataGovRecord[] };
}

interface WeatherResponse {
  current: {
    wind_speed_10m: number;
    wind_direction_10m: number;
    temperature_2m: number;
    visibility: number;
    surface_pressure: number;
  };
}

interface MarineResponse {
  current: {
    time: string;
    wave_height: number;
    ocean_current_velocity: number;
    sea_surface_temperature: number;
  };
}

const jsonResponse = (response: ServerResponse, value: unknown, status = 200) => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', status === 200 ? 'no-store' : 'no-cache');
  response.end(JSON.stringify(value));
};

const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const enforceAuthorization = (request: IncomingMessage, pathname: string) => {
  const configuredToken = configuredApiToken;
  if (!configuredToken || !pathname.startsWith('/api/')) return;
  const publicRoute = pathname === '/healthz' || pathname === '/readyz' ||
    pathname === '/api/public-data/health' || pathname === '/api/public-data/snapshot' ||
    pathname === '/api/rl/health' || pathname === '/api/rl/contracts/terminal-operations' ||
    pathname === '/api/openapi.json';
  if (publicRoute) return;
  const authorization = request.headers.authorization ?? '';
  if (!authorization.startsWith('Bearer ') || !safeEqual(authorization.slice(7), configuredToken)) {
    throw new HttpError(401, '需要有效的 Bearer 访问令牌');
  }
};

const enforceRateLimit = (request: IncomingMessage, response: ServerResponse) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method ?? '')) return;
  const key = request.socket.remoteAddress ?? 'unknown';
  const now = Date.now();
  const current = rateBuckets.get(key);
  const bucket = !current || current.resetAt <= now ? { resetAt: now + RATE_LIMIT_WINDOW_MS, count: 0 } : current;
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (rateBuckets.size > 10_000) {
    for (const [address, candidate] of rateBuckets) if (candidate.resetAt <= now) rateBuckets.delete(address);
  }
  response.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_WRITES));
  response.setHeader('X-RateLimit-Remaining', String(Math.max(0, RATE_LIMIT_WRITES - bucket.count)));
  response.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
  if (bucket.count > RATE_LIMIT_WRITES) {
    serviceMetrics.rateLimited += 1;
    response.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
    throw new HttpError(429, '请求过于频繁，请稍后重试');
  }
};

const finiteNumber = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
  optional = true,
) => {
  if (value === undefined && optional) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new HttpError(422, `${path} 必须是 ${minimum} 到 ${maximum} 的有限数值`);
  }
};

const validateTrainingRequest = (value: unknown): RlTrainingRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, '训练请求必须是 JSON 对象');
  const request = value as RlTrainingRequest;
  if (request.protocolVersion && request.protocolVersion !== 'rl-training-job.v1') {
    throw new HttpError(422, 'protocolVersion 必须是 rl-training-job.v1');
  }
  if (request.algorithmId && !ALGORITHMS.includes(request.algorithmId)) throw new HttpError(422, '不支持的 algorithmId');
  if (request.objectiveId && !getRlObjectivePreset(request.objectiveId).supportedByAggregateEnvironment) {
    throw new HttpError(
      422,
      `目标 ${request.objectiveId} 需要尚未进入控制状态的直接业务量；当前投影环境拒绝近似替代`,
    );
  }
  const parameters = request.trainingParameters ?? {};
  finiteNumber(parameters.maxEpisodes, 'trainingParameters.maxEpisodes', 120, 5_000);
  if (parameters.maxEpisodes !== undefined && !Number.isInteger(parameters.maxEpisodes)) throw new HttpError(422, 'maxEpisodes 必须是整数');
  finiteNumber(parameters.seed, 'trainingParameters.seed', 0, 2_147_483_647);
  if (parameters.seed !== undefined && !Number.isInteger(parameters.seed)) throw new HttpError(422, 'seed 必须是整数');
  finiteNumber(parameters.learningRate, 'trainingParameters.learningRate', 0.00001, 1);
  finiteNumber(parameters.discountGamma, 'trainingParameters.discountGamma', 0, 1);
  finiteNumber(parameters.wallClockHours, 'trainingParameters.wallClockHours', 0.01, 24);
  const weights = request.rewardWeights ?? {};
  for (const [key, weight] of Object.entries(weights)) finiteNumber(weight, `rewardWeights.${key}`, 0, 1);
  return request;
};

const validateJobId = (value: string) => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new HttpError(400, '无效的 RL jobId 编码');
  }
  if (!/^rl-[a-zA-Z0-9-]{8,80}$/.test(decoded)) throw new HttpError(400, '无效的 RL jobId');
  return decoded;
};

const fetchJson = async <T>(url: string, headers?: Record<string, string>): Promise<T> => {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
  return (await response.json()) as T;
};

interface AuthorizedAisRecord {
  id?: string;
  mmsi?: string | number;
  imo?: string | number;
  name?: string;
  shipName?: string;
  latitude?: number;
  lat?: number;
  longitude?: number;
  lon?: number;
  sog?: number;
  speedKnots?: number;
  cog?: number;
  heading?: number;
  shipType?: string;
  category?: string;
}

const normalizeAisCategory = (value = '') => {
  const type = value.toLowerCase();
  if (type.includes('tank')) return 'tanker';
  if (type.includes('container')) return 'container';
  if (type.includes('bulk')) return 'bulk';
  if (type.includes('cargo') || type.includes('freight')) return 'cargo';
  return 'other';
};

const loadAuthorizedAis = async () => {
  const endpoint = process.env.AIS_REST_ENDPOINT;
  if (!endpoint) return [];
  const parsedEndpoint = new URL(endpoint);
  if (!['http:', 'https:'].includes(parsedEndpoint.protocol)) throw new Error('AIS_REST_ENDPOINT 只允许 http/https');
  const payload = await fetchJson<AuthorizedAisRecord[] | { vessels?: AuthorizedAisRecord[] }>(
    parsedEndpoint.toString(),
    process.env.AIS_BEARER_TOKEN
      ? { Authorization: `Bearer ${process.env.AIS_BEARER_TOKEN}` }
      : undefined,
  );
  const records = Array.isArray(payload) ? payload : payload.vessels ?? [];
  return records.slice(0, 250).flatMap((record, index) => {
    const lat = Number(record.latitude ?? record.lat);
    const lon = Number(record.longitude ?? record.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    const id = String(record.id ?? record.mmsi ?? `authorized-ais-${index + 1}`);
    const speedKnots = Number(record.sog ?? record.speedKnots ?? 10);
    const headingDeg = Number(record.cog ?? record.heading ?? 120);
    return [{
      id: `ais-${id}`,
      name: record.name ?? record.shipName ?? `AIS ${record.mmsi ?? index + 1}`,
      imo: record.imo ? `IMO ${record.imo}` : `MMSI ${record.mmsi ?? id}`,
      category: normalizeAisCategory(record.shipType ?? record.category),
      position: {
        x: `${Math.min(94, Math.max(6, 8 + ((lon - 99.5) / 5.2) * 84)).toFixed(2)}%`,
        y: `${Math.min(94, Math.max(6, 92 - ((lat - 0.5) / 5.8) * 84)).toFixed(2)}%`,
      },
      flowId: lon >= 102.5 ? 'traffic-separation-singapore' : 'main-route-north',
      destinationPortId: lon >= 102.5 ? 'singapore' : 'port-klang',
      progressPercent: Math.round(Math.min(100, Math.max(0, ((lon - 99.5) / 5.2) * 100))),
      speedKnots: Number.isFinite(speedKnots) ? speedKnots : 10,
      headingDeg: Number.isFinite(headingDeg) ? headingDeg : 120,
      assignedChannelId: lon >= 102.5 ? 'singapore-east-west' : 'malacca-main',
      carbonEmissionTonsPerHour: 8.5,
      animationDelaySeconds: -(index % 12),
    }];
  });
};

const degreesToCompass = (degrees: number) => {
  const labels = ['北风', '东北风', '东风', '东南风', '南风', '西南风', '西风', '西北风'];
  return labels[Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
};

const buildPublicSnapshot = async () => {
  if (publicSnapshotCache && publicSnapshotCache.expiresAt > Date.now()) return publicSnapshotCache.value;
  const dataGovUrl = (dataset: string, limit: number) =>
    `https://data.gov.sg/api/action/datastore_search?resource_id=${dataset}&limit=${limit}&sort=month%20desc`;
  const [total, breakdown, weather, marine, authorizedAisVessels] = await Promise.all([
    fetchJson<DataGovResponse>(dataGovUrl(MPA_TOTAL_DATASET, 14)),
    fetchJson<DataGovResponse>(dataGovUrl(MPA_BREAKDOWN_DATASET, 24)),
    fetchJson<WeatherResponse>(
      'https://api.open-meteo.com/v1/forecast?latitude=1.22&longitude=103.75&current=temperature_2m,wind_speed_10m,wind_direction_10m,visibility,surface_pressure&wind_speed_unit=ms&timezone=Asia%2FSingapore',
    ),
    fetchJson<MarineResponse>(
      'https://marine-api.open-meteo.com/v1/marine?latitude=1.22&longitude=103.75&current=wave_height,wave_direction,wave_period,ocean_current_velocity,ocean_current_direction,sea_surface_temperature&timezone=Asia%2FSingapore',
    ),
    loadAuthorizedAis(),
  ]);
  const latest = total.result.records[0];
  const latestMonth = latest.month;
  const latestBreakdown = breakdown.result.records.filter((record) => record.month === latestMonth);
  const monthlyVessels = Number(latest.number_of_vessels);
  const dailyAverage = Math.round(monthlyVessels / 30.44);
  const byType = new Map<string, number>(
    latestBreakdown.map((record) => [record.vessel_type ?? 'Unknown', Number(record.number_of_vessels)]),
  );
  const type = (names: string[]) => names.reduce((sum, name) => sum + (byType.get(name) ?? 0), 0);
  const stats = [
    { category: 'cargo', label: '货船', count: type(['Freighter', 'Barges']), percent: 0 },
    { category: 'tanker', label: '油轮', count: type(['Tanker']), percent: 0 },
    { category: 'container', label: '集装箱船', count: type(['Container']), percent: 0 },
    { category: 'bulk', label: '散货船', count: type(['Bulk Carrier']), percent: 0 },
    { category: 'other', label: '其他', count: type(['Passenger', 'Tug', 'Miscellaneous']), percent: 0 },
  ].map((item) => ({ ...item, percent: Number((item.count / monthlyVessels * 100).toFixed(1)) }));
  const observedAt = `${marine.current.time}:00+08:00`;
  const snapshot = {
    protocolVersion: 'port-digital-twin.snapshot.v1',
    observedAt,
    source: 'MPA data.gov.sg + Open-Meteo Marine + AIS研究实证基线',
    scenario: {
      id: 'malacca-public-evidence-operational-scenario',
      name: '马六甲海峡公开数据实证推演场景',
      currentTime: marine.current.time.replace('T', ' ') + ':00',
      overview: { portCount: 32, channelCount: 6, anchorageCount: 48, monitoredVesselCount: monthlyVessels },
      vesselTypeStats: stats,
      metrics: [
        {
          id: 'active-vessels', label: '公开统计日均到港', value: dailyAverage.toLocaleString('en-US'), unit: '艘/日',
          detail: `MPA ${latestMonth} 月度折算`, trendLabel: `月度原始值 ${monthlyVessels.toLocaleString('en-US')} 艘`, tone: 'ok',
        },
        {
          id: 'transit-vessels', label: '最新月到港船舶', value: monthlyVessels.toLocaleString('en-US'), unit: '艘/月',
          detail: 'MPA >75 GT 官方统计', trendLabel: `数据期 ${latestMonth}`, tone: 'ok',
        },
        {
          id: 'cargo-throughput', label: '到港总吨位', value: Number(latest.gross_tonnage).toLocaleString('en-US'), unit: '千GT',
          detail: 'MPA 月度原始字段', trendLabel: '最新月份为初步统计', tone: 'warning',
        },
        {
          id: 'carbon-emission', label: '碳排放', value: '18.7', unit: '万吨 CO₂',
          detail: 'IMO燃料因子模型估算', trendLabel: '模型值·非实测', tone: 'warning',
        },
        {
          id: 'resilience-index', label: '网络韧性指数', value: '87.6', unit: 'A',
          detail: '公开数据驱动模型评分', trendLabel: '事件注入后动态更新', tone: 'ok',
        },
      ],
    },
    telemetry: {
      overview: { monitoredVesselCount: monthlyVessels },
      ...(authorizedAisVessels.length ? { vessels: authorizedAisVessels } : {}),
      weather: {
        windSpeedMs: Number(weather.current.wind_speed_10m.toFixed(1)),
        windDirection: degreesToCompass(weather.current.wind_direction_10m),
        temperatureC: Number(weather.current.temperature_2m.toFixed(1)),
        visibilityKm: Number((weather.current.visibility / 1000).toFixed(1)),
        waveHeightM: Number(marine.current.wave_height.toFixed(2)),
        currentSpeedKnots: Number((marine.current.ocean_current_velocity / 1.852).toFixed(2)),
        waterTemperatureC: Number(marine.current.sea_surface_temperature.toFixed(1)),
        pressureHpa: Math.round(weather.current.surface_pressure),
      },
    },
    evidence: {
      mode: 'public-evidence',
      mpa: {
        agency: 'Maritime and Port Authority of Singapore', dataset: 'Vessel Arrivals (>75 GT), Monthly',
        collectionId: '394', datasetIds: [MPA_TOTAL_DATASET, MPA_BREAKDOWN_DATASET], period: latestMonth,
        monthlyVessels, grossTonnage: Number(latest.gross_tonnage), retrievedAt: new Date().toISOString(),
        url: 'https://data.gov.sg/collections/394/view',
      },
      weather: {
        provider: 'Open-Meteo', modelType: 'weather forecast + marine model current field', observedAt,
        coordinate: { lat: 1.22, lon: 103.75 }, url: 'https://open-meteo.com/en/docs/marine-weather-api',
        navigationDisclaimer: '海洋模型值仅用于推演，不替代航海通告和船舶导航设备。',
      },
      ais: {
        mode: process.env.AIS_REST_ENDPOINT ? 'authorized-live-adapter-configured' : 'public-research-baseline',
        source: 'Enda et al. (2025), AIS Data-Based Maritime Statistics Analysis in the Strait of Malacca',
        period: '2025-02/2025-06',
        facts: { cargoSharePercent: 54.49, tankerSharePercent: 24.02, underwaySharePercent: 84.88, averageDensityVesselsPerKm2Month: 1.36 },
        doi: '10.2991/978-94-6463-926-1_92',
        liveEndpointConfigured: Boolean(process.env.AIS_REST_ENDPOINT),
        recordsMapped: authorizedAisVessels.length,
        notice: process.env.AIS_REST_ENDPOINT
          ? '已配置授权 AIS REST 接口，网关可继续扩展船位字段映射。'
          : '公开模式不伪造实时船位；地图代表船为场景映射，实时船位需配置授权 AIS_REST_ENDPOINT。',
      },
      carbon: {
        source: 'Fourth IMO GHG Study 2020', method: 'fuel consumption × fuel-specific CO2 emission factor',
        factorsKgCo2PerKgFuel: { HFO: 3.114, MDO: 3.206, LNG: 2.75 },
        url: 'https://www.imo.org/en/ourwork/environment/pages/fourth-imo-greenhouse-gas-study-2020.aspx',
      },
    },
  };
  publicSnapshotCache = { value: snapshot, expiresAt: Date.now() + CACHE_TTL_MS };
  return snapshot;
};

const readRequestBody = async (request: IncomingMessage) => {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, '请求体超过 1 MiB 上限');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const readJsonBody = async <T>(request: IncomingMessage): Promise<T> => {
  const contentType = request.headers['content-type'] ?? '';
  if (contentType && !contentType.toLowerCase().includes('application/json')) {
    throw new HttpError(415, 'Content-Type 必须是 application/json');
  }
  try {
    return JSON.parse((await readRequestBody(request)) || '{}') as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, '请求体不是有效 JSON');
  }
};

const consultXiaoyiAi = async (payload: XiaoyiRlAdvisorRequest) => {
  const endpoint = process.env.XIAOYI_AI_ENDPOINT ?? 'http://127.0.0.1:8010';
  try {
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: `你是港航控制算法训练顾问。当前优化目标是“${payload.objectiveLabel ?? payload.objectiveId ?? '均衡韧性'}”，峰值拥堵${payload.scenario?.peakCongestionPercent ?? 0}%，峰值延误${payload.scenario?.peakDelayMinutes ?? 0}分钟。只返回一个JSON对象，不要Markdown。字段为 algorithmId（q-learning/sarsa/expected-sarsa/dyna-q/mpc）、baselineId（q-learning/sarsa/expected-sarsa/dyna-q/mpc）、settingId、policyTestCaseId、confidencePercent、operatorSummary、reasons字符串数组、parameters数值对象。参数只使用 learningRate、discountGamma、maxEpisodes、wallClockHours、seed、rewardDelay、rewardCongestion、rewardCarbon、rewardSafety、rewardResilience。四种RL与一个MPC控制基线共享训练切分；不虚构深度网络指标，不执行生产下发。`,
        mode: 'expert',
        top_k: 5,
        strict_evidence: false,
      }),
      signal: AbortSignal.timeout(1_200),
    });
    if (!response.ok) throw new Error(`Xiaoyi HTTP ${response.status}`);
    const result = await response.json() as { answer?: string };
    return {
      connected: true,
      answer: result.answer,
      decision: parseXiaoyiRlExternalDecision(result.answer),
    };
  } catch {
    return { connected: false };
  }
};

export const createPublicEvidenceMiddleware = () => async (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const requestIdHeader = request.headers['x-request-id'];
  const requestId = typeof requestIdHeader === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(requestIdHeader)
    ? requestIdHeader
    : randomUUID();
  response.setHeader('X-Request-Id', requestId);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  serviceMetrics.requests += 1;
  try {
    enforceAuthorization(request, url.pathname);
    enforceRateLimit(request, response);
    if (url.pathname.startsWith('/api/rl')) await ensureRlTrainingJobsRestored();
    if (request.method === 'GET' && url.pathname === '/healthz') {
      jsonResponse(response, { status: 'ok', service: 'malacca-port-resilience-sandbox', requestId });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/readyz') {
      const dataset = await loadResolvedRlTrainingDataset();
      await ensureRlTrainingJobsRestored();
      jsonResponse(response, { status: 'ready', datasetFingerprint: dataset.fingerprint, portId: dataset.portId, requestId });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/openapi.json') {
      jsonResponse(response, {
        openapi: '3.1.0',
        info: { title: 'Malacca Port Resilience Sandbox API', version: '1.0.0' },
        servers: [{ url: '/' }],
        paths: {
          '/healthz': { get: { summary: '存活探针', responses: { '200': { description: '服务进程存活' } } } },
          '/readyz': { get: { summary: '数据集与检查点就绪探针', responses: { '200': { description: '服务可接收请求' } } } },
          '/api/rl/jobs': {
            get: { summary: '列出训练任务', security: [{ bearerAuth: [] }], responses: { '200': { description: '任务列表' } } },
            post: {
              summary: '创建异步五基线训练任务', security: [{ bearerAuth: [] }],
              requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
              responses: { '202': { description: '任务已排队' }, '422': { description: '参数校验失败' }, '503': { description: '队列已满' } },
            },
          },
          '/api/rl/jobs/{jobId}': {
            parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }],
            get: { summary: '读取训练进度', security: [{ bearerAuth: [] }], responses: { '200': { description: '任务快照' }, '404': { description: '任务不存在' } } },
            delete: { summary: '取消训练任务', security: [{ bearerAuth: [] }], responses: { '200': { description: '取消请求已记录' }, '404': { description: '任务不存在' } } },
          },
          '/api/rl/jobs/{jobId}/evaluate': {
            parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }],
            post: { summary: '在最终测试段评估并返回回放轨迹', security: [{ bearerAuth: [] }], responses: { '200': { description: '最终测试指标和 trace' }, '409': { description: '检查点未就绪' } } },
          },
          '/api/rl/jobs/{jobId}/checkpoint': {
            parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }],
            get: { summary: '下载带 SHA-256 完整性信息的检查点', security: [{ bearerAuth: [] }], responses: { '200': { description: '检查点 JSON' }, '404': { description: '检查点不存在' } } },
          },
          '/api/rl/inference': { post: { summary: '使用已完成检查点执行策略推理', security: [{ bearerAuth: [] }], responses: { '200': { description: '策略决策' }, '409': { description: '检查点未就绪' } } } },
          '/api/rl/contracts/terminal-operations': {
            get: {
              summary: '读取真实码头数据、观测、动作、目标与门禁状态',
              responses: { '200': { description: 'terminal-operations.v2 合同和当前清单就绪度' } },
            },
          },
          '/api/port-calls/validate': { post: { summary: '校验并规范化 port-call-event.v1 事件', security: [{ bearerAuth: [] }], responses: { '200': { description: '规范化事件' }, '422': { description: '事件合同校验失败' } } } },
        },
        components: {
          securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
        },
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/public-data/health') {
      jsonResponse(response, { status: 'ok', service: 'public-evidence-gateway', cached: Boolean(publicSnapshotCache) });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/public-data/snapshot') {
      jsonResponse(response, await buildPublicSnapshot());
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/rl/health') {
      jsonResponse(response, {
        status: 'ok', service: 'malacca-reference-rl', protocolVersion: 'rl-training-job.v1',
        engine: 'dataset-calibrated-port-control',
        algorithms: ['q-learning', 'sarsa', 'expected-sarsa', 'dyna-q', 'mpc'],
        trainingRendering: false,
        evaluationRendering: 'trace-driven',
        ...getRlServiceStatus(),
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/observability/metrics') {
      jsonResponse(response, {
        protocolVersion: 'malacca-service-metrics.v1',
        generatedAt: new Date().toISOString(),
        uptimeSeconds: Math.floor((Date.now() - serviceStartedAt) / 1_000),
        cache: { publicSnapshot: Boolean(publicSnapshotCache), ttlMs: CACHE_TTL_MS },
        rl: getRlServiceStatus(),
        counters: { ...serviceMetrics },
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/rl/datasets') {
      const dataset = await loadResolvedRlTrainingDataset();
      jsonResponse(response, {
        protocolVersion: 'port-training-dataset.v1',
        datasets: [{
          id: dataset.id,
          label: dataset.label,
          source: dataset.source,
          sourceUrl: dataset.sourceUrl,
          license: dataset.license,
          fingerprint: dataset.fingerprint,
          quality: dataset.quality,
          portId: dataset.portId,
          recordCount: dataset.records.length,
          trainRecordCount: dataset.trainRecords.length,
          validationRecordCount: dataset.validationRecords.length,
          testRecordCount: dataset.testRecords.length,
          split: dataset.split,
        }],
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/rl/contracts/terminal-operations') {
      const status = await loadPortOperationalManifest();
      jsonResponse(response, {
        protocolVersion: 'terminal-operations.v2',
        algorithms: ALGORITHMS.map((id) => ({
          id,
          family: id === 'mpc' ? 'control-theory' : 'reinforcement-learning',
          usesProjectedControlContract: true,
        })),
        fields: PORT_OPERATIONAL_FIELDS,
        rawOperationalObservations: PORT_OPERATIONAL_OBSERVATIONS,
        projectedAlgorithmObservations: RL_OBSERVATION_CONTRACT,
        projectedAlgorithmActions: RL_ACTIONS.map(({ id, label, detail }) => ({ id, label, detail })),
        operationalActionEvidence: PORT_OPERATIONAL_ACTIONS,
        manifest: status,
        projectionBoundary: [
          'terminal-operations.v2 fields are retained in the adapted dataset fingerprint and readiness audit',
          'berth, yard, crane, gate, channel, tide, pilot and tug constraints must be consolidated by the operator into effective_service_capacity',
          'the current five methods consume the six-dimensional audited aggregate control state; objectives requiring direct fairness, energy-cost or multi-port terms remain blocked',
        ],
        executionBoundary: status.readiness.trainingReady
          ? 'operator mapping ready for the shared aggregate control projection; production actions still require human approval and site authorization'
          : 'fail-closed; aggregate-v1 remains available for offline research only',
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/rl/jobs') {
      jsonResponse(response, { protocolVersion: 'rl-training-job-list.v1', jobs: listRlTrainingJobs() });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/rl/jobs') {
      const body = validateTrainingRequest(await readJsonBody<unknown>(request));
      try {
        const job = createRlTrainingJob(body);
        serviceMetrics.trainingJobsCreated += 1;
        jsonResponse(response, job, 202);
      } catch (error) {
        if (error instanceof RlTrainingCapacityError) throw new HttpError(503, error.message);
        throw error;
      }
      return;
    }
    const rlJobMatch = url.pathname.match(/^\/api\/rl\/jobs\/([^/]+)$/);
    if (request.method === 'GET' && rlJobMatch) {
      const job = getRlTrainingJob(validateJobId(rlJobMatch[1]));
      jsonResponse(response, job ?? { status: 'error', message: 'RL training job not found' }, job ? 200 : 404);
      return;
    }
    if (request.method === 'DELETE' && rlJobMatch) {
      const job = cancelRlTrainingJob(validateJobId(rlJobMatch[1]));
      jsonResponse(response, job ?? { status: 'error', message: 'RL training job not found' }, job ? 200 : 404);
      return;
    }
    const rlEvaluationMatch = url.pathname.match(/^\/api\/rl\/jobs\/([^/]+)\/evaluate$/);
    if (request.method === 'POST' && rlEvaluationMatch) {
      const body = await readJsonBody<{
        algorithmId?: RlAlgorithmId;
        testCaseId?: RlPolicyEvaluationResponse['testCaseId'];
      }>(request);
      const jobId = validateJobId(rlEvaluationMatch[1]);
      const job = getRlTrainingJob(jobId);
      if (!job) throw new HttpError(404, 'RL training job not found');
      if (job.status !== 'completed') throw new HttpError(409, 'RL 训练任务尚未完成，不能执行最终测试');
      const algorithmId = body.algorithmId ?? job?.result?.bestAlgorithmId;
      if (!algorithmId) throw new HttpError(422, '缺少可评估的 algorithmId');
      if (!ALGORITHMS.includes(algorithmId)) throw new HttpError(422, '不支持的 algorithmId');
      if (body.testCaseId && !TEST_CASES.includes(body.testCaseId)) throw new HttpError(422, '不支持的 testCaseId');
      serviceMetrics.evaluationsRun += 1;
      jsonResponse(response, evaluateRlTrainingJob(
        jobId,
        algorithmId,
        body.testCaseId ?? 'closed-loop-replay',
      ));
      return;
    }
    const rlCheckpointMatch = url.pathname.match(/^\/api\/rl\/jobs\/([^/]+)\/checkpoint$/);
    if (request.method === 'GET' && rlCheckpointMatch) {
      const jobId = validateJobId(rlCheckpointMatch[1]);
      const checkpoint = getRlTrainingCheckpoint(jobId);
      if (!checkpoint) {
        jsonResponse(response, { status: 'error', message: 'RL checkpoint not found' }, 404);
        return;
      }
      response.setHeader('Content-Disposition', `attachment; filename="${jobId}.json"`);
      jsonResponse(response, checkpoint);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/rl/inference') {
      const body = await readJsonBody<RlPolicyInferenceRequest>(request);
      if (!body.jobId) {
        jsonResponse(response, {
          status: 'error',
          message: '真实策略推理必须提供已完成训练任务的 jobId。',
        }, 409);
        return;
      }
      validateJobId(body.jobId);
      if (body.algorithmId && !ALGORITHMS.includes(body.algorithmId)) throw new HttpError(422, '不支持的 algorithmId');
      const job = getRlTrainingJob(body.jobId);
      if (!job) throw new HttpError(404, 'RL training job not found');
      if (job.status !== 'completed') throw new HttpError(409, 'RL 检查点尚未就绪');
      const state = body.state ?? {};
      finiteNumber(state.congestionPercent, 'state.congestionPercent', 0, 200, false);
      finiteNumber(state.delayMinutes, 'state.delayMinutes', 0, 10_080, false);
      finiteNumber(state.carbonTons, 'state.carbonTons', 0, 1_000_000_000, false);
      finiteNumber(state.windSpeedMs, 'state.windSpeedMs', 0, 100, false);
      finiteNumber(state.waveHeightM, 'state.waveHeightM', 0, 30, false);
      finiteNumber(state.visibilityKm, 'state.visibilityKm', 0, 100, false);
      const trained = inferRlTrainingJob(body.jobId, body.algorithmId, {
        congestionPercent: state.congestionPercent ?? 0,
        delayMinutes: state.delayMinutes ?? 0,
        carbonTons: state.carbonTons ?? 0,
        windSpeedMs: state.windSpeedMs ?? 0,
        waveHeightM: state.waveHeightM ?? 0,
        visibilityKm: state.visibilityKm ?? 20,
      });
      serviceMetrics.inferencesRun += 1;
      jsonResponse(response, runRlPolicyInference(body, trained));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/port-calls/validate') {
      const validation = validatePortCallEvent(await readJsonBody<unknown>(request));
      if (!validation.valid) throw new HttpError(422, validation.errors.join('; '));
      serviceMetrics.portCallEventsValidated += 1;
      jsonResponse(response, {
        protocolVersion: 'port-call-validation.v1',
        valid: true,
        event: validation.event,
        compatibility: {
          contract: 'project-owned normalization contract',
          dcsa: 'field-aligned subset; not a DCSA conformance claim',
          ialaS211: 'event-exchange mapping point; not an IALA conformance claim',
          imoMaritimeSingleWindow: 'adapter boundary only; not an IMO MSW implementation',
        },
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/xiaoyi/health') {
      const external = await consultXiaoyiAi({ objectiveId: 'balanced-resilience' });
      jsonResponse(response, {
        status: 'ok',
        service: 'xiaoyi-rl-advisor',
        externalConnected: external.connected,
        externalEndpoint: process.env.XIAOYI_AI_ENDPOINT ?? 'http://127.0.0.1:8010',
        fallback: 'embedded-xiaoyi-advisor',
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/xiaoyi/rl-advisor') {
      const body = await readJsonBody<XiaoyiRlAdvisorRequest>(request);
      const external = await consultXiaoyiAi(body);
      jsonResponse(response, buildXiaoyiRlAdvisorResponse(body, external));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/rl/benchmark') {
      jsonResponse(response, {
        status: 'error',
        message: '同步 benchmark 接口已停用；请使用 POST /api/rl/jobs 并轮询任务状态。',
      }, 410);
      return;
    }
    next();
  } catch (error) {
    serviceMetrics.errors += 1;
    const status = error instanceof HttpError ? error.statusCode : 502;
    jsonResponse(response, {
      status: 'error',
      message: error instanceof Error ? error.message : 'unknown error',
      requestId,
    }, status);
  }
};

export const publicEvidencePlugin = (): Plugin => ({
  name: 'malacca-public-evidence-and-rl-api',
  configureServer(server) {
    server.middlewares.use(createPublicEvidenceMiddleware());
  },
  configurePreviewServer(server) {
    server.middlewares.use(createPublicEvidenceMiddleware());
  },
});
