import type { MalaccaScenario } from '../types/sandbox';
import { malaccaScenario } from './malaccaScenario';
import { shanghaiScenario } from './shanghaiScenario';

export const PORT_SCENARIO_PROFILES: Record<string, MalaccaScenario> = {
  'malacca-strait': malaccaScenario,
  'shanghai-international-port': shanghaiScenario,
};

export const configuredPortScenarioProfile =
  import.meta.env.VITE_PORT_SCENE_PROFILE || 'malacca-strait';

export const defaultPortScenario =
  PORT_SCENARIO_PROFILES[configuredPortScenarioProfile] ?? malaccaScenario;
