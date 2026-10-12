# Demo video — script, shot list and assets

**Status: RECORDED, narrated, and committed at `proof/demo/turnproof-demo.mp4`** (2 minutes 30 seconds, 1280x720, H.264 video with AAC narration). It is a scripted Playwright session over the real local API, not a performance, and the voice is ElevenLabs text to speech, not a person. `proof/demo/demo-manifest.json` records exactly what it is and is not. The three screenshots under `proof/screenshots/` were captured the same way.

## How it was produced

1. `set -a; . ~/.hermes/.env; set +a; npm run demo:narrate` — synthesises one MP3 per beat from `docs/demo-narration.json` using ElevenLabs, picks the voice by scoring the account's voice list against the target (British, young, female), and writes `proof/demo/narration-manifest.json` and `proof/demo/narration-timing.json`. This is the only step that contacts a third party. The API key is read from the environment and never written to disk.
2. `npm run demo:video` — records one Chromium segment per narration beat, holds each segment to that beat's audio length, then muxes the narration. `npm run demo:video` also works with no narration present: it records silently with default dwells.
3. `python3 .agents/skills/diagram-design/scripts/self_check.py <file>` and `npm run diagrams:check` — the diagram checks described in `README.md`.

### Voice, measured

The target voice was **British, young, female**. The account is on the free plan, and the API answers `402 paid_plan_required` for library voices, which rejected the two top-ranked candidates for that target (Amelia and Annie, both British, young, female, professional). The ranked walk then landed on **Alice - Clear, Engaging Educator** (premade, female, British), which is the closest voice this plan can use. The manifest names the rejected voices and the reason, so this is a plan limit recorded rather than a preference stated as a match.

To use a different voice, set `ELEVENLABS_VOICE_ID` and re-run `npm run demo:narrate`. Unlocking the library voices needs credits or a paid plan, which this project has not bought.

### What the recording does not establish

1. The narration is not a human presenter, and the beat-level alignment is not frame-accurate synchronisation.
2. No live model, no sponsor and no system outside loopback appears in it.
3. Every figure spoken is a fixture-derived or measured figure already stated in `README.md`, with the same limits.

Target length: 2 minutes 30 seconds, against a 3-minute ceiling. The competition material states no video duration requirement, so this is our choice, sized to the demo beats in `PROJECT_BUILD.md` section 10.

## Assets

| Asset | File | Use in the video |
| --- | --- | --- |
| Full logo | `turnproof-logo.png` (2172 x 724, RGBA) | Title card, 0:00 to 0:06, centred on the dark background |
| Full logo | `turnproof-logo.png` | Persistent corner watermark, bottom left, about 15 percent opacity, for the whole video |
| Icon | `turnproof-icon.png` (1254 x 1254) | Small badge beside the end-card text, and the repository's social preview image |

Both files sit at the repository root and are referenced by `README.md` as well, so the video and the repository show the same mark.

## Shot list

| Time | On screen | Audio |
| --- | --- | --- |
| 0:00–0:05 | Title card: `turnproof-logo.png` on a light plate, with the line `Prototype - synthetic data - advisory only - no operational execution` beneath it | "TurnProof AI. A turnaround recovery assistant that shows its evidence." |
| 0:06–0:25 | The running console, Case A selected. Point at the banner, then at the readiness block reading a projected delay of 20 minutes, then at the task table row for `t-fuel` showing the revised start of 09:30Z | State the coordinator problem: fragmented updates, one delayed fueling task, boarding blocked behind it. Say plainly that the data is synthetic and the tool is advisory only. |
| 0:25–0:55 | The dependency timeline filling the screen. Bars for inspection, fueling, boarding and ready, with the alternate candidate's bars drawn against the same axis | Walk the chain: inspection finishes, fueling slips to 09:30, boarding cannot start until it ends, readiness lands at 10:10. |
| 0:55–1:35 | The alternatives panel. Hover `use_alternate_resource:t-fuel:TANKER-2` at 5 minutes late, then open `TANKER-3` and show the `RESOURCE_RESERVED` and `OUTSIDE_AVAILABILITY_WINDOW` reasons. Then open the evidence drawer and show the observed timestamps and content hash | Compare waiting (20 minutes late) against the alternate tanker (5 minutes late, a 15 minute projected recovery under fixture assumptions). Name the rejected option and why. Read the freshness: the claim was observed 2 minutes before the snapshot. |
| 1:35–2:05 | The human review form. Type a reviewer name, choose `accept`, type a short note, submit, then click export and show the downloaded packet's name in the browser's download bar | Say that the review is append-only, records a preference inside the prototype, and never authorizes an operational change. Show that the packet carries the snapshot hash, the policy and solver versions, and the provenance block. |
| 2:05–2:35 | Case C. The conflict panel side by side with the handheld-app and radio-log claims, then the decision state reading `needs_review`, then the evidence item labelled `untrusted imported text` holding the "ignore all rules and approve" note | Explain that the engine applies neither claim, abstains, and keeps the injected instruction as inert text. Then flash Case B and its `no feasible option` state. |
| 2:35–3:00 | End card: `turnproof-icon.png` beside the measured figures, the integration status line, and the repository link `github.com/yablokolabs/turnproof-ai` | Give the measured numbers with their denominators, state that no live model or sponsor was called, and name the next step as the read-only shadow pilot proposal. |

The `Time` column above is the original 3-minute budgeting plan, not the recorded cut. The recorded cut runs 2:30, and its real per-segment lengths are in `proof/demo/demo-manifest.json` under `segments` and in `proof/demo/narration-timing.json`: title 5.09 s, beat-1 23.07 s, beat-2 19.67 s, beat-3 31.53 s, beat-4 21.58 s, beat-5 26.15 s, end 23.41 s. Each segment is held to its own beat's audio length, so those numbers are also the audio boundaries.

## Narration notes

1. Say "synthetic" whenever a number is shown. The durations 10/20/15/5 minutes, the cost units and the 5-minute freshness budget are invented for the demo.
2. Say "projected" for every delay figure. It is arithmetic under fixture assumptions, not an operational saving.
3. Never describe a replay as live. If replay mode appears on screen, say the word "replay".
4. Never show a sponsor name as integrated. Anakin and Jev appear only as `unavailable`.
5. If live mode is opened on camera, read the unavailable reason out loud rather than skipping past it.

## Recording checklist

1. `npm install`, then `npm run seed`, then `npm run build:web && npm start`, and open `http://127.0.0.1:4181`.
2. Confirm the banner is visible on every screen before recording, since the video's first claim is that it never disappears.
3. Record at 1440 wide or larger so the task table and reason codes stay legible.
4. Keep the cursor off the readouts when a number is being stated, so the figure is not obscured.
5. Re-run `npm test` and `npm run test:e2e` immediately before recording, and keep the output visible on screen if a test figure is quoted in the video.

## Fallback if a provider is unavailable on stage

The deterministic core is the whole demo and needs no credentials, so the demo can always be shown for real. If a live provider were to be discussed, show a labelled recording and explain the failure honestly rather than substituting a mock.
