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
  optimizeBusinessActionDeterministically,
  projectBusinessAction,
  type PortBusinessDynamicState,
} from './portBusinessControlPlane.ts';
import type { PortBusinessRecord } from './portBusinessDataset.ts';

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
      finalTestGate: unknown;
    };
  };
  releaseDecision: {
    operationalDeploymentAdmitted: boolean;
  };
}

export const loadPortBusinessChampionStatus = async (
  reportPath = process.env.PORT_BUSINESS_CHAMPION_REPORT || 'reports/port-business-rl-champion-v3.json',
) => {
  const resolved = path.resolve(reportPath);
  const report = JSON.parse(await readFile(resolved, 'utf8')) as StoredEvidence;
  if (report.schemaVersion !== 'port-business-rl-evidence.v3' || !report.training?.champion) {
    throw new Error('港口全业务冠军证据不存在或协议不兼容');
  }
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
      finalTestGate: report.training.champion.finalTestGate,
    },
    boundary: PORT_BUSINESS_AUTHORITY_BOUNDARY,
    operationalDeploymentAdmitted: report.releaseDecision.operationalDeploymentAdmitted,
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
