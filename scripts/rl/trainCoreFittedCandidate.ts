import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadGroupedCoreDataset } from '../../server/coreOperationsGroupedDataset.ts';
import { trainFittedCorePolicy } from '../../server/coreOperationsFittedRl.ts';
const directory = process.argv[2];
if (!directory || !/^\.runtime\/core-fitted-[a-z0-9-]+$/.test(directory)) throw new Error('provide unique .runtime/core-fitted-<run-id> directory');
await mkdir(directory); // Never overwrite a prior training attempt.
const dataset = await loadGroupedCoreDataset();
const configuration = { seeds: [17, 37, 59, 83, 101], iterations: 40, samples: 192, damping: 0.15, rolloutHorizon: 4, ridge: 0.03 };
await writeFile(`${directory}/protocol.json`, JSON.stringify({ configuration, datasetFingerprint: dataset.fingerprint, split: dataset.split,
  trainingSourceSha256: createHash('sha256').update(await readFile('server/coreOperationsFittedRl.ts')).digest('hex'),
  evaluation: 'validation-only; historical final-test records are not read by this experiment',
  convergence: 'last 5: action change <=2%, validation reward range <=0.003; all five seeds required',
}, null, 2));
if (process.argv.includes('--prepare-only')) process.exit(0);
for (const seed of configuration.seeds) {
  const result = trainFittedCorePolicy(dataset.trainRecords, dataset.validationRecords, { ...configuration, seed,
    onIteration: (p) => { if (p.iteration % 5 === 0) console.log(JSON.stringify({ seed, ...p })); },
  });
  await writeFile(`${directory}/seed-${seed}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ seed, convergence: result.convergence }));
}
await import('./evaluateCoreFittedValidation.ts');
