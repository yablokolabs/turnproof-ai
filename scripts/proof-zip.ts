/**
 * Package the proof bundle into a ZIP archive.
 *
 * No `zip` binary is assumed to exist, so this writes a store-only (uncompressed)
 * ZIP directly. Entries are sorted and given a fixed timestamp, so the same
 * working tree produces the same archive bytes.
 *
 * The archive deliberately contains `proof/manifest.json` and the decision
 * packets. `proof/zip-manifest.json` records the archive's own hash and is kept
 * outside the archive, so there is no circular hash.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const PROOF_DIR = join(ROOT, 'proof');
const OUT_ZIP = join(PROOF_DIR, 'turnproof-proof.zip');
const OUT_RECORD = join(PROOF_DIR, 'zip-manifest.json');

/** Fixed timestamp so the archive is byte-identical across runs. */
const FIXED_INSTANT = '2026-10-12T00:00:00Z';

const ROOTS = ['fixtures', 'packages', 'apps', 'scripts', 'tests', 'docs', 'proof'];
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
  'FREEBUFF_PROMPT.md',
  'SESSION_CONTINUATION.md',
  'turnproof-logo.png',
  'turnproof-icon.png',
];
const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'data',
  'test-results',
  'playwright-report',
]);
const EXCLUDED_NAMES = new Set(['turnproof-proof.zip', 'zip-manifest.json', 'local']);
const INCLUDED_EXTENSIONS = ['.ts', '.tsx', '.json', '.css', '.html', '.mjs', '.js', '.png', '.md'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    if (EXCLUDED_DIRS.has(entry) || EXCLUDED_NAMES.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (INCLUDED_EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

/* ---------------------------------------------------------------- CRC-32 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------ ZIP writer */

function dosStamp(iso: string): { time: number; date: number } {
  const d = new Date(iso);
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const date = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

type Entry = { name: string; data: Buffer; crc: number; offset: number };

function buildZip(files: Array<{ name: string; data: Buffer }>, iso: string): Buffer {
  const { time, date } = dosStamp(iso);
  const chunks: Buffer[] = [];
  const entries: Entry[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8');
    const crc = crc32(file.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBytes, file.data);
    entries.push({ name: file.name, data: file.data, crc, offset });
    offset += local.length + nameBytes.length + file.data.length;
  }

  const centralStart = offset;
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.data.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(entry.offset, 42);
    chunks.push(header, nameBytes);
    offset += header.length + nameBytes.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(offset - centralStart, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  chunks.push(eocd);

  return Buffer.concat(chunks);
}

/* --------------------------------------------------------------- assembly */

const paths = [
  ...ROOT_FILES.map((f) => join(ROOT, f)).filter((f) => {
    try {
      return statSync(f).isFile();
    } catch {
      return false;
    }
  }),
  ...ROOTS.flatMap((dir) => {
    try {
      return walk(join(ROOT, dir));
    } catch {
      return [];
    }
  }),
].sort();

const files = paths.map((path) => ({
  name: relative(ROOT, path).split('\\').join('/'),
  data: readFileSync(path),
}));

const zip = buildZip(files, FIXED_INSTANT);
writeFileSync(OUT_ZIP, zip);

const sha256 = createHash('sha256').update(zip).digest('hex');
const record = {
  archive: relative(ROOT, OUT_ZIP).split('\\').join('/'),
  sha256,
  bytes: zip.length,
  entryCount: files.length,
  compression: 'none (store method)',
  fixedEntryTimestamp: FIXED_INSTANT,
  documentedAt: new Date().toISOString(),
  note:
    'Reproducible archive of the proof bundle. Entry timestamps are fixed so the same working tree produces the same bytes. Rebuilding after any source change changes the hash. This hash detects change; it is not tamper-proof storage.',
  verification: {
    command: 'python3 -c "import zipfile; z=zipfile.ZipFile(\'proof/turnproof-proof.zip\'); print(len(z.namelist()), z.testzip())"',
    expected: 'entry count printed, then None for a clean archive',
  },
  contents: {
    manifest: 'proof/manifest.json',
    packets: ['proof/packets/case-a-packet.json', 'proof/packets/case-b-packet.json', 'proof/packets/case-c-packet.json'],
    evaluation: 'proof/results/evaluation.json',
    screenshots: files.filter((f) => f.name.startsWith('proof/screenshots/')).map((f) => f.name),
  },
};
writeFileSync(OUT_RECORD, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

console.log(`proof:zip wrote ${record.archive} (${files.length} entries, ${zip.length} bytes)`);
console.log(`  sha256 ${sha256}`);
console.log(`  record written to ${relative(ROOT, OUT_RECORD)}`);
