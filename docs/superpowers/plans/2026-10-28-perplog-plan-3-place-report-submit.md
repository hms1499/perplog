# PerpLog Plan 3: Plan & Place, Weekly Report, Evidence, Submission — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A trader enters a risk-sized market order with a bot-held stop attached, shares a weekly report on X, and judges see every PerpLog transaction on `/evidence`, ready for the DoraHacks submission on 2026-11-01 23:59 UTC.

**Architecture:**
- Sizing is a pure function in `packages/core`.
- The web quotes it from live reads, and `POST /api/plans` inserts a plan plus one `queued` entry execution.
- A new worker `EntryEngine` sends that entry once. It shares the per-bot-key serial queue with the `StopEngine`. On a fill it arms a `plan` stop in the same transaction.
- The weekly report is computed on request from history, through `next/og`. There is no cron and no `weekly_reports` table.
- `/evidence` lists the `executions` table.

**Tech Stack:** TypeScript 5.9.3, pnpm workspace, Next.js App Router (`next/og`), Drizzle + Postgres (PGlite in tests), viem, `@somnia-chain/markets-sdk` 0.32.1, Vitest, Playwright, Biome.

**Spec:**
- `docs/specs/2026-10-25-perplog-design.md` (§4.1 ⑤ ⑦, §6.6, §8 `plans`, §9 Plan-3 rows, §10, §14.2), for behavior;
- `docs/specs/2026-10-28-perplog-design-system.md` (approved 2026-10-28), for how every screen looks.

Read `CLAUDE.md` first.

**Execution:** Native (the user's choice). The invariant change below is approved.

## Global Constraints

- Only `apps/worker` signs. `apps/web` never imports `@perplog/db/crypto`, `@perplog/chain/signer` or a viem wallet client.
- Stop and plan status changes are compare-and-set. Never update a status blindly.
- Raw values are `bigint` (`numeric(78,0)`), and decimal strings over JSON. Addresses are lowercase. Pools, decimals, tick and lot sizes come from `chain.markets()`.
- `@somnia-chain/markets-sdk` stays exactly `0.32.1`, and TypeScript stays `5.9.3`.
- Without `DATABASE_URL`, the protection and plan routes answer 503 `db_unavailable`, and the UI hides Place/Protect/Watch. `/evidence` shows an "unavailable" state.
- Fixed UI copy and `data-testid`s that e2e already uses must not change. New ones: `plan-form`, `plan-quote`, `Place order`, `plan-status`, `report-image`, `Share on X`, `evidence-row`.
- Every input goes through zod v4. Addresses are normalized with `normalizeAddress`. POSTs check `checkOrigin` and `limitPost`.
- Spec defaults: entry slippage **50 bps**; long reference price `bestAsk`, short reference price `bestBid`; long needs `stop < P`, short needs `stop > P`; `qty = floor(R·10^baseDecimals / |P−S| / lot)·lot`.
- All copy, code, comments and commits are in English. Work on a branch (`feat/plan-3-…`) and merge locally.
- **Styling:**
  - Colors come only from the design-system tokens (§4 of the design doc), with no raw hex in components. The one exception is the OG card, which always uses the dark values.
  - Every number is Geist Mono with `tabular-nums`.
  - The footer reads "Independent tool for dreamDEX traders · not affiliated with dreamDEX".
  - Never use the `{d}` logo or "dreamdex" as our brand.

## Invariant change (approved 2026-10-28)

`CLAUDE.md` says "The worker never increases exposure". Plan & Place cannot work under that rule. Task 5 replaces it with:

> **The worker increases exposure only for a plan entry:**
> - the IOC order of a plan that the account's linked session confirmed through `POST /api/plans`;
> - sent **at most once**, never retried or resent, including after a restart;
> - only while the account is flat on that pool and the plan is younger than `ENTRY_MAX_AGE_MS` (30 s);
> - never larger than the quoted `qtyRaw`.
>
> Every other order closes a position for an armed stop, as before.

## Deliberate deviations from the spec

- **Market entry only:** spec §6.6 entry mode `limit` is cut, because a resting entry would need fill tracking and stop arming on a later fill.
- **Max quantity:** the cap is `getMaxPerpOrderSize(...).maxQuantity`, without the "− Σ resting same-side orders" term. The worker's `simulateContract` still rejects anything the margin cannot carry, before broadcast.
- **Flat positions only:** Plan & Place requires a flat position on the pool (409 `position_open`). A plan stop is `qtyMode: "entire"`, and on a non-flat pool it would also close the older position.
- **Weekly report:** computed on request for an ISO week (Monday 00:00 UTC). There is no `weekly_reports` table and no `ReportJob`.
- **`/api/executions`:** returns the latest 200 executions with a tx hash, across all accounts (`?account=` filters). `/evidence` is for judges.

## Review Focus

1. **Double-click or a retried POST on Place.** Expected: one plan and one entry. A second POST for the same (account, pool) while a plan is `pending_entry` answers 409 `plan_pending` (Task 4 test).
2. **Price moves between quote and Place.** Expected: the server re-quotes and never trusts client numbers. The IOC bound caps the slippage at 50 bps. The worker fails entries older than 30 s with `expired` (Tasks 4 and 5 tests).
3. **Worker restart with an entry left `sending`/`sent`.** Expected: it is resolved from its receipt or marked `dropped`, and never sent again (Task 5 test).
4. **Odd market units:** 6/8/18/24 base decimals, BTC lot 1000 and min 13000, risk too small for one lot. Expected: an exact floor to the lot, or a `risk_too_small` error, never a zero-quantity order (Task 1 tests).
5. **Empty or one-sided book** (no ask for a long). Expected: a quote error `no_liquidity`, and no NaN or zero prices shown (Tasks 1 and 3 tests).

---

### Task 1: Risk sizing in core

**Files:**
- Create: `packages/core/src/sizing.ts`
- Modify: `packages/core/src/config.ts` (append), `packages/core/src/index.ts` (export)
- Test: `packages/core/test/sizing.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const ENTRY_SLIP_BPS = 50;            // config.ts
  export const ENTRY_MAX_AGE_MS = 30_000;      // config.ts
  export type EntryQuoteError =
    | "no_liquidity" | "stop_wrong_side" | "risk_too_small" | "stop_beyond_liquidation" | "not_priceable";
  export interface EntryQuoteInput {
    market: MarketInfo; side: Side; riskRaw: bigint; stopPrice: bigint;
    bestBid: bigint | null; bestAsk: bigint | null; slippageBps?: number; // default ENTRY_SLIP_BPS
  }
  export type EntrySize =
    | { ok: true; refPrice: bigint; qtyRaw: bigint; priceBound: bigint; notionalRaw: bigint; effectiveRiskRaw: bigint }
    | { ok: false; error: EntryQuoteError };
  export function sizeEntry(input: EntryQuoteInput): EntrySize;
  /** Applies the margin cap; `capped` is true when maxQtyRaw cut the size. */
  export function capEntry(size: Extract<EntrySize, { ok: true }>, maxQtyRaw: bigint, market: MarketInfo, side: Side, stopPrice: bigint):
    | (Extract<EntrySize, { ok: true }> & { capped: boolean })
    | { ok: false; error: "risk_too_small" };
  /** Long: blocked when liq ≥ stop. Short: blocked when liq ≤ stop. A null liquidation price never blocks. */
  export function stopBeyondLiquidation(side: Side, stopPrice: bigint, liqPrice: bigint | null): boolean;
  ```
- `effectiveRiskRaw = qtyRaw · |P − S| / 10^baseDecimals`. `notionalRaw` uses the existing `notionalRaw(qty, P, baseDecimals)` from `units.ts`.
- `priceBound`:
  - long: `floor(P·(10000+slip)/10000 / tick)·tick`;
  - short: `ceil(P·(10000−slip)/10000 / tick)·tick`.

- [ ] **Step 1: Write the failing tests** in `packages/core/test/sizing.test.ts`:
  - `long sizes from bestAsk and floors to the lot`: an 18-decimal market (lot 10¹⁵, min 10¹⁵, tick 10¹⁴); `bestAsk = 100e18`; stop `95e18`; risk `10e18`. Expect `qtyRaw = 2e18`, `effectiveRiskRaw = 10e18`, `priceBound = 100.5e18`.
  - `short sizes from bestBid; priceBound rounds up to the tick`.
  - `6, 8 and 24 base decimals give the exact floored quantity` (table test).
  - `BTC lot 1000 min 13000: a risk below one min lot is risk_too_small`.
  - `long with stop ≥ P is stop_wrong_side; short with stop ≤ P is stop_wrong_side`.
  - `missing ask for a long (or bid for a short) is no_liquidity`.
  - `capEntry floors maxQty to the lot, sets capped, recomputes effectiveRiskRaw; below minQuantity is risk_too_small`.
  - `stopBeyondLiquidation: long blocks liq ≥ stop, short blocks liq ≤ stop, null never blocks`.
- [ ] **Step 2: Run them and see them fail.** `pnpm vitest run packages/core/test/sizing.test.ts`, expected FAIL (module not found).
- [ ] **Step 3: Implement `sizing.ts`** with the signatures above, then export it from the core barrel.
- [ ] **Step 4: Run them and see them pass.** Same command, expected PASS.
- [ ] **Step 5: Commit** with `feat(core): risk-based entry sizing`.

### Task 2: Plans, entry executions and evidence queries in the DB

**Files:**
- Modify: `packages/db/src/schema.ts`:
  - new `planStatus` enum `pending_entry | entered | partially_entered | entry_failed`;
  - new `plans` table per spec §8 (columns `id, account, pool, side, risk_raw, ref_price, stop_price, qty_raw, price_bound, leverage_est_bps int null, liq_price_est null, status, entry_execution_id, stop_id, created_at, updated_at`);
  - `alertType` gains `entry_failed`;
  - `executions.planId` references `plans.id`;
  - a partial unique index `plans_one_pending_idx` on `(account, pool)` where `status = 'pending_entry'`.
- Generate: `packages/db/migrations/0001_*.sql`, with `cd packages/db && pnpm exec drizzle-kit generate`.
- Create: `packages/db/src/queries/plans.ts`. Modify: `packages/db/src/queries/index.ts`.
- Test: `packages/db/test/plans.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PlanRow; export type NewPlan; export type PlanStatus;
  /** One transaction: the plan (pending_entry) and its queued entry execution. A unique violation → null. */
  export function createPlanWithEntry(db: Db, p: NewPlanInput): Promise<{ plan: PlanRow; executionId: string } | null>;
  export function getPlan(db: Db, id: string): Promise<PlanRow | null>;
  /** CAS queued → sending, oldest first, at most `limit`. Returns the claimed rows. */
  export function claimQueuedEntries(db: Db, limit: number): Promise<ExecutionRow[]>;
  /** Entries left sending/sent (crash or unknown outcome), for the resolver. */
  export function listOpenEntries(db: Db): Promise<ExecutionRow[]>;
  /** One transaction: the execution confirmed, a stop inserted (armed, entire, source plan), and the plan pending_entry → entered or partially_entered. False when the plan already left pending_entry. */
  export function settleEntryFilled(db: Db, a: { executionId: string; fill: { txHash: string; orderId: bigint | null; filledRaw: bigint; avgPrice: bigint | null; gasUsed: bigint } }): Promise<boolean>;
  /** One transaction: the execution failed (error, optional txHash), the plan → entry_failed, and an entry_failed
   * alert with payload { planId, pool, reason }. */
  export function settleEntryFailed(db: Db, a: { executionId: string; error: string; txHash?: string | null }): Promise<boolean>;
  /** CAS sending → queued for an entry that was claimed but not sent (the bot had a pending tx). */
  export function requeueEntry(db: Db, executionId: string): Promise<boolean>;
  /** The latest executions with a tx hash, newest first, optionally for one account. */
  export function listEvidence(db: Db, opts: { account?: Address; limit?: number }): Promise<ExecutionRow[]>;
  ```
  `NewPlanInput` carries: `account, pool, botKeyId, side, riskRaw, refPrice, stopPrice, qtyRaw, priceBound, leverageEstBps, liqPriceEst`. The entry execution is `kind: "entry"`, `isBid = side === "long"`. A plan is `entered` when `filledRaw === qtyRaw` and `partially_entered` when `0 < filledRaw < qtyRaw`. The stop's `triggerPrice` is the plan's `stopPrice`, with `triggerOp` `lte` for a long and `gte` for a short.

- [ ] **Step 1: Write the failing tests** in `plans.test.ts`, on `createTestDb()`:
  - `createPlanWithEntry inserts a pending plan and a queued entry`;
  - `a second pending plan on the same account and pool returns null`;
  - `claimQueuedEntries claims each row once`: two concurrent calls never return the same id;
  - `settleEntryFilled arms a plan stop and marks the plan entered; a partial fill is partially_entered`;
  - `settleEntryFilled on a plan that left pending_entry returns false and inserts no stop`;
  - `settleEntryFailed marks the plan entry_failed and inserts one entry_failed alert`;
  - `listEvidence returns only rows with a tx hash, newest first, filtered by account`.
- [ ] **Step 2: Run them and see them fail.** `pnpm vitest run packages/db/test/plans.test.ts`
- [ ] **Step 3: Edit `schema.ts`, generate the migration, implement `plans.ts`, and export it.**
- [ ] **Step 4: Run the DB package and see it pass.** `pnpm vitest run packages/db`. The existing tests stay green, and the migration applies on PGlite.
- [ ] **Step 5: Commit** with `feat(db): plans, entry executions and evidence queries`.

### Task 3: Quote reads and `POST /api/plans/quote`

**Files:**
- Modify: `apps/web/lib/chain.ts`. Add `bookTop(pool)`, `maxOrderSize(account, pool, isBid, price)` and `liquidationPreview(account, pool, isBid, qtyRaw, price)`, wrapping the SDK `getBookTopsOnchain`, `getMaxPerpOrderSize` and `previewPerpLiquidationPrice` on `createReadClient(HIDEKI)`. Errors become `ChainUnavailableError`.
- Create: `apps/web/lib/quote.ts`, `apps/web/app/api/plans/quote/route.ts`
- Test: `apps/web/app/api/plans/plans.test.ts` (mock `@/lib/chain` as `stops.test.ts` does)

**Interfaces:**
- Consumes: `sizeEntry`, `capEntry`, `stopBeyondLiquidation`, `ENTRY_SLIP_BPS` (Task 1).
- Produces:
  ```ts
  // lib/chain.ts
  bookTop(pool: Address): Promise<{ bestBid: bigint | null; bestAsk: bigint | null }>;
  maxOrderSize(account: Address, pool: Address, isBid: boolean, price: bigint): Promise<bigint | null>; // null = not priceable
  liquidationPreview(account: Address, pool: Address, isBid: boolean, qtyRaw: bigint, price: bigint):
    Promise<{ liqPrice: bigint | null; leverageBps: bigint | null } | null>;           // null = not priceable
  // lib/quote.ts — shared by /quote and POST /api/plans so both size identically
  export const QuoteBody: z.ZodType<{ account: string; pool: string; side: "long" | "short"; riskRaw: string; stopPrice: string }>;
  export type Quote = { ok: true; qtyRaw: bigint; refPrice: bigint; priceBound: bigint; notionalRaw: bigint;
    effectiveRiskRaw: bigint; capped: boolean; liqPriceEst: bigint | null; leverageEstBps: bigint | null; warnings: string[] }
    | { ok: false; error: EntryQuoteError | "unknown_pool" };
  export function quoteEntry(input: { account: Address; pool: Address; side: Side; riskRaw: bigint; stopPrice: bigint }): Promise<Quote>;
  ```
  `stopPrice` is snapped to the tick away from the entry (long: floor, short: ceil). A `capped` quote adds the warning `"Capped by your available margin; effective risk shown."`.
  Route response: 200 with the quote's bigints as decimal strings; 400 `{ error }` for `!ok` or a zod failure; 503 `indexer_unavailable` on `ChainUnavailableError`. This route needs **no DB and no session**.

- [ ] **Step 1: Write the failing tests:**
  - `quote sizes a long from the ask and returns decimal strings`;
  - `missing ask → 400 no_liquidity`;
  - `stop beyond the projected liquidation price → 400 stop_beyond_liquidation`;
  - `a max size below the risk size returns capped with the warning`;
  - `riskRaw "0", "-1" or "1.5" → 400 invalid_input`;
  - `chain failure → 503 indexer_unavailable`.
- [ ] **Step 2: Run them and see them fail.** `pnpm vitest run apps/web/app/api/plans/plans.test.ts`
- [ ] **Step 3: Implement the chain wrappers, `lib/quote.ts` and the route.**
- [ ] **Step 4: Run them and see them pass.** Same command.
- [ ] **Step 5: Commit** with `feat(web): entry quote from live book, margin and liquidation reads`.

### Task 4: `POST /api/plans` and `GET /api/plans/:id`

**Files:**
- Create: `apps/web/app/api/plans/route.ts`, `apps/web/app/api/plans/[id]/route.ts`
- Test: extend `apps/web/app/api/plans/plans.test.ts`

**Interfaces:**
- Consumes: `quoteEntry`, `QuoteBody` (Task 3); `createPlanWithEntry`, `getPlan` (Task 2); `linkedOf`, `checkOrigin`, `limitPost`, `sessionId` (existing).
- Produces:
  - `POST /api/plans`, with body `QuoteBody & { confirm: true }`. The checks run in the same order as `POST /api/stops`:
    1. origin, DB (503), rate limit, session (401) and linked (403);
    2. `body.account` must equal the linked account (403 `account_mismatch`);
    3. grant on the pool (409 `pool_not_linked`, with the stops route's message);
    4. live position size must be 0 (409 `position_open`);
    5. the server-side `quoteEntry` must be `ok` (400 `{error}`);
    6. `createPlanWithEntry`, where `null` means 409 `plan_pending`.

    Success is 201 `{ plan: PlanView }`.
  - `GET /api/plans/:id`, with a session whose linked account owns the plan, otherwise 404. Returns `{ plan: PlanView }`. `PlanView` is `{ id, pool, side, qtyRaw, stopPrice, status, stopId, txHash }`, where `txHash` comes from the entry execution.

- [ ] **Step 1: Write the failing tests:**
  - `places a plan with a queued entry sized by the server, not the client`: the body carries a stale `qtyRaw` that is ignored;
  - `no DATABASE_URL → 503 db_unavailable`;
  - `unlinked → 403`;
  - `another account → 403 account_mismatch`;
  - `open position → 409 position_open`;
  - `second POST while pending → 409 plan_pending`;
  - `missing grant → 409 pool_not_linked`;
  - `GET returns the owner's plan with its entry tx hash and 404 for anyone else`.
- [ ] **Step 2: Run them and see them fail.** `pnpm vitest run apps/web/app/api/plans/plans.test.ts`
- [ ] **Step 3: Implement both routes.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** with `feat(web): place a plan as a queued entry; read its status`.

### Task 5: Worker `EntryEngine`, shared serial and the invariant change

**Files:**
- Create: `apps/worker/src/entry-engine.ts`
- Modify:
  - `apps/worker/src/stop-engine.ts`: `StopEngineDeps` gains `serial?: KeyedSerial`, defaulting to a new one;
  - `apps/worker/src/start.ts`: one `KeyedSerial` shared by both engines; `every(ENTRY_POLL_MS = 300, "entry-engine", …)`; the engine is stopped with the other loops;
  - `CLAUDE.md`: replace the "never increases exposure" invariant with the text in **Invariant change** above;
  - `README.md`: the security section, same text.
- Test: `apps/worker/test/entry-engine.test.ts` (reuse `fakeTradingChain` and `fakeLogger` from `test/fakes.ts`)

**Interfaces:**
- Consumes: `claimQueuedEntries`, `listOpenEntries`, `settleEntryFilled`, `settleEntryFailed`, `getPlan`, `getBotKey` (Task 2 and existing); `ENTRY_MAX_AGE_MS` (Task 1); `placeMarketFor` and `TxOutcomeUnknown` through `ChainPort`.
- Produces: `createEntryEngine(deps: { db; chain: ChainPort; kek: Buffer; log; serial: KeyedSerial; now?: () => number }): { tick(): Promise<void>; idle(): Promise<void>; stop(): Promise<void> }`.
- Per tick:
  1. **Resolve** `listOpenEntries`:
     - receipt found → `settleEntryFilled`, or `settleEntryFailed("no_fill" | "reverted_onchain")`;
     - no receipt and `hasPendingTx` → wait;
     - no receipt and nothing pending → `settleEntryFailed("dropped")`.
  2. **Send** each claimed entry, under `serial.run(botKeyId, …)`:
     - fail `expired` when `now − createdAt > ENTRY_MAX_AGE_MS`;
     - fail `position_changed` when the live size ≠ 0;
     - fail `bot_key_unavailable` when there is no key or the decrypt fails;
     - when `hasPendingTx` is true, `requeueEntry` and retry next tick;
     - otherwise `placeMarketFor` **once**:
       - fill > 0 → `settleEntryFilled`;
       - `OperatorRevert` or zero fill → `settleEntryFailed`;
       - `TxOutcomeUnknown` → `updateExecution(status: "sent", txHash)` and leave it to the resolver.
- Log `entry_sent` with `ms_since_queued` and `place_steps`. Never log key material.

- [ ] **Step 1: Write the failing tests:**
  - `a queued entry is sent once with the plan's qty and bound, and arms an entire plan stop`;
  - `a zero fill fails the plan with an entry_failed alert and arms no stop`;
  - `an entry older than 30 s is expired and never sent`;
  - `a non-flat position fails position_changed and is never sent`;
  - `an unknown outcome is resolved from its receipt on the next tick, never resent`;
  - `after a restart, a sent entry with no receipt and no pending tx is dropped, never resent`;
  - `entry and stop close for the same bot key never overlap`: the serial is shared, so `f.calls` shows no interleaving.
- [ ] **Step 2: Run them and see them fail.** `pnpm vitest run apps/worker/test/entry-engine.test.ts`
- [ ] **Step 3: Implement the engine, wire it into `start.ts`, inject the serial into the StopEngine, and update `CLAUDE.md` and the README.**
- [ ] **Step 4: Run the worker tests and see them pass.** `pnpm vitest run apps/worker`. The existing stop-engine and start tests stay green.
- [ ] **Step 5: Commit** with `feat(worker): EntryEngine sends each plan entry once and arms its stop`.

### Task 6: Design system and whole-app re-skin

**Files:**
- Modify:
  - `apps/web/app/globals.css`: replace the paper/sheet/marker tokens with the design doc's §4 tokens, light under `:root` and dark under `@media (prefers-color-scheme: dark)`, mapped in `@theme inline` as `--color-page`, `--color-panel`, `--color-field`, `--color-line`, `--color-line-strong`, `--color-head`, `--color-text`, `--color-muted`, `--color-gain`, `--color-loss`, `--color-loss-fill`, `--color-warn`, `--color-brand`, `--color-brand-line`, `--color-action`, `--color-action-hover`, `--color-focus`;
  - `apps/web/app/layout.tsx`: replace Schibsted Grotesk with `Geist` and `Geist_Mono` from `next/font/google` (variables `--font-geist`, `--font-geist-mono`), and render `NavBar` and `Footer`;
  - every existing component in `apps/web/components/`: move to the tokens and the shared components below. **Keep every layout, copy string and `data-testid` as it is** (Health is changed in Task 7).
- Create: `apps/web/components/ui.tsx`, with small presentational components and no data fetching.
- Test: `apps/web/e2e/design.spec.ts`

**Interfaces:**
- Produces, from `ui.tsx`. Later tasks build their screens from these, styled per design doc §5:
  ```tsx
  Panel({ className?, children }); Label({ children }); StatTile({ label, value: ReactNode, tone?: "gain"|"loss"|"warn"|"head" });
  Field({ label, value, onChange, unit?, hint?, invalid?, inputMode?, id }); Segmented<T>({ options: {value: T; label}[]; value: T; onChange; tone?: "side" });
  Button({ variant: "action"|"ghost"|"x", ...buttonProps }); Badge({ tone: "testnet"|"ok"|"warn"|"loss", children }); Pill({ tone: "brand"|"action", children });
  Num({ raw?: bigint; text?: string; tone?: "auto"|"gain"|"loss"; className? }) // Geist Mono, tabular-nums, sign-colored when tone="auto"
  BreakdownRow({ label, value: ReactNode, total?: boolean }); WarnBox({ tone?: "warn"|"loss", children }); StepTracker({ steps: {label; state: "done"|"now"|"todo"}[] });
  NavBar({ address?: Address }); Footer();
  ```
- `NavBar` links are Account (when an address is known), Evidence (`/evidence`) and How it works (`/how-it-works`). The wordmark is `perp` + `log`, and "log" is `text-brand`.

- [ ] **Step 1: Write the failing e2e tests:**
  - `footer says not affiliated on the landing and account pages`;
  - `the light page background is rgb(238, 241, 245)` (with `page.emulateMedia({ colorScheme: "light" })`);
  - `no horizontal scroll at 390px wide on /, Health, Journal, Leaks and Positions` (`scrollWidth <= innerWidth`);
  - `the wordmark reads perplog and links home`.
- [ ] **Step 2: Run them and see them fail.** `cd apps/web && pnpm exec playwright test e2e/design.spec.ts --reporter=line`
- [ ] **Step 3: Implement the tokens, fonts, `ui.tsx` and the re-skin.** Change styling only.
- [ ] **Step 4: Run all e2e and see them pass.** `cd apps/web && pnpm exec playwright test --reporter=line`. Expected: 18 existing + 4 new, all passing.
- [ ] **Step 5: Screenshot review.**
  - Screenshot `/`, `/a/0x395225eab84c1b9304d42cb647238dcc90003951?range=all` (all tabs) and `/a/<addr>?tab=positions` at 1440 and 390 width.
  - Compare them with the mockups in the design doc's header.
  - Fix any raw hex left in components (`grep -rn "#[0-9a-fA-F]\{6\}" apps/web/components` must be empty).
- [ ] **Step 6: Commit** with `feat(web): design system tokens, Geist fonts and whole-app re-skin`.

### Task 7: Health Check "The gap"

**Files:**
- Modify:
  - `packages/core/src/types.ts` (`HealthSummary` gains `liquidationFeesRaw: bigint; tradingFeesRaw: bigint`);
  - `packages/core/src/summary.ts`;
  - `apps/web/components/health-panel.tsx` (the layout of design doc §6.1);
  - `apps/web/e2e/health.spec.ts`.
- Test: `packages/core/test/summary.test.ts` (extend), `apps/web/e2e/health.spec.ts`

**Interfaces:**
- Consumes: `ui.tsx` (Task 6); the `/api/accounts/:addr/health` response (it already serializes the summary; the two new bigints become decimal strings).
- Produces, over the same closed trades in range:
  - `liquidationFeesRaw = Σ costs.liquidationFee`;
  - `tradingFeesRaw = Σ (costs.tradingFee + costs.builderFee)`.
- New testids:
  - `health-gap`, on the panel with both figures;
  - `health-breakdown`, on the rows block.
- Keep `top-leak`, `equity-chart` and the reconcile badge copy (`✓ Reconciled with chain`) unchanged.
- The breakdown heading is "Where the <|realized − net|> went". The "Trading & builder fees" row appears only when that value is not 0.

- [ ] **Step 1: Write the failing tests:**
  - core: `breakdown identity holds on every golden fixture and range`. For each fixture in `packages/core/test/fixtures` and each range `7d|30d|all`, assert `realizedPnlRaw − fundingPaidRaw − liquidationFeesRaw − tradingFeesRaw === netPnlRaw`.
  - core: `liquidationFeesRaw excludes the realized loss counted in liquidationCostRaw`, on the liquidated fixture `0x3952…3951`.
  - e2e, which replaces the `1,782.26 USDso` assertion in `liquidated account shows reconciled badge…`. On `/a/0x395225eab84c1b9304d42cb647238dcc90003951?range=all`:
    - `health-gap` shows "The app shows (realized)" and "Your true net PnL";
    - `health-breakdown` shows Realized PnL, Funding paid, Liquidation fees and Net PnL rows;
    - the badge and `top-leak` checks stay.
- [ ] **Step 2: Run them and see them fail.**
  - `pnpm vitest run packages/core/test/summary.test.ts`
  - `cd apps/web && pnpm exec playwright test e2e/health.spec.ts --reporter=line`
- [ ] **Step 3: Implement the summary fields and the new Health layout.**
- [ ] **Step 4: Run them and see them pass.** Run the core tests and all e2e.
- [ ] **Step 5: Commit** with `feat: Health Check leads with the gap between realized and true net PnL`.

### Task 8: Plan tab (PlanForm)

**Files:**
- Create: `apps/web/components/plan-form.tsx`, `apps/web/components/plan-panel.tsx`
- Modify:
  - `apps/web/components/account-view.tsx`: add the `plan` tab after `positions`;
  - `apps/web/components/alert-toasts.tsx`: the `entry_failed` copy is "Entry not filled: no position was opened and no stop was armed.";
  - `apps/web/components/leak-card.tsx`: the [Fix] of `SIZE_UP_AFTER_LOSS` and `FUNDING_DRAG` links to `?tab=plan` (spec §6.5).
- Test: `apps/web/e2e/plan.spec.ts` (mock `/api/session`, `/api/plans/quote`, `/api/plans`, `/api/plans/*` as `protect.spec.ts` mocks its routes)

**Interfaces:**
- Consumes: `POST /api/plans/quote`, `POST /api/plans`, `GET /api/plans/:id`; `useProtectionAvailable`, `useSessionState` and `LinkWizard` (existing); `parseAmount` and `formatUsd` (core); `ui.tsx` (Task 6).
- **Layout is design doc §6.3 (P1, order ticket):**
  - The risk field is labelled "Max loss if the stop hits".
  - The button text is exactly `Place order`, with the secondary line "long <qty> <base> · stop <price>".
  - `plan-status` is a `StepTracker`: *Entry filled → Arming stop… → Protected*.
  - A failure shows a loss `WarnBox` with the `entry_failed` copy.
- Form fields:
  - market (select from `chain.markets()` via the existing positions or markets data);
  - side;
  - risk in USDso;
  - stop price.
- The quote is debounced by 400 ms, and the inputs are parsed with `parseAmount`.
- `plan-quote` shows the size, notional, entry bound, estimated liquidation price, estimated leverage, effective risk and warnings. An error code becomes readable text, e.g. `stop_beyond_liquidation` → "Stop is beyond your liquidation price; you would be liquidated first".
- `Place order`:
  - is disabled without a linked session, and shows `LinkWizard` in that case;
  - is disabled while there is no `ok` quote;
  - after a POST, polls `GET /api/plans/:id` every 2 s and shows `plan-status` (Entering… → Entered + stop armed, or Entry failed). Polling stops at a final status.
- Without a DB, the Plan tab shows the quote but no `Place order` button, in line with "UI hides Protect/Watch".

- [ ] **Step 1: Write the failing e2e tests:**
  - `quote updates as risk and stop change`;
  - `quote error is shown in words`;
  - `Place order needs a linked session`;
  - `placing shows Entering then Entered with the stop armed`;
  - `without a database there is no Place order button`.
- [ ] **Step 2: Run them and see them fail.** `cd apps/web && pnpm exec playwright test e2e/plan.spec.ts --reporter=line`
- [ ] **Step 3: Implement the components and the tab.**
- [ ] **Step 4: Run all e2e and see them pass.** `cd apps/web && pnpm exec playwright test --reporter=line`. Expected: all passing (the existing ones plus these 5).
- [ ] **Step 5: Commit** with `feat(web): Plan tab with a live risk quote and Place order`.

### Task 9: Weekly report image and share page

**Files:**
- Create:
  - `packages/core/src/weekly.ts`;
  - `apps/web/app/api/og/report/[address]/[week]/route.tsx` (`ImageResponse` from `next/og`, 1200×630);
  - `apps/web/app/r/[address]/[week]/page.tsx` (`generateMetadata` sets `openGraph.images` and `twitter.card = "summary_large_image"`);
  - `apps/web/components/report-panel.tsx`.
- Modify: `apps/web/components/account-view.tsx` (the `report` tab), `packages/core/src/index.ts`
- Test: `packages/core/test/weekly.test.ts`, `apps/web/e2e/report.spec.ts`

**Interfaces:**
- Consumes: the account service's enriched trades and unattributed funding (the same inputs `buildHealthSummary` takes); `computeLeaks`.
- Produces:
  ```ts
  /** Monday 00:00 UTC of the week holding `nowSec`, as "YYYY-MM-DD". */
  export function isoWeekStart(nowSec: number): string;
  export interface WeeklyReport { weekStart: string; tradeCount: number; netPnlRaw: bigint; winRatePct: number;
    fundingPaidRaw: bigint; liquidationCostRaw: bigint; tradesWithoutStopPct: number; topLeak: Leak | null; perplogStops: number }
  /** Trades with closedAt in [weekStart, weekStart + 7d); perplogStops counts exitType PERPLOG_STOP. */
  export function buildWeeklyReport(a: { trades: EnrichedTrade[]; unattributedFunding: FundingPayment[]; weekStart: string }): WeeklyReport;
  ```
- `WeeklyReport` also carries `realizedPnlRaw: bigint`, because the card's sentence needs it.
- The OG route:
  - answers 400 for a bad address or a `week` that is not a Monday in `YYYY-MM-DD` form;
  - sets `Cache-Control: public, max-age=300`;
  - **always draws the R2 dark card of design doc §6.4**, whatever the app theme, with the exact copy given there:
    - week label;
    - "True net PnL this week";
    - the "App showed … realized · biggest leak: …" sentence;
    - Trades, Win rate, Funding and No stop;
    - the footer "Reconciled to on-chain balance · Somnia testnet" / "perplog · <short address>".
- Fonts: commit the TTFs `Geist-Regular.ttf`, `Geist-SemiBold.ttf`, `GeistMono-Regular.ttf` and `GeistMono-SemiBold.ttf` (SIL OFL, from the vercel/geist-font release) under `apps/web/assets/fonts/`, plus the license file. The route reads them with `fs.readFile`. No fetch at request time.
- The Report tab shows:
  - `report-image` in a Panel;
  - a week picker (‹ previous · next ›; next is disabled on the current week);
  - **Share on X** (`Button variant="x"`);
  - **Download PNG** (an anchor to the OG URL with `download="perplog-<week>.png"`).
- `Share on X` opens `https://x.com/intent/post?text=…&url=<origin>/r/<address>/<week>`. The text is "My dreamDEX perps week: <net> net after funding & fees. Where I leak money → via PerpLog @DreamDEXSomnia".

- [ ] **Step 1: Write the failing tests:**
  - core: `isoWeekStart maps every day of a week to its Monday (UTC)`;
  - core: `buildWeeklyReport counts only trades closed in the week and PERPLOG_STOP exits`;
  - core: `an empty week is all zeros with no top leak`;
  - e2e (fixture account): `the report tab shows report-image and a Share on X link to /r/<address>/<week>`;
  - e2e: `the OG route returns image/png`;
  - e2e: `/r/<address>/<week> has og:image pointing at the OG route`;
  - e2e: `the week picker moves to the previous week and disables next on the current week`;
  - e2e: `Download PNG links to the OG route with a download name`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement the core function, the OG route, the share page and the Report tab.**
- [ ] **Step 4: Run them and see them pass.** Run the core tests and the e2e.
- [ ] **Step 5: Commit** with `feat: weekly report image with share-to-X`.

### Task 10: `/evidence`, `/api/executions` and `/how-it-works`

**Files:**
- Create:
  - `apps/web/app/api/executions/route.ts`;
  - `apps/web/app/evidence/page.tsx`;
  - `apps/web/components/evidence-table.tsx`;
  - `apps/web/app/how-it-works/page.tsx`.
- Modify: none outside the files above (the NavBar from Task 6 already links to `/evidence` and `/how-it-works`)
- Test: `apps/web/app/api/executions/executions.test.ts`, `apps/web/e2e/evidence.spec.ts`

**Interfaces:**
- Consumes: `listEvidence` (Task 2); `HIDEKI.explorerTx` and `HIDEKI.explorerAddress` (existing); `chain.markets()` for symbols; `ui.tsx` (Task 6).
- Produces:
  - `medianStopLatencyMs(db: Db): Promise<number | null>` in `packages/db/src/queries/plans.ts`. It is the median over confirmed `stop_close` executions of `executions.updated_at − stops.triggered_at`, in ms, or null when there are none. Test it in `packages/db/test/plans.test.ts`.
  - `GET /api/executions?account=`, which returns `{ rows: Array<{ kind: "entry" | "stop_close"; status; account; pool; symbol; isBid; filledRaw; avgPrice; txHash; explorerUrl; createdAt }>, totals: { transactions: number; entries: number; stopCloses: number; medianStopLatencyMs: number | null } }`. It answers 503 `db_unavailable` without a DB and 400 for a bad `account`.
- The layout is design doc §6.5:
  - the header panel copy;
  - four StatTiles (Transactions, Stop closes, Plan entries, Median stop latency, shown as `x.x s` or "—");
  - the table with Pill kinds ("Stop close" brand, "Plan entry" action) and Buy/Sell colored by side.
- Each `evidence-row` shows the time, kind ("Entry" or "Stop close"), market, side, filled quantity, average price, a short account link and a tx link (explorer, new tab).
- The header shows the counts. The empty state says "No PerpLog transactions yet."
- `/how-it-works` is static copy, in English, covering:
  - linking a bot as the proof of ownership (spec §4.3);
  - why stops are bot-held (C1/C2: a linked bot cannot arm exchange stops and gets `InvalidOrderOwner()`);
  - what the worker may send (the invariant above);
  - limits: IOC liquidity on thin books, one signer, testnet.

- [ ] **Step 1: Write the failing tests:**
  - db: `medianStopLatencyMs is the median of confirmed stop closes and null with none`;
  - `executions lists rows with explorer links and totals, including medianStopLatencyMs`;
  - `no DB → 503`;
  - `bad account → 400`;
  - e2e (`page.route` mock): `evidence shows one row per execution with a tx link`;
  - e2e: `without a database evidence says it is unavailable`;
  - e2e: `how-it-works renders`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement the route, the pages and the header links.**
- [ ] **Step 4: Run them and see them pass, then run `/verify`.**
- [ ] **Step 5: Commit** with `feat(web): evidence page for every PerpLog transaction; how it works`.

### Task 11: Deploy, live acceptance and submission material

**Files:**
- Modify: `README.md`, `docs/superpowers/plans/2026-10-27-perplog-plan-2-protection.md` (Acceptance log, **after the user approves the numbers**), and this plan's Acceptance log.
- Create: `docs/submission/x-posts.md` (drafts for the user to post).

**README sections the bounty requires:**
- **What it is** (one paragraph plus a screenshot);
- **Who it is for** (spec §1 evidence E1/E2/E4, with sources);
- **How to run** (local, fixture mode, worker, deploy: Vercel web, worker host, Neon);
- **Evidence** (links to `/evidence` and to 3 or more tx hashes);
- **Somnia Reactivity** usage;
- **X posts** (links, filled in after posting);
- **Security model** (the invariant above);
- **Limits.**

- [ ] **Step 1: Deploy the web to Vercel (Hobby, free).** Set the pooled `DATABASE_URL`. Check that `/`, `/a/<account>`, `/evidence` and `/api/plans/quote` answer on the deployed URL.
- [ ] **Step 2: Deploy the worker.** Railway, if signups are open again; otherwise the local Mac with `caffeinate -i pnpm --filter @perplog/worker start`. Check the logs for `signer lock acquired` and `loop started` for `entry-engine` and `stop-engine`.
- [ ] **Step 3: Live acceptance on Hideki (the user trades).**
  - 3 Plan & Place entries with their stops armed.
  - 1 or more plan stops fired.
  - Enough Protect Now stops for ≥ 20 PerpLog txs in total on `/evidence` (§14.2 #4).
  - Record `ms_since_queued`, `ms_since_trigger` and `steps_ms` from the logs.
- [ ] **Step 4: Write the README sections and `docs/submission/x-posts.md`.** Write 3 drafts tagging @DreamDEXSomnia, with numbers taken from `/evidence` and the platform stats, sources stated.
- [ ] **Step 5: Run `/verify`, then commit** with `docs: submission README, evidence and X post drafts`.
- [ ] **Step 6 (user):** record the 2–3 minute demo video, post on X, and submit on DoraHacks with the repo, the deployed URL, `/evidence` and the video, before **2026-11-01 23:59 UTC**.

---

## Notes for the executor

- **Order:**
  - Backend: Tasks 1 → 2 → 3 → 4 → 5 are sequential, since each consumes the previous task's interfaces.
  - Design: Task 6 → 7 depends on nothing in 1–5.
  - UI: Tasks 8 (needs 3, 4 and 6), 9 (needs 6) and 10 (needs 2 and 6).
  - Task 11 is last.
  - Run in this order: 1, 2, 3, 4, 5, 6, 7, 8, 10, 9, 11. Evidence comes before Report because the judges need it.
- **If time runs short, cut from the end:**
  - first `/how-it-works` (fold three lines into the README);
  - then the Report tab's week picker (keep "this week", the OG route and the share page);
  - then the dark-mode token set.
- **Never cut** the invariant change, the shared serial, the "sent at most once" entry tests, or the Health breakdown identity test.
- **Blocked on the user:**
  - Task 11 Steps 1–3 (Vercel and worker accounts, live trading on Hideki);
  - Task 11 Step 6 (video, X, DoraHacks).

## Acceptance log

(Filled in by Task 11.)
