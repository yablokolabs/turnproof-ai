/**
 * Narrate the demo video with ElevenLabs.
 *
 * This is the one script in the repository that contacts a third party, and it
 * is opt-in: without `ELEVENLABS_API_KEY` in the environment it explains what to
 * set and exits without making a request. Pass the key in through the
 * environment, never through a file in this repository:
 *
 *   set -a; . ~/.hermes/.env; set +a; npm run demo:narrate
 *
 * The key is read from the environment, sent only in the `xi-api-key` header,
 * and never written to disk, logged, or included in any manifest. Synthesised
 * speech is billed per character, so the script prints the character count and
 * an estimate at list price before it sends anything.
 *
 * Voice selection is explicit rather than hardcoded to a voice id: the script
 * lists the account's voices, scores them against the requested target (British,
 * young, female), prints the ranking so the choice is auditable, and then walks
 * that ranking. A voice this plan cannot use answers `402 paid_plan_required`,
 * which is recorded and skipped rather than retried, so the run degrades to the
 * best available voice instead of failing. Override the whole process with
 * `ELEVENLABS_VOICE_ID`, which is the only judge that matters for a voice.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SCRIPT_FILE = join(ROOT, 'docs', 'demo-narration.json');
const OUT_DIR = join(ROOT, 'proof', 'demo', 'narration');
const API = process.env.ELEVENLABS_API_URL ?? 'https://api.elevenlabs.io';
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID ?? 'eleven_multilingual_v2';
const VOICE_SETTINGS = {
  stability: Number(process.env.ELEVENLABS_STABILITY ?? 0.42),
  similarity_boost: Number(process.env.ELEVENLABS_SIMILARITY ?? 0.78),
  style: Number(process.env.ELEVENLABS_STYLE ?? 0.15),
  use_speaker_boost: true,
};
/** ElevenLabs list pricing for the multilanguage tier, in USD per character. */
const PRICE_PER_CHARACTER = 0.00018;

interface Beat {
  id: string;
  screen: string;
  text: string;
}

interface Voice {
  voice_id: string;
  name: string;
  labels?: Record<string, string>;
  category?: string;
  fine_tuning?: { language?: string };
  verified_languages?: Array<{ language?: string; locale?: string; accent?: string }>;
}

interface Candidate {
  voice: Voice;
  score: number;
  why: string[];
}

interface BeatOutput {
  id: string;
  screen: string;
  text: string;
  characters: number;
  textSha256: string;
  audio: string;
  audioSha256: string;
  bytes: number;
  durationSeconds: number;
}

const apiKey = process.env.ELEVENLABS_API_KEY;

if (!apiKey) {
  console.error('ELEVENLABS_API_KEY is not set, so no narration was generated.');
  console.error('The key is read from the environment only and is never stored in this repository.');
  console.error('Set it for one command, then re-run:');
  console.error('  set -a; . ~/.hermes/.env; set +a; npm run demo:narrate');
  process.exit(1);
}

const script = JSON.parse(readFileSync(SCRIPT_FILE, 'utf8')) as { beats: Beat[] };
const beats = script.beats;

class PlanRejected extends Error {}

async function withRetries<T>(label: string, run: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (error instanceof PlanRejected) break;
      const retryable = error instanceof Error && /HTTP (429|5\d\d)/.test(error.message);
      if (!retryable || attempt === attempts) break;
      const waitMs = 1000 * 2 ** (attempt - 1);
      console.warn(`  ${label}: ${(error as Error).message} - retrying in ${waitMs} ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
}

async function elevenLabs(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'xi-api-key': apiKey as string, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.ok) return response;

  const body = await response.text().catch(() => '');
  // The plan gate is a permanent answer for this voice, not a transient fault,
  // so it is raised as its own error type and never retried.
  if (response.status === 402 || /paid_plan_required/.test(body)) {
    throw new PlanRejected(`HTTP 402 for this voice: ${body.slice(0, 240)}`);
  }
  // Request headers are never echoed, so the key cannot leak into a log or an
  // error message even when the API rejects the call.
  throw new Error(`HTTP ${response.status} from ${path}: ${body.slice(0, 300)}`);
}

function scoreVoice(voice: Voice): Candidate | null {
  const labels = voice.labels ?? {};
  const gender = (labels.gender ?? '').toLowerCase();
  const accent = (labels.accent ?? '').toLowerCase();
  const age = (labels.age ?? '').toLowerCase();
  const languages = [
    labels.language ?? '',
    voice.fine_tuning?.language ?? '',
    ...(voice.verified_languages ?? []).map(
      (entry) => `${entry.language ?? ''} ${entry.locale ?? ''} ${entry.accent ?? ''}`,
    ),
  ]
    .join(' ')
    .toLowerCase();

  if (gender && gender !== 'female') return null;

  const why: string[] = [];
  let score = 0;
  if (gender === 'female') {
    score += 4;
    why.push('female');
  }
  if (accent.includes('british')) {
    score += 4;
    why.push(`accent=${accent}`);
  } else if (/en[-_]gb|british|uk english/.test(languages)) {
    score += 3;
    why.push('en-GB');
  }
  if (age === 'young') {
    score += 4;
    why.push('young');
  } else if (age === 'young adult') {
    score += 3;
    why.push('young adult');
  }
  if (voice.category === 'premade' || voice.category === 'professional') {
    score += 1;
    why.push(voice.category);
  }
  if (!gender) {
    score -= 2;
    why.push('gender unlabelled');
  }
  return score > 0 ? { voice, score, why } : null;
}

function ffprobeDuration(path: string): number {
  return Number(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path],
      { encoding: 'utf8' },
    ).trim(),
  );
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function rankCandidates(): Promise<Candidate[]> {
  const response = await withRetries('voices', () => elevenLabs('/v1/voices', { method: 'GET' }, 20_000));
  const body = (await response.json()) as { voices?: Voice[] };
  const voices = body.voices ?? [];
  if (voices.length === 0) throw new Error('the account returned no voices');

  const override = process.env.ELEVENLABS_VOICE_ID;
  const ranked = voices
    .map(scoreVoice)
    .filter((entry): entry is Candidate => entry !== null)
    .sort((a, b) => b.score - a.score || a.voice.name.localeCompare(b.voice.name));

  if (override) {
    const match = voices.find((voice) => voice.voice_id === override);
    if (!match) throw new Error(`ELEVENLABS_VOICE_ID ${override} is not in this account's voice list`);
    console.log(`voice: ELEVENLABS_VOICE_ID override -> ${match.name} (${match.voice_id})`);
    const forced: Candidate = { voice: match, score: Number.POSITIVE_INFINITY, why: ['voice id override'] };
    return [forced, ...ranked.filter((entry) => entry.voice.voice_id !== override)];
  }

  if (ranked.length === 0) throw new Error('no voice in this account matched the requested target');

  console.log(
    `voice target: British, young, female - ${voices.length} voices available, ranked candidates:`,
  );
  for (const entry of ranked) {
    console.log(`  ${String(entry.score).padStart(2)}  ${entry.voice.name} (${entry.voice.voice_id}) [${entry.why.join(', ')}]`);
  }
  return ranked;
}

async function synthesiseBeat(voice: Voice, beat: Beat, target: string): Promise<void> {
  const response = await elevenLabs(
    `/v1/text-to-speech/${voice.voice_id}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text: beat.text, model_id: MODEL_ID, voice_settings: VOICE_SETTINGS }),
    },
    120_000,
  );
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength < 1024) throw new Error(`${beat.id}: response was too small to be audio`);
  writeFileSync(target, audio);
}

async function main(): Promise<void> {
  const characters = beats.reduce((total, beat) => total + beat.text.length, 0);
  console.log(`narration script: ${beats.length} beats, ${characters} characters`);
  console.log(
    `model ${MODEL_ID}; estimated cost at list price USD ${(characters * PRICE_PER_CHARACTER).toFixed(2)} (the account plan governs the real charge)`,
  );

  const candidates = await rankCandidates();
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const rejected: Array<{ voiceId: string; name: string; reason: string }> = [];
  let chosen: Voice | undefined;
  let outputs: BeatOutput[] = [];

  for (const candidate of candidates) {
    const voice = candidate.voice;
    try {
      // The first beat is the probe: a plan gate answers on the first request,
      // before any audio has been written for this voice.
      const attempt: BeatOutput[] = [];
      for (const beat of beats) {
        const target = join(OUT_DIR, `${beat.id}.mp3`);
        await withRetries(beat.id, () => synthesiseBeat(voice, beat, target));
        const durationSeconds = Number(ffprobeDuration(target).toFixed(3));
        attempt.push({
          id: beat.id,
          screen: beat.screen,
          text: beat.text,
          characters: beat.text.length,
          textSha256: createHash('sha256').update(beat.text).digest('hex'),
          audio: `proof/demo/narration/${beat.id}.mp3`,
          audioSha256: sha256(target),
          bytes: statSync(target).size,
          durationSeconds,
        });
        console.log(`  ${beat.id.padEnd(8)} ${durationSeconds.toFixed(2)}s  ${(statSync(target).size / 1024).toFixed(0)} KB`);
      }
      chosen = voice;
      outputs = attempt;
      break;
    } catch (error) {
      if (!(error instanceof PlanRejected)) throw error;
      rejected.push({ voiceId: voice.voice_id, name: voice.name, reason: error.message });
      console.warn(`  ${voice.name} is not usable on this plan: ${error.message.replace(/^HTTP 402[^:]*: /, '').slice(0, 120)}`);
      for (const beat of beats) rmSync(join(OUT_DIR, `${beat.id}.mp3`), { force: true });
    }
  }

  if (!chosen) {
    throw new Error(
      `no voice in this account could be used on this plan (${rejected.length} rejected). Add credits or set ELEVENLABS_VOICE_ID to a usable voice.`,
    );
  }
  console.log(`voice used: ${chosen.name} (${chosen.voice_id})${rejected.length > 0 ? ` after ${rejected.length} plan rejection(s)` : ''}`);

  const totalSeconds = Number(outputs.reduce((total, entry) => total + entry.durationSeconds, 0).toFixed(3));

  // The recorder reads this file to set each beat's on-screen duration, so the
  // picture and the narration line up beat for beat.
  writeFileSync(
    join(ROOT, 'proof', 'demo', 'narration-timing.json'),
    `${JSON.stringify({ beats: outputs.map(({ id, durationSeconds }) => ({ id, durationSeconds })) }, null, 2)}\n`,
    'utf8',
  );

  const manifest = {
    artifact: 'proof/demo/narration/',
    producedAt: new Date().toISOString(),
    whatThisIs:
      'Synthetic narration for the demo video, generated by ElevenLabs text to speech from docs/demo-narration.json. This is the only step of the build that contacts a third party.',
    whatThisIsNot:
      'It is not a human presenter, not a recording of a person, and not a measurement of anything. The spoken figures restate fixture-derived and measured values from README.md.',
    provider: {
      name: 'ElevenLabs',
      endpointHost: new URL(API).host,
      apiPaths: ['GET /v1/voices', 'POST /v1/text-to-speech/{voice_id}'],
      modelId: MODEL_ID,
      voiceSettings: VOICE_SETTINGS,
      requestedTarget: 'British, young, female',
      voiceUsed: {
        voiceId: chosen.voice_id,
        name: chosen.name,
        category: chosen.category ?? null,
        labels: chosen.labels ?? {},
      },
      voicesRejectedByPlan: rejected,
      selectionNote:
        rejected.length > 0
          ? 'The account plan cannot use library voices, so the ranking was walked down to the first usable voice. That is a plan limit, not a judgement about the voice.'
          : 'The top-ranked voice for the target was usable, so no fallback was needed.',
    },
    credentials: 'ELEVENLABS_API_KEY read from the environment; never written to disk, logged, or stored in this manifest',
    cost: {
      characters,
      pricePerCharacterAssumed: PRICE_PER_CHARACTER,
      estimatedUsd: Number((characters * PRICE_PER_CHARACTER).toFixed(4)),
      note: 'An estimate at public list price, not an invoice. The account plan governs the real charge.',
    },
    contactedOutsideLoopback: true,
    totalDurationSeconds: totalSeconds,
    beats: outputs,
  };
  writeFileSync(join(ROOT, 'proof', 'demo', 'narration-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`narration: ${totalSeconds.toFixed(2)}s total across ${outputs.length} beats`);
  console.log('wrote proof/demo/narration-manifest.json and proof/demo/narration-timing.json');
}

main().catch((error) => {
  console.error(`demo:narrate failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
