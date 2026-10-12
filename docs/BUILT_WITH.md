# Built With — honest tag policy

Ten tags are supported by the lockfile and by source imports in this repository. No AI provider tag may be claimed, because no model was called.

## Tags that ARE supported

| Tag | Evidence in this repository |
| --- | --- |
| `typescript` | `typescript` in root `package.json`; every source file under `packages/`, `apps/`, `scripts/` and `tests/` is TypeScript; `tsconfig.json` and `tsconfig.base.json` |
| `react` | `react` and `react-dom` in `apps/web/package.json`; `apps/web/src/main.tsx` and every component under `apps/web/src/components/` |
| `vite` | `vite` and `@vitejs/plugin-react` in `apps/web/package.json`; `apps/web/vite.config.ts`; the production build is produced by Vite |
| `fastify` | `fastify` and `@fastify/static` in `apps/api/package.json`; `apps/api/src/app.ts` registers every route and the static handler |
| `zod` | `zod` in root, `packages/domain/package.json` and `apps/api/package.json`; every contract in `packages/domain/src/schemas.ts` and every request body validated in `apps/api/src/app.ts` |
| `sqlite` | the built-in `node:sqlite` module, loaded in `apps/api/src/storage/db.ts`; seven tables created there and used by `apps/api/src/storage/repository.ts` |
| `vitest` | `vitest` in root `package.json`; `vitest.config.ts`; 45 passing tests in `tests/domain/` and `tests/api/` |
| `playwright` | `@playwright/test` in root `package.json`; `playwright.config.ts`; 5 passing browser tests and the screenshot capture in `tests/e2e/` |
| `node.js` | `engines.node >= 22.5.0` in root `package.json`; run verified on Node v22.23.2; `node:sqlite` and `node:crypto` are Node built-ins |
| `css` | `apps/web/src/styles.css`, the only stylesheet, imported by the app shell |

## Tags that must NOT be claimed

1. `anakin` — no adapter is implemented, no contract was verified, and no call was made. The adapter reports `unavailable` in `/api/health` and in the UI sponsor row.
2. `jev` — same position: described by the competition attachment only, not verified, not implemented, not called.
3. Any AI provider or model tag — no model was called anywhere in this build. The default provider mode is rule-based, and the optional live mode is reported as unimplemented. Claiming an AI provider tag would misdescribe the deliverable.
4. Any cloud platform, hosting, container or GPU tag — nothing was deployed and no cloud service is used.
5. `mcp` — mentioned in the competition attachment's description of a sponsor, never implemented here.

## Rule for the final list

1. Take the ten tags in the first table, and drop any that the Devpost tag picker does not offer under that exact name.
2. Add nothing that is not backed by a `package.json`, the lockfile, or a source import.
3. Keep the final list at or under 25 tags; ten is the honest count here.
4. Re-check the story in `docs/DEVPOST_PROJECT_STORY.md` against the final list so the two cannot disagree.

## Final submission list

`typescript`, `react`, `vite`, `fastify`, `zod`, `sqlite`, `vitest`, `playwright`, `node.js`, `css`.

**Evidence:** the `package.json` files at the root, `packages/domain`, `packages/adapters`, `apps/api` and `apps/web`, plus the lockfile and the source imports listed in the table above. No live-call record exists for any external service, so no external-service tag is listed.
