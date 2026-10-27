# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

PerpLog: a trade journal and bot-held stop-loss protection for dreamDEX perps on Somnia (Hideki testnet).
pnpm workspace: `packages/{core,chain,db}`, `apps/{web,worker}`. Design authority: `docs/specs/2026-10-25-perplog-design.md`;
implementation plans live in `docs/superpowers/plans/`.

## Commands

- Full check (what CI runs, plus e2e and build): `pnpm lint && pnpm -r typecheck && pnpm test && (cd apps/web && pnpm exec playwright test) && pnpm --filter @perplog/web build`
- One test file: `pnpm vitest run apps/worker/test/stop-engine.test.ts` (from the repo root; vitest projects cover every package).
- e2e runs the web app in fixture mode (`PERPLOG_FIXTURE_DIR`, set by `apps/web/playwright.config.ts`, port 3200, no DB).
  Outside CI it reuses a server already on port 3200, so stop a stale one first.
- DB tests need no Postgres: `createTestDb()` from `@perplog/db/testing` runs PGlite with the real migrations.
- New migration after editing `packages/db/src/schema.ts`: `cd packages/db && pnpm exec drizzle-kit generate`.
- Local secrets live in `apps/worker/.env` (loaded by the worker's `start` script; real env vars win) and
  `apps/web/.env.local`. Never print, commit or echo their values; `.dockerignore` must keep `**/.env*` out of images.
- Lint is Biome (`biome check .`, line width 110, double quotes, organized imports); Markdown and `docs/` are excluded.

## Invariants (break these and the product is unsafe)

- **Only `apps/worker` signs.** `apps/web` must never import `@perplog/db/crypto`, `@perplog/chain/signer` or a viem
  wallet client, and never reads `KEY_ENCRYPTION_KEY` or `TREASURY_PRIVATE_KEY`. Signer code stays out of the
  `@perplog/chain` barrel.
- **The worker never increases exposure.** It only sends orders that close a position for an armed stop; it re-reads
  the live size before every send, never sends more than `|size|`, and never resends while a previous tx outcome is
  unknown. dreamDEX has no reduce-only flag.
- Stop status changes are compare-and-set (`transitionStop(db, id, fromStatuses, to)`); never update status blindly.
- Money and on-chain values are raw `bigint` (`numeric(78,0)` in Postgres, decimal strings over JSON). Addresses are
  lowercase. Never hardcode pools, decimals, tick or lot sizes: read them from the market list.
- `@somnia-chain/markets-sdk` is pinned to exactly `0.32.1`; TypeScript stays `5.9.3`.
- Without `DATABASE_URL` the web app must keep working read-only: protection routes answer 503 `db_unavailable` and
  the UI hides Protect/Watch.
- On Neon the worker needs the **direct** URL: its single-signer lock is a session-level `pg_try_advisory_lock`,
  which Neon's pooled (PgBouncer transaction mode) URL breaks. The web uses the pooled URL.

## Conventions

- Everything in the repo (code, comments, docs, commits) is in English.
- Never commit to `main` directly: create a branch (`feat/…`, `fix/…`, `docs/…`) first, then merge locally.
- Fixed UI copy and `data-testid`s used by e2e (`Protect`, `Arm stop`, `Cancel stop`, `Watch this account`,
  `link-wizard`, `bot-address`, `perplog-stop`, `alert-toast`) must not change without updating `apps/web/e2e`.
