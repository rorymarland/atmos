/**
 * Loads the repository's real config/profiles.yaml for tests. Not used at runtime.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { parseScoringConfig, type ScoringConfig } from './config.js';

const CONFIG_PATH = fileURLToPath(new URL('../../../config/profiles.yaml', import.meta.url));

/** The parsed but unvalidated YAML, for tests that break it on purpose. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests mutate arbitrary paths
export function rawProfilesYaml(): Record<string, any> {
  return parse(readFileSync(CONFIG_PATH, 'utf8'));
}

export function loadRealConfig(): ScoringConfig {
  return parseScoringConfig(rawProfilesYaml());
}
