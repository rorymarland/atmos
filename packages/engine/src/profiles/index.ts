import { inversion } from './inversion.js';
import {
  alpenglow,
  astro,
  aurora,
  clarity,
  dramatic,
  frost,
  frozen,
  lenticular,
  midges,
  mist,
  snow,
  waterfalls,
} from './photo.js';
import { bluebird, brocken, noctilucent, rainbow } from './optics.js';
import { reflections } from './reflections.js';
import { sky } from './sky.js';
import type { ProfileDefinition } from './types.js';
import { walking } from './walking.js';

export const PROFILE_DEFINITIONS: Record<string, ProfileDefinition> = {
  walking,
  inversion,
  sky,
  reflections,
  mist,
  frost,
  snow,
  clarity,
  dramatic,
  waterfalls,
  astro,
  aurora,
  alpenglow,
  lenticular,
  frozen,
  brocken,
  rainbow,
  bluebird,
  noctilucent,
  midges,
};

export type {
  FactorDefinition,
  FactorReading,
  GateDefinition,
  ProfileDefinition,
} from './types.js';
