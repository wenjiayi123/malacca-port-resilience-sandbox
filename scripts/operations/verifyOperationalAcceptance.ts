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
  failureClosure: { dataLossFailure: string; simulatorStoppedFailure: string };
  audit: { verified: boolean; recordCount: number; headHash: string };
  sourceFingerprint: { algorithm: string; digest: string; files: Record<string, string> };
}

interface ExtensionManifest {
  schemaVersion: string;
  baseReport: { path: string; sha256: string; immutable: boolean };
  expectedChangedSourceFiles: string[];
  currentSourceFingerprints: Record<string, string>;
  regulatoryEvidence: { path: string; sha256: string; verifier: string };
  authority: Record<string, boolean>;
}

const reportPath = path.resolve('reports/operational-closure-acceptance-v1.json');
const reportBytes = await readFile(reportPath);
const report = JSON.parse(reportBytes.toString('utf8')) as AcceptanceReport;
const errors: string[] = [];
if (report.schemaVersion !== 'operational-closure-acceptance.v1') errors.push('unsupported acceptance schema');
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
if (report.failureClosure.dataLossFailure !== 'DATA_QUALITY_GATE_BLOCKED' ||
    report.failureClosure.simulatorStoppedFailure !== 'SIMULATOR_STOPPED') {
  errors.push('fail-closed evidence missing');
}
if (!report.audit.verified || report.audit.recordCount < 8 || !/^[a-f0-9]{64}$/.test(report.audit.headHash)) {
  errors.push('audit chain evidence invalid');
}
const recomputed: Record<string, string> = {};
const changedSourceFiles: string[] = [];
for (const [file, expected] of Object.entries(report.sourceFingerprint.files)) {
  const digest = createHash('sha256').update(await readFile(path.resolve(file))).digest('hex');
  recomputed[file] = digest;
  if (digest !== expected) changedSourceFiles.push(file);
}
const combined = createHash('sha256')
  .update(Object.entries(recomputed).sort(([left], [right]) => left.localeCompare(right))
    .map(([file, digest]) => `${file}:${digest}`).join('\n'))
  .digest('hex');
let extensionVerified = false;
if (changedSourceFiles.length || combined !== report.sourceFingerprint.digest) {
  try {
    const manifestPath = path.resolve('reports/operational-closure-regulatory-extension-v1.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ExtensionManifest;
    const expectedChanged = [...manifest.expectedChangedSourceFiles].sort();
    const actualChanged = [...changedSourceFiles].sort();
    const baseReportHash = createHash('sha256').update(reportBytes).digest('hex');
    const regulatoryEvidenceHash = createHash('sha256')
      .update(await readFile(path.resolve(manifest.regulatoryEvidence.path)))
      .digest('hex');
    const extensionErrors: string[] = [];
    if (manifest.schemaVersion !== 'operational-closure-regulatory-extension.v1') {
      extensionErrors.push('unsupported operational extension schema');
    }
    if (manifest.baseReport.path !== 'reports/operational-closure-acceptance-v1.json' ||
        manifest.baseReport.immutable !== true || manifest.baseReport.sha256 !== baseReportHash) {
      extensionErrors.push('base operational report changed');
    }
    if (JSON.stringify(expectedChanged) !== JSON.stringify(actualChanged)) {
      extensionErrors.push('operational source drift is outside the declared extension');
    }
    for (const file of expectedChanged) {
      if (recomputed[file] !== manifest.currentSourceFingerprints[file]) {
        extensionErrors.push(`extended operational source fingerprint mismatch: ${file}`);
      }
    }
    if (manifest.regulatoryEvidence.path !== 'reports/regulatory-resilience-v2.json' ||
        manifest.regulatoryEvidence.verifier !== 'pnpm benchmark:regulatory:verify' ||
        manifest.regulatoryEvidence.sha256 !== regulatoryEvidenceHash) {
      extensionErrors.push('regulatory evidence reference changed');
    }
    if (manifest.authority.simulation_mode !== true || manifest.authority.live_data_verified !== false ||
        manifest.authority.dispatch_allowed !== false || manifest.authority.production_authority !== false) {
      extensionErrors.push('extension production authority boundary changed');
    }
    if (extensionErrors.length) errors.push(...extensionErrors);
    else extensionVerified = true;
  } catch (error) {
    errors.push(`operational extension manifest invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}
for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
if (errors.length) process.exit(1);
process.stdout.write(extensionVerified
  ? 'Operational closure acceptance verified with immutable regulatory extension.\n'
  : 'Operational closure acceptance verified.\n');
