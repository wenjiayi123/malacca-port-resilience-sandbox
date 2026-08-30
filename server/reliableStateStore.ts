import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { canonicalJson } from './operatorIntegrationGateway.ts';

interface StateEnvelope<T> {
  protocolVersion: 'durable-state-envelope.v1';
  storeID: string;
  generation: number;
  committedAt: string;
  previousStateSha256: string | null;
  payloadSha256: string;
  payload: T;
  envelopeSha256: string;
}

interface JournalRecord {
  protocolVersion: 'durable-state-journal.v1';
  sequence: number;
  generation: number;
  committedAt: string;
  stateSha256: string;
  previousJournalHash: string;
  hash: string;
}

export interface DurableStateStoreOptions {
  directory: string;
  storeID: string;
  clock?: () => Date;
  maximumPayloadBytes?: number;
}

const SHA256 = /^[a-f0-9]{64}$/;
const STABLE_ID = /^[A-Za-z0-9._:-]{2,120}$/;
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

const atomicWrite = (file: string, body: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const descriptor = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(descriptor, body, 'utf8');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, file);
  const directoryDescriptor = openSync(path.dirname(file), 'r');
  try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
};

const parseEnvelope = <T>(body: string, storeID: string): StateEnvelope<T> => {
  const value = JSON.parse(body) as StateEnvelope<T>;
  if (value.protocolVersion !== 'durable-state-envelope.v1' || value.storeID !== storeID ||
      !Number.isInteger(value.generation) || value.generation < 1 || !SHA256.test(value.payloadSha256) ||
      !SHA256.test(value.envelopeSha256)) throw new Error('state_envelope_invalid');
  if (sha256(canonicalJson(value.payload)) !== value.payloadSha256) throw new Error('state_payload_digest_mismatch');
  const { envelopeSha256, ...unsigned } = value;
  if (sha256(canonicalJson(unsigned)) !== envelopeSha256) throw new Error('state_envelope_digest_mismatch');
  return value;
};

export class DurableStateStore<T> {
  readonly directory: string;
  readonly storeID: string;
  readonly clock: () => Date;
  readonly maximumPayloadBytes: number;
  readonly primaryFile: string;
  readonly previousFile: string;
  readonly journalFile: string;

  constructor(options: DurableStateStoreOptions) {
    if (!path.isAbsolute(options.directory)) throw new Error('state_directory_must_be_absolute');
    if (!STABLE_ID.test(options.storeID)) throw new Error('store_id_invalid');
    this.directory = options.directory;
    this.storeID = options.storeID;
    this.clock = options.clock ?? (() => new Date());
    this.maximumPayloadBytes = options.maximumPayloadBytes ?? 8 * 1_048_576;
    this.primaryFile = path.join(this.directory, 'state.json');
    this.previousFile = path.join(this.directory, 'state.previous.json');
    this.journalFile = path.join(this.directory, 'journal.jsonl');
  }

  load() {
    const errors: string[] = [];
    for (const [source, file] of [['primary', this.primaryFile], ['previous', this.previousFile]] as const) {
      if (!existsSync(file)) continue;
      try {
        const envelope = parseEnvelope<T>(readFileSync(file, 'utf8'), this.storeID);
        return { found: true as const, source, envelope, recoveryErrors: errors };
      } catch (error) {
        errors.push(`${source}:${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { found: false as const, source: null, envelope: null, recoveryErrors: errors };
  }

  commit(payload: T, expectedGeneration: number | null) {
    const serializedPayload = canonicalJson(payload);
    if (Buffer.byteLength(serializedPayload) > this.maximumPayloadBytes) throw new Error('state_payload_too_large');
    const current = this.load();
    if (current.recoveryErrors.length) throw new Error('state_recovery_required_before_commit');
    const currentGeneration = current.found ? current.envelope.generation : 0;
    if (expectedGeneration !== null && expectedGeneration !== currentGeneration) throw new Error('state_generation_conflict');
    const journal = this.verifyJournal();
    if (!journal.verified) throw new Error(`journal_integrity_failed:${journal.errors.join(',')}`);
    const unsigned = {
      protocolVersion: 'durable-state-envelope.v1' as const,
      storeID: this.storeID,
      generation: currentGeneration + 1,
      committedAt: this.clock().toISOString(),
      previousStateSha256: current.found ? current.envelope.envelopeSha256 : null,
      payloadSha256: sha256(serializedPayload),
      payload: structuredClone(payload),
    };
    const envelope: StateEnvelope<T> = {
      ...unsigned,
      envelopeSha256: sha256(canonicalJson(unsigned)),
    };
    mkdirSync(this.directory, { recursive: true });
    if (existsSync(this.primaryFile)) copyFileSync(this.primaryFile, this.previousFile);
    atomicWrite(this.primaryFile, `${JSON.stringify(envelope, null, 2)}\n`);
    const recordBase = {
      protocolVersion: 'durable-state-journal.v1' as const,
      sequence: journal.recordCount + 1,
      generation: envelope.generation,
      committedAt: envelope.committedAt,
      stateSha256: envelope.envelopeSha256,
      previousJournalHash: journal.headHash,
    };
    const record: JournalRecord = { ...recordBase, hash: sha256(canonicalJson(recordBase)) };
    appendFileSync(this.journalFile, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    const descriptor = openSync(this.journalFile, 'r');
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
    return envelope;
  }

  verifyJournal() {
    if (!existsSync(this.journalFile)) return { verified: true, recordCount: 0, headHash: '0'.repeat(64), errors: [] as string[] };
    const errors: string[] = [];
    let previous = '0'.repeat(64);
    const records = readFileSync(this.journalFile, 'utf8').split('\n').filter(Boolean).map((line, index) => {
      try { return JSON.parse(line) as JournalRecord; } catch { errors.push(`journal_line_invalid:${index + 1}`); return null; }
    }).filter((value): value is JournalRecord => value !== null);
    records.forEach((record, index) => {
      const { hash, ...base } = record;
      if (record.sequence !== index + 1 || record.previousJournalHash !== previous || hash !== sha256(canonicalJson(base))) {
        errors.push(`journal_chain_invalid:${index + 1}`);
      }
      previous = hash;
    });
    return { verified: errors.length === 0, recordCount: records.length, headHash: previous, errors };
  }

  disasterRecoveryCheck() {
    const loaded = this.load();
    const journal = this.verifyJournal();
    return {
      protocolVersion: 'durable-state-recovery-check.v1',
      checkedAt: this.clock().toISOString(),
      stateRecoverable: loaded.found,
      recoveredFrom: loaded.source,
      generation: loaded.envelope?.generation ?? 0,
      recoveryErrors: loaded.recoveryErrors,
      journalVerified: journal.verified,
      journalRecordCount: journal.recordCount,
      journalHeadHash: journal.headHash,
      rawRestorePayloadReleased: false,
    };
  }
}

export interface FencingToken {
  protocolVersion: 'fencing-token.v1';
  leaseID: string;
  holderID: string;
  fencingNumber: number;
  acquiredAt: string;
  expiresAt: string;
}

export class FileFencedLease {
  readonly leaseFile: string;
  readonly updateLockFile: string;
  readonly clock: () => Date;

  constructor(directory: string, clock: () => Date = () => new Date()) {
    if (!path.isAbsolute(directory)) throw new Error('lease_directory_must_be_absolute');
    this.leaseFile = path.join(directory, 'leader-lease.json');
    this.updateLockFile = path.join(directory, 'leader-lease.update.lock');
    this.clock = clock;
  }

  private read(): FencingToken | null {
    if (!existsSync(this.leaseFile)) return null;
    try { return JSON.parse(readFileSync(this.leaseFile, 'utf8')) as FencingToken; } catch { throw new Error('leader_lease_corrupt'); }
  }

  acquire(holderID: string, ttlSeconds: number) {
    if (!STABLE_ID.test(holderID) || !Number.isInteger(ttlSeconds) || ttlSeconds < 5 || ttlSeconds > 300) throw new Error('lease_request_invalid');
    mkdirSync(path.dirname(this.leaseFile), { recursive: true });
    let updateDescriptor: number;
    try {
      updateDescriptor = openSync(this.updateLockFile, 'wx', 0o600);
    } catch {
      throw new Error('leader_lease_update_in_progress');
    }
    try {
      const now = this.clock();
      const current = this.read();
      if (current && Date.parse(current.expiresAt) > now.getTime() && current.holderID !== holderID) throw new Error('leader_lease_held');
      const token: FencingToken = {
        protocolVersion: 'fencing-token.v1',
        leaseID: randomUUID(),
        holderID,
        fencingNumber: (current?.fencingNumber ?? 0) + 1,
        acquiredAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlSeconds * 1_000).toISOString(),
      };
      atomicWrite(this.leaseFile, `${JSON.stringify(token, null, 2)}\n`);
      return token;
    } finally {
      closeSync(updateDescriptor);
      unlinkSync(this.updateLockFile);
    }
  }

  assertCurrent(token: FencingToken) {
    const current = this.read();
    if (!current || current.leaseID !== token.leaseID || current.fencingNumber !== token.fencingNumber ||
        Date.parse(current.expiresAt) <= this.clock().getTime()) throw new Error('stale_fencing_token');
    return true;
  }
}

export const assessReliabilityReadiness = (input: {
  replicaCount: number;
  backupAgeMinutes: number;
  restoreDrillAgeDays: number;
  restoreDrillPassed: boolean;
  journalVerified: boolean;
  alertRouteTested: boolean;
  runbookReviewed: boolean;
  observedAvailabilityDays: number;
  observedAvailabilityPercent: number;
}) => {
  const blockers: string[] = [];
  if (input.replicaCount < 2) blockers.push('redundant_replica_missing');
  if (input.backupAgeMinutes > 15) blockers.push('rpo_15_minutes_not_met');
  if (input.restoreDrillAgeDays > 90 || !input.restoreDrillPassed) blockers.push('restore_drill_not_current');
  if (!input.journalVerified) blockers.push('journal_integrity_failed');
  if (!input.alertRouteTested) blockers.push('alert_route_not_tested');
  if (!input.runbookReviewed) blockers.push('runbook_not_reviewed');
  if (input.observedAvailabilityDays < 30 || input.observedAvailabilityPercent < 99.9) blockers.push('availability_slo_not_evidenced');
  return {
    protocolVersion: 'reliability-readiness.v1',
    softwareControlsReady: blockers.filter((blocker) => !['redundant_replica_missing', 'availability_slo_not_evidenced'].includes(blocker)).length === 0,
    siteReliabilityAccepted: blockers.length === 0,
    blockers,
    targets: { rpoMinutes: 15, rtoMinutes: 60, availabilityPercent: 99.9, observationDays: 30 },
    authority: { dispatchAllowed: false, productionAuthority: false },
  };
};
