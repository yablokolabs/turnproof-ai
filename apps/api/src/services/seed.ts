/**
 * Local seed. The prototype has no upstream system of record: the committed
 * synthetic fixtures are the source of truth, and seeding is idempotent so a
 * restart never erases coordinator events appended through the API.
 */
import { loadAllScenarios } from '../../../../fixtures/loader.js';
import type { Scenario } from '@turnproof/domain';
import type { DatabaseSync } from 'node:sqlite';
import { nowIso } from '../storage/db.js';
import { countScenarios, seedScenario } from '../storage/repository.js';

export function scenarioRevision(scenario: Scenario): number {
  return Math.max(scenario.turnaround.revision, ...scenario.events.map((e) => e.revision), 0);
}

export function seedScenariosFromFixtures(db: DatabaseSync): number {
  const scenarios = loadAllScenarios();
  const seededAt = nowIso();
  for (const scenario of scenarios) {
    seedScenario(db, scenario, scenarioRevision(scenario), seededAt);
  }
  return countScenarios(db);
}
