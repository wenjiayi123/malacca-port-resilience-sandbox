import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadPortTrainingDataset } from '../../server/portTrainingDataset.ts';

interface Report {
  schemaVersion: string;
  evidenceLabel: string;
  status: string;
  evidenceSha256: string;
  authority: Record<string, boolean>;
  dataset: { fingerprint: string; recordCount: number; frozenTestRows: number };
  protocol: { seeds: number[]; episodesPerSeed: number; finalTestAccessBeforeSelection: boolean };
  candidates: Array<{ artifact: string; episodes: number }>;
  gates: Record<string, boolean>;
  finalTest: {
    delta: Record<string, number>;
    costReductionCi95: { lower95Percent: number; upper95Percent: number; pairedRows: number };
  };
  historicalPreservation: {
    changedFiles: string[];
    after: Record<string, string>;
  };
  sourceFingerprint: { algorithm: string; digest: string; files: Record<string, string> };
}

const stableHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value, null, 0)).digest('hex');
const fileHash = async (file: string) => createHash('sha256').update(await readFile(path.resolve(file))).digest('hex');
const errors: string[] = [];
const reportPaths = ['reports/regulatory-resilience-v1.json', 'reports/regulatory-resilience-v2.json'];
const dataset = await loadPortTrainingDataset();

for (const reportPath of reportPaths) {
  const report = JSON.parse(await readFile(path.resolve(reportPath), 'utf8')) as Report;
  const { evidenceSha256, ...base } = report;
  if (evidenceSha256 !== stableHash(base)) errors.push(`${reportPath}: evidence hash mismatch`);
  if (report.evidenceLabel !== 'PREDECLARED_MALACCA_REGULATORY_SCENARIO_NOT_FIELD_KPI') {
    errors.push(`${reportPath}: evidence boundary mismatch`);
  }
  if (report.dataset.fingerprint !== dataset.fingerprint || report.dataset.recordCount !== dataset.records.length ||
      report.dataset.frozenTestRows !== dataset.testRecords.length) {
    errors.push(`${reportPath}: dataset fingerprint or split mismatch`);
  }
  if (report.protocol.seeds.length !== 3 || report.protocol.episodesPerSeed < 2_500 ||
      report.protocol.finalTestAccessBeforeSelection !== false) {
    errors.push(`${reportPath}: training or frozen-test protocol incomplete`);
  }
  if (report.authority.production_authority !== false || report.authority.dispatch_allowed !== false ||
      report.authority.official_release_exogenous !== true) {
    errors.push(`${reportPath}: authority boundary invalid`);
  }
  for (const candidate of report.candidates) {
    if (candidate.episodes < 2_500 || !/^[a-f0-9]{64}$/.test(await fileHash(candidate.artifact))) {
      errors.push(`${reportPath}: candidate artifact invalid`);
    }
  }
  const currentSources = Object.fromEntries(
    await Promise.all(Object.keys(report.sourceFingerprint.files).sort().map(async (file) => [file, await fileHash(file)])),
  );
  if (JSON.stringify(currentSources) !== JSON.stringify(report.sourceFingerprint.files) ||
      stableHash(currentSources) !== report.sourceFingerprint.digest) {
    errors.push(`${reportPath}: source fingerprint mismatch`);
  }
  for (const [file, expected] of Object.entries(report.historicalPreservation.after)) {
    if (await fileHash(file) !== expected) errors.push(`${reportPath}: protected history changed: ${file}`);
  }
  if (report.historicalPreservation.changedFiles.length) errors.push(`${reportPath}: historical files changed during run`);
  const gatesPassed = Object.values(report.gates).every(Boolean);
  const expectedStatus = gatesPassed ? 'qualified_offline' : 'blocked_candidate_preserved';
  if (report.status !== expectedStatus) errors.push(`${reportPath}: status/gates mismatch`);
  if (report.schemaVersion.endsWith('v2')) {
    const delta = report.finalTest.delta;
    if (report.status !== 'qualified_offline' || delta.costReductionPercent < 0 ||
        delta.carbonReductionPercent < 0 || delta.regulatoryDelayReductionPercent < 0 ||
        delta.expectedSafetyViolationChange > 0 || delta.authorityViolationChange !== 0 ||
        report.finalTest.costReductionCi95.lower95Percent < 0 ||
        report.finalTest.costReductionCi95.pairedRows !== dataset.testRecords.length) {
      errors.push(`${reportPath}: v2 business gates failed`);
    }
  }
}

for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
if (errors.length) process.exit(1);
process.stdout.write('Malacca regulatory resilience v1/v2 evidence verified; old artifacts unchanged.\n');
