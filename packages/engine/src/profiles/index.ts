import { inversion } from './inversion.js';
import { reflections } from './reflections.js';
import { sky } from './sky.js';
import type { ProfileDefinition } from './types.js';
import { walking } from './walking.js';

export const PROFILE_DEFINITIONS: Record<string, ProfileDefinition> = {
  walking,
  inversion,
  sky,
  reflections,
};

export type {
  FactorDefinition,
  FactorReading,
  GateDefinition,
  ProfileDefinition,
} from './types.js';
