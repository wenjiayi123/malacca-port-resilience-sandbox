import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

interface ComparisonReport {
  schemaVersion: string;
  evidenceLabel: string;
  sourceFingerprint: {
    algorithm: string;
    digest: string;
    files: Record<string, string>;
  };
  comparison: {
    existingMacroBenchmark: {
      recordCount: number;
      fingerprint: string;
    };
    highFrequencyBenchmark: {
      doi: string;
      license: string;
      archiveMd5: string;
      rawMessageCount: number;
      derivedRecordCount: number;
      demandMode: string;
      limitations: string[];
      methods: Record<string, {
        validationSelectionScore: { mean: number; standardDeviation: number; samples: number };
        heldOutDelayReductionPercent: { mean: number; standardDeviation: number; samples: number };
      }>;
    };
  };
  verdict: {
    primaryResumeEvidence: string;
    operationalClaimAllowed: boolean;
  };
}

const reportPath = path.resolve('reports/public-dataset-credibility-comparison.json');
const report = JSON.parse(await readFile(reportPath, 'utf8')) as ComparisonReport;
const errors: string[] = [];
if (report.schemaVersion !== 'public-dataset-credibility-comparison.v1') {
  errors.push('unsupported comparison schema');
}
if (report.evidenceLabel !== 'AIS_TRAFFIC_DENSITY_EXTERNAL_VALIDATION_NOT_PORT_KPI') {
  errors.push('AIS evidence boundary is missing');
}
if (report.sourceFingerprint.algorithm !== 'sha256') {
  errors.push('comparison source fingerprint algorithm mismatch');
} else {
  const sourceDigest = createHash('sha256');
  for (const [sourcePath, expectedDigest] of Object.entries(report.sourceFingerprint.files)) {
    const content = await readFile(path.resolve(sourcePath)).catch(() => null);
    if (!content) {
      errors.push(`comparison source missing: ${sourcePath}`);
      continue;
    }
    const actualDigest = createHash('sha256').update(content).digest('hex');
    if (actualDigest !== expectedDigest) errors.push(`comparison source changed: ${sourcePath}`);
    sourceDigest.update(`${sourcePath}\0${actualDigest}\n`);
  }
  if (sourceDigest.digest('hex') !== report.sourceFingerprint.digest) {
    errors.push('comparison source fingerprint mismatch');
  }
}
if (report.comparison.existingMacroBenchmark.recordCount !== 377) {
  errors.push('existing MPA benchmark record count changed');
}
if (!/^[a-f0-9]{16}$/.test(report.comparison.existingMacroBenchmark.fingerprint)) {
  errors.push('existing MPA fingerprint is missing');
}
const highFrequency = report.comparison.highFrequencyBenchmark;
if (highFrequency.doi !== '10.5281/zenodo.3754481') errors.push('INFORE DOI mismatch');
if (highFrequency.license !== 'CC BY-NC-ND 4.0') errors.push('INFORE license boundary mismatch');
if (highFrequency.archiveMd5 !== '7f33c6f59b4e5979abb3f3f2dbef0090') {
  errors.push('INFORE archive checksum mismatch');
}
if (highFrequency.demandMode !== 'ais-active-vessel-density-proxy') {
  errors.push('AIS demand proxy boundary is missing');
}
if (!highFrequency.limitations.some((item) => item.includes('not Shanghai or Malacca'))) {
  errors.push('AIS geographic limitation is missing');
}
if (highFrequency.rawMessageCount < 300_000) errors.push('large AIS source was not processed');
if (highFrequency.derivedRecordCount < 1_000) errors.push('minute-level derived package is too small');
const expectedMethods = ['q-learning', 'sarsa', 'expected-sarsa', 'dyna-q', 'mpc'];
for (const method of expectedMethods) {
  const result = highFrequency.methods[method];
  if (!result) {
    errors.push(`missing method ${method}`);
    continue;
  }
  for (const summary of [result.validationSelectionScore, result.heldOutDelayReductionPercent]) {
    if (![summary.mean, summary.standardDeviation, summary.samples].every(Number.isFinite)) {
      errors.push(`non-finite comparison result for ${method}`);
    }
    if (summary.samples < 2) errors.push(`insufficient seeds for ${method}`);
  }
}
if (report.verdict.primaryResumeEvidence !== 'MPA+ERA5 aggregate-v1 benchmark') {
  errors.push('the short AIS window must not replace the official long-horizon primary evidence');
}
if (report.verdict.operationalClaimAllowed !== false) {
  errors.push('public comparison must not authorize operational claims');
}
for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
if (errors.length) process.exit(1);
process.stdout.write('Public dataset comparison evidence verified.\n');
