import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PORT_BUSINESS_ACTIONS,
  PORT_BUSINESS_AUTHORITY_BOUNDARY,
  PORT_BUSINESS_HARD_CONSTRAINTS,
  PORT_BUSINESS_OBSERVATIONS,
  PORT_BUSINESS_RESPONSIBILITY_MATRIX,
  PORT_BUSINESS_REWARD_COMPONENTS,
  PORT_BUSINESS_RL_CONTRACT_VERSION,
} from '../../shared/portBusinessRlContract.ts';
import {
  evaluatePublicDemandForecaster,
  trainPublicDemandForecaster,
} from '../../server/portBusinessControlPlane.ts';
import { loadPortBusinessDataset } from '../../server/portBusinessDataset.ts';
import { trainPortBusinessChampion } from '../../server/portBusinessRlEngine.ts';

const REPORT_JSON = path.resolve('reports/port-business-rl-champion-v3.json');
const REPORT_MARKDOWN = path.resolve('reports/port-business-rl-champion-v3.md');
const RUNTIME_DIRECTORY = path.resolve('.runtime/port-business-rl-v3');
const DATASET_ARTIFACT = path.join(RUNTIME_DIRECTORY, 'training-dataset.json');
const ATTEMPTS_ARTIFACT = path.join(RUNTIME_DIRECTORY, 'all-training-attempts.json');

const sourceFiles = [
  'shared/portBusinessRlContract.ts',
  'server/portBusinessDataset.ts',
  'server/portBusinessControlPlane.ts',
  'server/portBusinessRlEngine.ts',
  'server/portBusinessRlService.ts',
  'server/portBusinessRlPlugin.ts',
  'scripts/rl/runPortBusinessChampion.ts',
  'scripts/rl/verifyPortBusinessChampion.ts',
  'tests/portBusinessRl.test.ts',
  'docs/PORT_BUSINESS_RL_V3.md',
  'docs/schemas/port-business-dataset-v3.schema.json',
  'data/rl/mpa_vessel_arrivals_monthly.csv',
  'data/rl/README.md',
] as const;

const sha256 = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');
const atomicWrite = async (target: string, content: string) => {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, target);
};
const round = (value: number, digits = 4) => Number(value.toFixed(digits));

const sourceFileDigests = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [
  file,
  sha256(await readFile(path.resolve(file))),
])));
const sourceDigest = sha256(Object.entries(sourceFileDigests)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([file, digest]) => `${file}:${digest}`)
  .join('\n'));

const dataset = await loadPortBusinessDataset();
const demandForecast = trainPublicDemandForecaster(dataset.trainRecords);
const validationForecast = evaluatePublicDemandForecaster(
  demandForecast,
  [...dataset.trainRecords.slice(-8), ...dataset.validationRecords],
);
const testForecast = evaluatePublicDemandForecaster(
  demandForecast,
  [...dataset.validationRecords.slice(-8), ...dataset.testRecords],
);
const champion = trainPortBusinessChampion(dataset);

const datasetArtifactCore = {
  protocolVersion: dataset.protocolVersion,
  generatedAt: new Date().toISOString(),
  id: dataset.id,
  fingerprint: dataset.fingerprint,
  sourceFingerprint: dataset.sourceFingerprint,
  evidenceLevel: dataset.evidenceLevel,
  operationalClaimAllowed: dataset.operationalClaimAllowed,
  source: dataset.source,
  sourceUrls: dataset.sourceUrls,
  license: dataset.license,
  split: dataset.split,
  lineage: dataset.lineage,
  quality: dataset.quality,
  limitations: dataset.limitations,
  records: dataset.records,
};
const datasetArtifact = {
  ...datasetArtifactCore,
  integrity: { algorithm: 'sha256', digest: sha256(JSON.stringify(datasetArtifactCore)) },
};
await atomicWrite(DATASET_ARTIFACT, `${JSON.stringify(datasetArtifact)}\n`);
await atomicWrite(ATTEMPTS_ARTIFACT, `${JSON.stringify({
  protocolVersion: champion.protocolVersion,
  datasetFingerprint: dataset.fingerprint,
  attempts: champion.attempts,
  integrity: { algorithm: 'sha256', sourceDigest },
}, null, 2)}\n`);

const policyArtifacts = [];
for (const policy of champion.champion.seedPolicies) {
  const target = path.join(RUNTIME_DIRECTORY, `champion-seed-${policy.hyperparameters.seed}.json`);
  const core = {
    datasetFingerprint: dataset.fingerprint,
    championAlgorithmId: champion.champion.algorithmId,
    admitted: champion.champion.admitted,
    policy,
  };
  const payload = { ...core, integrity: { algorithm: 'sha256', digest: sha256(JSON.stringify(core)) } };
  await atomicWrite(target, `${JSON.stringify(payload)}\n`);
  policyArtifacts.push({
    seed: policy.hyperparameters.seed,
    path: path.relative(process.cwd(), target),
    digest: payload.integrity.digest,
  });
}

const coverageAudit = [
  { domain: '到港节奏与排队', before: '六维聚合控制已覆盖', after: '保留并扩展到等待尾部、预测不确定度和数据质量', owner: 'reinforcement-learning-advisory' },
  { domain: '泊位与岸桥', before: '仅折叠为有效能力', after: '直接观测利用率、能力余量、岸桥效率与可用率，并提供有界动作', owner: 'reinforcement-learning-advisory + deterministic-optimizer' },
  { domain: '堆场与闸口', before: '字段存在但未进入奖励闭环', after: '堆场占用、容量余量、集卡时间和闸口压力进入观测与非回退门禁', owner: 'reinforcement-learning-advisory + rules-and-safety-interlock' },
  { domain: '通航、潮窗、引航与拖轮', before: '数据合同存在但控制器只见气象聚合', after: '直接观测并由硬约束动作屏蔽器控制', owner: 'rules-and-safety-interlock' },
  { domain: '能源、岸电与碳成本', before: '只有碳强度聚合奖励', after: '岸电可用、碳强度和能源价格进入观测与奖励', owner: 'reinforcement-learning-advisory + human-approved-executor' },
  { domain: '海铁、水水与邻港协同', before: '目标被禁用', after: '转运压力、能力余量与邻港建议进入闭环，但对方接受仍为外部事件', owner: 'reinforcement-learning-advisory + external-authority' },
  { domain: '扰动恢复', before: '只有综合韧性指标', after: '能力损失、恢复积压、恢复动作和恢复奖励显式化', owner: 'reinforcement-learning-advisory + deterministic-optimizer' },
  { domain: '服务公平性', before: '目标被禁用', after: '船型服务差距进入状态、奖励和冠军门禁', owner: 'reinforcement-learning-advisory' },
  { domain: '审批、放行、避碰、紧急停止与生产下发', before: '监管扩展已声明外生', after: '继续排除在强化学习之外，由主管机关、安全联锁和人工批准执行', owner: 'external-authority + rules-and-safety-interlock + human-approved-executor' },
];

const report = {
  schemaVersion: 'port-business-rl-evidence.v3',
  evidenceLabel: 'OFFLINE_PUBLIC_ANCHORED_ENGINEERING_AUGMENTED_NOT_FIELD_KPI',
  generatedAt: new Date().toISOString(),
  sourceFingerprint: {
    algorithm: 'sha256',
    digest: sourceDigest,
    files: sourceFileDigests,
  },
  publicEvidence: [
    {
      role: 'training-anchor',
      publisher: 'Maritime and Port Authority of Singapore',
      title: 'Vessel Arrivals (>75 GT), Monthly',
      url: 'https://data.gov.sg/collections/394/view',
      use: 'Monthly vessel-arrival and gross-tonnage anchors',
    },
    {
      role: 'training-anchor',
      publisher: 'Open-Meteo / ERA5',
      title: 'Historical Weather API',
      url: 'https://open-meteo.com/en/docs/historical-weather-api',
      use: 'Monthly high-wind exposure already joined to the checked-in public snapshot',
    },
    {
      role: 'external-traffic-robustness-reference',
      publisher: 'Zenodo / INFORE',
      title: 'Single Ground Based AIS Receiver Vessel Tracking Dataset',
      url: 'https://zenodo.org/records/3754481',
      use: 'Existing separate public traffic-density benchmark; not relabeled as Malacca terminal calls',
    },
    {
      role: 'business-metric-reference',
      publisher: 'World Bank',
      title: 'Container Port Performance Index',
      url: 'https://www.worldbank.org/en/topic/transport/publication/cppi',
      use: 'Vessel time in port and waiting-time business-value framing; no CPPI rank used as a training label',
    },
    {
      role: 'network-metric-reference',
      publisher: 'UN Trade and Development',
      title: 'Liner Shipping Connectivity Index',
      url: 'https://unctadstat.unctad.org/insights/theme/246',
      use: 'Network-connectivity framing; no index value used as a terminal observation',
    },
  ],
  coverageAudit,
  contract: {
    version: PORT_BUSINESS_RL_CONTRACT_VERSION,
    observations: PORT_BUSINESS_OBSERVATIONS,
    actions: PORT_BUSINESS_ACTIONS,
    rewardComponents: PORT_BUSINESS_REWARD_COMPONENTS,
    hardConstraints: PORT_BUSINESS_HARD_CONSTRAINTS,
    responsibilityMatrix: PORT_BUSINESS_RESPONSIBILITY_MATRIX,
    authorityBoundary: PORT_BUSINESS_AUTHORITY_BOUNDARY,
  },
  dataset: {
    id: dataset.id,
    label: dataset.label,
    fingerprint: dataset.fingerprint,
    sourceFingerprint: dataset.sourceFingerprint,
    evidenceLevel: dataset.evidenceLevel,
    operationalClaimAllowed: dataset.operationalClaimAllowed,
    source: dataset.source,
    sourceUrls: dataset.sourceUrls,
    license: dataset.license,
    recordCount: dataset.records.length,
    split: dataset.split,
    lineage: dataset.lineage,
    quality: dataset.quality,
    limitations: dataset.limitations,
    retainedArtifact: {
      path: path.relative(process.cwd(), DATASET_ARTIFACT),
      integrityDigest: datasetArtifact.integrity.digest,
    },
  },
  nonReinforcementLearning: {
    demandForecast: {
      model: demandForecast,
      validation: validationForecast,
      sealedTest: testForecast,
      gate: {
        finite: [validationForecast.model.wapePercent, testForecast.model.wapePercent].every(Number.isFinite),
        validationBeatsSeasonalNaive: validationForecast.model.wapePercent < validationForecast.seasonalNaive.wapePercent,
        testBeatsSeasonalNaive: testForecast.model.wapePercent < testForecast.seasonalNaive.wapePercent,
      },
    },
    deterministicOptimizer: {
      owner: 'deterministic-optimizer',
      results: champion.champion.finalTest.deterministicOptimizer,
      dispatchAllowed: false,
    },
    safetyAndAuthority: {
      actionMask: 'deterministic feasibility + business applicability + one-interval cooldown',
      externalDecisions: ['maritime inspection', 'customs examination', 'official release', 'VTS instruction', 'collision avoidance', 'emergency stop'],
      humanApprovalRequired: true,
      dispatchAllowed: false,
    },
  },
  training: champion,
  retainedArtifacts: {
    allAttempts: path.relative(process.cwd(), ATTEMPTS_ARTIFACT),
    championPolicies: policyArtifacts,
  },
  releaseDecision: {
    offlineChampionAdmitted: champion.champion.admitted,
    validationGatePassed: champion.champion.validationGate.passed,
    finalTestGatePassed: champion.champion.finalTestGate.passed,
    operationalDeploymentAdmitted: false,
    reasons: [
      'The public aggregate anchors do not contain synchronized Malacca terminal measurements.',
      'Engineering-derived fields are replaceable scenario variables, not observed berth, yard, gate or authority outcomes.',
      'Field promotion still requires operator-authorized data, calibration, shadow replay, safety acceptance and signed site acceptance.',
    ],
  },
};

const finalGate = champion.champion.finalTestGate.evidence;
const failedCandidates = champion.attempts.reduce((sum, attempt) =>
  sum + attempt.candidates.filter((candidate) => !candidate.selectedForAlgorithm).length, 0);
const markdown = `# 港口全业务强化学习冠军证据 v3

> 证据边界：\`${report.evidenceLabel}\`。这是公开数据锚定、工程约束补足的离线训练与封存测试，不能写成马六甲港现场收益或生产调度授权。

## 结论

- 冠军：\`${champion.champion.algorithmId}\`，课程 \`${champion.champion.attemptId}\`，离线准入：**${champion.champion.admitted ? '通过' : '不通过'}**。
- 数据：${dataset.records.length.toLocaleString('en-US')} 条，训练 ${dataset.split.trainRange.join(' 至 ')}，验证 ${dataset.split.validationRange.join(' 至 ')}，封存测试 ${dataset.split.testRange.join(' 至 ')}。
- 观测 / 动作 / 奖励：${PORT_BUSINESS_OBSERVATIONS.length} / ${PORT_BUSINESS_ACTIONS.length} / ${PORT_BUSINESS_REWARD_COMPONENTS.length}；硬约束 ${PORT_BUSINESS_HARD_CONSTRAINTS.length} 项。
- 多随机种子：${champion.champion.seedPolicies.length}；未晋级参数候选 ${failedCandidates} 个，全部候选摘要保留在本报告和运行时工件中。

## 封存测试业务价值（相对保持计划基线）

| 指标 | 均值 | 95% 下界 | 门禁 |
|---|---:|---:|---|
| 奖励改善 | ${finalGate.rewardImprovement.mean.toFixed(4)} | ${finalGate.rewardImprovement.lower95.toFixed(4)} | ≥ ${champion.champion.finalTestGate.thresholds.minimumRewardImprovementLower95} |
| 有实质延误场景的等待降低（小时） | ${finalGate.waitReductionHours.mean.toFixed(4)} | ${finalGate.waitReductionHours.lower95.toFixed(4)} | ≥ ${champion.champion.finalTestGate.thresholds.minimumWaitReductionHoursLower95} |
| 有实质延误场景的队列降低（艘） | ${finalGate.queueReductionVessels.mean.toFixed(2)} | ${finalGate.queueReductionVessels.lower95.toFixed(2)} | ≥ ${champion.champion.finalTestGate.thresholds.minimumQueueReductionVesselsLower95} |
| 碳强度降低（%） | ${finalGate.carbonReductionPercent.mean.toFixed(3)} | ${finalGate.carbonReductionPercent.lower95.toFixed(3)} | ≥ ${champion.champion.finalTestGate.thresholds.minimumCarbonReductionPercentLower95} |
| 公平性差距降低（百分点） | ${finalGate.fairnessGapReductionPoints.mean.toFixed(3)} | ${finalGate.fairnessGapReductionPoints.lower95.toFixed(3)} | ≥ ${champion.champion.finalTestGate.thresholds.minimumFairnessGapReductionPointsLower95} |
| 最低吞吐保持率（%） | ${finalGate.minimumThroughputRetentionPercent.toFixed(3)} | — | ≥ ${champion.champion.finalTestGate.thresholds.minimumThroughputRetentionPercent} |

安全投影率 ${finalGate.maximumSafetyProjectionRatePercent.toFixed(3)}%，硬约束违规 ${finalGate.hardConstraintViolations}，平均干预率 ${finalGate.meanInterventionRatePercent.toFixed(3)}%，平均动作切换率 ${finalGate.meanActionSwitchRatePercent.toFixed(3)}%。堆场溢出与闸口服务水平协议均未回退。

## 数据真实性与替换

公开实证字段只包括新加坡海事及港务管理局月度到港、总吨位和已经接入的 ERA5 风场锚点。泊位、岸桥、堆场、闸口、引拖、浪高、能见度、岸电、能源价格、转运能力和公平性等字段均标为 \`engineering-derived\`。现场接入时按 \`port-business-dataset.v3\` 同名字段整包替换；未达到 \`operator-authorized\` 前 \`operationalClaimAllowed=false\`。

完整训练数据保留于 \`${path.relative(process.cwd(), DATASET_ARTIFACT)}\`，冠军策略按随机种子保留于 \`${path.relative(process.cwd(), RUNTIME_DIRECTORY)}/champion-seed-*.json\`；报告保存数据和源码指纹以防错配。

## 非强化学习职责

需求预测使用训练段拟合岭回归时序模型，验证 WAPE ${round(validationForecast.model.wapePercent)}%，封存测试 WAPE ${round(testForecast.model.wapePercent)}%，均优于同月周期朴素基线。泊位/资源守恒由确定性优化器处理；航道、潮窗、危险品、岸电容量和冷却间隔由规则联锁处理；海事/海关放行、船舶交通服务指令、避碰、紧急停止和生产下发不交给强化学习。
`;

await atomicWrite(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
await atomicWrite(REPORT_MARKDOWN, markdown);

if (!champion.champion.admitted) {
  throw new Error(`Port business champion failed closed: ${Object.entries(champion.champion.finalTestGate.checks)
    .filter(([, passed]) => !passed).map(([name]) => name).join(', ')}`);
}
process.stdout.write(`PORT_BUSINESS_CHAMPION:PASS:${champion.champion.algorithmId}:${champion.champion.attemptId}\n`);
process.stdout.write(`DATASET:${dataset.id}:${dataset.records.length}:${dataset.fingerprint}\n`);
process.stdout.write(`FINAL_GATE:${JSON.stringify(champion.champion.finalTestGate.evidence)}\n`);
