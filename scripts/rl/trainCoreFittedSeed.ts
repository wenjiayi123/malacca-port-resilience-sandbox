import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadGroupedCoreDataset } from '../../server/coreOperationsGroupedDataset.ts';
import { trainFittedCorePolicy } from '../../server/coreOperationsFittedRl.ts';
const [directory, seedText] = process.argv.slice(2);
const seed = Number(seedText);
if (!directory || !Number.isInteger(seed)) throw new Error('directory and seed required');
const protocol = JSON.parse(await readFile(`${directory}/protocol.json`, 'utf8'));
if (!protocol.configuration.seeds.includes(seed)) throw new Error('seed not preregistered');
if (createHash('sha256').update(await readFile('server/coreOperationsFittedRl.ts')).digest('hex') !== protocol.trainingSourceSha256) throw new Error('training source changed');
const d = await loadGroupedCoreDataset();
if (d.fingerprint !== protocol.datasetFingerprint) throw new Error('dataset changed');
const result = trainFittedCorePolicy(d.trainRecords, d.validationRecords, { ...protocol.configuration, seed,
  onIteration:p=> { if(p.iteration % 5 === 0) console.log(JSON.stringify({seed,...p})); },
});
await writeFile(`${directory}/seed-${seed}.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify(result.convergence));
