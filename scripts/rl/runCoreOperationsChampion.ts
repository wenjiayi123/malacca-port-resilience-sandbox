import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CORE_OPERATIONS_ACTION_HEADS,
  CORE_OPERATIONS_AUTHORITY_BOUNDARY,
  CORE_OPERATIONS_HARD_CONSTRAINTS,
  CORE_OPERATIONS_OBSERVATIONS,
  CORE_OPERATIONS_REWARD_COMPONENTS,
  CORE_OPERATIONS_RL_CONTRACT_VERSION,
} from '../../shared/coreOperationsRlContract.ts';
import { loadPortBusinessDataset } from '../../server/portBusinessDataset.ts';
import { trainCoreOperationsChampion } from '../../server/coreOperationsRlEngine.ts';

const REPORT_JSON = path.resolve('reports/core-operations-rl-champion-v1.json');
const REPORT_MARKDOWN = path.resolve('reports/core-operations-rl-champion-v1.md');
const RUNTIME_DIRECTORY = path.resolve('.runtime/core-operations-rl-v1');
const ATTEMPTS_ARTIFACT = path.join(RUNTIME_DIRECTORY, 'all-training-attempts.json');

const sourceFiles = [
  'shared/coreOperationsRlContract.ts',
  'server/coreOperationsRlEngine.ts',
  'server/coreOperationsRlService.ts',
  'server/operationalSimulator.ts',
  'server/publicEvidencePlugin.ts',
  'server/portBusinessDataset.ts',
  'src/integrations/coreOperationsRlAdapter.ts',
  'src/components/OperationalEvidenceCenter.tsx',
  'src/App.tsx',
  'scripts/rl/runCoreOperationsChampion.ts',
  'scripts/rl/verifyCoreOperationsChampion.ts',
  'tests/coreOperationsRl.test.ts',
  'tests/uiInteractionContract.test.ts',
  'docs/CORE_OPERATIONS_RL_V1.md',
  'package.json',
  'data/rl/mpa_vessel_arrivals_monthly.csv',
] as const;

const sha256 = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');
const atomicWrite = async (target: string, content: string) => {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, target);
};

const sourceFileDigests = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [
  file,
  sha256(await readFile(path.resolve(file))),
])));
const sourceDigest = sha256(Object.entries(sourceFileDigests)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([file, digest]) => `${file}:${digest}`)
  .join('\n'));

const dataset = await loadPortBusinessDataset();
const champion = trainCoreOperationsChampion(dataset);
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
  policyArtifacts.push({ seed: policy.hyperparameters.seed, path: path.relative(process.cwd(), target), digest: payload.integrity.digest });
}

const coverageAudit = [
  { domain: '到港节奏', previous: '单动作策略可选择低碳航速或错峰到港', current: '独立动作头与其他九个动作头同周期协同', owner: 'reinforcement-learning-advisory' },
  { domain: '泊位与岸桥', previous: '单次只能选择泊位或岸桥动作', current: '与到港、堆场、运输和恢复同步出计划', owner: 'reinforcement-learning-advisory + deterministic-optimizer' },
  { domain: '堆场与闸口', previous: '已有动作但不能进入运行执行回执', current: '箱区与预约负荷进入同一沙盘执行事务', owner: 'reinforcement-learning-advisory + safety-interlock' },
  { domain: '水平运输', previous: '只作为有效能力的隐含因素', current: '自动导引运输车、场内集卡和轮胎式龙门起重机可用率直接入状态和动作头', owner: 'reinforcement-learning-advisory + safety-interlock' },
  { domain: '航道、潮窗、引航与拖轮', previous: '动作屏蔽存在但只服务单动作策略', current: '独立资源头参与联合计划，主管机关与安全联锁仍有否决权', owner: 'reinforcement-learning-advisory + external-authority' },
  { domain: '岸电与储能', previous: '只有岸电优先建议', current: '岸电、储能削峰、电价、碳因子和变压器负载进入联合闭环', owner: 'reinforcement-learning-advisory + energy-interlock' },
  { domain: '冷藏箱与楼宇柔性负荷', previous: '遥测存在但没有强化学习动作', current: '在温控和舒适边界内形成负荷协同建议', owner: 'reinforcement-learning-advisory + service-interlock' },
  { domain: '设备维护', previous: '故障和到期维护仅显示', current: '预防维护窗口与故障恢复优先进入策略、奖励与回执', owner: 'reinforcement-learning-advisory + lockout-tagout-interlock' },
  { domain: '海铁水水与邻港协同', previous: '单动作建议且不改变主控制闭环', current: '联运头参与同周期计划，对方接受仍为外生信号', owner: 'reinforcement-learning-advisory + external-authority' },
  { domain: '扰动恢复', previous: '已有恢复动作但与运行执行分离', current: '能力调用和受控积压释放进入同一事务回执', owner: 'reinforcement-learning-advisory + emergency-plan' },
  { domain: '监管放行、避碰、紧急停止、身份与生产下发', previous: '排除在强化学习之外', current: '继续由外部主管机关、确定性安全联锁和人工授权掌控', owner: 'external-authority + safety-interlock + human-approved-executor' },
];

const report = {
  schemaVersion: 'core-operations-rl-evidence.v1',
  evidenceLabel: 'OFFLINE_PUBLIC_ANCHORED_ENGINEERING_AUGMENTED_SIMULATION_VALUE_NOT_FIELD_KPI',
  generatedAt: new Date().toISOString(),
  sourceFingerprint: { algorithm: 'sha256', digest: sourceDigest, files: sourceFileDigests },
  contract: {
    version: CORE_OPERATIONS_RL_CONTRACT_VERSION,
    observations: CORE_OPERATIONS_OBSERVATIONS,
    actionHeads: CORE_OPERATIONS_ACTION_HEADS,
    rewardComponents: CORE_OPERATIONS_REWARD_COMPONENTS,
    hardConstraints: CORE_OPERATIONS_HARD_CONSTRAINTS,
    authorityBoundary: CORE_OPERATIONS_AUTHORITY_BOUNDARY,
  },
  coverageAudit,
  dataset: {
    id: dataset.id,
    label: dataset.label,
    fingerprint: dataset.fingerprint,
    sourceFingerprint: dataset.sourceFingerprint,
    evidenceLevel: dataset.evidenceLevel,
    operationalClaimAllowed: dataset.operationalClaimAllowed,
    recordCount: dataset.records.length,
    split: dataset.split,
    lineage: dataset.lineage,
    quality: dataset.quality,
    limitations: dataset.limitations,
  },
  training: champion,
  retainedArtifacts: { allAttempts: path.relative(process.cwd(), ATTEMPTS_ARTIFACT), championPolicies: policyArtifacts },
  valueAttribution: {
    design: 'paired_counterfactual_same_records_same_scenarios_rl_vs_conservative_sop',
    finalTestGate: champion.champion.finalTestGate,
    claimBoundary: '差值只归因于同一离线工程仿真中的策略选择；不是马六甲港现场节省、财务确认或生产绩效。',
  },
  runtimeClosure: {
    protocolVersion: 'core-operations-runtime-decision.v1',
    stages: ['authoritative-snapshot', 'factorized-rl-inference', 'deterministic-safety-projection', 'dual-test-role-approval', 'paired-same-state-counterfactual', 'simulation-executor', 'receipt', 'audit-report'],
    simulatorExecutionImplemented: true,
    pairedRuntimeCounterfactualImplemented: true,
    physicalExecutionImplemented: false,
  },
  releaseDecision: {
    offlineChampionAdmitted: champion.champion.admitted,
    validationGatePassed: champion.champion.validationGate.passed,
    finalTestGatePassed: champion.champion.finalTestGate.passed,
    simulationExecutionAdmitted: champion.champion.admitted,
    operationalDeploymentAdmitted: false,
  },
};

await atomicWrite(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
const gate = champion.champion.finalTestGate.evidence;
const markdown = `# 全核心业务强化学习闭环冠军证据 v1

> 证据边界：\`${report.evidenceLabel}\`。以下价值来自同一封存测试记录、同一扰动场景下强化学习与保守标准作业程序的配对反事实，不是现场关键绩效指标。

## 结论

- 冠军：\`${champion.champion.algorithmId}\` / \`${champion.champion.attemptId}\`；离线准入：**${champion.champion.admitted ? '通过' : '不通过'}**。
- 合同：${CORE_OPERATIONS_OBSERVATIONS.length} 维观测、${CORE_OPERATIONS_ACTION_HEADS.length} 个并行动作头、${CORE_OPERATIONS_ACTION_HEADS.reduce((sum, head) => sum + head.choices.length, 0)} 个有界选项、${CORE_OPERATIONS_REWARD_COMPONENTS.length} 项奖励、${CORE_OPERATIONS_HARD_CONSTRAINTS.length} 项硬约束。
- 训练：${champion.champion.seedPolicies.length} 个独立随机种子；训练 / 验证 / 封存测试严格按时间切分。
- 核心覆盖：封存测试中 ${gate.activeDomainCount}/${CORE_OPERATIONS_ACTION_HEADS.length} 个动作头实际产生非保持动作。
- 安全：硬约束违规 ${gate.hardConstraintViolations}；最高安全投影率 ${gate.maximumSafetyProjectionRatePercent.toFixed(4)}%。

## 因强化学习参与而产生的离线业务价值

- 综合奖励改善：均值 ${gate.rewardImprovement.mean.toFixed(4)}，百分之九十五置信下界 ${gate.rewardImprovement.lower95.toFixed(4)}。
- 平均等待减少：均值 ${gate.waitReductionHours.mean.toFixed(4)} 小时，置信下界 ${gate.waitReductionHours.lower95.toFixed(4)}。
- 平均队列减少：均值 ${gate.queueReductionVessels.mean.toFixed(4)} 艘，置信下界 ${gate.queueReductionVessels.lower95.toFixed(4)}。
- 能源成本指数降低：均值 ${gate.energyCostReductionPercent.mean.toFixed(4)}%，置信下界 ${gate.energyCostReductionPercent.lower95.toFixed(4)}%。
- 峰值负载降低：均值 ${gate.peakGridReductionPoints.mean.toFixed(4)} 个百分点，置信下界 ${gate.peakGridReductionPoints.lower95.toFixed(4)}。
- 碳强度降低：均值 ${gate.carbonReductionPercent.mean.toFixed(4)}%，置信下界 ${gate.carbonReductionPercent.lower95.toFixed(4)}%。
- 维护积压降低：均值 ${gate.maintenanceBacklogReduction.mean.toFixed(4)}，置信下界 ${gate.maintenanceBacklogReduction.lower95.toFixed(4)}。
- 恢复积压减少：均值 ${gate.recoveryBacklogReductionVessels.mean.toFixed(4)} 艘，置信下界 ${gate.recoveryBacklogReductionVessels.lower95.toFixed(4)}。
- 最低吞吐保持率 ${gate.minimumThroughputRetentionPercent.toFixed(4)}%；最低冷藏箱服务保持率 ${gate.minimumReeferServicePercent.toFixed(4)}%。

## 运行闭环

冠军策略能从当前后端权威快照生成十域联合计划，经确定性安全投影、两个本地测试角色模拟审批后，从同一状态、同一随机种子和同一时刻分别推进继续当前计划与新强化学习计划，返回可归因的沙盘差值、执行前后差值与审计哈希。\`dispatch_allowed=false\` 与 \`production_authority=false\` 始终保持；现场设备控制、主管机关放行、避碰和紧急停止不属于强化学习动作。
`;
await atomicWrite(REPORT_MARKDOWN, markdown);

process.stdout.write(`CORE_OPERATIONS_CHAMPION:${champion.champion.admitted ? 'ADMITTED' : 'BLOCKED'}:${champion.champion.algorithmId}:${champion.champion.attemptId}\n`);
process.stdout.write(`CORE_OPERATIONS_VALUE:reward_lower95=${gate.rewardImprovement.lower95}:domains=${gate.activeDomainCount}/${CORE_OPERATIONS_ACTION_HEADS.length}:violations=${gate.hardConstraintViolations}\n`);
