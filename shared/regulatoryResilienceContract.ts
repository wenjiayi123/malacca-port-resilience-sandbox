export const REGULATORY_RESILIENCE_CONTRACT_VERSION = 'port-regulatory-resilience.v1' as const;

export type RegulatoryScenarioId =
  | 'baseline'
  | 'maritime-inspection'
  | 'customs-document-hold'
  | 'dual-inspection-recovery';

export const REGULATORY_AUTHORITY_BOUNDARY = {
  inspection_selection_exogenous: true,
  inspection_outcome_exogenous: true,
  official_release_exogenous: true,
  terminal_readiness_controllable: true,
  post_release_recovery_controllable: true,
  simulation_mode: true,
  live_data_verified: false,
  dispatch_allowed: false,
  production_authority: false,
} as const;

export const REGULATORY_OBSERVATION_CONTRACT = [
  'maritime_inspection_ratio',
  'customs_inspection_ratio',
  'maritime_release_ratio',
  'customs_release_ratio',
  'document_readiness_ratio',
  'inspection_resource_available_ratio',
  'expected_hold_hours',
  'maritime_hold_to_capacity',
  'customs_hold_to_capacity',
  'released_recovery_to_capacity',
  'queue_to_capacity',
  'energy_carbon_pressure',
] as const;

export const REGULATORY_SUPPLEMENT_ACTIONS = [
  { id: 'readiness-20-recovery-30', readinessRatio: 0.2, recoveryPriorityRatio: 0.3 },
  { id: 'readiness-20-recovery-60', readinessRatio: 0.2, recoveryPriorityRatio: 0.6 },
  { id: 'readiness-20-recovery-90', readinessRatio: 0.2, recoveryPriorityRatio: 0.9 },
  { id: 'readiness-50-recovery-30', readinessRatio: 0.5, recoveryPriorityRatio: 0.3 },
  { id: 'readiness-50-recovery-60', readinessRatio: 0.5, recoveryPriorityRatio: 0.6 },
  { id: 'readiness-50-recovery-90', readinessRatio: 0.5, recoveryPriorityRatio: 0.9 },
  { id: 'readiness-80-recovery-30', readinessRatio: 0.8, recoveryPriorityRatio: 0.3 },
  { id: 'readiness-80-recovery-60', readinessRatio: 0.8, recoveryPriorityRatio: 0.6 },
  { id: 'readiness-80-recovery-90', readinessRatio: 0.8, recoveryPriorityRatio: 0.9 },
] as const;

export const PRESERVED_OPERATIONAL_ACTION_IDS = [
  'hold-plan',
  'eco-speed',
  'arrival-window',
  'port-diversion',
  'capacity-control',
] as const;

export const REGULATORY_OFFICIAL_SOURCES = [
  {
    authority: 'International Maritime Organization',
    subject: 'Port State Control',
    url: 'https://www.imo.org/en/ourwork/iiis/pages/port%20state%20control.aspx',
  },
  {
    authority: 'Royal Malaysian Customs Department',
    subject: 'Pre-Arrival Processing and physical examination',
    url: 'https://www.customs.gov.my/en/business/facilitation/pre-arrival-processing-pap',
  },
  {
    authority: 'Singapore Customs',
    subject: 'Import permits and cargo clearance conditions',
    url: 'https://www.customs.gov.sg/businesses/importing-goods/import-procedures/apply-customs-import-permit/',
  },
] as const;
