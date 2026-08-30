import { createHash, sign, verify, type KeyLike } from 'node:crypto';
import { canonicalJson } from './operatorIntegrationGateway.ts';

export const SITE_ACCEPTANCE_EVIDENCE_VERSION = 'site-acceptance-evidence.v1' as const;

export interface FieldKpiEvidence {
  kpiID: string;
  direction: 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER' | 'NON_INFERIOR';
  unit: string;
  baselineMean: number;
  shadowMean: number;
  improvementLower95Percent: number;
  requiredImprovementPercent: number;
  baselineSampleCount: number;
  shadowSampleCount: number;
  missingPercent: number;
  independentMeasurement: boolean;
  sourceSystem: string;
  sourceExtractSha256: string;
  measurementMethodReference: string;
}

export interface SiteAcceptanceSignoff {
  keyID: string;
  subjectID: string;
  role: 'OPERATOR_OWNER' | 'SAFETY_OWNER' | 'IT_OT_SECURITY' | 'DATA_OWNER' | 'PROJECT_ACCEPTANCE';
  signedAt: string;
  acceptanceDigest: string;
  signature: string;
}

export interface SiteAcceptanceEvidence {
  protocolVersion: typeof SITE_ACCEPTANCE_EVIDENCE_VERSION;
  evidenceLevel: 'TEST_FIXTURE' | 'FIELD_ACCEPTED';
  acceptanceID: string;
  siteID: string;
  projectID: string;
  observationWindow: { baselineStart: string; baselineEnd: string; shadowStart: string; shadowEnd: string };
  shadow: {
    completedHours: number;
    minimumRequiredHours: number;
    recommendationCount: number;
    humanInterventionCount: number;
    severeIncidentCount: number;
    unresolvedIncidentCount: number;
    productionDispatchCount: number;
  };
  kpis: FieldKpiEvidence[];
  acceptanceTests: Array<{
    phase: 'FAT' | 'SAT' | 'UAT' | 'DISASTER_RECOVERY' | 'CYBERSECURITY' | 'SAFETY';
    testPlanID: string;
    passed: boolean;
    witnessedByIndependentParty: boolean;
    executedAt: string;
    evidenceSha256: string;
  }>;
  operationsReadiness: {
    operatorTrainingCompletionPercent: number;
    maintainerTrainingCompletionPercent: number;
    runbookApproved: boolean;
    onCallRosterActive: boolean;
    rollbackDrillPassed: boolean;
    dataRetentionApproved: boolean;
    cyberIncidentResponseDrillPassed: boolean;
  };
  artifacts: Record<string, string>;
  acceptanceDigest: string;
  signoffs: SiteAcceptanceSignoff[];
}

export interface SiteAcceptanceGateOptions {
  trustBundle: Record<string, string>;
  clock?: () => Date;
}

const SHA256 = /^[a-f0-9]{64}$/;
const STABLE_ID = /^[A-Za-z0-9._:/-]{2,180}$/;
const PLACEHOLDER = /(?:example|replace|pending|placeholder|todo|tbd|test-only|fixture|待填写|待确认)/i;
const validTime = (value: string) => /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));

export const siteAcceptanceCore = (evidence: Omit<SiteAcceptanceEvidence, 'acceptanceDigest' | 'signoffs'> | SiteAcceptanceEvidence) => ({
  protocolVersion: evidence.protocolVersion,
  evidenceLevel: evidence.evidenceLevel,
  acceptanceID: evidence.acceptanceID,
  siteID: evidence.siteID,
  projectID: evidence.projectID,
  observationWindow: evidence.observationWindow,
  shadow: evidence.shadow,
  kpis: evidence.kpis,
  acceptanceTests: evidence.acceptanceTests,
  operationsReadiness: evidence.operationsReadiness,
  artifacts: evidence.artifacts,
});

export const siteAcceptanceDigest = (evidence: Omit<SiteAcceptanceEvidence, 'acceptanceDigest' | 'signoffs'> | SiteAcceptanceEvidence) =>
  createHash('sha256').update(canonicalJson(siteAcceptanceCore(evidence))).digest('hex');

export const signSiteAcceptance = (
  value: Omit<SiteAcceptanceSignoff, 'signature'>,
  privateKey: KeyLike,
): SiteAcceptanceSignoff => ({
  ...value,
  signature: sign(null, Buffer.from(canonicalJson(value)), privateKey).toString('base64url'),
});

const verifySignoff = (signoff: SiteAcceptanceSignoff, trustBundle: Record<string, string>) => {
  const key = trustBundle[signoff.keyID];
  if (!key) return false;
  const { signature, ...unsigned } = signoff;
  try { return verify(null, Buffer.from(canonicalJson(unsigned)), key, Buffer.from(signature, 'base64url')); } catch { return false; }
};

export const evaluateSiteAcceptance = (evidence: SiteAcceptanceEvidence, options: SiteAcceptanceGateOptions) => {
  const blockers: string[] = [];
  const now = (options.clock ?? (() => new Date()))();
  if (evidence.protocolVersion !== SITE_ACCEPTANCE_EVIDENCE_VERSION) blockers.push('protocol_version_invalid');
  if (![evidence.acceptanceID, evidence.siteID, evidence.projectID].every((value) => STABLE_ID.test(value))) {
    blockers.push('acceptance_identity_invalid');
  }
  const actualDigest = siteAcceptanceDigest(evidence);
  if (!SHA256.test(evidence.acceptanceDigest) || evidence.acceptanceDigest !== actualDigest) blockers.push('acceptance_digest_mismatch');
  const times = Object.entries(evidence.observationWindow);
  if (times.some(([, value]) => !validTime(value))) blockers.push('observation_window_invalid');
  else {
    const baselineDays = (Date.parse(evidence.observationWindow.baselineEnd) - Date.parse(evidence.observationWindow.baselineStart)) / 86_400_000;
    const shadowHours = (Date.parse(evidence.observationWindow.shadowEnd) - Date.parse(evidence.observationWindow.shadowStart)) / 3_600_000;
    if (baselineDays < 30) blockers.push('baseline_window_below_30_days');
    if (shadowHours < evidence.shadow.minimumRequiredHours || Math.abs(shadowHours - evidence.shadow.completedHours) > 0.01) {
      blockers.push('shadow_duration_not_evidenced');
    }
    if (Date.parse(evidence.observationWindow.shadowEnd) > now.getTime() + 30_000) blockers.push('shadow_window_in_future');
  }
  if (evidence.shadow.minimumRequiredHours < 720 || evidence.shadow.completedHours < evidence.shadow.minimumRequiredHours) {
    blockers.push('minimum_30_day_shadow_not_completed');
  }
  if (evidence.shadow.recommendationCount < 100) blockers.push('shadow_recommendation_sample_insufficient');
  if (evidence.shadow.severeIncidentCount > 0 || evidence.shadow.unresolvedIncidentCount > 0) blockers.push('shadow_incident_gate_failed');
  if (evidence.shadow.productionDispatchCount !== 0) blockers.push('shadow_mode_dispatch_detected');

  const requiredKpis = ['VESSEL_WAITING_TIME', 'BERTH_PRODUCTIVITY', 'ENERGY_INTENSITY', 'CARBON_INTENSITY', 'SAFETY_EVENTS'];
  const kpiIDs = new Set(evidence.kpis.map((kpi) => kpi.kpiID));
  if (kpiIDs.size !== evidence.kpis.length) blockers.push('duplicate_kpi_id');
  const missingKpis = requiredKpis.filter((kpi) => !kpiIDs.has(kpi));
  if (missingKpis.length) blockers.push(`required_kpis_missing:${missingKpis.join(',')}`);
  evidence.kpis.forEach((kpi) => {
    if (!STABLE_ID.test(kpi.kpiID) || !kpi.unit.trim() || !Number.isFinite(kpi.baselineMean) || !Number.isFinite(kpi.shadowMean) ||
        !Number.isFinite(kpi.improvementLower95Percent) || !Number.isFinite(kpi.requiredImprovementPercent)) {
      blockers.push(`kpi_metric_invalid:${kpi.kpiID}`);
    }
    if (kpi.baselineSampleCount < 30 || kpi.shadowSampleCount < 30) blockers.push(`kpi_sample_insufficient:${kpi.kpiID}`);
    if (kpi.missingPercent < 0 || kpi.missingPercent > 5) blockers.push(`kpi_missingness_failed:${kpi.kpiID}`);
    if (!kpi.independentMeasurement) blockers.push(`kpi_not_independently_measured:${kpi.kpiID}`);
    if (!SHA256.test(kpi.sourceExtractSha256) || !STABLE_ID.test(kpi.sourceSystem) ||
        !STABLE_ID.test(kpi.measurementMethodReference) || PLACEHOLDER.test(kpi.measurementMethodReference)) {
      blockers.push(`kpi_lineage_invalid:${kpi.kpiID}`);
    }
    if (kpi.improvementLower95Percent < kpi.requiredImprovementPercent) blockers.push(`kpi_target_not_met:${kpi.kpiID}`);
    if (kpi.requiredImprovementPercent < 0) blockers.push(`kpi_target_invalid:${kpi.kpiID}`);
    if (kpi.direction !== 'NON_INFERIOR') {
      if (Math.abs(kpi.baselineMean) < 1e-9) blockers.push(`kpi_small_denominator:${kpi.kpiID}`);
      else {
        const pointImprovement = kpi.direction === 'LOWER_IS_BETTER'
          ? (kpi.baselineMean - kpi.shadowMean) / Math.abs(kpi.baselineMean) * 100
          : (kpi.shadowMean - kpi.baselineMean) / Math.abs(kpi.baselineMean) * 100;
        if (kpi.improvementLower95Percent > pointImprovement + 1e-6) blockers.push(`kpi_confidence_bound_inconsistent:${kpi.kpiID}`);
      }
    }
  });

  const requiredPhases: SiteAcceptanceEvidence['acceptanceTests'][number]['phase'][] = [
    'FAT', 'SAT', 'UAT', 'DISASTER_RECOVERY', 'CYBERSECURITY', 'SAFETY',
  ];
  const passedPhases = new Set(evidence.acceptanceTests
    .filter((item) => item.passed && item.witnessedByIndependentParty && SHA256.test(item.evidenceSha256) && validTime(item.executedAt))
    .map((item) => item.phase));
  const missingPhases = requiredPhases.filter((phase) => !passedPhases.has(phase));
  if (missingPhases.length) blockers.push(`acceptance_tests_missing:${missingPhases.join(',')}`);
  const readiness = evidence.operationsReadiness;
  if (readiness.operatorTrainingCompletionPercent !== 100 || readiness.maintainerTrainingCompletionPercent !== 100 ||
      !readiness.runbookApproved || !readiness.onCallRosterActive || !readiness.rollbackDrillPassed ||
      !readiness.dataRetentionApproved || !readiness.cyberIncidentResponseDrillPassed) blockers.push('operations_readiness_incomplete');
  const artifactEntries = Object.entries(evidence.artifacts);
  if (artifactEntries.length < 5 || artifactEntries.some(([name, digest]) => !STABLE_ID.test(name) || !SHA256.test(digest))) {
    blockers.push('acceptance_artifacts_incomplete');
  }

  const requiredRoles: SiteAcceptanceSignoff['role'][] = [
    'OPERATOR_OWNER', 'SAFETY_OWNER', 'IT_OT_SECURITY', 'DATA_OWNER', 'PROJECT_ACCEPTANCE',
  ];
  const validSignoffs = evidence.signoffs.filter((signoff) => {
    const timeValid = validTime(signoff.signedAt) && Date.parse(signoff.signedAt) <= now.getTime() + 30_000;
    return STABLE_ID.test(signoff.keyID) && STABLE_ID.test(signoff.subjectID) &&
      signoff.acceptanceDigest === evidence.acceptanceDigest && timeValid && verifySignoff(signoff, options.trustBundle);
  });
  const roles = new Set(validSignoffs.map((signoff) => signoff.role));
  const subjects = new Set(validSignoffs.map((signoff) => signoff.subjectID));
  const missingRoles = requiredRoles.filter((role) => !roles.has(role));
  if (missingRoles.length || subjects.size < requiredRoles.length) blockers.push('independent_signoffs_incomplete');
  if (evidence.evidenceLevel !== 'FIELD_ACCEPTED') blockers.push('field_evidence_not_declared');
  const uniqueBlockers = [...new Set(blockers)];
  const structuralBlockers = uniqueBlockers.filter((blocker) => blocker !== 'field_evidence_not_declared');
  return {
    protocolVersion: 'site-acceptance-decision.v1',
    evaluatedAt: now.toISOString(),
    acceptanceID: evidence.acceptanceID,
    softwareEvidenceComplete: structuralBlockers.length === 0,
    siteDeliveryReady: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    validSignoffCount: validSignoffs.length,
    requiredSignoffCount: requiredRoles.length,
    authority: {
      productionAuthority: false,
      dispatchAllowed: false,
      dispatchRequiresSeparateProductionAuthorityGate: true,
    },
  };
};
