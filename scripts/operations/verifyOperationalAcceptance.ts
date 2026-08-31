import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

interface AcceptanceReport {
  schemaVersion: string;
  evidenceLabel: string;
  authority: Record<string, boolean>;
  simulator: {
    changedContinuously: boolean;
    quality: {
      total_fields: number;
      consistency_checks: Array<{ passed: boolean }>;
    };
  };
  forecast: { modelHash: string; trainRows: number; validationRows: number };
  groundedHandoff: {
    protocolVersion: string;
    generator: { kind: string; model_used: boolean };
    inputSnapshotHash: string;
    traceCount: number;
    productionAuthority: boolean;
  };
  control: {
    candidateCount: number;
    controllers: Array<{ id: string; eligible: boolean; rejectionReason: string | null }>;
    approvalCount: number;
    receiptId?: string;
    idempotentReplay: boolean;
    rollbackStatus: string;
  };
  coreOperationsControl: {
    champion: {
      admitted: boolean;
      algorithmId: string;
      attemptId: string;
      seedPolicyCount: number;
      actionHeadCount: number;
    };
    proposalId: string;
    admissionStatus: string;
    activeDomains: string[];
    domainAbstentions: string[];
    simulatedApprovals: Array<{ approverId: string; role: string }>;
    receipt: {
      protocol_version: string;
      status: string;
      receipt_id: string;
      input_snapshot_hash: string;
      output_snapshot_hash: string;
      kpi_delta: Record<string, number>;
      counterfactual: {
        design: string;
        baseline_output_snapshot_hash: string;
        rl_vs_baseline_kpi_delta: Record<string, number>;
        rl_vs_baseline_domain_delta: Record<string, number>;
      };
      attribution: string;
      dispatch_allowed: boolean;
      production_authority: boolean;
    };
    idempotentReplay: boolean;
    rollbackStatus: string;
  };
  failureClosure: { dataLossFailure: string; simulatorStoppedFailure: string };
  audit: { verified: boolean; recordCount: number; headHash: string };
  sourceFingerprint: { algorithm: string; digest: string; files: Record<string, string> };
  evidenceReferences: Record<string, string>;
}

const reportPath = path.resolve('reports/operational-closure-acceptance-v2.json');
const reportBytes = await readFile(reportPath);
const report = JSON.parse(reportBytes.toString('utf8')) as AcceptanceReport;
const errors: string[] = [];
if (report.schemaVersion !== 'operational-closure-acceptance.v2') errors.push('unsupported acceptance schema');
if (report.evidenceLabel !== 'PUBLIC_DATA_CALIBRATED_SIMULATION_NOT_FIELD_KPI') errors.push('missing truth boundary');
if (report.authority.simulation_mode !== true || report.authority.live_data_verified !== false ||
    report.authority.dispatch_allowed !== false || report.authority.production_authority !== false) {
  errors.push('production authority boundary changed');
}
if (!report.simulator.changedContinuously || report.simulator.quality.total_fields < 50 ||
    report.simulator.quality.consistency_checks.some((check) => !check.passed)) {
  errors.push('simulator continuity, coverage, or consistency evidence failed');
}
if (!/^[a-f0-9]{64}$/.test(report.forecast.modelHash) || report.forecast.trainRows < 200 || report.forecast.validationRows < 50) {
  errors.push('forecast training/validation evidence incomplete');
}
if (report.groundedHandoff.protocolVersion !== 'xiaoyi-operational-handoff.v1' ||
    report.groundedHandoff.generator.kind !== 'deterministic_state_grounding' ||
    report.groundedHandoff.generator.model_used !== false ||
    report.groundedHandoff.traceCount < 4 || report.groundedHandoff.productionAuthority !== false ||
    !/^[a-f0-9]{64}$/.test(report.groundedHandoff.inputSnapshotHash)) {
  errors.push('grounded handoff evidence or model disclosure incomplete');
}
if (report.control.candidateCount !== 5 || report.control.approvalCount !== 2 || !report.control.receiptId ||
    !report.control.idempotentReplay || report.control.rollbackStatus !== 'rolled_back') {
  errors.push('decision/approval/execution/idempotency/rollback closure incomplete');
}
const rl = report.control.controllers.find((controller) => controller.id === 'rl-checkpoint');
if (rl?.eligible !== false || rl.rejectionReason !== 'missing_completed_checkpoint_inference') {
  errors.push('missing RL checkpoint was not rejected');
}
const core = report.coreOperationsControl;
if (!core.champion.admitted || core.champion.algorithmId !== 'factorized-linear-dyna-q' ||
    core.champion.seedPolicyCount !== 5 || core.champion.actionHeadCount !== 10 ||
    core.admissionStatus !== 'admitted_for_simulation_approval' || core.activeDomains.length < 1) {
  errors.push('core operations champion or runtime admission evidence incomplete');
}
const approvalIds = new Set(core.simulatedApprovals.map((approval) => approval.approverId));
const approvalRoles = new Set(core.simulatedApprovals.map((approval) => approval.role));
if (approvalIds.size !== 2 || !approvalRoles.has('operator') || !approvalRoles.has('safety_officer')) {
  errors.push('core operations simulated dual-role approval evidence incomplete');
}
const coreReceipt = core.receipt;
const hashes = [
  coreReceipt.input_snapshot_hash,
  coreReceipt.counterfactual.baseline_output_snapshot_hash,
  coreReceipt.output_snapshot_hash,
];
if (coreReceipt.protocol_version !== 'core-operations-simulation-receipt.v1' ||
    coreReceipt.status !== 'acknowledged' || !/^[a-zA-Z0-9-]+$/.test(coreReceipt.receipt_id) ||
    hashes.some((value) => !/^[a-f0-9]{64}$/.test(value)) || new Set(hashes).size !== 3 ||
    coreReceipt.counterfactual.design !== 'same_state_same_seed_same_tick_new_rl_plan_vs_continue_current_plan' ||
    coreReceipt.attribution !== 'paired_deterministic_simulation_counterfactual_not_field_causal_estimate' ||
    !Object.values(coreReceipt.counterfactual.rl_vs_baseline_kpi_delta).every(Number.isFinite) ||
    !Object.values(coreReceipt.counterfactual.rl_vs_baseline_kpi_delta).some((value) => Math.abs(value) > 0) ||
    !Object.values(coreReceipt.counterfactual.rl_vs_baseline_domain_delta).every(Number.isFinite) ||
    coreReceipt.dispatch_allowed !== false || coreReceipt.production_authority !== false ||
    !core.idempotentReplay || core.rollbackStatus !== 'rolled_back') {
  errors.push('core operations paired execution, attribution, idempotency, boundary, or rollback evidence incomplete');
}
if (report.failureClosure.dataLossFailure !== 'DATA_QUALITY_GATE_BLOCKED' ||
    report.failureClosure.simulatorStoppedFailure !== 'SIMULATOR_STOPPED') {
  errors.push('fail-closed evidence missing');
}
if (!report.audit.verified || report.audit.recordCount < 10 || !/^[a-f0-9]{64}$/.test(report.audit.headHash)) {
  errors.push('audit chain evidence invalid');
}
const recomputed: Record<string, string> = {};
for (const [file, expected] of Object.entries(report.sourceFingerprint.files)) {
  const digest = createHash('sha256').update(await readFile(path.resolve(file))).digest('hex');
  recomputed[file] = digest;
  if (digest !== expected) errors.push(`operational source fingerprint mismatch: ${file}`);
}
const combined = createHash('sha256')
  .update(Object.entries(recomputed).sort(([left], [right]) => left.localeCompare(right))
    .map(([file, digest]) => `${file}:${digest}`).join('\n'))
  .digest('hex');
if (combined !== report.sourceFingerprint.digest) errors.push('combined operational source fingerprint mismatch');
const expectedEvidenceFiles = [
  'reports/core-operations-rl-champion-v1.json',
  'reports/operational-closure-acceptance-v1.json',
  'reports/operational-closure-regulatory-extension-v1.json',
  'reports/regulatory-resilience-v2.json',
].sort();
if (JSON.stringify(Object.keys(report.evidenceReferences).sort()) !== JSON.stringify(expectedEvidenceFiles)) {
  errors.push('operational evidence lineage set mismatch');
}
for (const [file, expected] of Object.entries(report.evidenceReferences)) {
  const actual = createHash('sha256').update(await readFile(path.resolve(file))).digest('hex');
  if (actual !== expected) errors.push(`operational evidence lineage changed: ${file}`);
}
for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
if (errors.length) process.exit(1);
process.stdout.write('Operational closure acceptance v2 verified with immutable v1, regulatory, and core-RL lineage.\n');
