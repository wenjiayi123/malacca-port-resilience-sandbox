import { isVerifiedRuntimeSourceExtension } from './runtimeCompatibilityEvidence.ts';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CORE_OPERATIONS_ACTION_HEADS, CORE_OPERATIONS_AUTHORITY_BOUNDARY, CORE_OPERATIONS_OBSERVATIONS, CORE_OPERATIONS_RL_CONTRACT_VERSION } from '../shared/coreOperationsRlContract.ts';
import type { FactorizedCorePolicy } from './coreOperationsRlEngine.ts';

export const CORE_LEGACY_REPORT = 'reports/core-operations-rl-champion-v1.json';
export const CORE_ACTIVE_MANIFEST = 'reports/core-operations-active.json';
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export interface CoreModelReport {
  schemaVersion: string;
  generatedAt: string;
  contract: { version: string; authorityBoundary: Record<string, boolean> };
  dataset: { fingerprint: string };
  training: { champion: { admitted: boolean; seedPolicies: FactorizedCorePolicy[]; validationGate: { passed: boolean }; finalTestGate: { passed: boolean } } };
  releaseDecision: { simulationExecutionAdmitted: boolean; operationalDeploymentAdmitted: boolean };
  upgrade?: { allSeedsConverged: boolean; deployedValidationPassed: boolean; deployedTestPassed: boolean; sourceFiles: Record<string, string> };
}
export interface CoreModelReference { reportPath: string; sha256: string; datasetFingerprint: string }
export interface CoreActiveManifest {
  schemaVersion: 'core-operations-active.v1';
  changedAt: string;
  active: CoreModelReference;
  rollback: CoreModelReference;
  productionAuthority: false;
  dispatchAllowed: false;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const validateCoreModelReport = (report: CoreModelReport) => {
  if (report.schemaVersion !== 'core-operations-rl-evidence.v1' || report.contract?.version !== CORE_OPERATIONS_RL_CONTRACT_VERSION) throw new Error('CORE_MODEL_CONTRACT_MISMATCH');
  if (Object.entries(CORE_OPERATIONS_AUTHORITY_BOUNDARY).some(([key, value]) => report.contract.authorityBoundary?.[key] !== value)) throw new Error('CORE_MODEL_AUTHORITY_MISMATCH');
  const champion = report.training?.champion;
  if (!champion?.admitted || !champion.validationGate?.passed || !champion.finalTestGate?.passed ||
      report.releaseDecision?.simulationExecutionAdmitted !== true || report.releaseDecision.operationalDeploymentAdmitted !== false) throw new Error('CORE_MODEL_NOT_ADMITTED');
  if (!champion.seedPolicies || champion.seedPolicies.length < 5 || new Set(champion.seedPolicies.map((p) => p.hyperparameters?.seed)).size !== champion.seedPolicies.length) throw new Error('CORE_MODEL_SEEDS_INVALID');
  for (const policy of champion.seedPolicies) {
    if (policy.protocolVersion !== 'factorized-core-operations-policy.v1' ||
        !['factorized-linear-q', 'factorized-linear-dyna-q', 'factorized-fitted-policy-iteration'].includes(policy.algorithmId) ||
        !same(policy.observationIds, CORE_OPERATIONS_OBSERVATIONS.map((o) => o.id)) ||
        !same(policy.heads?.map((h) => h.domain), CORE_OPERATIONS_ACTION_HEADS.map((h) => h.id))) throw new Error('CORE_POLICY_CONTRACT_MISMATCH');
    policy.heads.forEach((head, i) => {
      if (!same(head.choiceIds, CORE_OPERATIONS_ACTION_HEADS[i].choices.map((c) => c.id)) ||
          head.weights.length !== head.choiceIds.length || head.weights.some((row) => row.length !== policy.observationIds.length + 1 || !row.every(Number.isFinite))) throw new Error('CORE_POLICY_WEIGHTS_INVALID');
    });
    if (!(policy.training?.environmentSteps > 0 && policy.training.parameterUpdates > 0)) throw new Error('CORE_POLICY_TRAINING_MISSING');
  }
  if (champion.seedPolicies.some((p) => p.algorithmId === 'factorized-fitted-policy-iteration') &&
      (!report.upgrade?.allSeedsConverged || !report.upgrade.deployedValidationPassed || !report.upgrade.deployedTestPassed)) throw new Error('CORE_MODEL_UPGRADE_GATES_FAILED');
};
const readVerified = async (file: string, expected?: CoreModelReference) => {
  const content = await readFile(path.resolve(file));
  const digest = sha256(content);
  if (expected && digest !== expected.sha256) throw new Error('CORE_MODEL_DIGEST_MISMATCH');
  const report = JSON.parse(content.toString()) as CoreModelReport;
  validateCoreModelReport(report);
  if (expected && report.dataset.fingerprint !== expected.datasetFingerprint) throw new Error('CORE_MODEL_DATASET_MISMATCH');
  for (const [source, expectedHash] of Object.entries(report.upgrade?.sourceFiles ?? {})) {
    const actualHash = sha256(await readFile(path.resolve(source)));
    if (actualHash !== expectedHash && !await isVerifiedRuntimeSourceExtension(file, source, expectedHash, actualHash)) {
      throw new Error(`CORE_MODEL_SOURCE_MISMATCH:${source}`);
    }
  }
  return { report, reference: { reportPath: file, sha256: digest, datasetFingerprint: report.dataset.fingerprint } };
};
export const loadActiveCoreModel = async (options: { manifestPath?: string; overrideReport?: string } = {}) => {
  const override = options.overrideReport ?? process.env.CORE_OPERATIONS_CHAMPION_REPORT;
  if (override) return { ...await readVerified(override), selection: 'explicit-report', fallbackReason: null };
  let manifest: CoreActiveManifest;
  try {
    manifest = JSON.parse(await readFile(options.manifestPath ?? CORE_ACTIVE_MANIFEST, 'utf8')) as CoreActiveManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('CORE_MODEL_MANIFEST_INVALID', { cause: error });
    return { ...await readVerified(CORE_LEGACY_REPORT), selection: 'legacy-default', fallbackReason: null };
  }
  if (manifest.schemaVersion !== 'core-operations-active.v1' || manifest.productionAuthority !== false || manifest.dispatchAllowed !== false) throw new Error('CORE_MODEL_MANIFEST_INVALID');
  try {
    return { ...await readVerified(manifest.active.reportPath, manifest.active), selection: 'active', fallbackReason: null };
  } catch (error) {
    // A corrupt/incompatible upgrade can only fall back to the hash-pinned previous model.
    return { ...await readVerified(manifest.rollback.reportPath, manifest.rollback), selection: 'rollback', fallbackReason: error instanceof Error ? error.message : 'CORE_MODEL_LOAD_FAILED' };
  }
};
export const activateCoreModel = async (reportPath: string, options: { manifestPath?: string; receiptDirectory?: string } = {}) => {
  const candidate = await readVerified(reportPath);
  const previous = await loadActiveCoreModel({ manifestPath: options.manifestPath });
  if (previous.selection === 'active' && previous.reference.sha256 === candidate.reference.sha256) {
    return JSON.parse(await readFile(options.manifestPath ?? CORE_ACTIVE_MANIFEST, 'utf8')) as CoreActiveManifest;
  }
  const manifest: CoreActiveManifest = {
    schemaVersion: 'core-operations-active.v1', changedAt: new Date().toISOString(), active: candidate.reference,
    rollback: previous.reference, productionAuthority: false, dispatchAllowed: false,
  };
  const target = options.manifestPath ?? CORE_ACTIVE_MANIFEST;
  const directory = options.receiptDirectory ?? '.runtime/core-model-switches';
  await mkdir(directory, { recursive: true });
  await mkdir(path.dirname(target), { recursive: true });
  const id = randomUUID();
  const temporary = `${target}.${id}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, target); // Readers see the complete previous or next manifest.
  await writeFile(path.join(directory, `${id}.json`), JSON.stringify({ id, manifest, changed: previous.reference.sha256 !== candidate.reference.sha256 }, null, 2), { flag: 'wx' });
  return manifest;
};
