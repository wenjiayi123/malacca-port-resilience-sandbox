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

const percentile = (values, ratio) => {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
};

const firstMonth = normalized[0].month;
const lastMonth = normalized.at(-1).month;
const startYear = Number(firstMonth.slice(0, 4));
const endYear = Number(lastMonth.slice(0, 4));
const monthEnd = (month) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const day = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
};
const dailyWindByMonth = new Map();

// Fetch in bounded chunks so a reproducible refresh does not depend on one
// oversized response. ERA5 daily maximum 10 m wind is aggregated to a monthly
// P95: the monthly demand sample remains unchanged, while the weather feature
// represents high-wind exposure rather than an arbitrary single day.
for (let chunkStart = startYear; chunkStart <= endYear; chunkStart += 5) {
  const chunkEnd = Math.min(endYear, chunkStart + 4);
  const requestedStart = chunkStart === startYear ? `${firstMonth}-01` : `${chunkStart}-01-01`;
  const requestedEnd = chunkEnd === endYear ? monthEnd(lastMonth) : `${chunkEnd}-12-31`;
  const archiveUrl = new URL('https://archive-api.open-meteo.com/v1/archive');
  archiveUrl.searchParams.set('latitude', '1.22');
  archiveUrl.searchParams.set('longitude', '103.75');
  archiveUrl.searchParams.set('start_date', requestedStart);
  archiveUrl.searchParams.set('end_date', requestedEnd);
  archiveUrl.searchParams.set('daily', 'wind_speed_10m_max');
  archiveUrl.searchParams.set('wind_speed_unit', 'ms');
  archiveUrl.searchParams.set('timezone', 'Asia/Singapore');
  archiveUrl.searchParams.set('models', 'era5');
  archiveUrl.searchParams.set('cell_selection', 'sea');

  const archiveResponse = await fetch(archiveUrl, { signal: AbortSignal.timeout(60_000) });
  if (!archiveResponse.ok) throw new Error(`Open-Meteo Archive HTTP ${archiveResponse.status}`);
  const archive = await archiveResponse.json();
  const times = archive?.daily?.time;
  const winds = archive?.daily?.wind_speed_10m_max;
  if (!Array.isArray(times) || !Array.isArray(winds) || times.length !== winds.length) {
    throw new Error('Open-Meteo Archive response does not contain aligned daily wind values');
  }
  for (let index = 0; index < times.length; index += 1) {
    const wind = Number(winds[index]);
    if (!Number.isFinite(wind) || wind < 0) continue;
    const month = String(times[index]).slice(0, 7);
    const values = dailyWindByMonth.get(month) ?? [];
    values.push(wind);
    dailyWindByMonth.set(month, values);
  }
}

const monthlyWindP95 = new Map(
  [...dailyWindByMonth].map(([month, values]) => [month, percentile(values, 0.95)]),
);
const missingWindMonths = normalized
  .map((record) => record.month)
  .filter((month) => !Number.isFinite(monthlyWindP95.get(month)));
if (missingWindMonths.length) {
  throw new Error(`Open-Meteo Archive is missing ${missingWindMonths.length} requested months`);
}

const destination = path.resolve('data/rl/mpa_vessel_arrivals_monthly.csv');
await mkdir(path.dirname(destination), { recursive: true });
const csv = [
  'month,number_of_vessels,gross_tonnage,wind_speed_ms',
  ...normalized.map((record) =>
    `${record.month},${record.numberOfVessels},${record.grossTonnage},${monthlyWindP95.get(record.month).toFixed(2)}`),
  '',
].join('\n');
await writeFile(destination, csv, 'utf8');
console.log(`Wrote ${normalized.length} MPA records with ${monthlyWindP95.size} Open-Meteo ERA5 monthly wind features to ${destination}`);
