---
name: verify
description: Run PerpLog's full verification chain (Biome lint, typecheck, unit/golden/DB tests, Playwright e2e in fixture mode, web production build) and report pass/fail per step. Use before claiming work is done, before committing or merging, or when the user asks to verify, check or test everything.
---

Run each step from the repo root, in this order, stopping at the first failure. Send each step's output to a file
under the session scratchpad (or `/tmp` if none) and read only its tail; never paste a full log into the reply.

1. Lint: `pnpm lint`
   - On a formatting or import-order failure, run `pnpm exec biome check --write <paths>` on the files you changed,
     then re-run the step. Never auto-fix files you did not touch without saying so.
2. Typecheck: `pnpm -r typecheck` (the web package runs `next typegen` first).
3. Unit, golden and DB tests: `pnpm test` (vitest projects for every package; DB tests use PGlite, no Postgres).
4. e2e: `cd apps/web && pnpm exec playwright test --reporter=line`
   - Fixture mode, port 3200, no DB. If a server is already on port 3200 it is reused; when results look stale,
     check `lsof -i :3200` and stop that server before re-running.
5. Build: `pnpm --filter @perplog/web build`
   - The route list must include `ƒ /api/session`, `ƒ /api/stops`, `ƒ /api/alerts` and `ƒ /api/watch`.

If $ARGUMENTS names a step (`lint`, `typecheck`, `test`, `e2e`, `build`) or a path, run only that step, or
`pnpm vitest run <path>` for a path.

Report a short table: step, command, result with counts (e.g. "364/364 tests", "18/18 e2e"). For a failure, quote
the failing test name and the first assertion or error lines, then diagnose the cause before proposing a fix. Do not
say a step passed unless you ran it in this turn and read its output.
