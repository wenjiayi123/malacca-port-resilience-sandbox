import type { GodotValidationResult } from '../types/sandbox';

const isNonemptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isNonnegativeNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isCount = (value: unknown): value is number => isNonnegativeNumber(value) && Number.isSafeInteger(value);

export const isGodotValidationResult = (value: unknown): value is GodotValidationResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<GodotValidationResult>;
  const nonnegativeFields: Array<keyof GodotValidationResult> = [
    'estimatedTravelMinutes', 'recommendedSpeedKnots', 'simulatedDurationSeconds', 'averageSpeedKnots',
  ];
  const countFields: Array<keyof GodotValidationResult> = [
    'collisionCount', 'groundingCount', 'riskEventResolvedCount',
  ];
  const signedFields: Array<keyof GodotValidationResult> = ['minClearanceMeters', 'delayDeltaMinutes', 'carbonDeltaTons'];
  return Boolean(
    isNonemptyString(candidate.requestId) &&
    isNonemptyString(candidate.vesselId) &&
    isNonemptyString(candidate.summary) &&
    // Only completed validation can close the App's metric-feedback workflow.
    ['passed', 'failed', 'degraded'].includes(candidate.status ?? '') &&
    ['low', 'medium', 'high', 'critical'].includes(candidate.riskLevel ?? '') &&
    typeof candidate.safePass === 'boolean' &&
    typeof candidate.reachedDestination === 'boolean' &&
    nonnegativeFields.every((field) => isNonnegativeNumber(candidate[field])) &&
    countFields.every((field) => isCount(candidate[field])) &&
    signedFields.every((field) => Number.isFinite(candidate[field])) &&
    (candidate.status !== 'passed' || candidate.safePass) &&
    (candidate.status !== 'failed' || !candidate.safePass) &&
    (!candidate.safePass || (candidate.collisionCount === 0 && candidate.groundingCount === 0)) &&
    (candidate.loadedScene === undefined || (candidate.loadedScene !== null &&
      typeof candidate.loadedScene === 'object' && !Array.isArray(candidate.loadedScene) &&
      isCount(candidate.loadedScene.routePointCount) &&
      isCount(candidate.loadedScene.riskZoneCount) &&
      isCount(candidate.loadedScene.temporaryObstacleCount))),
  );
};

/** A 200 SPA fallback is not a Godot export. Inspect its declared core artifacts. */
export async function checkGodotWebExport(url: string, signal?: AbortSignal): Promise<boolean> {
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000);
  const response = await fetch(url, { cache: 'no-store', signal: requestSignal });
  if (!response.ok) return false;
  const html = await response.text();
  const configuration = html.match(/\b(?:const|let|var)\s+GODOT_CONFIG\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (!configuration || !/new\s+Engine\s*\(\s*GODOT_CONFIG\s*\)/.test(html)) return false;
  let config: { executable?: unknown; fileSizes?: unknown };
  try { config = JSON.parse(configuration[1]); } catch { return false; }
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      typeof config.executable !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(config.executable) ||
      !config.fileSizes || typeof config.fileSizes !== 'object' || Array.isArray(config.fileSizes)) return false;
  const sizes = config.fileSizes as Record<string, unknown>;
  const executable = config.executable;
  if (['wasm', 'pck'].some((extension) => !isCount(sizes[`${executable}.${extension}`]) || sizes[`${executable}.${extension}`] === 0)) return false;
  const base = url.slice(0, url.lastIndexOf('/') + 1);
  const artifacts = ['js', 'wasm', 'pck'].map((extension) => `${executable}.${extension}`);
  const results = await Promise.all(artifacts.map(async (artifact) => {
    const asset = await fetch(`${base}${artifact}`, { method: 'HEAD', cache: 'no-store', signal: requestSignal });
    const contentType = (asset.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const allowedTypes = artifact.endsWith('.js')
      ? ['application/javascript', 'text/javascript', 'application/ecmascript', 'text/ecmascript', 'application/octet-stream']
      : artifact.endsWith('.wasm') ? ['application/wasm', 'application/octet-stream'] : ['application/octet-stream', 'application/x-godot-pck'];
    if (!asset.ok || !allowedTypes.includes(contentType)) return false;
    const expected = sizes[artifact];
    const length = asset.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) <= 0)) return false;
    const encoding = asset.headers.get('content-encoding');
    // Godot records uncompressed sizes, while an encoded HEAD can report compressed bytes.
    return !expected || length === null || (encoding !== null && encoding !== 'identity') || Number(length) === expected;
  }));
  return results.every(Boolean);
}
