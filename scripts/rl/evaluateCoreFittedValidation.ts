import { evaluateCoreRobustness } from '../../server/coreOperationsRobustEvaluation.ts';
import { readFile, writeFile } from 'node:fs/promises';
import { loadGroupedCoreDataset } from '../../server/coreOperationsGroupedDataset.ts';
import { coreEnsembleAgreement, evaluateDeployedCore, type FittedTrainingResult } from '../../server/coreOperationsFittedRl.ts';
import { CORE_OPERATIONS_EVALUATION_SCENARIOS, coreBusinessValueGate, evaluateCorePolicy } from '../../server/coreOperationsRlEngine.ts';
const directory = process.argv[2];
const d = await loadGroupedCoreDataset();
const protocol = JSON.parse(await readFile(`${directory}/protocol.json`, 'utf8'));
if (d.fingerprint !== protocol.datasetFingerprint) throw new Error('dataset mismatch');
const results: FittedTrainingResult[] = await Promise.all(protocol.configuration.seeds.map(async (seed: number) => JSON.parse(await readFile(`${directory}/seed-${seed}.json`, 'utf8'))));
const policies = results.map((r) => r.policy);
const old = JSON.parse(await readFile('reports/core-operations-rl-champion-v1.json', 'utf8')).training.champion.seedPolicies;
const evaluations = CORE_OPERATIONS_EVALUATION_SCENARIOS.map((s) => evaluateDeployedCore(policies, d.validationRecords, s));
const baselines = CORE_OPERATIONS_EVALUATION_SCENARIOS.map((s) => evaluateCorePolicy({ kind: 'standard-operating-procedure' }, d.validationRecords, s));
const oldEvaluations = CORE_OPERATIONS_EVALUATION_SCENARIOS.map((s) => evaluateDeployedCore(old, d.validationRecords, s));
const validation = { allSeedsConverged: results.every((r) => r.convergence.passed), convergence: results.map((r) => ({seed:r.policy.hyperparameters.seed,...r.convergence})),
  gate: coreBusinessValueGate(evaluations, baselines), evaluations, baselines, oldEvaluations,
  agreement: coreEnsembleAgreement(policies, d.validationRecords), oldAgreement: coreEnsembleAgreement(old, d.validationRecords) };
await writeFile(`${directory}/validation.json`, JSON.stringify(validation, null, 2), { flag: 'wx' });
console.log(JSON.stringify(validation, null, 2));

const robust = evaluateCoreRobustness(policies, old, d.validationRecords);
await writeFile(`${directory}/robust-validation.json`, JSON.stringify(robust, null, 2), { flag: 'wx' });
console.log(JSON.stringify({robustValidationPassed: robust.gate.passed, checks: robust.gate.checks}));
