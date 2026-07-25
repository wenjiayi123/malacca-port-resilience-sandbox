import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const SOURCE_URL = 'https://zenodo.org/api/records/3754481/files/INFORE_AIS_dataset.zip/content';
const SOURCE_PAGE = 'https://zenodo.org/records/3754481';
const SOURCE_DOI = '10.5281/zenodo.3754481';
const EXPECTED_MD5 = '7f33c6f59b4e5979abb3f3f2dbef0090';
const ARCHIVE_MEMBER = 'INFORE_AIS_dataset/ais.csv';
const outputDirectory = path.resolve(process.env.PUBLIC_DATA_RUNTIME_DIR || '.runtime/public-datasets');
const archivePath = process.env.INFORE_AIS_ARCHIVE_PATH
  ? path.resolve(process.env.INFORE_AIS_ARCHIVE_PATH)
  : path.join(outputDirectory, 'INFORE_AIS_dataset.zip');
const outputPath = path.resolve(
  process.env.INFORE_AIS_OUTPUT_PATH ||
  path.join(outputDirectory, 'infore-piraeus-ais-minute.json'),
);

const parseCsvLine = (line) => {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
};

const fileMd5 = async (file) => {
  const hash = createHash('md5');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};

const ensureArchive = async () => {
  await mkdir(path.dirname(archivePath), { recursive: true });
  const existing = await stat(archivePath).catch(() => null);
  if (!existing) {
    const response = await fetch(SOURCE_URL, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`INFORE AIS download failed: HTTP ${response.status}`);
    const temporaryPath = `${archivePath}.tmp`;
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporaryPath));
    await rename(temporaryPath, archivePath);
  }
  const digest = await fileMd5(archivePath);
  if (digest !== EXPECTED_MD5) throw new Error(`INFORE AIS checksum mismatch: ${digest}`);
  return digest;
};

const minuteBuckets = new Map();
let sourceRecordCount = 0;
let rejectedRecordCount = 0;
let firstTimestamp = '';
let lastTimestamp = '';
let previousActive = new Set();

const archiveDigest = await ensureArchive();
const unzip = spawn('unzip', ['-p', archivePath, ARCHIVE_MEMBER], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
const lines = readline.createInterface({ input: unzip.stdout, crlfDelay: Infinity });
let headers = null;
for await (const line of lines) {
  if (!headers) {
    headers = parseCsvLine(line);
    continue;
  }
  const values = parseCsvLine(line);
  const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  sourceRecordCount += 1;
  const timestamp = String(record.t || '');
  const parsedTime = Date.parse(timestamp);
  const vesselId = String(record.shipid || '');
  const speed = Number(record.speed);
  if (!Number.isFinite(parsedTime) || !vesselId || !Number.isFinite(speed)) {
    rejectedRecordCount += 1;
    continue;
  }
  if (!firstTimestamp) firstTimestamp = timestamp;
  lastTimestamp = timestamp;
  const minute = new Date(Math.floor(parsedTime / 60_000) * 60_000).toISOString();
  const bucket = minuteBuckets.get(minute) || {
    timestamp: minute,
    vessels: new Set(),
    movingVessels: new Set(),
    stationaryVessels: new Set(),
    messageCount: 0,
    speedTotal: 0,
  };
  bucket.vessels.add(vesselId);
  if (speed >= 0.5) bucket.movingVessels.add(vesselId);
  else bucket.stationaryVessels.add(vesselId);
  bucket.messageCount += 1;
  bucket.speedTotal += Math.max(0, speed);
  minuteBuckets.set(minute, bucket);
}
const exitCode = await new Promise((resolve, reject) => {
  unzip.once('error', reject);
  unzip.once('close', resolve);
});
if (exitCode !== 0) throw new Error(`unzip exited with code ${exitCode}`);

const records = [...minuteBuckets.values()]
  .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
  .map((bucket) => {
    const activeVessels = bucket.vessels.size;
    const newVessels = [...bucket.vessels].filter((vessel) => !previousActive.has(vessel)).length;
    previousActive = bucket.vessels;
    return {
      port_id: 'GRPIR-AIS-RECEIVER',
      timestamp: bucket.timestamp,
      arrivals: activeVessels,
      gross_tonnage: activeVessels * 30,
      ais_message_count: bucket.messageCount,
      active_vessels: activeVessels,
      newly_observed_vessels: newVessels,
      moving_vessels: bucket.movingVessels.size,
      stationary_vessels: bucket.stationaryVessels.size,
      mean_reported_speed_knots: Number((bucket.speedTotal / Math.max(1, bucket.messageCount)).toFixed(3)),
    };
  })
  .filter((record) => record.arrivals > 0);

await mkdir(path.dirname(outputPath), { recursive: true });
const payload = {
  protocolVersion: 'public-ais-training-package.v1',
  manifest: {
    datasetId: 'infore-single-receiver-piraeus-2020',
    title: 'Single Ground Based AIS Receiver Vessel Tracking Dataset',
    source: 'University of Piraeus / Zenodo',
    sourceUrl: SOURCE_PAGE,
    doi: SOURCE_DOI,
    license: 'CC BY-NC-ND 4.0',
    redistribution: 'raw archive is downloaded by the user and is not redistributed by this repository',
    archiveMd5: archiveDigest,
    rawMessageCount: sourceRecordCount,
    rejectedMessageCount: rejectedRecordCount,
    rawPeriod: [firstTimestamp, lastTimestamp],
    derivedRecordCount: records.length,
    aggregation: 'one-minute unique active-vessel density',
    demandMode: 'ais-active-vessel-density-proxy',
    grossTonnageMode: 'neutral-control-scaling-not-observed-tonnage',
    limitations: [
      'The source covers one receiver near Piraeus for 24 hours; it is not Shanghai or Malacca traffic.',
      'Active-vessel density is not a port-call or terminal-service event.',
      'Gross tonnage, berth capacity, weather, safety and intervention outcomes are not present.',
      'Carbon and field-operation benefit claims are disabled for this package.',
    ],
  },
  records,
};
await writeFile(outputPath, `${JSON.stringify(payload)}\n`, 'utf8');
process.stdout.write(JSON.stringify({
  outputPath,
  rawMessageCount: sourceRecordCount,
  rejectedMessageCount: rejectedRecordCount,
  derivedRecordCount: records.length,
  archiveMd5: archiveDigest,
}, null, 2));
process.stdout.write('\n');
