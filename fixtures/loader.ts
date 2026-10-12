import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PolicySchema, ScenarioSchema, type Policy, type Scenario } from '@turnproof/domain';

const here = dirname(fileURLToPath(import.meta.url));
export const SCENARIOS_DIR = join(here, 'scenarios');
export const POLICIES_DIR = join(here, 'policies');

export function evidenceContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function scenarioIds(): string[] {
  return readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

export function loadScenario(id: string): Scenario {
  const raw = JSON.parse(readFileSync(join(SCENARIOS_DIR, `${id}.json`), 'utf8'));
  const scenario = ScenarioSchema.parse(raw);
  assertEvidenceHashes(scenario);
  return scenario;
}

export function loadAllScenarios(): Scenario[] {
  return scenarioIds().map(loadScenario);
}

export function loadScenarioRaw(id: string): unknown {
  return JSON.parse(readFileSync(join(SCENARIOS_DIR, `${id}.json`), 'utf8'));
}

export function loadPolicy(id: string): Policy {
  return PolicySchema.parse(JSON.parse(readFileSync(join(POLICIES_DIR, `${id}.json`), 'utf8')));
}

export function loadPolicyFor(scenario: Scenario): Policy {
  return loadPolicy(scenario.policyId);
}

/** Every evidence item must carry the hash of its own content. */
export function assertEvidenceHashes(scenario: Scenario): void {
  for (const item of scenario.evidence) {
    const expected = evidenceContentHash(item.content);
    if (item.contentHash !== expected) {
      throw new Error(
        `Fixture ${scenario.id}: evidence ${item.id} contentHash ${item.contentHash} does not match content hash ${expected}`,
      );
    }
  }
}
