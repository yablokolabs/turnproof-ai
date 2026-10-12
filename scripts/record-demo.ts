/**
 * Record the demo video.
 *
 * Playwright drives a real Chromium against the real local API and records the
 * screen. The walkthrough is captured as **one segment per narration beat**, so
 * each segment can be held to exactly the length of the sentence spoken over it
 * and the picture and the voice line up beat for beat. ffmpeg then assembles a
 * title card, the segments with the wordmark as a corner watermark, and an end
 * card, and muxes the narration built by `npm run demo:narrate`.
 *
 * Two modes, chosen by whether `proof/demo/narration-timing.json` exists:
 *  - narrated  - segments are timed to each beat's audio and the MP3s are muxed in
 *  - silent    - segments use default dwells and no audio track is written
 *
 * Only the deterministic provider is exercised. This script contacts nothing
 * outside loopback and needs no credentials; the narration is the one step that
 * does, and it lives in `scripts/narrate-demo.ts`.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, 'proof', 'demo');
const WORK_DIR = join(tmpdir(), `turnproof-demo-${Date.now()}`);
const PORT = Number(process.env.DEMO_PORT ?? 4182);
const BASE = `http://127.0.0.1:${PORT}`;
const VIDEO_SIZE = { width: 1280, height: 720 };
const FPS = 25;
const LOGO_PATH = join(ROOT, 'turnproof-logo.png');
const ICON_PATH = join(ROOT, 'turnproof-icon.png');
const TIMING_FILE = join(OUT_DIR, 'narration-timing.json');
const NARRATION_DIR = join(OUT_DIR, 'narration');

const ffmpeg = (...args: string[]): void => {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
};

const ffprobe = (path: string): Record<string, unknown> => {
  const raw = execFileSync(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
    { encoding: 'utf8' },
  );
  return JSON.parse(raw) as Record<string, unknown>;
};

function durationOf(path: string): number {
  const format = ffprobe(path).format as { duration?: string } | undefined;
  return format?.duration ? Number(format.duration) : 0;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function dataUri(path: string, mime: string): string {
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
}

function brandCard(options: { title: string; lines: string[]; logoHeight: number }): string {
  const logo = dataUri(LOGO_PATH, 'image/png');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  html, body { margin: 0; height: 100%; }
  body {
    background: #f5f7fa;
    color: #0b2233;
    font-family: "DejaVu Sans", system-ui, sans-serif;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 22px;
    padding: 48px;
    box-sizing: border-box;
    text-align: center;
  }
  img { width: auto; height: ${options.logoHeight}px; }
  h1 { margin: 0; font-size: 26px; letter-spacing: 0.4px; font-weight: 600; }
  p { margin: 0; font-size: 17px; color: #33505f; max-width: 900px; line-height: 1.5; }
  .rule { width: 160px; height: 3px; background: #0b6f8f; border-radius: 2px; }
</style></head>
<body>
  <img src="${logo}" alt="TurnProof AI">
  <div class="rule"></div>
  <h1>${options.title}</h1>
  ${options.lines.map((line) => `<p>${line}</p>`).join('\n  ')}
</body></html>`;
}

async function renderCard(browser: Browser, html: string, file: string): Promise<void> {
  const page = await browser.newPage({ viewport: VIDEO_SIZE, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: file });
  await page.close();
}

async function waitForServer(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // Server not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`API did not become healthy on ${BASE} within ${timeoutMs} ms`);
}

/** One narration beat: a scenario to open, then the shots to hold, by weight. */
interface Beat {
  id: string;
  opens: 'case-a' | 'case-c' | 'case-b';
  /** Steps run in order. `weight` splits whatever time the beat has left. */
  steps: Array<{ show?: string; weight: number; act?: (page: Page) => Promise<void> }>;
  /** Used when no narration timing file exists. */
  silentMs: number;
}

const BEATS: Beat[] = [
  {
    id: 'beat-1',
    opens: 'case-a',
    silentMs: 14_000,
    steps: [
      { show: 'prototype-banner', weight: 3 },
      { show: 'readiness', weight: 3 },
      { show: 'task-row-t-fuel', weight: 3 },
    ],
  },
  {
    id: 'beat-2',
    opens: 'case-a',
    silentMs: 14_000,
    steps: [
      { show: 'timeline', weight: 6 },
      { show: 'readiness', weight: 2 },
      { show: 'timeline', weight: 4 },
    ],
  },
  {
    id: 'beat-3',
    opens: 'case-a',
    silentMs: 22_000,
    steps: [
      { show: 'decision-state', weight: 2 },
      { show: 'candidate-feasible-use_alternate_resource:t-fuel:TANKER-2', weight: 4 },
      { show: 'candidate-rejected-use_alternate_resource:t-fuel:TANKER-3', weight: 3 },
      { show: 'evidence-drawer', weight: 4 },
    ],
  },
  {
    id: 'beat-4',
    opens: 'case-a',
    silentMs: 18_000,
    steps: [
      {
        weight: 1,
        act: async (page) => {
          await page.getByTestId('reviewer-name').scrollIntoViewIfNeeded();
          await page.getByTestId('reviewer-name').fill('Coordinator');
          await page.getByTestId('review-action').selectOption('accept');
          await page
            .getByTestId('review-note')
            .fill('Alternate synthetic tanker accepted on fixture assumptions.');
          await page.getByTestId('review-submit').click();
        },
      },
      { show: 'review-result', weight: 6 },
      { show: 'export-button', weight: 3 },
      {
        weight: 1,
        act: async (page) => {
          const download = page.waitForEvent('download');
          await page.getByTestId('export-button').click();
          await download;
        },
      },
    ],
  },
  {
    id: 'beat-5',
    opens: 'case-c',
    silentMs: 18_000,
    steps: [
      { show: 'conflict-TANKER-2-unavailable', weight: 4 },
      { show: 'evidence-item-ev-d-injected-note', weight: 4 },
      {
        weight: 4,
        act: async (page) => {
          await page.getByTestId('scenario-item-case-b').click();
          await page.getByTestId('decision-state').waitFor();
          await page.getByTestId('decision-state').scrollIntoViewIfNeeded();
        },
      },
    ],
  },
];

function loadTimings(): Map<string, number> | null {
  if (!existsSync(TIMING_FILE)) return null;
  const parsed = JSON.parse(readFileSync(TIMING_FILE, 'utf8')) as {
    beats: Array<{ id: string; durationSeconds: number }>;
  };
  return new Map(parsed.beats.map((beat) => [beat.id, Math.round(beat.durationSeconds * 1000)]));
}

/** Run one beat, holding each shot until the beat's own time budget is spent. */
async function recordBeat(
  browser: Browser,
  beat: Beat,
  targetMs: number,
  rawDir: string,
): Promise<string> {
  const beatStart = Date.now();
  const context = await browser.newContext({
    viewport: VIDEO_SIZE,
    recordVideo: { dir: rawDir, size: VIDEO_SIZE },
  });
  const page = await context.newPage();

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByTestId(`scenario-item-${beat.opens}`).click();
  await page.getByTestId('decision-state').waitFor();

  for (let index = 0; index < beat.steps.length; index += 1) {
    const step = beat.steps[index];
    if (step.act) {
      await step.act(page);
    }
    // Split whatever is left across the steps that are left, so a slow action
    // shortens the later holds instead of pushing the beat past its audio.
    const stepsLeft = beat.steps.slice(index).reduce((total, entry) => total + entry.weight, 0);
    const remaining = targetMs - (Date.now() - beatStart) - 700;
    const share = (remaining * step.weight) / Math.max(1, stepsLeft);
    const dwell = Math.max(700, Math.min(11_000, Math.round(share)));
    if (step.show) {
      const target = page.getByTestId(step.show);
      await target.scrollIntoViewIfNeeded();
      await page.waitForTimeout(dwell);
    } else {
      await page.waitForTimeout(Math.min(dwell, 2500));
    }
  }

  // Hold until the beat is exactly as long as its narration, so the next beat
  // starts on the same frame the next sentence does.
  const overshoot = beatStart + targetMs - Date.now();
  if (overshoot > 0) await page.waitForTimeout(overshoot);

  // Closing the context is what flushes Playwright's video file.
  await context.close();

  const recorded = readdirSync(rawDir).filter((name) => name.endsWith('.webm'));
  if (recorded.length === 0) throw new Error(`Playwright recorded no video for ${beat.id}`);
  const raw = join(rawDir, recorded[0]);
  const kept = join(WORK_DIR, `${beat.id}-raw.webm`);
  writeFileSync(kept, readFileSync(raw));
  rmSync(raw, { force: true });
  return kept;
}

async function main(): Promise<void> {
  for (const required of [LOGO_PATH, ICON_PATH]) {
    if (!existsSync(required)) throw new Error(`Missing brand asset: ${required}`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(WORK_DIR, { recursive: true });

  const timings = loadTimings();
  const narrated = timings !== null && existsSync(NARRATION_DIR);
  console.log(
    narrated
      ? 'narration timing found: recording one segment per beat and muxing the narration'
      : 'no narration timing found: recording silent, with default dwells',
  );

  console.log('building the UI so the recording serves the committed application');
  execFileSync('npm', ['run', 'build:web'], { stdio: 'inherit' });

  let server: ChildProcess | undefined;
  try {
    // `detached` puts the server in its own process group so the whole tree can
    // be signalled at the end. Without it, `npx` dies but the `tsx` child keeps
    // the inherited stdout pipe open and this script never exits.
    server = spawn('npx', ['tsx', 'apps/api/src/server.ts'], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    await waitForServer();

    const browser = await chromium.launch({ headless: true });
    const watermarkPng = join(WORK_DIR, 'watermark.png');
    const encode = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', String(FPS)];

    // A light plate behind the watermark, so the dark wordmark stays legible
    // over the dark console.
    ffmpeg(
      '-f', 'lavfi', '-i', `color=c=0xf5f7fa:s=300x120:d=1:r=${FPS}`,
      '-i', LOGO_PATH,
      '-filter_complex', '[1:v]scale=270:-1[lg];[0:v][lg]overlay=(W-w)/2:(H-h)/2,format=rgba',
      '-frames:v', '1', watermarkPng,
    );

    const segments: Array<{ path: string; seconds: number; label: string }> = [];
    const audioParts: string[] = [];

    const beatSeconds = (id: string, fallback: number) =>
      timings?.get(id) ? timings.get(id)! / 1000 : fallback;

    const titleSeconds = beatSeconds('title', 6);
    const titlePng = join(WORK_DIR, 'title.png');
    await renderCard(
      browser,
      brandCard({
        title: 'Recover the turnaround. Show the evidence.',
        lines: [
          'Prototype - synthetic data - advisory only - no operational execution',
          'Recorded from the running application with the deterministic rule-based provider.',
        ],
        logoHeight: 120,
      }),
      titlePng,
    );
    const titleMp4 = join(WORK_DIR, 'title.mp4');
    ffmpeg('-loop', '1', '-i', titlePng, '-t', titleSeconds.toFixed(3), ...encode, '-s', '1280x720', titleMp4);
    segments.push({ path: titleMp4, seconds: titleSeconds, label: 'title card' });

    for (const beat of BEATS) {
      const targetMs = Math.round(beatSeconds(beat.id, beat.silentMs) * 1000);
      const rawDir = join(WORK_DIR, `raw-${beat.id}`);
      mkdirSync(rawDir, { recursive: true });
      const raw = await recordBeat(browser, beat, targetMs, rawDir);
      const out = join(WORK_DIR, `${beat.id}.mp4`);
      // `-t` trims only the few milliseconds the context close adds; the beat was
      // held to its narration length before closing, so no content is cut.
      ffmpeg(
        '-i', raw,
        '-i', watermarkPng,
        '-filter_complex',
        '[0:v]scale=1280:720,setsar=1,fps=25[bg];[1:v]format=rgba[wm];[bg][wm]overlay=24:H-h-24,format=yuv420p[v]',
        '-map', '[v]', '-an', '-t', (targetMs / 1000).toFixed(3), ...encode, out,
      );
      segments.push({ path: out, seconds: targetMs / 1000, label: beat.id });
      console.log(`  ${beat.id}: ${(targetMs / 1000).toFixed(2)}s -> ${durationOf(out).toFixed(2)}s`);
    }

    const endSeconds = beatSeconds('end', 7);
    const endPng = join(WORK_DIR, 'end.png');
    await renderCard(
      browser,
      brandCard({
        title: 'Measured on 34 committed synthetic fixtures',
        lines: [
          '45 unit and integration tests, 6 browser tests, typecheck clean.',
          '3 hero cases: 1 recovers 15 minutes, 1 reports no feasible option, 1 abstains on a conflict.',
          'Live AI, Anakin and Jev: unavailable. Nothing outside loopback was contacted.',
          'github.com/yablokolabs/turnproof-ai',
        ],
        logoHeight: 104,
      }),
      endPng,
    );
    const endMp4 = join(WORK_DIR, 'end.mp4');
    ffmpeg('-loop', '1', '-i', endPng, '-t', endSeconds.toFixed(3), ...encode, '-s', '1280x720', endMp4);
    segments.push({ path: endMp4, seconds: endSeconds, label: 'end card' });

    await browser.close();

    const concatFile = join(WORK_DIR, 'concat.txt');
    writeFileSync(concatFile, segments.map((segment) => `file '${segment.path}'`).join('\n') + '\n', 'utf8');
    const silentVideo = join(WORK_DIR, 'video.mp4');
    ffmpeg(
      '-f', 'concat', '-safe', '0', '-i', concatFile,
      '-vf', 'scale=1280:720,setsar=1',
      ...encode, silentVideo,
    );

    const videoSeconds = durationOf(silentVideo);
    const finalPath = join(OUT_DIR, 'turnproof-demo.mp4');
    let narrationSeconds: number | null = null;
    let narrationVoice: unknown = null;
    let contactOutside = false;

    if (narrated) {
      const order = ['title', ...BEATS.map((beat) => beat.id), 'end'];
      for (const id of order) {
        const part = join(NARRATION_DIR, `${id}.mp3`);
        if (!existsSync(part)) throw new Error(`missing narration beat ${id}: ${part}`);
        audioParts.push(part);
        narrationSeconds = (narrationSeconds ?? 0) + durationOf(part);
      }
      const audioList = join(WORK_DIR, 'audio.txt');
      writeFileSync(audioList, audioParts.map((part) => `file '${part}'`).join('\n') + '\n', 'utf8');
      const narrationMp3 = join(WORK_DIR, 'narration.mp3');
      ffmpeg('-f', 'concat', '-safe', '0', '-i', audioList, '-c:a', 'libmp3lame', '-q:a', '4', narrationMp3);

      ffmpeg(
        '-i', silentVideo,
        '-i', narrationMp3,
        '-map', '0:v', '-map', '1:a',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
        '-shortest', '-movflags', '+faststart', finalPath,
      );

      const narrationManifest = join(OUT_DIR, 'narration-manifest.json');
      if (existsSync(narrationManifest)) {
        const parsed = JSON.parse(readFileSync(narrationManifest, 'utf8')) as {
          provider?: { voiceUsed?: unknown };
        };
        narrationVoice = parsed.provider?.voiceUsed ?? null;
        contactOutside = true;
      }
      console.log(`  narration: ${narrationSeconds?.toFixed(2)}s muxed over ${videoSeconds.toFixed(2)}s of picture`);
    } else {
      writeFileSync(finalPath, readFileSync(silentVideo));
    }

    const probed = ffprobe(finalPath);
    const format = probed.format as { duration?: string; size?: string } | undefined;
    const streams = (probed.streams ?? []) as Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string }>;
    const videoStream = streams.find((stream) => stream.codec_type === 'video');
    const audioStream = streams.find((stream) => stream.codec_type === 'audio');

    const manifest = {
      artifact: 'proof/demo/turnproof-demo.mp4',
      producedAt: new Date().toISOString(),
      whatThisIs: narrated
        ? 'A screen recording of the running application, driven by a scripted Playwright session against the real local API, with synthetic text-to-speech narration generated by ElevenLabs from docs/demo-narration.json. The walkthrough is captured one segment per narration beat and each segment is held to the length of the sentence spoken over it, so the picture and the voice align beat for beat. Not performed on camera.'
        : 'A screen recording of the running application, driven by a scripted Playwright session against the real local API. Not narrated and not performed on camera.',
      whatThisIsNot: narrated
        ? 'It is not a human presenter and not a person speaking, and the beat-level alignment is not frame-accurate synchronisation. It shows no sponsor and no live provider call.'
        : 'It is not the narrated video described in docs/DEMO.md. It contains no audio and shows no sponsor or live provider call.',
      providerMode: 'deterministic',
      credentialsUsed: 'none in this step; the narration step used ELEVENLABS_API_KEY from the environment only',
      contactedOutsideLoopback: contactOutside,
      narration:
        narrated && narrationSeconds !== null
          ? {
              source: 'proof/demo/narration/*.mp3 from scripts/narrate-demo.ts',
              voice: narrationVoice,
              seconds: Number(narrationSeconds.toFixed(3)),
              beats: ['title', ...BEATS.map((beat) => beat.id), 'end'],
              alignment: 'one recorded segment per beat, each held to that beat\'s audio length',
              manifest: 'proof/demo/narration-manifest.json',
            }
          : null,
      runtime: {
        node: process.version,
        encoder: execFileSync('ffmpeg', ['-hide_banner', '-version'], { encoding: 'utf8' }).split('\n')[0].trim(),
      },
      video: {
        durationSeconds: format?.duration ? Number(Number(format.duration).toFixed(2)) : null,
        bytes: format?.size ? Number(format.size) : statSync(finalPath).size,
        width: videoStream?.width ?? null,
        height: videoStream?.height ?? null,
        codec: videoStream?.codec_name ?? null,
        frameRate: videoStream?.avg_frame_rate ?? null,
        hasAudio: Boolean(audioStream),
        audioCodec: audioStream?.codec_name ?? null,
      },
      segments: segments.map((segment) => ({
        label: segment.label,
        seconds: Number(segment.seconds.toFixed(3)),
      })),
      hashes: {
        mp4: sha256(finalPath),
      },
      brandAssetsUsed: {
        wordmark: 'turnproof-logo.png (title card, corner watermark, end card)',
        icon: 'turnproof-icon.png (served by the app, available for the social preview)',
        note: 'The wordmark is dark ink on transparency, so it is always placed on a light plate.',
      },
      scriptedBeats: [
        'case A board with the prototype banner',
        'readiness and the delayed fueling row',
        'dependency timeline',
        'feasible alternate tanker and the rejected committed unit',
        'evidence drawer',
        'coordinator review recorded, then the decision packet exported',
        'case C contradictory updates abstain',
        'case B no feasible option',
      ],
    };
    writeFileSync(join(OUT_DIR, 'demo-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    console.log(`demo:video wrote ${manifest.artifact}`);
    console.log(
      `  ${manifest.video.width}x${manifest.video.height} ${manifest.video.codec} ${manifest.video.durationSeconds}s, audio: ${manifest.video.hasAudio}${manifest.video.audioCodec ? ` (${manifest.video.audioCodec})` : ''}`,
    );
    console.log(`  sha256 ${manifest.hashes.mp4}`);
  } finally {
    if (server && !server.killed) {
      server.stdout?.destroy();
      server.stderr?.destroy();
      try {
        if (typeof server.pid === 'number' && process.platform !== 'win32') {
          process.kill(-server.pid, 'SIGTERM');
        } else {
          server.kill('SIGTERM');
        }
      } catch {
        // The process group is already gone.
      }
    }
    rmSync(WORK_DIR, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`demo:video failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
