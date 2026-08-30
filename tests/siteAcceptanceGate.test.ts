import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import {
  SITE_ACCEPTANCE_EVIDENCE_VERSION,
  evaluateSiteAcceptance,
  signSiteAcceptance,
  siteAcceptanceDigest,
  type SiteAcceptanceEvidence,
  type SiteAcceptanceSignoff,
} from '../server/siteAcceptanceGate.ts';

const NOW = new Date('2026-08-30T08:00:00.000Z');
const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const roles: SiteAcceptanceSignoff['role'][] = [
  'OPERATOR_OWNER', 'SAFETY_OWNER', 'IT_OT_SECURITY', 'DATA_OWNER', 'PROJECT_ACCEPTANCE',
];

const createEvidence = (evidenceLevel: SiteAcceptanceEvidence['evidenceLevel']) => {
  const core: Omit<SiteAcceptanceEvidence, 'acceptanceDigest' | 'signoffs'> = {
    protocolVersion: SITE_ACCEPTANCE_EVIDENCE_VERSION,
    evidenceLevel,
    acceptanceID: evidenceLevel === 'TEST_FIXTURE' ? 'test.acceptance.001' : 'field.acceptance.001',
    siteID: 'site.sgsin.01',
    projectID: 'project.port.twin.01',
    observationWindow: {
      baselineStart: '2026-06-01T00:00:00.000Z',
      baselineEnd: '2026-07-01T00:00:00.000Z',
      shadowStart: '2026-07-01T00:00:00.000Z',
      shadowEnd: '2026-07-31T00:00:00.000Z',
    },
    shadow: {
      completedHours: 720,
      minimumRequiredHours: 720,
      recommendationCount: 1000,
      humanInterventionCount: 20,
      severeIncidentCount: 0,
      unresolvedIncidentCount: 0,
      productionDispatchCount: 0,
    },
    kpis: [
      ['VESSEL_WAITING_TIME', 'LOWER_IS_BETTER'],
      ['BERTH_PRODUCTIVITY', 'HIGHER_IS_BETTER'],
      ['ENERGY_INTENSITY', 'LOWER_IS_BETTER'],
      ['CARBON_INTENSITY', 'LOWER_IS_BETTER'],
      ['SAFETY_EVENTS', 'NON_INFERIOR'],
    ].map(([kpiID, direction], index) => ({
      kpiID,
      direction: direction as SiteAcceptanceEvidence['kpis'][number]['direction'],
      unit: index === 1 ? 'moves/hour' : 'normalized-unit',
      baselineMean: 100,
      shadowMean: index === 1 ? 110 : 90,
      improvementLower95Percent: 5,
      requiredImprovementPercent: index === 4 ? 0 : 3,
      baselineSampleCount: 1000,
      shadowSampleCount: 1000,
      missingPercent: 0.5,
      independentMeasurement: true,
      sourceSystem: `independent.source.${index}`,
      sourceExtractSha256: hash(`kpi-source-${index}`),
      measurementMethodReference: `METHOD-2026-${index + 1}`,
    })),
    acceptanceTests: (['FAT', 'SAT', 'UAT', 'DISASTER_RECOVERY', 'CYBERSECURITY', 'SAFETY'] as const)
      .map((phase, index) => ({
        phase,
        testPlanID: `PLAN-${phase}-2026`,
        passed: true,
        witnessedByIndependentParty: true,
        executedAt: `2026-08-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`,
        evidenceSha256: hash(`acceptance-test-${phase}`),
      })),
    operationsReadiness: {
      operatorTrainingCompletionPercent: 100,
      maintainerTrainingCompletionPercent: 100,
      runbookApproved: true,
      onCallRosterActive: true,
      rollbackDrillPassed: true,
      dataRetentionApproved: true,
      cyberIncidentResponseDrillPassed: true,
    },
    artifacts: Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`artifact.${index + 1}`, hash(`artifact-${index}`)])),
  };
  const acceptanceDigest = siteAcceptanceDigest(core);
  const signoffs = roles.map((role, index) => signSiteAcceptance({
    keyID: 'acceptance-key-01',
    subjectID: `subject.acceptance.${index + 1}`,
    role,
    signedAt: `2026-08-${String(index + 10).padStart(2, '0')}T08:00:00.000Z`,
    acceptanceDigest,
  }, keys.privateKey));
  return { ...core, acceptanceDigest, signoffs };
};

test('complete test fixture validates the evaluator but cannot become field acceptance', () => {
  const result = evaluateSiteAcceptance(createEvidence('TEST_FIXTURE'), {
    trustBundle: { 'acceptance-key-01': publicKey },
    clock: () => NOW,
  });
  assert.equal(result.softwareEvidenceComplete, true);
  assert.equal(result.siteDeliveryReady, false);
  assert.ok(result.blockers.includes('field_evidence_not_declared'));
  assert.equal(result.authority.productionAuthority, false);
  assert.equal(result.authority.dispatchAllowed, false);
});

test('cryptographically signed field evidence can close site delivery but never grants dispatch itself', () => {
  const result = evaluateSiteAcceptance(createEvidence('FIELD_ACCEPTED'), {
    trustBundle: { 'acceptance-key-01': publicKey },
    clock: () => NOW,
  });
  assert.equal(result.siteDeliveryReady, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.validSignoffCount, 5);
  assert.equal(result.authority.productionAuthority, false);
  assert.equal(result.authority.dispatchRequiresSeparateProductionAuthorityGate, true);
});

test('tampered KPI evidence, missing signoffs and a short shadow window fail closed', () => {
  const value = createEvidence('FIELD_ACCEPTED');
  value.kpis[0].shadowMean = 1;
  value.shadow.completedHours = 10;
  value.signoffs = value.signoffs.slice(0, 2);
  const result = evaluateSiteAcceptance(value, {
    trustBundle: { 'acceptance-key-01': publicKey },
    clock: () => NOW,
  });
  assert.equal(result.siteDeliveryReady, false);
  assert.ok(result.blockers.includes('acceptance_digest_mismatch'));
  assert.ok(result.blockers.includes('shadow_duration_not_evidenced'));
  assert.ok(result.blockers.includes('independent_signoffs_incomplete'));
});
