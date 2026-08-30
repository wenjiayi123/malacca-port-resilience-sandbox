export const VESSEL_SENSOR_TYPES = ['AIS', 'RADAR', 'VTS', 'EO_IR'] as const;
export type VesselSensorType = typeof VESSEL_SENSOR_TYPES[number];

export interface VesselTrackObservation {
  sourceID: string;
  sourceType: VesselSensorType;
  trackID: string;
  MMSI?: string;
  IMO?: string;
  observedAt: string;
  latitude: number;
  longitude: number;
  speedOverGroundKnots: number;
  courseOverGroundDegrees: number;
  horizontalAccuracyMeters: number;
}

export interface FusedVesselTrack {
  vesselIdentity: string;
  observedAt: string;
  latitude: number;
  longitude: number;
  speedOverGroundKnots: number;
  courseOverGroundDegrees: number;
  sourceTypes: VesselSensorType[];
  sourceCount: number;
  quality: 'MULTI_SOURCE_CORRELATED' | 'SINGLE_SOURCE' | 'SOURCE_CONFLICT';
  conflicts: string[];
}

export interface VesselTrafficAssessmentOptions {
  maximumAgeSeconds?: number;
  correlationDistanceNm?: number;
  warningDcpaNm?: number;
  criticalDcpaNm?: number;
  maximumTcpaMinutes?: number;
}

const EARTH_RADIUS_NM = 3440.065;
const ISO_WITH_ZONE = /(?:Z|[+-]\d{2}:\d{2})$/;
const STABLE_ID = /^[A-Za-z0-9._:-]{2,160}$/;

const radians = (degrees: number) => degrees * Math.PI / 180;
const degrees = (radiansValue: number) => radiansValue * 180 / Math.PI;

const distanceNm = (left: Pick<VesselTrackObservation, 'latitude' | 'longitude'>, right: Pick<VesselTrackObservation, 'latitude' | 'longitude'>) => {
  const deltaLatitude = radians(right.latitude - left.latitude);
  const deltaLongitude = radians(right.longitude - left.longitude);
  const latitude1 = radians(left.latitude);
  const latitude2 = radians(right.latitude);
  const a = Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(a)));
};

const validateObservation = (value: VesselTrackObservation, now: Date, maximumAgeSeconds: number) => {
  const errors: string[] = [];
  if (!STABLE_ID.test(value.sourceID)) errors.push('source_id_invalid');
  if (!VESSEL_SENSOR_TYPES.includes(value.sourceType)) errors.push('source_type_invalid');
  if (!STABLE_ID.test(value.trackID)) errors.push('track_id_invalid');
  if (!value.MMSI && !value.IMO) errors.push('vessel_identity_missing');
  if (value.MMSI && !/^\d{9}$/.test(value.MMSI)) errors.push('mmsi_invalid');
  if (value.IMO && !/^\d{7}$/.test(value.IMO)) errors.push('imo_invalid');
  if (!ISO_WITH_ZONE.test(value.observedAt) || Number.isNaN(Date.parse(value.observedAt))) errors.push('observed_at_invalid');
  const ageSeconds = (now.getTime() - Date.parse(value.observedAt)) / 1_000;
  if (ageSeconds < -30) errors.push('observation_from_future');
  if (ageSeconds > maximumAgeSeconds) errors.push('observation_stale');
  if (!Number.isFinite(value.latitude) || value.latitude < -90 || value.latitude > 90) errors.push('latitude_invalid');
  if (!Number.isFinite(value.longitude) || value.longitude < -180 || value.longitude > 180) errors.push('longitude_invalid');
  if (!Number.isFinite(value.speedOverGroundKnots) || value.speedOverGroundKnots < 0 || value.speedOverGroundKnots > 80) errors.push('speed_invalid');
  if (!Number.isFinite(value.courseOverGroundDegrees) || value.courseOverGroundDegrees < 0 || value.courseOverGroundDegrees >= 360) errors.push('course_invalid');
  if (!Number.isFinite(value.horizontalAccuracyMeters) || value.horizontalAccuracyMeters <= 0 || value.horizontalAccuracyMeters > 10_000) {
    errors.push('horizontal_accuracy_invalid');
  }
  return errors;
};

const identity = (observation: VesselTrackObservation) => observation.IMO
  ? `IMO:${observation.IMO}`
  : `MMSI:${observation.MMSI}`;

const fuse = (
  observations: VesselTrackObservation[],
  correlationDistanceNm: number,
): FusedVesselTrack => {
  const latestBySource = new Map<string, VesselTrackObservation>();
  observations.forEach((observation) => {
    const previous = latestBySource.get(observation.sourceID);
    if (!previous || Date.parse(observation.observedAt) > Date.parse(previous.observedAt)) {
      latestBySource.set(observation.sourceID, observation);
    }
  });
  const candidates = [...latestBySource.values()];
  const conflicts: string[] = [];
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const left = candidates[leftIndex];
      const right = candidates[rightIndex];
      const uncertaintyNm = (left.horizontalAccuracyMeters + right.horizontalAccuracyMeters) * 3 / 1852;
      const allowedDistance = Math.max(correlationDistanceNm, uncertaintyNm);
      const separation = distanceNm(left, right);
      if (separation > allowedDistance) {
        conflicts.push(`${left.sourceID}:${right.sourceID}:${separation.toFixed(3)}nm`);
      }
    }
  }
  const weights = candidates.map((candidate) => 1 / Math.max(1, candidate.horizontalAccuracyMeters) ** 2);
  const weightSum = weights.reduce((total, weight) => total + weight, 0);
  const latitude = candidates.reduce((total, candidate, index) => total + candidate.latitude * weights[index], 0) / weightSum;
  const longitude = candidates.reduce((total, candidate, index) => total + candidate.longitude * weights[index], 0) / weightSum;
  const eastVelocity = candidates.reduce((total, candidate, index) =>
    total + candidate.speedOverGroundKnots * Math.sin(radians(candidate.courseOverGroundDegrees)) * weights[index], 0) / weightSum;
  const northVelocity = candidates.reduce((total, candidate, index) =>
    total + candidate.speedOverGroundKnots * Math.cos(radians(candidate.courseOverGroundDegrees)) * weights[index], 0) / weightSum;
  const speed = Math.hypot(eastVelocity, northVelocity);
  const course = (degrees(Math.atan2(eastVelocity, northVelocity)) + 360) % 360;
  const sourceTypes = [...new Set(candidates.map((candidate) => candidate.sourceType))];
  return {
    vesselIdentity: identity(candidates[0]),
    observedAt: candidates.map((candidate) => candidate.observedAt)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0],
    latitude,
    longitude,
    speedOverGroundKnots: speed,
    courseOverGroundDegrees: course,
    sourceTypes,
    sourceCount: candidates.length,
    quality: conflicts.length
      ? 'SOURCE_CONFLICT'
      : sourceTypes.length >= 2 ? 'MULTI_SOURCE_CORRELATED' : 'SINGLE_SOURCE',
    conflicts,
  };
};

const relativePositionNm = (left: FusedVesselTrack, right: FusedVesselTrack) => {
  const meanLatitude = radians((left.latitude + right.latitude) / 2);
  return {
    east: (right.longitude - left.longitude) * 60 * Math.cos(meanLatitude),
    north: (right.latitude - left.latitude) * 60,
  };
};

const velocity = (track: FusedVesselTrack) => ({
  east: track.speedOverGroundKnots * Math.sin(radians(track.courseOverGroundDegrees)),
  north: track.speedOverGroundKnots * Math.cos(radians(track.courseOverGroundDegrees)),
});

export const assessVesselTraffic = (
  values: VesselTrackObservation[],
  now = new Date(),
  options: VesselTrafficAssessmentOptions = {},
) => {
  const maximumAgeSeconds = options.maximumAgeSeconds ?? 120;
  const correlationDistanceNm = options.correlationDistanceNm ?? 0.5;
  const warningDcpaNm = options.warningDcpaNm ?? 1;
  const criticalDcpaNm = options.criticalDcpaNm ?? 0.5;
  const maximumTcpaMinutes = options.maximumTcpaMinutes ?? 60;
  const rejectedObservations: Array<{ index: number; errors: string[] }> = [];
  const accepted: VesselTrackObservation[] = [];
  values.forEach((value, index) => {
    const errors = validateObservation(value, now, maximumAgeSeconds);
    if (errors.length) rejectedObservations.push({ index, errors });
    else accepted.push(structuredClone(value));
  });
  const grouped = new Map<string, VesselTrackObservation[]>();
  accepted.forEach((observation) => grouped.set(identity(observation), [
    ...(grouped.get(identity(observation)) ?? []),
    observation,
  ]));
  const tracks = [...grouped.values()].map((observations) => fuse(observations, correlationDistanceNm));
  const encounters = [];
  for (let leftIndex = 0; leftIndex < tracks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < tracks.length; rightIndex += 1) {
      const left = tracks[leftIndex];
      const right = tracks[rightIndex];
      const scantyInformation = left.quality !== 'MULTI_SOURCE_CORRELATED' || right.quality !== 'MULTI_SOURCE_CORRELATED';
      const position = relativePositionNm(left, right);
      const leftVelocity = velocity(left);
      const rightVelocity = velocity(right);
      const relativeVelocity = {
        east: rightVelocity.east - leftVelocity.east,
        north: rightVelocity.north - leftVelocity.north,
      };
      const velocitySquared = relativeVelocity.east ** 2 + relativeVelocity.north ** 2;
      const tcpaHours = velocitySquared < 1e-9
        ? Number.POSITIVE_INFINITY
        : -(position.east * relativeVelocity.east + position.north * relativeVelocity.north) / velocitySquared;
      const cpaPosition = tcpaHours > 0 && Number.isFinite(tcpaHours)
        ? {
            east: position.east + relativeVelocity.east * tcpaHours,
            north: position.north + relativeVelocity.north * tcpaHours,
          }
        : position;
      const dcpaNm = Math.hypot(cpaPosition.east, cpaPosition.north);
      const tcpaMinutes = Number.isFinite(tcpaHours) ? tcpaHours * 60 : null;
      let risk: 'INSUFFICIENT_DATA' | 'LOW' | 'WARNING' | 'CRITICAL' = 'LOW';
      if (scantyInformation) risk = 'INSUFFICIENT_DATA';
      else if (tcpaMinutes !== null && tcpaMinutes >= 0 && tcpaMinutes <= 30 && dcpaNm <= criticalDcpaNm) risk = 'CRITICAL';
      else if (tcpaMinutes !== null && tcpaMinutes >= 0 && tcpaMinutes <= maximumTcpaMinutes && dcpaNm <= warningDcpaNm) risk = 'WARNING';
      encounters.push({
        vessels: [left.vesselIdentity, right.vesselIdentity],
        risk,
        dcpaNm: Number(dcpaNm.toFixed(3)),
        tcpaMinutes: tcpaMinutes === null ? null : Number(tcpaMinutes.toFixed(2)),
        informationSufficient: !scantyInformation,
        response: risk === 'WARNING' || risk === 'CRITICAL' ? 'VTS_OPERATOR_REVIEW' : 'MONITOR',
        automaticManeuverAllowed: false,
        colregsDecisionAuthority: false,
      });
    }
  }
  return {
    protocolVersion: 'vessel-traffic-safety-assessment.v1',
    generatedAt: now.toISOString(),
    inputObservationCount: values.length,
    acceptedObservationCount: accepted.length,
    rejectedObservations,
    tracks,
    encounters,
    criticalEncounterCount: encounters.filter((encounter) => encounter.risk === 'CRITICAL').length,
    warningEncounterCount: encounters.filter((encounter) => encounter.risk === 'WARNING').length,
    insufficientInformationCount: encounters.filter((encounter) => encounter.risk === 'INSUFFICIENT_DATA').length,
    safetyBoundary: {
      advisoryOnly: true,
      assumptionsFromScantyInformationProhibited: true,
      vtsOperatorReviewRequired: true,
      automaticManeuverAllowed: false,
      dispatchAllowed: false,
      productionAuthority: false,
    },
  };
};
