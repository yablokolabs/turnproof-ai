/**
 * Build the proof bundle.
 *
 * Writes:
 *  - `proof/manifest.json`  : SHA-256 of every tracked source artefact, plus the
 *                             environment, commit and reproduction commands.
 *  - `proof/packets/*.json` : decision packets produced by driving the real
 *                             HTTP API in-process, not by calling the engine directly.
 *
 * The manifest proves byte identity of the package at capture time. A hash
 * detects change; it does not establish truth and is not tamper-proof storage.
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { arch, platform, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { FastifyInstance } from 'fastify';

const ROOT = process.cwd();
const PROOF_DIR = join(ROOT, 'proof');
const PACKET_DIR = join(PROOF_DIR, 'packets');

const ROOTS = ['fixtures', 'packages', 'apps', 'scripts', 'tests', 'docs'];
const ROOT_FILES = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.base.json',
  'vitest.config.ts',
  'playwright.config.ts',
  'README.md',
  'AGENTS.md',
  'PROJECT_BUILD.md',
];
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.git', 'data', 'proof', 'test-results', 'playwright-report']);
const INCLUDED_EXTENSIONS = ['.ts', '.tsx', '.json', '.css', '.html', '.mjs', '.js', '.png', '.svg', '.md'];

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walk(full, out);
    } else if (INCLUDED_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function gitCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'no-git-repository';
  }
}

function gitDirty(): boolean | null {
  try {
    return execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().length > 0;
  } catch {
    return null;
  }
}

async function collectPackets(): Promise<Array<{ name: string; path: string; scenarioId: string; decisionState: string; hash: string }>> {
  const { buildApp } = await import('../apps/api/src/app.js');
  const dbPath = join(tmpdir(), `turnproof-proof-${Date.now()}.sqlite`);
  const app: FastifyInstance = await buildApp({ dbPath, seed: true, logger: false });
  const written: Array<{ name: string; path: string; scenarioId: string; decisionState: string; hash: string }> = [];

  try {
    for (const scenarioId of ['case-a', 'case-b', 'case-c']) {
      const listRes = await app.inject({ method: 'GET', url: '/api/scenarios' });
      const { scenarios } = JSON.parse(listRes.body) as { scenarios: Array<{ id: string; revision: number }> };
      const scenario = scenarios.find((s) => s.id === scenarioId);
      if (!scenario) throw new Error(`scenario ${scenarioId} is missing from the API`);

      const created = await app.inject({
        method: 'POST',
        url: '/api/decisions',
        headers: { 'x-idempotency-key': `proof-${scenarioId}` },
        payload: { scenarioId, expectedRevision: scenario.revision, providerMode: 'deterministic' },
      });
      if (created.statusCode !== 200) throw new Error(`decision for ${scenarioId} failed: ${created.body}`);
      const { decision } = JSON.parse(created.body) as { decision: { id: string; state: string } };

      const exported = await app.inject({ method: 'GET', url: `/api/decisions/${decision.id}/export` });
      if (exported.statusCode !== 200) throw new Error(`export for ${scenarioId} failed: ${exported.body}`);

      const name = `${scenarioId}-packet.json`;
      const path = join(PACKET_DIR, name);
      const body = `${JSON.stringify(JSON.parse(exported.body), null, 2)}\n`;
      writeFileSync(path, body, 'utf8');
      written.push({
        name,
        path: relative(ROOT, path),
        scenarioId,
        decisionState: decision.state,
        hash: createHash('sha256').update(body).digest('hex'),
      });
    }
  } finally {
    await app.close();
    try {
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
    } catch {
      // Local scratch database removal is best-effort.
    }
  }

  return written;
}

async function main(): Promise<void> {
  mkdirSync(PACKET_DIR, { recursive: true });

  const files = [
    ...ROOT_FILES.map((f) => join(ROOT, f)).filter((f) => {
      try {
        return statSync(f).isFile();
      } catch {
        return false;
      }
    }),
    ...ROOTS.flatMap((dir) => walk(join(ROOT, dir))),
  ]
    .filter((f) => !relative(ROOT, f).startsWith('proof/'))
    .sort();

  const artefacts = files.map((file) => ({
    path: relative(ROOT, file).split('\\').join('/'),
    bytes: statSync(file).size,
    sha256: sha256(file),
  }));

  const bundleHash = createHash('sha256')
    .update(artefacts.map((a) => `${a.path}:${a.sha256}`).join('\n'))
    .digest('hex');

  const packets = await collectPackets();

  const evaluationPath = join(PROOF_DIR, 'results', 'evaluation.json');
  let evaluationHash: string | null = null;
  try {
    evaluationHash = sha256(evaluationPath);
  } catch {
    evaluationHash = null;
  }

  const manifest = {
    manifestVersion: '1.0.0',
    capturedAt: new Date().toISOString(),
    capturedAtNote: 'Capture timestamp is when this command ran. It is not an evidence-lock timestamp.',
    commit: gitCommit(),
    workingTreeDirty: gitDirty(),
    environment: {
      node: process.version,
      platform: `${platform()} ${arch()}`,
      packageManager: 'npm workspaces',
    },
    bundleHash,
    bundleHashMethod: 'sha256 of the sorted "path:sha256" lines below',
    counts: {
      artefacts: artefacts.length,
      scenarios: artefacts.filter((a) => a.path.startsWith('fixtures/scenarios/')).length,
      packets: packets.length,
    },
    reproduction: [
      { command: 'npm install', purpose: 'install the locked dependency tree' },
      { command: 'npm test', purpose: 'domain and API test suites' },
      { command: 'npm run typecheck', purpose: 'TypeScript project check' },
      { command: 'npm run evaluate', purpose: 'regenerate proof/results/evaluation.json' },
      { command: 'npm run build:web && npm run test:e2e', purpose: 'browser smoke tests over the built UI' },
      { command: 'npm run proof:export', purpose: 'regenerate this manifest and the decision packets' },
    ],
    evaluation: { path: 'proof/results/evaluation.json', sha256: evaluationHash },
    packets,
    artefacts,
    limitations: [
      'Synthetic fixtures only; no airport, airline or sponsor system was contacted.',
      'Deterministic rule-based mode. Live AI extraction and live ranking are unimplemented.',
      'Anakin and Jev adapters are unavailable; no sponsor call was made.',
      'The demo video and its narration are generated artefacts outside this artefact list; their own manifests, proof/demo/demo-manifest.json and proof/demo/narration-manifest.json, carry their hashes. The narration step is the only one that contacts a third party.',
      'A hash detects byte changes. It does not establish source truth or tamper-resistant storage.',
    ],
  };

  writeFileSync(join(PROOF_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`proof:export wrote proof/manifest.json (${artefacts.length} artefacts, bundle ${bundleHash.slice(0, 12)})`);
  for (const packet of packets) {
    console.log(`  packet ${packet.path} state=${packet.decisionState}`);
  }
  if (evaluationHash === null) {
    console.log('  note: proof/results/evaluation.json was not present; run `npm run evaluate` first');
  }
}

main().catch((error) => {
  console.error(`proof:export failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
