import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const datasetId = 'd_d48c5a038904f6da3c603cd854b6c191';
const endpoint = new URL('https://data.gov.sg/api/action/datastore_search');
endpoint.searchParams.set('resource_id', datasetId);
endpoint.searchParams.set('limit', '1000');
endpoint.searchParams.set('sort', 'month asc');

const response = await fetch(endpoint, { signal: AbortSignal.timeout(20_000) });
if (!response.ok) throw new Error(`data.gov.sg HTTP ${response.status}`);
const payload = await response.json();
const records = payload?.result?.records;
if (!payload?.success || !Array.isArray(records) || records.length < 12) {
  throw new Error('data.gov.sg response does not contain enough records');
}

const normalized = records.map((record) => ({
  month: String(record.month),
  numberOfVessels: Number(record.number_of_vessels),
  grossTonnage: Number(record.gross_tonnage),
}));
if (normalized.some((record) => !record.month || !Number.isFinite(record.numberOfVessels) || !Number.isFinite(record.grossTonnage))) {
  throw new Error('data.gov.sg dataset contains invalid required fields');
}

const destination = path.resolve('data/rl/mpa_vessel_arrivals_monthly.csv');
await mkdir(path.dirname(destination), { recursive: true });
const csv = [
  'month,number_of_vessels,gross_tonnage',
  ...normalized.map((record) => `${record.month},${record.numberOfVessels},${record.grossTonnage}`),
  '',
].join('\n');
await writeFile(destination, csv, 'utf8');
console.log(`Wrote ${normalized.length} records to ${destination}`);
