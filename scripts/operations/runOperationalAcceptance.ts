import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { OperationalControlService, PortOperationsSimulator } from '../../server/operationalSimulator.ts';

const outputJson = path.resolve('reports/operational-closure-acceptance-v1.json');
const outputMarkdown = path.resolve('reports/operational-closure-acceptance-v1.md');
const sourceFiles = [
  'server/operationalSimulator.ts',
  'server/publicEvidencePlugin.ts',
  'shared/portTelemetryContract.ts',
  'src/components/OperationalEvidenceCenter.tsx',
  'src/integrations/operationsControlAdapter.ts',
  'data/rl/mpa_vessel_arrivals_monthly.csv',
  'package.json',
  'pnpm-lock.yaml',
];

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const sourceHashes: Record<string, string> = {};
for (const file of sourceFiles) sourceHashes[file] = sha256(await readFile(path.resolve(file)));
const combinedSourceHash = sha256(
  Object.entries(sourceHashes).sort(([left], [right]) => left.localeCompare(right))
    .map(([file, digest]) => `${file}:${digest}`).join('\n'),
);

const simulator = new PortOperationsSimulator({ seed: 240520, wallTickMs: 60_000 });
const service = new OperationalControlService({ simulator, auditFile: null });
const first = service.snapshot();
simulator.forceAdvance(2);
const second = service.snapshot();
const recommendations = service.recommendations();
const handoff = service.handoffReport();
const decision = service.createDecision('mpc');
service.approveDecision(decision.decision_id, [
  { approver_id: 'acceptance-operator', role: 'operator' },
  { approver_id: 'acceptance-safety', role: 'safety_officer' },
]);
const execution = service.executeDecision(decision.decision_id, 'acceptance-artifact-001');
const idempotentReplay = service.executeDecision(decision.decision_id, 'acceptance-artifact-001');
const rollback = service.rollbackDecision(decision.decision_id, 'acceptance_artifact_rollback');
service.injectScenario('data-loss');
let dataLossFailure = '';
try {
  service.recommendations();
} catch (error) {
  dataLossFailure = error instanceof Error ? error.message : 'unknown';
}
service.injectScenario('normal');
service.controlSimulator('stop');
let stoppedFailure = '';
try {
  service.recommendations();
} catch (error) {
  stoppedFailure = error instanceof Error ? error.message : 'unknown';
}
service.controlSimulator('start');
const audit = service.auditTrail();

const report = {
  schemaVersion: 'operational-closure-acceptance.v1',
  generatedAt: new Date().toISOString(),
  evidenceLabel: 'PUBLIC_DATA_CALIBRATED_SIMULATION_NOT_FIELD_KPI',
  authority: first.authority,
  simulator: {
    seed: first.seed,
    runId: first.run_id,
    protocolVersion: first.protocolVersion,
    firstSequence: first.sequence,
    secondSequence: second.sequence,
    firstSnapshotHash: first.snapshot_hash,
    secondSnapshotHash: second.snapshot_hash,
    changedContinuously: first.snapshot_hash !== second.snapshot_hash,
    quality: first.quality,
  },
  forecast: {
    modelId: first.forecast.model.id,
    modelHash: first.forecast.model.hash,
    trainRows: first.forecast.model.trainRows,
    validationRows: first.forecast.model.validationRows,
    trainRmseVesselsPerMonth: first.forecast.model.trainRmseVesselsPerMonth,
    validationRmseVesselsPerMonth: first.forecast.model.validationRmseVesselsPerMonth,
    inputSnapshotHash: first.forecast.input_snapshot_hash,
  },
  groundedHandoff: {
    protocolVersion: handoff.protocol_version,
    generator: handoff.generator,
    inputSnapshotHash: handoff.input_snapshot_hash,
    traceCount: handoff.evidence.trace_ids.length,
    productionAuthority: handoff.shift_handoff.authority.production_authority,
  },
  control: {
    candidateCount: recommendations.candidates.length,
    controllers: recommendations.candidates.map((candidate) => ({
      id: candidate.controller_id,
      action: candidate.action_id,
      eligible: candidate.eligible,
      rejectionReason: candidate.rejection_reason,
    })),
    decisionStatusAfterExecution: execution.decision.receipt ? 'receipt-recorded' : 'missing-receipt',
    approvalCount: execution.decision.approvals.length,
    receiptId: execution.decision.receipt?.receipt_id,
    kpiDelta: execution.decision.receipt?.kpi_delta,
    idempotentReplay: idempotentReplay.idempotent_replay,
    rollbackStatus: rollback.status,
  },
  failureClosure: {
    dataLossFailure,
    simulatorStoppedFailure: stoppedFailure,
  },
  audit: {
    verified: audit.verified,
    recordCount: audit.record_count,
    headHash: audit.head_hash,
  },
  sourceFingerprint: {
    algorithm: 'sha256',
    digest: combinedSourceHash,
    files: sourceHashes,
  },
  claimBoundary: [
    'This artifact is a real execution of the backend simulator and control service.',
    'It is not a live-port, measured field KPI, production saving, or autonomous control claim.',
    'Historical RL benchmark artifacts remain unchanged and are verified separately.',
  ],
};

const markdown = `# Operational closure acceptance v1

- Evidence: **${report.evidenceLabel}**
- Seed/run: \`${report.simulator.seed}\` / \`${report.simulator.runId}\`
- Telemetry: ${report.simulator.quality.total_fields} fields; ${report.simulator.quality.consistency_checks.filter((check) => check.passed).length}/${report.simulator.quality.consistency_checks.length} consistency gates passed
- Forecast: ${report.forecast.modelId}; train ${report.forecast.trainRows}, validation ${report.forecast.validationRows}; model SHA-256 \`${report.forecast.modelHash}\`
- Grounded handoff: ${report.groundedHandoff.protocolVersion}; ${report.groundedHandoff.traceCount} trace IDs; model impersonation ${report.groundedHandoff.generator.model_used}
- Controllers: ${report.control.candidateCount} (FCFS, port SOP, operations research, MPC, optional completed-checkpoint RL)
- Closure: ${report.control.approvalCount} approvals; receipt \`${report.control.receiptId}\`; idempotent replay ${report.control.idempotentReplay}; rollback ${report.control.rollbackStatus}
- Fail closed: data loss \`${report.failureClosure.dataLossFailure}\`; simulator stop \`${report.failureClosure.simulatorStoppedFailure}\`
- Audit: ${report.audit.verified ? 'verified' : 'failed'}; ${report.audit.recordCount} records; head \`${report.audit.headHash}\`
- Current source fingerprint: \`${report.sourceFingerprint.digest}\`

This is a public-data-calibrated simulation acceptance artifact, not a field KPI or production-authority claim.
`;

await mkdir(path.dirname(outputJson), { recursive: true });
await writeFile(outputJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await writeFile(outputMarkdown, markdown, 'utf8');
process.stdout.write(`Operational acceptance written: ${path.relative(process.cwd(), outputJson)}\n`);
