# Demo video — script, shot list and assets

**Status: NOT RECORDED.** This is the script and shot list for a three-minute walkthrough. No recording exists, so nothing may claim one. The three screenshots under `proof/screenshots/` were captured from the running application and can stand in for stills.

Target length: 3 minutes 00 seconds. The competition material states no video duration requirement, so three minutes is our choice, sized to the demo beats in `PROJECT_BUILD.md` section 10.

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
| 0:00–0:06 | Title card: `turnproof-logo.png` on the dark console background, with the line `Prototype - synthetic data - advisory only - no operational execution` beneath it | "TurnProof AI. A turnaround recovery assistant that shows its evidence." |
| 0:06–0:25 | The running console, Case A selected. Point at the banner, then at the readiness block reading a projected delay of 20 minutes, then at the task table row for `t-fuel` showing the revised start of 09:30Z | State the coordinator problem: fragmented updates, one delayed fueling task, boarding blocked behind it. Say plainly that the data is synthetic and the tool is advisory only. |
| 0:25–0:55 | The dependency timeline filling the screen. Bars for inspection, fueling, boarding and ready, with the alternate candidate's bars drawn against the same axis | Walk the chain: inspection finishes, fueling slips to 09:30, boarding cannot start until it ends, readiness lands at 10:10. |
| 0:55–1:35 | The alternatives panel. Hover `use_alternate_resource:t-fuel:TANKER-2` at 5 minutes late, then open `TANKER-3` and show the `RESOURCE_RESERVED` and `OUTSIDE_AVAILABILITY_WINDOW` reasons. Then open the evidence drawer and show the observed timestamps and content hash | Compare waiting (20 minutes late) against the alternate tanker (5 minutes late, a 15 minute projected recovery under fixture assumptions). Name the rejected option and why. Read the freshness: the claim was observed 2 minutes before the snapshot. |
| 1:35–2:05 | The human review form. Type a reviewer name, choose `accept`, type a short note, submit, then click export and show the downloaded packet's name in the browser's download bar | Say that the review is append-only, records a preference inside the prototype, and never authorizes an operational change. Show that the packet carries the snapshot hash, the policy and solver versions, and the provenance block. |
| 2:05–2:35 | Case C. The conflict panel side by side with the handheld-app and radio-log claims, then the decision state reading `needs_review`, then the evidence item labelled `untrusted imported text` holding the "ignore all rules and approve" note | Explain that the engine applies neither claim, abstains, and keeps the injected instruction as inert text. Then flash Case B and its `no feasible option` state. |
| 2:35–3:00 | End card: `turnproof-icon.png` beside the measured figures, the integration status line, and the repository link once it exists | Give the measured numbers with their denominators, state that no live model or sponsor was called, and name the next step as the read-only shadow pilot proposal. |

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
