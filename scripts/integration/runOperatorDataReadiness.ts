import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { OperatorIntegrationGateway, canonicalJson } from '../../server/operatorIntegrationGateway.ts';
import { assessOperatorSourceManifest, OPERATOR_ADAPTER_IDS } from '../../server/operatorSourceManifest.ts';
import { PORT_OPERATIONAL_FIELDS } from '../../shared/portOperationalContract.ts';
import {
  FIXTURE_NOW,
  buildAllFixtureEnvelopes,
  fixtureManifest,
  fixtureSigningKeys,
} from './operatorDataFixture.ts';

const gateway = new OperatorIntegrationGateway({
  signingKeys: fixtureSigningKeys,
  stateFile: null,
  manifestReadiness: assessOperatorSourceManifest(fixtureManifest, FIXTURE_NOW),
  clock: () => FIXTURE_NOW,
});
const ingestResults = buildAllFixtureEnvelopes().map((envelope) => gateway.ingest(envelope));
const status = gateway.status();
const shadow = gateway.shadowSnapshot();
if (!ingestResults.every((result) => result.accepted) || shadow.protocolVersion !== 'port-digital-twin.snapshot.v1') {
  throw new Error('operator data readiness fixture did not pass');
}
const operatorData = (shadow as unknown as {
  operatorData: { quality: { fieldCount: number; signedAdapterCount: number }; snapshotSha256: string };
}).operatorData;

const sourceFiles = [
  'server/operatorSourceManifest.ts',
  'server/operatorIntegrationGateway.ts',
  'server/operatorIntegrationPlugin.ts',
  'config/port-profiles/operator-data-source.example.json',
  'docs/schemas/operator-data-source-manifest.schema.json',
  'docs/schemas/operator-snapshot.schema.json',
];
const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [
  file,
  createHash('sha256').update(await readFile(file)).digest('hex'),
])));

const report = {
  schemaVersion: 'operator-data-readiness-evidence.v1',
  reportId: 'operator-data-readiness-fixture-v1',
  generatedAt: FIXTURE_NOW.toISOString(),
  result: 'PASS_SOFTWARE_GATE_WITH_TEST_FIXTURE',
  scope: 'read-only operator data ingestion and atomic shadow snapshot release',
  evidenceBoundary: {
    testFixtureOnly: true,
    connectedToRealPort: false,
    independentMeasurementVerified: false,
    operatorFieldAcceptanceCompleted: false,
    siteDeliveryReady: false,
  },
  checks: {
    authorizedManifestFixture: status.manifest.authorization_ready,
    requiredAdapterCount: status.required_adapter_count,
    acceptedAdapterCount: ingestResults.filter((result) => result.accepted).length,
    allHmacSignaturesVerified: status.adapters.every((adapter) => adapter.signature_valid),
    allFeedsFresh: status.adapters.every((adapter) => adapter.fresh),
    dynamicTimeAlignmentReady: status.dynamic_time_alignment.ready,
    terminalFieldContractCount: PORT_OPERATIONAL_FIELDS.length,
    releasedTerminalFieldCount: operatorData.quality.fieldCount,
    atomicShadowReleaseReady: status.read_only_shadow_ready,
    rawPayloadPersisted: false,
    restartRequiresResend: true,
  },
  integrity: {
    compositeSnapshotSha256: operatorData.snapshotSha256,
    evidenceSha256: createHash('sha256').update(canonicalJson({
      adapterDigests: status.adapters.map((adapter) => adapter.payload_sha256),
      sourceSha256,
    })).digest('hex'),
    sourceSha256,
  },
  authority: {
    simulation_mode: false,
    live_data_verified_for_test_fixture: true,
    read_only_shadow: true,
    dispatch_allowed: false,
    production_authority: false,
  },
  remainingExternalBlockers: status.remaining_site_blockers,
  adapters: OPERATOR_ADAPTER_IDS.map((adapterId) => ({ adapterId, accepted: true })),
};

const outputJson = path.resolve('reports/operator-data-readiness-v1.json');
const outputMarkdown = path.resolve('reports/operator-data-readiness-v1.md');
await mkdir(path.dirname(outputJson), { recursive: true });
await writeFile(outputJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await writeFile(outputMarkdown, `# 现场数据接入软件门禁证据 v1

- 结果：\`${report.result}\`
- 受控测试时间：\`${report.generatedAt}\`
- 签名源：\`${report.checks.acceptedAdapterCount}/${report.checks.requiredAdapterCount}\`
- \`terminal-operations.v2\` 字段：\`${report.checks.releasedTerminalFieldCount}/${report.checks.terminalFieldContractCount}\`
- 证据摘要：\`${report.integrity.evidenceSha256}\`

本证据只证明六源 HMAC/SHA-256、字段/单位/时效/顺序/重放门禁和原子影子快照在自动化测试夹具上可复现。它不是真实港口连接、独立计量校准、现场运行或运营方验收的证据。

调度权与生产控制权始终为 \`false\`。
`, 'utf8');
process.stdout.write(`Operator data readiness evidence written: ${outputJson}\n`);
