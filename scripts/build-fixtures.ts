/**
 * Recompute every fixture evidence `contentHash` from its content.
 *
 * Run after editing fixture text: `npx tsx scripts/build-fixtures.ts`.
 * The loader refuses fixtures whose hashes do not match, so this keeps the
 * checked-in artefacts honest.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SCENARIOS_DIR,
  evidenceContentHash,
  scenarioIds,
} from '../fixtures/loader.js';

let changed = 0;
for (const id of scenarioIds()) {
  const path = join(SCENARIOS_DIR, `${id}.json`);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    evidence?: Array<{ id: string; content: string; contentHash: string }>;
  };
  let touched = false;
  for (const item of raw.evidence ?? []) {
    const hash = evidenceContentHash(item.content);
    if (item.contentHash !== hash) {
      item.contentHash = hash;
      touched = true;
    }
  }
  if (touched) {
    writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
    changed += 1;
    console.log(`updated ${id}`);
  }
}
console.log(`build-fixtures: ${changed} file(s) updated, ${scenarioIds().length} scenario(s) checked`);
