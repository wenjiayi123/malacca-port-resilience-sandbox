import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const report = JSON.parse(await readFile('reports/top-tier-hardening-evidence-v1.json', 'utf8')) as {
  schemaVersion: string;
  result: string;
  areas: Array<{ id: string; softwareStatus: string; externalBlockers: string[] }>;
  verification: { sourceSha256: Record<string, string> };
  overall: Record<string, unknown>;
};
const errors: string[] = [];
if (report.schemaVersion !== 'top-tier-hardening-evidence.v1') errors.push('unsupported hardening evidence schema');
if (report.result !== 'PASS_SOFTWARE_PREREQUISITES_EXTERNAL_GATES_OPEN') errors.push('hardening evidence result invalid');
if (report.areas.length !== 8 || new Set(report.areas.map((area) => area.id)).size !== 8) errors.push('eight hardening areas required');
if (report.areas.some((area) => area.softwareStatus !== 'PASS' || !area.externalBlockers.length)) {
  errors.push('each area must pass software prerequisites and preserve external blockers');
}
for (const [file, expected] of Object.entries(report.verification.sourceSha256)) {
  const actual = createHash('sha256').update(await readFile(file)).digest('hex');
  if (actual !== expected) errors.push(`hardening source fingerprint mismatch: ${file}`);
}
if (report.overall.softwarePrerequisiteAreaCount !== 8 || report.overall.softwarePrerequisitePassCount !== 8 ||
    report.overall.connectedToRealPort !== false || report.overall.siteDeliveryReady !== false ||
    report.overall.productionAuthority !== false || report.overall.dispatchAllowed !== false) {
  errors.push('overall production boundary is invalid');
}
for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
if (errors.length) process.exit(1);
process.stdout.write('Top-tier hardening evidence verified.\n');
