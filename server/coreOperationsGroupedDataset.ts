import { createHash } from 'node:crypto';
import { loadPortBusinessDataset, type PortBusinessDataset } from './portBusinessDataset.ts';

/** Keep all four engineering variants of a public monthly anchor in the same split. */
export const groupCoreDatasetBySourceMonth = (dataset: PortBusinessDataset): PortBusinessDataset => {
  const months = [...new Set(dataset.records.map((r) => r.sourceMonth))].sort();
  if (months.length < 20 || months.some((m) => !/^\d{4}-\d{2}$/.test(m))) throw new Error('source-month grouping unavailable');
  const trainEnd = Math.floor(months.length * 0.7);
  const validationEnd = Math.floor(months.length * 0.85);
  const trainMonths = new Set(months.slice(0, trainEnd));
  const validationMonths = new Set(months.slice(trainEnd, validationEnd));
  const testMonths = new Set(months.slice(validationEnd));
  const trainRecords = dataset.records.filter((r) => trainMonths.has(r.sourceMonth));
  const validationRecords = dataset.records.filter((r) => validationMonths.has(r.sourceMonth));
  const testRecords = dataset.records.filter((r) => testMonths.has(r.sourceMonth));
  if (trainRecords.at(-1)!.timestamp >= validationRecords[0].timestamp || validationRecords.at(-1)!.timestamp >= testRecords[0].timestamp) throw new Error('chronological grouping failed');
  return {
    ...dataset,
    id: `${dataset.id}-month-grouped-v2`,
    fingerprint: createHash('sha256').update(JSON.stringify({ base: dataset.fingerprint, protocol: 'source-month-grouped.v1', train: [...trainMonths], validation: [...validationMonths], test: [...testMonths] })).digest('hex'),
    trainRecords, validationRecords, testRecords,
    split: { ...dataset.split,
      trainRange: [trainRecords[0].timestamp, trainRecords.at(-1)!.timestamp],
      validationRange: [validationRecords[0].timestamp, validationRecords.at(-1)!.timestamp],
      testRange: [testRecords[0].timestamp, testRecords.at(-1)!.timestamp],
    },
    limitations: [...dataset.limitations, 'v2 groups every variant of a source month before splitting; historical test dates remain a regression set, not a new prospective site trial.'],
  };
};
export const loadGroupedCoreDataset = async () => groupCoreDatasetBySourceMonth(await loadPortBusinessDataset());
