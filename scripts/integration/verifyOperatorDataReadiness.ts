import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { OPERATOR_ADAPTER_IDS } from '../../server/operatorSourceManifest.ts';
import { PORT_OPERATIONAL_FIELDS } from '../../shared/portOperationalContract.ts';

const report = JSON.parse(await readFile('reports/operator-data-readiness-v1.json', 'utf8')) as Record<string, unknown>;
const errors: string[] = [];
const checks = report.checks as Record<string, unknown>;
const boundary = report.evidenceBoundary as Record<string, unknown>;
const authority = report.authority as Record<string, unknown>;
const integrity = report.integrity as { sourceSha256: Record<string, string> };

if (report.schemaVersion !== 'operator-data-readiness-evidence.v1') errors.push('unsupported evidence schema');
if (report.result !== 'PASS_SOFTWARE_GATE_WITH_TEST_FIXTURE') errors.push('software gate did not pass');
if (boundary.testFixtureOnly !== true || boundary.connectedToRealPort !== false || boundary.siteDeliveryReady !== false) {
  errors.push('external evidence boundary is inflated');
}
if (checks.requiredAdapterCount !== OPERATOR_ADAPTER_IDS.length || checks.acceptedAdapterCount !== OPERATOR_ADAPTER_IDS.length) {
  errors.push('six-source adapter coverage is incomplete');
}
if (checks.terminalFieldContractCount !== PORT_OPERATIONAL_FIELDS.length ||
    checks.releasedTerminalFieldCount !== PORT_OPERATIONAL_FIELDS.length) {
  errors.push('terminal-operations.v2 field coverage is incomplete');
}
for (const check of [
  'authorizedManifestFixture', 'allHmacSignaturesVerified', 'allFeedsFresh',
  'dynamicTimeAlignmentReady', 'atomicShadowReleaseReady', 'restartRequiresResend',
]) {
  if (checks[check] !== true) errors.push(`${check} must be true`);
}
if (checks.rawPayloadPersisted !== false) errors.push('raw payload persistence must remain disabled');
if (authority.read_only_shadow !== true || authority.dispatch_allowed !== false || authority.production_authority !== false) {
  errors.push('authority boundary changed');
}
for (const [file, expected] of Object.entries(integrity.sourceSha256)) {
  const actual = createHash('sha256').update(await readFile(file)).digest('hex');
  if (actual !== expected) errors.push(`source fingerprint mismatch: ${file}`);
}

for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
if (errors.length) process.exit(1);
process.stdout.write('Operator data readiness evidence verified.\n');
