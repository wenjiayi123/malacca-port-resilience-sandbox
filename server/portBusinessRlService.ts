import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PORT_BUSINESS_ACTIONS,
  PORT_BUSINESS_AUTHORITY_BOUNDARY,
  PORT_BUSINESS_OBSERVATIONS,
  PORT_BUSINESS_REWARD_COMPONENTS,
  PORT_BUSINESS_RL_CONTRACT_VERSION,
  type BusinessActionId,
} from '../shared/portBusinessRlContract.ts';
import {
  businessActionEffect,
  optimizeBusinessActionDeterministically,
  projectBusinessAction,
  type PortBusinessDynamicState,
} from './portBusinessControlPlane.ts';
import type { PortBusinessRecord } from './portBusinessDataset.ts';
import {
  inferPortBusinessPolicyEnsemble,
  type LinearBusinessPolicy,
} from './portBusinessRlEngine.ts';

interface StoredEvidence {
  schemaVersion: string;
  evidenceLabel: string;
  generatedAt: string;
  dataset: {
    id: string;
    fingerprint: string;
    evidenceLevel: string;
    operationalClaimAllowed: boolean;
    recordCount: number;
    split: unknown;
    quality: unknown;
  };
  training: {
    champion: {
      admitted: boolean;
      algorithmId: string;
      attemptId: string;
      seedPolicies: LinearBusinessPolicy[];
      finalTestGate: unknown;
      finalTest: unknown;
    };
  };
  releaseDecision: {
    operationalDeploymentAdmitted: boolean;
  };
}

const readStoredEvidence = async (
  reportPath = process.env.PORT_BUSINESS_CHAMPION_REPORT || 'reports/port-business-rl-champion-v3.json',
) => {
  const resolved = path.resolve(reportPath);
  const report = JSON.parse(await readFile(resolved, 'utf8')) as StoredEvidence;
  if (report.schemaVersion !== 'port-business-rl-evidence.v3' || !report.training?.champion) {
    throw new Error('港口全业务冠军证据不存在或协议不兼容');
  }
  return report;
};

export const loadPortBusinessChampionStatus = async (
  reportPath = process.env.PORT_BUSINESS_CHAMPION_REPORT || 'reports/port-business-rl-champion-v3.json',
) => {
  const report = await readStoredEvidence(reportPath);
  return {
    protocolVersion: 'port-business-runtime-status.v1' as const,
    generatedAt: report.generatedAt,
    evidenceLabel: report.evidenceLabel,
    contract: {
      version: PORT_BUSINESS_RL_CONTRACT_VERSION,
      observationCount: PORT_BUSINESS_OBSERVATIONS.length,
      actionCount: PORT_BUSINESS_ACTIONS.length,
      rewardComponentCount: PORT_BUSINESS_REWARD_COMPONENTS.length,
    },
    dataset: report.dataset,
    champion: {
      admitted: report.training.champion.admitted,
      algorithmId: report.training.champion.algorithmId,
      attemptId: report.training.champion.attemptId,
      seedPolicyCount: report.training.champion.seedPolicies.length,
      finalTestGate: report.training.champion.finalTestGate,
      finalTest: report.training.champion.finalTest,
    },
    boundary: PORT_BUSINESS_AUTHORITY_BOUNDARY,
    operationalDeploymentAdmitted: report.releaseDecision.operationalDeploymentAdmitted,
  };
};

const round = (value: number, digits = 6) => Number(value.toFixed(digits));

export const inferPortBusinessChampion = async (input: {
  record: PortBusinessRecord;
  state: PortBusinessDynamicState;
  previousRecord?: PortBusinessRecord;
  provenance?: {
    sourceProtocolVersion?: string;
    snapshotHash?: string;
    source?: string;
    liveDataVerified?: boolean;
    operatorMeasuredFieldCount?: number;
  };
}) => {
  const report = await readStoredEvidence();
  const inference = inferPortBusinessPolicyEnsemble(
    report.training.champion.seedPolicies,
    input.record,
    input.state,
    input.previousRecord,
  );
  const projected = projectBusinessAction(input.record, input.state, inference.selectedAction.actionId);
  const fallback = optimizeBusinessActionDeterministically(input.record, input.state);
  const effect = businessActionEffect(projected.executedActionId);
  const predictedCapacity = input.record.effectiveCapacity * effect.capacityMultiplier;
  const predictedQueue = Math.max(
    0,
    input.state.queueVessels
      + input.record.arrivals * (1 - effect.deferredDemandFraction - effect.divertedDemandFraction)
      - predictedCapacity,
  );
  const predictedYardOccupancy = Math.max(
    0,
    input.state.yardOccupancy - effect.yardRelief
      + predictedQueue / Math.max(1, predictedCapacity) * 0.018,
  );
  const throughputRetentionPercent = (1 - effect.deferredDemandFraction - effect.divertedDemandFraction) * 100;
  const businessProjection = {
    queueVessels: { before: round(input.state.queueVessels), after: round(predictedQueue) },
    meanWaitingHours: {
      before: round(input.state.queueVessels / Math.max(1, input.record.effectiveCapacity) * 24),
      after: round(predictedQueue / Math.max(1, predictedCapacity) * 24),
    },
    yardOccupancy: { before: round(input.state.yardOccupancy), after: round(predictedYardOccupancy) },
    gateQueuePressure: {
      before: round(input.state.gateQueuePressure),
      after: round(Math.max(0, input.state.gateQueuePressure - effect.gateRelief)),
    },
    carbonIntensity: {
      before: round(input.record.carbonIntensity),
      after: round(input.record.carbonIntensity * effect.carbonMultiplier),
    },
    fairnessGap: {
      before: round(input.state.fairnessGap),
      after: round(Math.max(0, input.state.fairnessGap - effect.fairnessRelief)),
    },
    recoveryBacklogVessels: {
      before: round(input.state.recoveryBacklogVessels),
      after: round(input.state.recoveryBacklogVessels / effect.recoveryMultiplier),
    },
    throughputRetentionPercent: round(throughputRetentionPercent),
  };
  const thresholds = {
    minimumEnsembleVoteShare: 0.6,
    maximumNormalizedEntropy: 0.85,
    maximumOutOfRangeObservations: 2,
    minimumDataQualityScore: 0.65,
    maximumForecastUncertainty: 0.55,
    minimumThroughputRetentionPercent: 97,
    maximumYardOccupancy: 1,
    maximumCarbonRegressionPercent: 1,
  };
  const carbonRegressionPercent = (businessProjection.carbonIntensity.after /
    Math.max(1e-9, businessProjection.carbonIntensity.before) - 1) * 100;
  const checks = {
    offlineChampionAdmitted: report.training.champion.admitted,
    contractCompatible: inference.uncertainty.ensemblePolicyCount > 0,
    actionFeasible: projected.feasible,
    ensembleAgreement: inference.selectedAction.voteShare >= thresholds.minimumEnsembleVoteShare,
    entropy: inference.uncertainty.normalizedEntropy <= thresholds.maximumNormalizedEntropy,
    observationRange: inference.uncertainty.outOfRangeObservationCount <= thresholds.maximumOutOfRangeObservations,
    dataQuality: input.record.dataQualityScore >= thresholds.minimumDataQualityScore,
    forecastUncertainty: input.record.forecastUncertainty <= thresholds.maximumForecastUncertainty,
    throughputNonRegression: throughputRetentionPercent >= thresholds.minimumThroughputRetentionPercent,
    yardCapacity: predictedYardOccupancy <= thresholds.maximumYardOccupancy,
    carbonNonRegression: carbonRegressionPercent <= thresholds.maximumCarbonRegressionPercent,
  };
  const blockerLabels: Record<keyof typeof checks, string> = {
    offlineChampionAdmitted: '离线冠军业务价值门禁未通过',
    contractCompatible: '冠军策略与当前合同不兼容',
    actionFeasible: '动作被确定性安全投影器阻断',
    ensembleAgreement: '五随机种子策略一致性不足',
    entropy: '动作概率分布熵过高',
    observationRange: '运行观测超出训练合同范围',
    dataQuality: '输入数据质量不足',
    forecastUncertainty: '需求预测不确定度过高',
    throughputNonRegression: '吞吐保持率低于门槛',
    yardCapacity: '堆场容量投影越界',
    carbonNonRegression: '碳强度退化超过门槛',
  };
  const blockers = (Object.entries(checks) as Array<[keyof typeof checks, boolean]>)
    .filter(([, passed]) => !passed)
    .map(([key]) => blockerLabels[key]);
  const admitted = blockers.length === 0;
  const recommendedActionId = admitted
    ? projected.executedActionId
    : fallback.selectedActionId;
  const proposalId = `business-${createHash('sha256').update(JSON.stringify({
    dataset: report.dataset.fingerprint,
    timestamp: input.record.timestamp,
    state: input.state,
    selected: inference.selectedAction.actionId,
  })).digest('hex').slice(0, 20)}`;
  return {
    protocolVersion: 'port-business-runtime-decision.v1' as const,
    proposalId,
    generatedAt: new Date().toISOString(),
    champion: {
      algorithmId: report.training.champion.algorithmId,
      attemptId: report.training.champion.attemptId,
      seedPolicyCount: report.training.champion.seedPolicies.length,
      datasetFingerprint: report.dataset.fingerprint,
      evidenceLabel: report.evidenceLabel,
    },
    inputEvidence: {
      recordTimestamp: input.record.timestamp,
      portId: input.record.portId,
      terminalId: input.record.terminalId,
      dataQualityScore: input.record.dataQualityScore,
      forecastUncertainty: input.record.forecastUncertainty,
      sourceProtocolVersion: input.provenance?.sourceProtocolVersion ?? 'unreported',
      snapshotHash: input.provenance?.snapshotHash ?? 'unreported',
      source: input.provenance?.source ?? 'unreported',
      liveDataVerified: input.provenance?.liveDataVerified ?? false,
      operatorMeasuredFieldCount: input.provenance?.operatorMeasuredFieldCount ?? 0,
    },
    inference,
    projected,
    deterministicFallback: fallback,
    businessProjection,
    admission: {
      status: admitted ? 'admitted_for_simulation_review' : 'abstain_use_deterministic_fallback',
      thresholds,
      checks,
      blockers,
      recommendationSource: admitted ? 'reinforcement-learning-advisory' : 'deterministic-optimizer',
      recommendedActionId,
    },
    authority: PORT_BUSINESS_AUTHORITY_BOUNDARY,
    approval: {
      status: recommendedActionId === 'hold-plan' ? 'not_required' : 'pending_simulation_review',
      requiredRoles: recommendedActionId === 'hold-plan' ? [] : ['operator', 'safety_officer'],
      approvals: [] as Array<{ approverId: string; role: string; approvedAt: string }>,
    },
    execution: {
      dispatchAllowed: false as const,
      receiptIssued: false as const,
      reason: '全业务策略只进入沙盘审批与证据报告；未连接船舶交通服务、码头操作系统或设备控制系统',
    },
  };
};

export interface PortBusinessProposalInput {
  record: PortBusinessRecord;
  state: PortBusinessDynamicState;
  requestedActionId: BusinessActionId;
}

export const assessPortBusinessProposal = (input: PortBusinessProposalInput) => {
  const projected = projectBusinessAction(input.record, input.state, input.requestedActionId);
  const fallback = optimizeBusinessActionDeterministically(input.record, input.state);
  return {
    protocolVersion: 'port-business-proposal-assessment.v1' as const,
    requestedActionId: input.requestedActionId,
    projected,
    deterministicFallback: fallback,
    authority: PORT_BUSINESS_AUTHORITY_BOUNDARY,
    execution: {
      humanApprovalRequired: projected.executedActionId !== 'hold-plan',
      dispatchAllowed: false as const,
      receiptIssued: false as const,
      reason: '该接口只执行离线动作评估，不连接船舶交通服务、码头操作系统或设备控制系统',
    },
  };
};
