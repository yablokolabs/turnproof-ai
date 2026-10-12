/**
 * Seed the local SQLite database from the committed synthetic fixtures.
 * Idempotent: a reseed never removes coordinator events appended through the API.
 */
import { closeDatabase, currentDbPath, openDatabase } from '../apps/api/src/storage/db.js';
import { seedScenariosFromFixtures } from '../apps/api/src/services/seed.js';
import { scenarioIds } from '../fixtures/loader.js';

const db = openDatabase();
const total = seedScenariosFromFixtures(db);

console.log(`seeded ${total} scenario(s) into ${currentDbPath()}`);
console.log(`fixtures on disk: ${scenarioIds().length}`);
console.log('Prototype - synthetic data - advisory only - no operational execution');

closeDatabase();
