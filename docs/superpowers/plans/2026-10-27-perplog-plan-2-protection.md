# PerpLog Plan 2 — Protection (DB, Worker, Link, Bot-held Stops, Alerts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A trader links a PerpLog bot key to their dreamDEX account. They can then arm a **bot-held stop-loss** on any open position, which PerpLog executes with `placeOrderFor` when the mark crosses the trigger. Watched accounts also get **in-app alerts**: unprotected position, stop done, stop failed, bot low on gas, link revoked.

**Architecture:**
- `packages/core` gains pure decision logic:
  - the stop state machine;
  - the close planner (qty and price bound);
  - the unprotected-position rule;
  - the gas top-up rule.
- `packages/chain` gains the I/O for protection:
  - operator writes (viem);
  - grant checks (multicall);
  - live position and mark reads;
  - Reactivity `PositionUpdated` watching;
  - two live indexer queries.
- A new `packages/db` holds the Drizzle schema, migrations, AES-256-GCM key crypto and typed queries.
- A new `apps/worker` is a long-running Node process and the **only signer**. It runs:
  - BotKeyMinter, LinkWatcher;
  - StopEngine (mark polling + execution);
  - ReactivityListener, AlertEngine, GasTreasury.
- `apps/web` gains:
  - session, stops, watch and alerts routes;
  - LinkWizard, the Protect form and alert toasts.

  The web app **never signs**. It only writes rows the worker acts on.

**Tech Stack:** everything from Plan 1, plus:
- `drizzle-orm` 0.45, `drizzle-kit` 0.31, `pg` 8;
- `@electric-sql/pglite` 0.5 (in-process Postgres for tests);
- `pino` 10;
- `@somnia-chain/reactivity` ^0.2.1 (peer of `markets-sdk/reactivity`).

**Spec:** `docs/specs/2026-10-25-perplog-design.md`. Plan 2 covers phases **P0, P3 and P4** of §15 (spec §5 "Plan 2"). Plan 3 covers Plan & Place, the weekly report, `/evidence`, `/how-it-works` and submission.

## Global Constraints

- Everything in Plan 1's Global Constraints still applies:
  - English everywhere;
  - money as raw `bigint`;
  - lowercase addresses;
  - no hardcoded pools or decimals;
  - TypeScript 5.9.3;
  - SDK exactly `0.32.1`;
  - Conventional Commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Only the worker signs.** `KEY_ENCRYPTION_KEY` and `TREASURY_PRIVATE_KEY` are read only in `apps/worker`. The web app must not import `@perplog/db/crypto` or any viem wallet client.
- **The worker never increases exposure.** In Plan 2 it sends orders only to close a position for a stop that is ARMED for that account. There is no "send arbitrary order" path.
- **Never close more than the live position.** Re-read the size (`client.getPerpPosition`) immediately before every send. The sent qty is `≤ |size|` and a multiple of `lotSize`. dreamDEX has no reduce-only flag.
- Operator ABI and selectors (spec §7.4, C3):
  - `placeOrderFor` = `0x80054449`;
  - `cancelOrderFor` = `0xe37b444b`;
  - `reduceOrderFor` = `0x364c2587`.
- Every write uses:
  - `simulateContract`, then `writeContract`, then `waitForTransactionReceipt`;
  - gas limit **`20_000_000n`**;
  - `expireTimestampNs` 50 years out;
  - `ORDER_TYPE.MARKET` (= `2`, IOC);
  - `selfMatchingOption 0`, `builder 0x0`, `builderFeeBpsTimes1k 0`.
- Close order: `isBid = (position side == short)`.
  - Price bound = `mark × (1 ∓ slip)`, snapped to the tick on the side that fills more easily: floor when selling, ceil when buying.
  - Slip is **150 bps** on attempt 0 and grows **+100 bps** per attempt, capped at the stop's `max_slip_bps` (default **500**).
- Stop gives up (FAILED) after **5 failed attempts** or **15 s** since `triggered_at`, whichever comes first.
- Trigger rule:
  - long fires when `mark ≤ trigger`; short fires when `mark ≥ trigger`;
  - the mark is `perpMarkForPnl(client.getPerpState(pool))`;
  - when it falls back to the index (`fromIndex`), log `stale_mark`.
- Unprotected alert:
  - check **60 s** after an open or a size increase;
  - fallback poll every **30 s** while Reactivity is degraded;
  - target: alert ≤ 90 s after opening.
- Gas:
  - top up **0.5 STT** when a bot balance is below **0.2 STT**;
  - cap **2 STT per key per UTC day**;
  - warn when the treasury is below **5 STT**;
  - only keys with ≥ 1 armed, triggered or executing stop qualify.
- Single signer: worker takes `pg_try_advisory_lock(7331)` on a dedicated connection and stays standby without it.
- Raw on-chain values are stored as `numeric(78,0)` (Drizzle `numeric({ precision: 78, scale: 0, mode: "bigint" })`).
- Web writes:
  - session cookie `perplog_session` (httpOnly, `SameSite=Lax`, `Secure` in production, 30 days);
  - every POST/DELETE checks that the `Origin` header equals the request's own origin (else 403 `bad_origin`);
  - POSTs are rate-limited to **10 per minute** per session (or per IP without one), counted in Postgres (429 `rate_limited`).
- Without `DATABASE_URL`, the Plan 1 read-only product keeps working. Protection routes return 503 `{"error":"db_unavailable"}` and the UI hides Protect/Watch.
- Fixed UI copy and selectors (e2e relies on them):
  - **buttons:** `Protect`, `Enable protection`, `Arm stop`, `Cancel stop`, `Watch this account`;
  - **`data-testid`:** `link-wizard`, `bot-address`, `perplog-stop`, `alert-toast`;
  - **link instruction copy:** "In the dreamDEX app: open your wallet → Link a bot → tick Perps → paste this address."

## Review Focus

1. **The position changes between trigger and send.** The user closes manually, flips, or another fill lands. Expected: no order that opens or flips a position. The size is re-read before every attempt; size 0 ends DONE, a flip ends CANCELLED.
   - Tests: Task 1 (`planClose` fuzz and flip cases) and Task 9 (engine with a fake chain whose size goes to 0 or flips mid-execution).
2. **Double execution.** The user presses Cancel while the stop triggers, or the worker restarts while a stop is `triggered`/`executing`. Expected:
   - every status change is a conditional `UPDATE … WHERE status = <expected>`;
   - on boot, in-progress stops resume through `planClose` (re-read first), never by resending blindly;
   - DELETE on a triggered stop returns 409.
   - Tests: Task 4 (`transitionStop` returns false on a stale status), Task 8 (DELETE 409) and Task 9 (resume after restart).
3. **Grant missing on the stop's pool.** A market was listed after linking (C12), or the user revoked the bot. Expected:
   - creating a stop returns 409 `pool_not_linked` with re-link instructions;
   - an armed stop whose grant disappears becomes PAUSED with a `link_revoked` alert, and is re-armed when the grant returns.
   - Tests: Task 7 and Task 8.
4. **Mark read fails or is stale.** Expected:
   - an RPC error on `getPerpState` means no transition for that pool on that tick (never trigger on a failed read);
   - an index-price fallback still evaluates and logs `stale_mark`.
   - Test: Task 9.
5. **Reactivity silently dies.** The WebSocket stays open but stops delivering. Expected:
   - no notification for 60 s → status `degraded`, resubscribe with backoff;
   - the AlertEngine switches to the 30 s indexer poll, so unprotected alerts still arrive ≤ 90 s.
   - Tests: Task 3 (watchdog) and Task 10 (poll path creates the alert).

---

## File Structure

```
packages/core/src/
  stop-machine.ts      StopStatus, StopEvent, nextStopStatus, isTriggered, closeSlipBps
  close-planner.ts     planClose, closePriceBound
  alerts.ts            needsUnprotectedCheck
  gas.ts               planTopUp
  config.ts            (+ STOP_*, CLOSE_SLIP_*, UNPROTECTED_*, GAS_* constants)
packages/chain/src/
  operator.ts          OPERATOR_ABI, OPERATOR_SELECTOR, ORDER_GAS, grantedPools, summarizeFills,
                       OperatorRevert, createBotWallet, placeMarketFor
  onchain.ts           (+ createHttpClient, readPositionSize, readMark)
  networks.ts          (+ withOverrides)
  reactivity.ts        POSITION_UPDATED_TOPIC, decodePositionUpdated, watchPositionUpdates
  indexer/live.ts      fetchPendingStopLosses, fetchOpenPerpPositions
packages/db/
  package.json, drizzle.config.ts, migrations/*
  src/index.ts         re-exports (NOT crypto)
  src/schema.ts        tables + enums
  src/client.ts        Db type, createDb(url), migrateDb
  src/testing.ts       createTestDb() (PGlite + migrations)
  src/crypto.ts        parseKek, encryptPrivateKey, decryptPrivateKey   (import path @perplog/db/crypto)
  src/queries/{bot-keys,sessions,stops,executions,alerts,watch,gas,rate-limit}.ts
apps/worker/
  package.json, tsconfig.json, vitest.config.ts, Dockerfile, railway.toml
  src/main.ts, env.ts, log.ts, lock.ts, loop.ts, ports.ts, chain-live.ts, serial.ts
  src/bot-key-minter.ts, link-watcher.ts, stop-engine.ts, reactivity-listener.ts,
  src/alert-engine.ts, gas-treasury.ts
  test/*.test.ts, test/fakes.ts
scripts/
  new-bot-key.ts, spike-operator.ts, spike-reactivity.ts, spike-mark-latency.ts
apps/web/
  lib/db.ts, lib/session.ts, lib/chain.ts
  app/api/session/route.ts, app/api/stops/route.ts, app/api/stops/[id]/route.ts,
  app/api/watch/route.ts, app/api/alerts/route.ts   (+ *.test.ts beside each)
  components/link-wizard.tsx, protect-form.tsx, alert-toasts.tsx, watch-button.tsx
  e2e/protect.spec.ts
```

---

### Task 1: Core protection logic (stop machine, close planner, alert and gas rules)

**Files:**
- Create: `packages/core/src/stop-machine.ts`, `packages/core/src/close-planner.ts`, `packages/core/src/alerts.ts`, `packages/core/src/gas.ts`
- Modify: `packages/core/src/config.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/stop-machine.test.ts`, `close-planner.test.ts`, `alerts.test.ts`, `gas.test.ts`

**Interfaces:**
- Produces (all exported from `@perplog/core`):
  ```ts
  export type StopStatus = "armed" | "paused" | "triggered" | "executing" | "done" | "failed" | "cancelled";
  export type StopEvent =
    | "trigger" | "execute" | "filled" | "give_up"
    | "position_closed" | "position_flipped" | "grant_lost" | "grant_back" | "user_cancel";
  export const ACTIVE_STOP_STATUSES: readonly StopStatus[]; // armed, paused, triggered, executing
  export function nextStopStatus(status: StopStatus, event: StopEvent): StopStatus | null; // null = not allowed
  export function isTriggered(side: Side, triggerPrice: bigint, mark: bigint): boolean;
  export function closeSlipBps(attempt: number, maxSlipBps?: number): number;
  export type QtyMode = "entire" | "fixed";
  export type ClosePlan =
    | { action: "send"; isBid: boolean; qtyRaw: bigint }
    | { action: "stop"; event: "position_closed" | "position_flipped" | "filled" }
    | { action: "fail"; reason: "dust_position" };
  export function planClose(input: {
    positionSize: bigint; stopSide: Side; qtyMode: QtyMode; qtyRaw: bigint | null;
    closedSoFarRaw: bigint; lotSize: bigint; minQuantity: bigint;
  }): ClosePlan;
  export function closePriceBound(mark: bigint, stopSide: Side, slipBps: number, tickSize: bigint): bigint;
  export function needsUnprotectedCheck(prevSize: bigint | undefined, newSize: bigint): boolean;
  export type TopUpPlan = { action: "none" } | { action: "send"; amountWei: bigint } | { action: "capped" };
  export function planTopUp(input: {
    balanceWei: bigint; sentTodayWei: bigint; thresholdWei: bigint; amountWei: bigint; dailyCapWei: bigint;
  }): TopUpPlan;
  ```
- Config constants added to `config.ts`:
  - `STOP_MAX_ATTEMPTS = 5`
  - `STOP_GIVE_UP_MS = 15_000`
  - `CLOSE_SLIP_START_BPS = 150`
  - `CLOSE_SLIP_STEP_BPS = 100`
  - `CLOSE_SLIP_MAX_BPS = 500`
  - `UNPROTECTED_GRACE_SEC = 60`
  - `UNPROTECTED_POLL_SEC = 30`
  - `MARK_POLL_MS = 1_000`
  - `SIGNER_LOCK_ID = 7331`

- [ ] **Step 1: Write the failing tests**

`stop-machine.test.ts`: write one `test.each` over this transition table. Every pair **not** listed must return `null` (loop over all statuses × events):

| from | event → to |
|---|---|
| armed | trigger→triggered, position_closed→cancelled, position_flipped→cancelled, grant_lost→paused, user_cancel→cancelled |
| paused | grant_back→armed, position_closed→cancelled, position_flipped→cancelled, user_cancel→cancelled |
| triggered | execute→executing, position_closed→done, position_flipped→cancelled, filled→done |
| executing | execute→executing, filled→done, position_closed→done, position_flipped→cancelled, give_up→failed |
| done/failed/cancelled | (nothing) |

Plus:
```ts
expect(isTriggered("long", 100n, 100n)).toBe(true);
expect(isTriggered("long", 100n, 101n)).toBe(false);
expect(isTriggered("short", 100n, 100n)).toBe(true);
expect(isTriggered("short", 100n, 99n)).toBe(false);
expect([0, 1, 2, 3, 4, 9].map((a) => closeSlipBps(a))).toEqual([150, 250, 350, 450, 500, 500]);
expect(closeSlipBps(3, 300)).toBe(300);
```

`close-planner.test.ts`:
```ts
const base = { stopSide: "long" as const, qtyMode: "entire" as const, qtyRaw: null, closedSoFarRaw: 0n, lotSize: 1000n, minQuantity: 13000n };
test("closes the latest size of a long, rounded down to lot", () =>
  expect(planClose({ ...base, positionSize: 25_999n })).toEqual({ action: "send", isBid: false, qtyRaw: 25_000n }));
test("short closes with a bid", () =>
  expect(planClose({ ...base, stopSide: "short", positionSize: -20_000n })).toEqual({ action: "send", isBid: true, qtyRaw: 20_000n }));
test("flat position ends the stop", () =>
  expect(planClose({ ...base, positionSize: 0n })).toEqual({ action: "stop", event: "position_closed" }));
test("flipped position ends the stop without sending", () =>
  expect(planClose({ ...base, positionSize: -20_000n })).toEqual({ action: "stop", event: "position_flipped" }));
test("fixed qty never exceeds what is left of it", () =>
  expect(planClose({ ...base, qtyMode: "fixed", qtyRaw: 30_000n, closedSoFarRaw: 15_000n, positionSize: 100_000n }))
    .toEqual({ action: "send", isBid: false, qtyRaw: 15_000n }));
test("fixed qty fully closed ends the stop", () =>
  expect(planClose({ ...base, qtyMode: "fixed", qtyRaw: 30_000n, closedSoFarRaw: 30_000n, positionSize: 70_000n }))
    .toEqual({ action: "stop", event: "filled" }));
test("fixed qty below minQuantity closes the whole position instead", () =>
  expect(planClose({ ...base, qtyMode: "fixed", qtyRaw: 5_000n, positionSize: 20_500n }))
    .toEqual({ action: "send", isBid: false, qtyRaw: 20_000n }));
test("dust position fails", () =>
  expect(planClose({ ...base, positionSize: 12_999n })).toEqual({ action: "fail", reason: "dust_position" }));
test("fuzz: sent qty is positive, ≤ |size|, a lot multiple, and on the closing side", () => {
  // 20_000 seeded iterations with a tiny LCG (no Math.random), over
  // size ∈ [-10^24, 10^24], lot ∈ {1, 1000, 10^12}, min ∈ {0, lot, 13·lot},
  // side, qtyMode, qtyRaw, closedSoFar. Whenever action === "send":
  //   qtyRaw > 0n && qtyRaw <= abs(size) && qtyRaw % lot === 0n && isBid === (side === "short")
  // and size's side equals stopSide.
});
test("price bound: sell floors, buy ceils, both on tick", () => {
  expect(closePriceBound(100_000n, "long", 150, 7n)).toBe(98_497n);  // 98_500 floored to tick 7
  expect(closePriceBound(100_000n, "short", 150, 7n)).toBe(101_500n); // 101_500 is on tick (7 × 14_500)
  expect(closePriceBound(100_001n, "short", 150, 7n)).toBe(101_507n); // 101_501.015 ceiled to tick 7
});
```
The exact values of the last three expectations are derived in Step 3. If your arithmetic differs, recompute them from that rule; do not loosen the assertions.

`alerts.test.ts`:
```ts
expect(needsUnprotectedCheck(undefined, 5n)).toBe(true);
expect(needsUnprotectedCheck(0n, -5n)).toBe(true);
expect(needsUnprotectedCheck(5n, 8n)).toBe(true);
expect(needsUnprotectedCheck(-5n, -8n)).toBe(true);
expect(needsUnprotectedCheck(5n, -3n)).toBe(true);   // flip opens a new position
expect(needsUnprotectedCheck(8n, 5n)).toBe(false);   // reduction
expect(needsUnprotectedCheck(5n, 0n)).toBe(false);
```

`gas.test.ts`:
```ts
const E = 10n ** 17n; // 0.1 STT
const cfg = { thresholdWei: 2n * E, amountWei: 5n * E, dailyCapWei: 20n * E };
expect(planTopUp({ ...cfg, balanceWei: 3n * E, sentTodayWei: 0n })).toEqual({ action: "none" });
expect(planTopUp({ ...cfg, balanceWei: E, sentTodayWei: 0n })).toEqual({ action: "send", amountWei: 5n * E });
expect(planTopUp({ ...cfg, balanceWei: E, sentTodayWei: 17n * E })).toEqual({ action: "send", amountWei: 3n * E });
expect(planTopUp({ ...cfg, balanceWei: E, sentTodayWei: 20n * E })).toEqual({ action: "capped" });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/core/test/{stop-machine,close-planner,alerts,gas}.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the four modules**

- `nextStopStatus` is a lookup in a `Record<StopStatus, Partial<Record<StopEvent, StopStatus>>>`.
- `closeSlipBps(attempt, max = CLOSE_SLIP_MAX_BPS) = min(START + STEP × attempt, max)`.
- `planClose` checks, in order:
  1. size 0 → `position_closed`;
  2. `sideOf(size) !== stopSide` → `position_flipped` (use the same `size >= 0n ? "long" : "short"` rule as `trades.ts`);
  3. target:
     - entire: `|size|`;
     - fixed: `left = qtyRaw − closedSoFar`; if `left ≤ 0` → `filled`; otherwise `min(|size|, left)`;
  4. `qty = floor(target / lot) × lot`;
  5. if `qty < minQuantity || qty === 0n`:
     - when `|size| ≥ minQuantity`, use `floor(|size| / lot) × lot`;
     - otherwise `fail dust_position`.
- `closePriceBound`:
  - long (sell): `raw = mark × (10_000 − slip) / 10_000`, floored to a multiple of `tickSize`;
  - short (buy): `raw = ceil(mark × (10_000 + slip) / 10_000)`, ceiled to a multiple of `tickSize`;
  - result is never below `tickSize`.
- `planTopUp`:
  - `none` if `balance ≥ threshold`;
  - otherwise `room = cap − sentToday`; `capped` if `room ≤ 0`;
  - otherwise send `min(amount, room)`.
- Export everything from `index.ts`.

- [ ] **Step 4: Run the tests and the whole core suite**

Run: `pnpm vitest run packages/core && pnpm -r typecheck && pnpm lint`
Expected: all pass. The 22 Plan 1 snapshots are unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): stop state machine, close planner, alert and gas rules"
```

---

### Task 2: Chain operator writes, grant checks and live reads

**Files:**
- Create: `packages/chain/src/operator.ts`
- Modify: `packages/chain/src/onchain.ts`, `packages/chain/src/networks.ts`, `packages/chain/src/index.ts`
- Test: `packages/chain/test/operator.test.ts`, `packages/chain/test/networks.test.ts`

**Interfaces:**
- Consumes: `Network`, `HIDEKI` (Plan 1); `decodePlaceOrder`, `contractErrorsAbi`, `ORDER_TYPE`, `perpMarkForPnl` from `@somnia-chain/markets-sdk`.
- Produces:
  ```ts
  export const OPERATOR_SELECTOR: { placeOrderFor: "0x80054449"; cancelOrderFor: "0xe37b444b"; reduceOrderFor: "0x364c2587" };
  export const OPERATOR_ABI: readonly [...];           // spec §7.4 + contractErrorsAbi
  export const ORDER_GAS = 20_000_000n;
  export function grantedPools(client: Pick<PublicClient, "multicall">, owner: Address, bot: Address, pools: Address[]): Promise<Address[]>;
  export function summarizeFills(fills: OrderFill[]): { filledRaw: bigint; avgPrice: bigint | null };
  export class OperatorRevert extends Error { readonly errorName: string }  // "ImmediateOrCancelNoFill", …, or "unknown"
  export interface BotWallet { address: Address; publicClient: PublicClient; walletClient: WalletClient }
  export function createBotWallet(privateKey: Hex, network: Network): BotWallet;   // http(network.rpcHttp)
  export interface PlaceResult { txHash: Hash; orderId: bigint | null; filledRaw: bigint; avgPrice: bigint | null; gasUsed: bigint }
  export function placeMarketFor(wallet: BotWallet, p: { owner: Address; pool: Address; isBid: boolean; qtyRaw: bigint; priceBound: bigint }): Promise<PlaceResult>;
  export function createHttpClient(network: Network): PublicClient;   // onchain.ts, cached per network
  export function readPositionSize(client: Pick<SomniaMarketsClient, "getPerpPosition">, marginBank: Address, account: Address, pool: Address): Promise<bigint>;
  export function readMark(client: Pick<SomniaMarketsClient, "getPerpState">, pool: Address): Promise<{ price: bigint; fromIndex: boolean }>;
  export function withOverrides(network: Network, o: { rpcHttp?: string; rpcWs?: string; indexer?: string }): Network;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test("grantedPools keeps pools whose placeOrderFor grant is true and treats failures as not granted", async () => {
  const calls: unknown[] = [];
  const client = { multicall: async (a: { contracts: unknown[] }) => { calls.push(a); return [
    { status: "success", result: true }, { status: "success", result: false }, { status: "failure", error: new Error("x") },
  ]; } };
  expect(await grantedPools(client as never, "0xa", "0xb", ["0x1", "0x2", "0x3"])).toEqual(["0x1"]);
  // each contract call: address = pool, functionName "isOperatorAuthorized", args [owner, bot, "0x80054449"]; allowFailure true
});
test("summarizeFills: total and VWAP; no fills → 0 and null", () => {
  expect(summarizeFills([fill(2n, 100n), fill(1n, 130n)])).toEqual({ filledRaw: 3n, avgPrice: 110n });
  expect(summarizeFills([])).toEqual({ filledRaw: 0n, avgPrice: null });
});
test("OPERATOR_ABI selectors match the granted ones", () => {
  // toFunctionSelector(getAbiItem({ abi: OPERATOR_ABI, name })) equals OPERATOR_SELECTOR[name] for all three
});
test("withOverrides replaces only the given endpoints", () => {
  const n = withOverrides(HIDEKI, { indexer: "http://x" });
  expect(n.indexer).toBe("http://x"); expect(n.rpcHttp).toBe(HIDEKI.rpcHttp);
});
```
(`fill(q, p)` is a local helper building an `OrderFill` with `quantityFilled = q`, `fillPrice = p`.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/chain/test/operator.test.ts packages/chain/test/networks.test.ts`
Expected: FAIL, missing exports.

- [ ] **Step 3: Implement**

- Port `operator.ts` from bot-kit `packages/perp-core/src/operator.ts`. Keep the MIT attribution header comment naming DreamDEX S.A. and the bot-kit repo.
- `placeMarketFor`:
  1. simulate with `gas: ORDER_GAS`. Catch a viem `ContractFunctionRevertedError` and throw `OperatorRevert(errorName)`; any other error is rethrown;
  2. call `writeContract(request)`, then `waitForTransactionReceipt`;
  3. if `receipt.status !== "success"`, throw `OperatorRevert("reverted_onchain")`;
  4. decode with `decodePlaceOrder(receipt, pool)` and return `summarizeFills` plus `gasUsed`.
- `withOverrides` returns `{ ...network, ...definedOverrides }`. `Network` widens to a structural type (`Omit<typeof HIDEKI, "rpcHttp" | "rpcWs" | "indexer"> & { rpcHttp: string; rpcWs: string; indexer: string }`) so overrides type-check.
- `readMark` wraps `perpMarkForPnl(await client.getPerpState(pool))`.
- `readPositionSize` returns `(await client.getPerpPosition({ marginBank, account, pool })).size`.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm vitest run packages/chain && pnpm -r typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/chain
git commit -m "feat(chain): operator writes, grant checks, live position and mark reads"
```

---

### Task 3: Reactivity watcher and P0 spikes

**Files:**
- Create: `packages/chain/src/reactivity.ts`, `packages/chain/src/indexer/live.ts`
- Create: `scripts/new-bot-key.ts`, `scripts/spike-operator.ts`, `scripts/spike-reactivity.ts`, `scripts/spike-mark-latency.ts`
- Modify: `packages/chain/package.json` (add `@somnia-chain/reactivity@^0.2.1`), `packages/chain/src/index.ts`, `.gitignore` (`.env.spike`)
- Test: `packages/chain/test/reactivity.test.ts`, `packages/chain/test/live.test.ts`

**Interfaces:**
- Consumes: `createReadClient`, `createBotWallet`, `placeMarketFor`, `grantedPools`, `readMark`, `readPositionSize` (Task 2); `planClose`, `closePriceBound`, `closeSlipBps` (Task 1); `gql`, `paginateDesc`, `stopOrderRow`, `STOP_ORDER_FIELDS` (Plan 1).
- Produces:
  ```ts
  export interface PositionUpdate { account: Address; pool: Address; newSize: bigint }
  export const POSITION_UPDATED_TOPIC: Hex;  // from marginBankEventsAbi "PositionUpdated"
  export function decodePositionUpdated(e: { topics: Hex[]; data: Hex }): PositionUpdate | null;  // null if not that event
  export type FeedStatus = "live" | "degraded";
  export interface WatchHandle { stop(): Promise<void> }
  export function watchPositionUpdates(args: {
    subscribe: (onData: (e: { topics: Hex[]; data: Hex }) => void) => Promise<{ unsubscribe(): Promise<unknown> }>;
    onUpdate: (u: PositionUpdate) => void;
    onStatus: (s: FeedStatus) => void;
    silenceMs?: number;            // default 60_000
    backoffMs?: { min: number; max: number };   // default 1_000 / 30_000
    timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout; now: () => number };
  }): WatchHandle;
  export function reactivitySubscriber(client: SomniaMarketsClient, marginBank: Address): Parameters<typeof watchPositionUpdates>[0]["subscribe"];
  export function fetchPendingStopLosses(indexerUrl: string, account: Address, pool: Address, side: Side): Promise<number>;  // count of PENDING isStopLossFor(side)
  export function fetchOpenPerpPositions(indexerUrl: string, accounts: Address[]): Promise<{ account: Address; pool: Address; size: bigint }[]>;  // signed: isLong ? size : -size
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test("decodes a PositionUpdated log and ignores other topics", () => {
  // build topics/data with viem encodeEventTopics/encodeAbiParameters from marginBankEventsAbi
  expect(decodePositionUpdated(log)).toEqual({ account: "0x…aa", pool: "0x…e1", newSize: -5n });
  expect(decodePositionUpdated({ topics: ["0xdead"], data: "0x" })).toBeNull();
});
test("watchdog: 60s of silence → degraded, resubscribes with backoff, first event → live", async () => {
  // fake timers; subscribe() counts calls and captures onData
  // t=0 subscribe#1, onStatus("live") after subscribe resolves
  // advance 60_000 → onStatus("degraded"), unsubscribe#1 called, after 1_000 → subscribe#2
  // emit an event → onUpdate called, onStatus("live")
  // a subscribe() that rejects retries after 2_000, then 4_000 … capped at 30_000
});
test("fetchOpenPerpPositions signs sizes by isLong", async () => {
  // fetchImpl returns PerpPosition rows {account, pool, isLong:false, size:"7"} → size -7n
});
test("fetchPendingStopLosses counts only stop-losses for the side", async () => {
  // rows: PENDING isBid=false op=1 (long SL), PENDING isBid=false op=0 (TP) → long → 1
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/chain/test/reactivity.test.ts packages/chain/test/live.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `reactivitySubscriber` wraps `createReactivity(client).watch({ eventContractSources: [marginBank], topicOverrides: [POSITION_UPDATED_TOPIC], ethCalls: [], onData: (n) => onData(n.result) })` through `unwrap`. The payload is `n.result`, not `n.params.result`.
- The watchdog resets its silence timer on every event, and on subscribe success.
- `fetchOpenPerpPositions`:
  - one GraphQL query, `PerpPosition(where: {account: {_in: [...]}, size: {_neq: "0"}})`;
  - batches of 100 accounts;
  - uses `gql` with a zod schema.
- `fetchPendingStopLosses`:
  - `StopOrder(where: {owner: {_eq}, market_id: {_eq: pool}, status: {_eq: "PENDING"}})`;
  - filters with `isStopLossFor`.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/chain && pnpm -r typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Spike (b) — Reactivity receives a real event**

`scripts/spike-reactivity.ts` watches with `reactivitySubscriber(createReadClient(), HIDEKI.marginBank)` for up to 120 s. It prints each decoded update and exits 0 on the first one.
Run: `pnpm tsx scripts/spike-reactivity.ts`
Expected: at least one `PositionUpdated` line within 60 s (spec §14.1). Record the observed events per minute in the commit message body.

- [ ] **Step 6: Spike (c) — mark latency**

`scripts/spike-mark-latency.ts` calls `readMark` 30 times on the 3 most active pools. It prints p50/p95 ms and how often `fromIndex` is true.
Run: `pnpm tsx scripts/spike-mark-latency.ts`
Expected: p95 well under 1000 ms (MARK_POLL_MS). If p95 > 700 ms, note it in the commit body and in Task 9.

- [ ] **Step 7: Spike (a) — a linked bot opens and closes for a real account** (needs the user: Arena account + STT, spec §17)

1. `scripts/new-bot-key.ts` writes `BOT_PRIVATE_KEY=` and prints the bot address into `.env.spike` (git-ignored).
2. The user links that address in the dreamDEX app (wallet → Link a bot → tick Perps) and sends ≥ 0.5 STT to it on Hideki.
3. `scripts/spike-operator.ts` reads `OWNER` and `BOT_PRIVATE_KEY` from `.env.spike`. It:
   - prints `grantedPools` for the owner across all perp pools;
   - picks the ETH pool;
   - opens `minQuantity` long with `placeMarketFor(isBid: true, priceBound: closePriceBound(mark, "short", 150, tick))`;
   - re-reads the size;
   - closes with `planClose` + `closePriceBound(mark, "long", 150, tick)`;
   - re-reads the size (expect 0);
   - prints both tx hashes as explorer links, plus `gasUsed`.

Run: `pnpm tsx --env-file=.env.spike scripts/spike-operator.ts`
Expected: two successful tx hashes, final size `0`. **If the user's wallet is not ready, mark this step blocked and continue with Task 4. Task 9's live acceptance waits for it.**

- [ ] **Step 8: Commit**

```bash
git add packages/chain scripts .gitignore pnpm-lock.yaml
git commit -m "feat(chain): reactivity watcher with watchdog, live indexer queries, P0 spikes"
```

---

### Task 4: `packages/db` — schema, migrations, crypto, queries

**Files:**
- Create: `packages/db/{package.json,tsconfig.json,drizzle.config.ts}`, `packages/db/src/{index.ts,schema.ts,client.ts,testing.ts,crypto.ts}`, `packages/db/src/queries/*.ts`, `packages/db/migrations/*` (generated)
- Modify: root `vitest.config.ts` (projects already glob `packages/*`), `apps/web/next.config.ts` (`transpilePackages` += `@perplog/db`)
- Test: `packages/db/test/{crypto,bot-keys,stops,alerts,rate-limit}.test.ts`

**Interfaces:**
- Package `@perplog/db`, with `"exports": {".": "./src/index.ts", "./crypto": "./src/crypto.ts", "./testing": "./src/testing.ts"}`. Dependencies: `drizzle-orm`, `pg`, `@perplog/core`; dev: `drizzle-kit`, `@electric-sql/pglite`, `@types/pg`.
- Schema (snake_case columns, `uuid` pks with `defaultRandom()`, `timestamptz` with `defaultNow()`):
  - **`bot_keys`**:
    - `id`, `address text unique null`, `account text null`;
    - `enc_pk text null`, `enc_iv text null`, `enc_tag text null` (base64; spec says bytea, text is chosen for driver parity);
    - `status bot_key_status(requested,pending,linked,revoked)`;
    - `linked_pools text[] default '{}'`;
    - `created_at`, `linked_at null`, `checked_at null`.
  - **`sessions`**: `id`, `account text null`, `bot_key_id uuid fk null`, `created_at`, `last_seen_at`.
  - **`watched_accounts`**: `account text pk`, `source watch_source(session,watch)`, `created_at`.
  - **`stops`**:
    - `id`, `account`, `pool`, `bot_key_id uuid fk`;
    - `position_side side(long,short)`, `trigger_price numeric`, `trigger_op trigger_op(lte,gte)`;
    - `qty_mode qty_mode(entire,fixed)`, `qty_raw numeric null`, `closed_raw numeric default 0`;
    - `max_slip_bps int default 500`;
    - `source stop_source(protect_now,plan) default protect_now`;
    - `status stop_status(armed,paused,triggered,executing,done,failed,cancelled)`;
    - `attempts int default 0`, `last_error text null`;
    - `created_at`, `triggered_at null`, `finished_at null`;
    - index on `(status)` and on `(account, pool)`.
  - **`executions`**:
    - `id`, `kind execution_kind(entry,stop_close)`, `status execution_status(queued,sending,sent,confirmed,failed)`;
    - `account`, `pool`, `bot_key_id`, `plan_id uuid null` (FK added in Plan 3), `stop_id uuid fk null`;
    - `is_bid bool`, `qty_raw`, `price_bound`;
    - `tx_hash text null`, `order_id numeric null`, `filled_raw numeric null`, `avg_price numeric null`, `gas_used numeric null`;
    - `error text null`, `created_at`, `updated_at`.
  - **`alerts`**:
    - `id`, `account`;
    - `type alert_type(unprotected_position,stop_done,stop_failed,bot_low_gas,link_revoked)`;
    - `pool text null`, `payload jsonb`;
    - `created_at`, `read_at null`;
    - index on `(account, created_at)`.
  - **`gas_topups`**: `id`, `bot_key_id fk`, `amount_wei numeric`, `tx_hash text`, `created_at`.
  - **`rate_limits`**: `key text`, `window_start timestamptz`, `count int`, pk `(key, window_start)`.
- Produces:
  ```ts
  export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;   // satisfied by node-postgres and PGlite drivers
  export function createDb(url: string): { db: Db; pool: pg.Pool };
  export function migrateDb(db: Db): Promise<void>;                // node-postgres migrator, folder packages/db/migrations
  export function createTestDb(): Promise<Db>;                     // @perplog/db/testing: new PGlite() + pglite migrator
  // crypto (@perplog/db/crypto)
  export function parseKek(base64: string): Buffer;                // throws unless exactly 32 bytes
  export function encryptPrivateKey(pk: Hex, kek: Buffer, aad: string): { encPk: string; iv: string; tag: string };
  export function decryptPrivateKey(enc: { encPk: string; iv: string; tag: string }, kek: Buffer, aad: string): Hex;
  // row types: Drizzle `$inferSelect` → BotKeyRow, StopRow, AlertRow, SessionRow; inserts: `$inferInsert` → NewStop, NewExecution
  export type AlertType = (typeof alertType.enumValues)[number];   // alertType = the pgEnum in schema.ts
  // queries
  createBotKeyRequest(db): Promise<BotKeyRow>;
  claimRequestedBotKeys(db, limit: number, fill: (id: string) => { address: Address; encPk: string; iv: string; tag: string }): Promise<number>;  // FOR UPDATE SKIP LOCKED in one transaction
  bindBotKey(db, botKeyId: string, account: Address, pools: Address[]): Promise<void>;     // status linked, linked_at now
  setLinkedPools(db, botKeyId: string, pools: Address[], status: "linked" | "revoked"): Promise<void>;
  listLinkedBotKeys(db): Promise<BotKeyRow[]>;
  getBotKey(db, id: string): Promise<BotKeyRow | null>;
  createSession(db, botKeyId: string): Promise<SessionRow>;
  getSession(db, id: string): Promise<(SessionRow & { botKey: BotKeyRow | null }) | null>;
  bindSession(db, sessionId: string, account: Address): Promise<void>;
  insertStop(db, s: NewStop): Promise<StopRow>;                  // cancels other active armed/paused stops on (account,pool) in the same tx
  transitionStop(db, id: string, from: StopStatus[], to: StopStatus, patch?: Partial<StopRow>): Promise<boolean>;  // UPDATE … WHERE id AND status IN from; finished_at set for terminal
  listStops(db, statuses: StopStatus[]): Promise<StopRow[]>;
  listAccountStops(db, account: Address, statuses: StopStatus[]): Promise<StopRow[]>;
  recordExecution(db, e: NewExecution): Promise<string>;  updateExecution(db, id, patch): Promise<void>;
  stopCloseTxHashes(db, account: Address): Promise<Set<string>>;
  insertAlert(db, a: { account; type; pool?: Address; payload: object; dedupeWithinSec?: number }): Promise<boolean>;  // false when an alert of same (account,type,pool) exists within dedupeWithinSec
  listAlerts(db, account: Address, sinceMs: number, limit?: number): Promise<AlertRow[]>;
  upsertWatch(db, account: Address, source: "session" | "watch"): Promise<void>;
  listWatchedAccounts(db): Promise<Address[]>;                  // watched_accounts ∪ bound sessions' accounts
  gasSentTodayWei(db, botKeyId: string, now: Date): Promise<bigint>;  recordTopUp(db, botKeyId, amountWei, txHash): Promise<void>;
  hitRateLimit(db, key: string, limitPerMinute: number, now: Date): Promise<boolean>;  // true = allowed; upsert count in the current minute window
  ```

- [ ] **Step 1: Scaffold the package and schema, generate the migration**

Run: `pnpm --filter @perplog/db exec drizzle-kit generate --name init`
Expected: `packages/db/migrations/0000_init.sql` contains `CREATE TYPE "stop_status"` and `numeric(78, 0)` columns.

- [ ] **Step 2: Write the failing tests**

```ts
// crypto.test.ts
test("round-trips a key and rejects a wrong AAD or KEK", () => {
  const kek = parseKek(Buffer.alloc(32, 7).toString("base64"));
  const enc = encryptPrivateKey(PK, kek, "id-1");
  expect(decryptPrivateKey(enc, kek, "id-1")).toBe(PK);
  expect(() => decryptPrivateKey(enc, kek, "id-2")).toThrow();
  expect(() => parseKek(Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
});
// bot-keys.test.ts
test("claimRequestedBotKeys fills each requested key once", async () => {
  const db = await createTestDb(); await createBotKeyRequest(db); await createBotKeyRequest(db);
  expect(await claimRequestedBotKeys(db, 10, fakeFill)).toBe(2);
  expect(await claimRequestedBotKeys(db, 10, fakeFill)).toBe(0);
  // both rows now status "pending" with address set
});
// stops.test.ts
test("transitionStop only moves from the expected status", async () => {
  const s = await insertStop(db, armedStop());
  expect(await transitionStop(db, s.id, ["armed"], "triggered", { triggeredAt: new Date() })).toBe(true);
  expect(await transitionStop(db, s.id, ["armed", "paused"], "cancelled")).toBe(false);
});
test("insertStop replaces the previous active stop on the same pool", async () => {
  const a = await insertStop(db, armedStop()); const b = await insertStop(db, armedStop());
  expect((await listAccountStops(db, ACCOUNT, ["armed"])).map((s) => s.id)).toEqual([b.id]);
  // a is cancelled
});
test("numeric columns round-trip 78-digit bigints", async () => {
  const s = await insertStop(db, armedStop({ triggerPrice: 10n ** 77n }));
  expect((await listStops(db, ["armed"]))[0]!.triggerPrice).toBe(10n ** 77n);
});
// alerts.test.ts
test("insertAlert dedupes within the window, per pool", async () => { /* second call within 600s → false; other pool → true */ });
// rate-limit.test.ts
test("11th POST in a minute is refused, next minute is allowed", async () => { /* 10× true, 1× false, now+60s → true */ });
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm vitest run packages/db`
Expected: FAIL (functions missing).

- [ ] **Step 4: Implement `client.ts`, `testing.ts`, `crypto.ts` and the queries**

- Crypto uses `node:crypto` `createCipheriv("aes-256-gcm", kek, iv12)` with `setAAD(Buffer.from(aad))`. The AAD is the bot key id, so a ciphertext copied to another row will not decrypt.
- `claimRequestedBotKeys` runs inside `db.transaction`:
  - ``tx.execute(sql`SELECT id FROM bot_keys WHERE status='requested' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT ${limit}`)``;
  - then one update per row.

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `pnpm vitest run packages/db && pnpm -r typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db apps/web/next.config.ts pnpm-lock.yaml
git commit -m "feat(db): schema, migrations, AES-GCM key crypto and typed queries"
```

---

### Task 5: Worker scaffold, signer lock and BotKeyMinter

**Files:**
- Create: `apps/worker/{package.json,tsconfig.json,vitest.config.ts,Dockerfile,railway.toml}`, `apps/worker/src/{main.ts,env.ts,log.ts,lock.ts,loop.ts,ports.ts,chain-live.ts,serial.ts,bot-key-minter.ts}`, `apps/worker/test/{fakes.ts,lock.test.ts,serial.test.ts,bot-key-minter.test.ts,env.test.ts}`
- Modify: root `vitest.config.ts` (`projects` += `"apps/worker"`)

**Interfaces:**
- Consumes: `@perplog/db` (Task 4), `@perplog/db/crypto`, `@perplog/chain` (Tasks 2–3).
- Produces:
  ```ts
  // env.ts — zod v4, parsed once
  export interface WorkerEnv {
    DATABASE_URL: string; KEY_ENCRYPTION_KEY: Buffer; TREASURY_PRIVATE_KEY: Hex | null;
    NETWORK: "hideki"; RPC_HTTP_URL?: string; RPC_WS_URL?: string; INDEXER_URL?: string;
    GAS_TOPUP_THRESHOLD_WEI: bigint; GAS_TOPUP_AMOUNT_WEI: bigint; GAS_TOPUP_DAILY_CAP_WEI: bigint;  // from *_STT decimal strings, defaults 0.2/0.5/2
    LOG_LEVEL: string;
  }
  export function parseEnv(raw: NodeJS.ProcessEnv): WorkerEnv;
  // lock.ts
  export function tryAcquireSignerLock(conn: { query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }> }): Promise<boolean>;  // pg_try_advisory_lock(7331)
  // loop.ts
  export function every(ms: number, name: string, fn: () => Promise<void>, log: Logger): { stop(): void };  // no overlap; errors logged, loop continues
  // serial.ts
  export class KeyedSerial { run<T>(key: string, fn: () => Promise<T>): Promise<T> }   // one chain per key
  // ports.ts — everything the worker needs from the outside, faked in tests
  export interface ChainPort {
    markets(): Promise<MarketInfo[]>;                                   // cached 10 min
    readPositionSize(account: Address, pool: Address): Promise<bigint>;
    readMark(pool: Address): Promise<{ price: bigint; fromIndex: boolean }>;
    grantedPools(owner: Address, bot: Address, pools: Address[]): Promise<Address[]>;
    placeMarketFor(privateKey: Hex, p: { owner: Address; pool: Address; isBid: boolean; qtyRaw: bigint; priceBound: bigint }): Promise<PlaceResult>;
    balanceOf(address: Address): Promise<bigint>;
    sendNative(privateKey: Hex, to: Address, amountWei: bigint): Promise<Hash>;
    pendingStopLosses(account: Address, pool: Address, side: Side): Promise<number>;
    openPositions(accounts: Address[]): Promise<{ account: Address; pool: Address; size: bigint }[]>;
    subscribePositionUpdates: Parameters<typeof watchPositionUpdates>[0]["subscribe"];
  }
  export function liveChain(network: Network): ChainPort;   // chain-live.ts
  // bot-key-minter.ts
  export function mintRequestedKeys(db: Db, kek: Buffer, generate?: () => Hex): Promise<number>;
  ```
- `main.ts` does the following:
  1. parse env;
  2. `createDb`, then take a dedicated `pool.connect()` client for the lock;
  3. without the lock, log `standby` and retry every 10 s;
  4. with the lock, run `migrateDb`;
  5. start the loops: BotKeyMinter 300 ms (Tasks 7, 9–11 and 13 add theirs);
  6. on SIGTERM, stop the loops and close the pool.

- [ ] **Step 1: Write the failing tests**

```ts
test("parseEnv converts STT decimals to wei and requires a 32-byte KEK", () => {
  const env = parseEnv({ DATABASE_URL: "postgres://x", KEY_ENCRYPTION_KEY: b64(32), NETWORK: "hideki" });
  expect(env.GAS_TOPUP_THRESHOLD_WEI).toBe(2n * 10n ** 17n);
  expect(env.TREASURY_PRIVATE_KEY).toBeNull();
  expect(() => parseEnv({ ...ok, KEY_ENCRYPTION_KEY: b64(16) })).toThrow();
});
test("only one holder gets the signer lock", async () => {
  // PGlite: first tryAcquireSignerLock → true; a second PGlite-backed session cannot be simulated,
  // so assert the SQL sent is exactly "SELECT pg_try_advisory_lock(7331) AS ok" and that rows[0].ok=false → false
});
test("KeyedSerial runs one job at a time per key and in parallel across keys", async () => { /* order assertions */ });
test("mintRequestedKeys encrypts each requested key so it decrypts to an address-matching key", async () => {
  const db = await createTestDb(); const req = await createBotKeyRequest(db);
  expect(await mintRequestedKeys(db, KEK, () => PK)).toBe(1);
  const row = await getBotKey(db, req.id);
  expect(row!.status).toBe("pending");
  expect(row!.address).toBe(privateKeyToAddress(PK).toLowerCase());
  expect(decryptPrivateKey({ encPk: row!.encPk!, iv: row!.encIv!, tag: row!.encTag! }, KEK, req.id)).toBe(PK);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/worker`
Expected: FAIL.

- [ ] **Step 3: Implement the modules listed above**

- `log.ts` exports a `pino` logger.
- `Dockerfile`:
  - Node 24 slim;
  - `corepack enable && pnpm install --frozen-lockfile --filter @perplog/worker...`;
  - `CMD ["pnpm","--filter","@perplog/worker","start"]`, where `start` = `tsx src/main.ts`.
- `railway.toml`: Dockerfile builder, 1 replica, restart policy `ALWAYS`.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm vitest run apps/worker && pnpm -r typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Local boot check**

Run:
```bash
docker run -d --name perplog-pg -e POSTGRES_PASSWORD=pg -p 5433:5432 postgres:16
DATABASE_URL=postgres://postgres:pg@localhost:5433/postgres KEY_ENCRYPTION_KEY=$(openssl rand -base64 32) NETWORK=hideki \
  timeout 15 pnpm --filter @perplog/worker start
```
Expected:
- logs `signer lock acquired`, `migrations applied`, `loop started name=bot-key-minter`;
- a second instance started at the same time logs `standby`.

- [ ] **Step 6: Commit**

```bash
git add apps/worker vitest.config.ts pnpm-lock.yaml
git commit -m "feat(worker): scaffold, signer lock, keyed serial queue, BotKeyMinter"
```

---

### Task 6: Session API and LinkWizard (web)

**Files:**
- Create: `apps/web/lib/db.ts`, `apps/web/lib/session.ts`, `apps/web/lib/chain.ts`, `apps/web/app/api/session/route.ts`, `apps/web/app/api/session/route.test.ts`, `apps/web/components/link-wizard.tsx`
- Modify: `apps/web/package.json` (+ `@perplog/db`)

**Interfaces:**
- Consumes: Task 4 queries; `grantedPools`, `createHttpClient`, `fetchPerpMarkets` (chain).
- Produces:
  ```ts
  // lib/db.ts
  export function getDb(): Db | null;          // null without DATABASE_URL; one pg Pool (max 3) per lambda
  // lib/session.ts
  export const SESSION_COOKIE = "perplog_session";
  export function checkOrigin(req: Request): Response | null;          // 403 {error:"bad_origin"} or null
  export function sessionId(req: Request): string | null;
  export function setSessionCookie(res: Response, id: string): Response;
  export function limitPost(db: Db, req: Request): Promise<Response | null>;   // 429 {error:"rate_limited"} or null; key = session id or "ip:"+first x-forwarded-for
  // lib/chain.ts — the web's chain reads, mockable with vi.mock("@/lib/chain")
  export const chain: {
    perpPools(): Promise<Address[]>; markets(): Promise<MarketInfo[]>;
    grantedPools(owner: Address, bot: Address, pools: Address[]): Promise<Address[]>;
    readPositionSize(account: Address, pool: Address): Promise<bigint>;
    readMark(pool: Address): Promise<{ price: bigint; fromIndex: boolean }>;
  };
  // API
  // POST /api/session → 201 { status: "requested" | "pending" | "linked", botAddress: string | null }  (idempotent per cookie)
  // GET  /api/session?account=0x… → 401 {error:"no_session"} |
  //   200 { status, botAddress, account: string | null, linkedPools: string[], missingPools: string[] }
  ```
- The GET binding rule (spec §4.3), when the bot key is `pending` and `account` is valid:
  - `granted = grantedPools(account, bot, perpPools)`;
  - if non-empty: `bindBotKey`, `bindSession`, `upsertWatch(account, "session")`, then respond `linked`;
  - otherwise respond `pending`.
- When the key is already `linked`, return its bound `account` and `linked_pools`. `missingPools = perpPools − linkedPools`.

- [ ] **Step 1: Write the failing route tests**

Use `vi.mock("@/lib/db", () => ({ getDb: () => testDb }))` and `vi.mock("@/lib/chain", …)` with in-memory fakes. Requests carry `origin: http://localhost` and a matching URL.
```ts
test("POST creates a session once per cookie and sets the cookie", async () => {
  const r1 = await POST(req("POST", "/api/session"));
  expect(r1.status).toBe(201);
  expect(r1.headers.get("set-cookie")).toMatch(/perplog_session=.*HttpOnly.*SameSite=Lax/i);
  const r2 = await POST(req("POST", "/api/session", { cookie: cookieOf(r1) }));
  expect((await r2.json()).botAddress).toBe((await r1.json()).botAddress);  // same key, no new row
});
test("POST from another origin is refused", async () => {
  expect((await POST(req("POST", "/api/session", { origin: "https://evil.example" }))).status).toBe(403);
});
test("GET binds the account only when the bot holds a grant for it", async () => {
  // bot key pending with address B; fake grantedPools returns [] for 0xaa, [P1] for 0xbb
  expect((await (await GET(get("/api/session?account=0xaa"))).json()).status).toBe("pending");
  const linked = await (await GET(get("/api/session?account=0xbb"))).json();
  expect(linked).toMatchObject({ status: "linked", account: "0xbb", linkedPools: [P1], missingPools: [P2] });
  // 0xbb is now in listWatchedAccounts
});
test("GET without a cookie is 401; without DATABASE_URL every route is 503 db_unavailable", async () => { … });
test("11th POST within a minute is 429", async () => { … });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/web/app/api/session`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/db.ts`, `lib/session.ts`, `lib/chain.ts` and the route**

- `lib/chain.ts` uses `createHttpClient(HIDEKI)` for `grantedPools` (multicall over HTTP), `createReadClient()` for size and mark, and `fetchPerpMarkets` cached 10 min.
- `POST /api/session`, with no valid cookie, does `createBotKeyRequest` + `createSession`.
- `GET /api/session` returns `botAddress: null` while the worker has not minted yet.

- [ ] **Step 4: Implement `LinkWizard`**

`<LinkWizard account={address} onLinked={() => void} />` (client component, `data-testid="link-wizard"`) has three steps:
1. a button `Enable protection`, which POSTs `/api/session`;
2. the bot address (`data-testid="bot-address"`) with a Copy button, plus the fixed instruction copy (Global Constraints);
3. polling `GET /api/session?account=` every 3 s with TanStack Query (`refetchInterval: 3000` until linked). It shows "Waiting for the link…", then a pool checklist (`{symbol}: linked/missing`) and calls `onLinked` once linked.

When `missingPools` is non-empty after linking, show: "Some markets are not linked yet. Add the same bot address again in the app to cover them."

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `pnpm vitest run apps/web && pnpm -r typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): session API with origin check and rate limit, LinkWizard"
```

---

### Task 7: LinkWatcher (worker)

**Files:**
- Create: `apps/worker/src/link-watcher.ts`, `apps/worker/test/link-watcher.test.ts`
- Modify: `apps/worker/src/main.ts` (loop every 60 s)

**Interfaces:**
- Consumes: `listLinkedBotKeys`, `setLinkedPools`, `listAccountStops`, `transitionStop`, `insertAlert` (Task 4); `ChainPort.grantedPools`, `ChainPort.markets` (Task 5).
- Produces: `export function checkLinks(db: Db, chain: ChainPort, log: Logger): Promise<void>;`
- Rule, for each bot key with status `linked` or `revoked` and a non-null account:
  1. `granted = grantedPools(account, botAddress, all perp pools)`, then `setLinkedPools(db, id, granted, granted.length ? "linked" : "revoked")`;
  2. armed stops on pools not in `granted` → `paused` (`transitionStop(["armed"], "paused")`); the lost pools that had stops go into one `link_revoked` alert `{ pools }` (dedupe 3600 s);
  3. paused stops on pools in `granted` → `armed`.

  A grant read error skips that key for this tick; it never pauses.

- [ ] **Step 1: Write the failing tests**

```ts
test("losing a pool's grant pauses that pool's armed stop and alerts once", async () => { … expect paused, 1 alert, other pool's stop still armed });
test("grant back re-arms a paused stop", async () => { … });
test("no grants at all marks the key revoked", async () => { … });
test("a failed grant read changes nothing", async () => { … chain.grantedPools rejects → all stops still armed, no alert });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/worker/test/link-watcher.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `checkLinks` and register the 60 s loop in `main.ts`**

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run apps/worker && pnpm -r typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): LinkWatcher pauses and re-arms stops as grants change"
```

---

### Task 8: Stops API and PerpLog stops on Positions (web)

**Files:**
- Create: `apps/web/app/api/stops/route.ts`, `apps/web/app/api/stops/[id]/route.ts`, `apps/web/app/api/stops/stops.test.ts`
- Modify:
  - `apps/web/lib/account-service.ts`: add optional deps `fetchPerplogStops`, `fetchPerplogStopTxs`;
  - `apps/web/lib/service.ts`: wire them to the DB when `getDb()` is non-null;
  - `apps/web/lib/account-service.test.ts`.

**Interfaces:**
- Consumes: Task 4 `insertStop`, `transitionStop`, `listAccountStops`, `stopCloseTxHashes`; Task 6 `chain`, `session` helpers; Task 1 `isTriggered`.
- Produces:
  ```ts
  // POST /api/stops  body { pool: string, triggerPrice: string /* raw decimal integer */, qtyMode: "entire" | "fixed", qtyRaw?: string }
  //   → 201 { stop: Wire<StopView> }
  //   errors: 401 no_session | 403 not_linked (session has no bound account) | 400 invalid_input | 400 unknown_pool
  //           | 409 no_position | 409 pool_not_linked { message } | 400 trigger_wrong_side | 400 bad_quantity
  // DELETE /api/stops/:id → 200 { ok: true } | 404 not_found (absent or another account's) | 409 stop_in_progress
  export interface StopView { id: string; pool: Address; positionSide: Side; triggerPrice: bigint; qtyMode: QtyMode; qtyRaw: bigint | null; status: StopStatus }
  // AccountServiceDeps additions (optional, default to none):
  fetchPerplogStops?(account: Address): Promise<StopView[]>;      // ACTIVE_STOP_STATUSES
  fetchPerplogStopTxs?(account: Address): Promise<Set<string>>;   // → enrichTrades(..., perplogStopTxs) so exits classify PERPLOG_STOP
  // getPositions now returns (OpenPosition & { perplogStop: StopView | null })[]
  //   and stopCoverageBps = min(10_000, native + perplog), where perplog = entire ? 10_000 : qtyRaw·10_000/|size|
  ```
- POST checks, in order:
  1. origin and rate limit;
  2. session linked (else 401/403);
  3. zod body;
  4. pool in `chain.markets()`;
  5. `size = readPositionSize` ≠ 0 (else 409 `no_position`); `side = size > 0 ? "long" : "short"`;
  6. `grantedPools(account, bot, [pool])` non-empty, else 409 `pool_not_linked` with `message`: "PerpLog's bot is not linked for this market. In the dreamDEX app, open your wallet → Link a bot → tick Perps and paste the same bot address again.";
  7. snap the trigger to the tick: long → ceil, short → floor;
  8. trigger side vs the current mark: long requires `trigger < mark`, short requires `trigger > mark` (i.e. `!isTriggered(side, trigger, mark)`), else 400 `trigger_wrong_side`;
  9. fixed qty: floor to lot, `≥ minQuantity`, `≤ |size|`, else 400 `bad_quantity`;
  10. `insertStop` with `trigger_op = long ? "lte" : "gte"`, then 201.
- DELETE transitions `["armed","paused"] → "cancelled"`. When the stop exists for this account but the transition returns false → 409.

- [ ] **Step 1: Write the failing tests**

One test per error code above, plus:
```ts
test("arms a long stop below the mark, snapped up to the tick", async () => {
  // market tick 7, mark 1000, size +20_000 → POST triggerPrice "950" → 201, stop.triggerPrice "952", trigger_op lte
});
test("DELETE of a triggered stop is 409 and leaves it triggered", async () => { … });
test("DELETE of another account's stop is 404", async () => { … });
test("positions carry the PerpLog stop and combined coverage", async () => {
  // account-service with fetchPerplogStops → entire stop → perplogStop set, stopCoverageBps 10_000
});
test("trades closed by a PerpLog stop_close tx classify as PERPLOG_STOP", async () => { … });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/web`
Expected: FAIL.

- [ ] **Step 3: Implement the routes and the account-service additions**

- [ ] **Step 4: Run tests, typecheck, lint, e2e (unchanged fixture mode must still pass)**

Run: `pnpm vitest run apps/web && pnpm -r typecheck && pnpm lint && (cd apps/web && pnpm exec playwright test)`
Expected: PASS, 10/10 e2e.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): stops API with grant and side checks; PerpLog stops on positions"
```

---

### Task 9: StopEngine — mark polling and execution (worker)

**Files:**
- Create: `apps/worker/src/stop-engine.ts`, `apps/worker/test/stop-engine.test.ts`
- Modify: `apps/worker/src/main.ts` (loop every `MARK_POLL_MS`), `apps/worker/test/fakes.ts`

**Interfaces:**
- Consumes:
  - Task 1: `isTriggered`, `nextStopStatus`, `planClose`, `closePriceBound`, `closeSlipBps`, `STOP_MAX_ATTEMPTS`, `STOP_GIVE_UP_MS`;
  - Task 4: `listStops`, `transitionStop`, `recordExecution`, `updateExecution`, `insertAlert`, `getBotKey`; crypto `decryptPrivateKey`;
  - Task 5: `ChainPort`, `KeyedSerial`.
- Produces:
  ```ts
  export function createStopEngine(deps: { db: Db; chain: ChainPort; kek: Buffer; log: Logger; now?: () => number }): {
    tick(): Promise<void>;                 // one polling pass
    idle(): Promise<void>;                 // resolves when no execution is in flight (tests)
  };
  ```
- `tick()`:
  1. `stops = listStops(["armed","triggered","executing"])`;
  2. `markets = chain.markets()`, then marks for the armed stops' distinct pools via `Promise.allSettled(readMark)`. A rejected read logs `mark_read_failed` and skips that pool; `fromIndex` logs `stale_mark` and still evaluates;
  3. for each armed stop where `isTriggered(side, trigger, mark)`: `transitionStop(["armed"], "triggered", { triggeredAt })`; when that returns true, log `stop_triggered {stopId, mark, trigger}` and schedule `execute`;
  4. every `triggered`/`executing` stop not already in flight (restart catch-up) is scheduled too.
- `execute(stop)` runs inside `serial.run(botKeyId)`:
  1. `transitionStop(["triggered","executing"], "executing")`;
  2. decrypt the bot key (AAD = bot key id). The loop (`attempt = stop.attempts`) then repeats:
     1. `size = readPositionSize`, then `planClose({ positionSize: size, stopSide, qtyMode, qtyRaw, closedSoFarRaw: closed_raw, lotSize, minQuantity })`:
        - `stop` → the matching status (`position_closed`/`filled` → done, `position_flipped` → cancelled). On `done`, add a `stop_done` alert `{stopId, pool, txHashes, closedRaw}`. Return;
        - `fail` → `failed` with `last_error = reason`, plus a `stop_failed` alert. Return;
     2. `mark = readMark(pool)`, `bound = closePriceBound(mark.price, side, closeSlipBps(attempt, max_slip_bps), tickSize)`;
     3. `recordExecution(kind "stop_close", status "sending", …)`, then `placeMarketFor`:
        - success: `updateExecution(confirmed, txHash, filledRaw, avgPrice, gasUsed)`, `closed_raw += filledRaw`, log `stop_close_sent {stopId, ms_since_trigger}`;
        - an error (an `OperatorRevert` or anything else): `updateExecution(failed, error)`;
     4. `attempt += 1`; persist `attempts`, `closed_raw`, `last_error`;
     5. if `attempt ≥ STOP_MAX_ATTEMPTS` or `now − triggered_at > STOP_GIVE_UP_MS`: `failed` plus a `stop_failed` alert `{reason: last_error}`. Return.

  A successful fill also loops back to step 1. The re-read then ends it with `position_closed`/`filled`, or sends the remainder.

- [ ] **Step 1: Write the failing tests** (fakes: in-memory `ChainPort` whose size/mark are mutable and whose `placeMarketFor` applies the fill to the fake size)

```ts
test("long stop fires when mark ≤ trigger, closes the whole latest size, ends DONE with a stop_done alert", …);
test("short stop sends a bid with a ceiled bound", …);
test("a failed mark read never triggers", …);
test("stale mark (fromIndex) still evaluates and logs stale_mark", …);
test("position closed manually after trigger → DONE without sending any order", …);
test("position flipped after trigger → CANCELLED without sending any order", …);
test("IOC no-fill widens slip 150 → 250 → 350 and then fills", …);  // assert priceBound per attempt
test("five failed attempts → FAILED with stop_failed alert", …);
test("give-up after 15s since trigger even with attempts left", …);  // now() fake
test("partial fill sends the remainder next attempt, never more than the live size", …);
test("restart: a stop left 'executing' resumes by re-reading the size first", …);
test("cancelled between tick and execute → nothing is sent", …);  // transitionStop to executing fails
test("two stops on one bot key execute sequentially", …);
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/worker/test/stop-engine.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `createStopEngine` and register it in `main.ts`**

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run apps/worker && pnpm -r typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): StopEngine polls marks and closes positions with planClose"
```

- [ ] **Step 6: Live acceptance (blocked until Task 3 Step 7 succeeded)**

1. Run the worker locally against local Postgres with the spike's linked account (Task 5 Step 5 env, plus `KEY_ENCRYPTION_KEY` used when the key was minted).
2. Create a session through the web dev server and link it.
3. Open a small long in the dreamDEX app and arm a stop just under the mark through `POST /api/stops`.

Expected: the stop fires and the log shows `stop_close_sent` with `ms_since_trigger ≤ 3000` (acceptance §14.2 #3). The final size is 0 and the tx is on the explorer. Record the tx hash in the commit message of Task 14.

---

### Task 10: ReactivityListener and AlertEngine (worker)

**Files:**
- Create: `apps/worker/src/reactivity-listener.ts`, `apps/worker/src/alert-engine.ts`, `apps/worker/test/alert-engine.test.ts`
- Modify: `apps/worker/src/main.ts`

**Interfaces:**
- Consumes: `watchPositionUpdates` (Task 3), `needsUnprotectedCheck`, `UNPROTECTED_GRACE_SEC`, `UNPROTECTED_POLL_SEC` (Task 1), `listWatchedAccounts`, `listAccountStops`, `transitionStop`, `insertAlert` (Task 4), `ChainPort`.
- Produces:
  ```ts
  type Timers = NonNullable<Parameters<typeof watchPositionUpdates>[0]["timers"]>;   // Task 3's timers shape
  export function createAlertEngine(deps: { db: Db; chain: ChainPort; log: Logger; timers?: Timers }): {
    onUpdate(u: PositionUpdate): Promise<void>;      // from Reactivity or from the poll
    setFeed(s: FeedStatus): void;                     // "degraded" starts the 30 s poll, "live" stops it
    refreshWatched(): Promise<void>;                  // every 10 s from main
    stop(): void;
  };
  export function startReactivityListener(chain: ChainPort, engine: ReturnType<typeof createAlertEngine>, log: Logger): WatchHandle;
  ```
- `onUpdate` rules:
  - Keep `sizes: Map<"account:pool", bigint>`.
  - For every update (watched or not) whose account has active stops on that pool, when `newSize === 0n` or its sign differs from the stop side: `transitionStop(["armed","paused"], "cancelled")`. Triggered/executing stops are left to the StopEngine.
  - For watched accounts, when `needsUnprotectedCheck(prev, newSize)`: (re)schedule a check in 60 s, keyed by `account:pool`. The check alerts only when all of these hold:
    1. the cached size is still non-zero;
    2. there is no active PerpLog stop on that pool;
    3. `chain.pendingStopLosses(account, pool, side) === 0`.

    The alert is `insertAlert(unprotected_position, pool, { symbol, side, sizeRaw }, dedupeWithinSec: 600)`.
- Degraded poll, every 30 s:
  - `openPositions(watched)`;
  - each returned row goes through `onUpdate`;
  - each cached non-zero `account:pool` missing from the result goes through `onUpdate` with `newSize: 0n`.

- [ ] **Step 1: Write the failing tests** (fake timers)

```ts
test("open without a stop → unprotected alert after 60s", …);
test("a native stop-loss placed within 60s suppresses the alert", …);           // pendingStopLosses → 1
test("an armed PerpLog stop suppresses the alert", …);
test("position closed within 60s → no alert", …);
test("unwatched accounts never alert", …);
test("size to zero auto-cancels an armed stop", …);
test("flip auto-cancels an armed stop; a triggered stop is left alone", …);
test("degraded feed: the 30s poll alone produces the alert within 90s", …);   // no onUpdate from Reactivity at all
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/worker/test/alert-engine.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement both modules; in `main.ts` start the listener and the 10 s `refreshWatched` loop**

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run apps/worker && pnpm -r typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): Reactivity listener and unprotected-position alerts with poll fallback"
```

---

### Task 11: Watch and alerts API, alert toasts (web)

**Files:**
- Create: `apps/web/app/api/watch/route.ts`, `apps/web/app/api/alerts/route.ts`, `apps/web/app/api/alerts/alerts.test.ts`, `apps/web/components/alert-toasts.tsx`, `apps/web/components/watch-button.tsx`
- Modify: `apps/web/components/account-view.tsx` (mount `AlertToasts` and `WatchButton`)

**Interfaces:**
- Consumes: `upsertWatch`, `listAlerts` (Task 4); `checkOrigin`, `limitPost`, `getDb` (Task 6).
- Produces:
  ```ts
  // POST /api/watch { account } → 200 { watching: true } | 400 invalid_address | 403 | 429 | 503 db_unavailable
  // GET  /api/alerts?account=0x…&since=<ms> → 200 { alerts: Wire<AlertView>[] } (ascending, ≤ 50) | 400 | 503 db_unavailable
  export interface AlertView { id: string; type: AlertType; pool: Address | null; payload: Record<string, unknown>; createdAt: string }
  ```
- `AlertToasts({ account })`:
  - polls every 5 s with `since` = the last seen `createdAt` (start = page load time);
  - renders each alert as a toast (`data-testid="alert-toast"`) with one-line copy per type:
    - **unprotected_position:** "{symbol} {side} has no stop-loss." with a `Protect` link to `?tab=positions&protect={pool}`;
    - **stop_done:** "PerpLog stop closed {symbol}." with an explorer link;
    - **stop_failed:** "PerpLog stop on {symbol} failed: {reason}.";
    - **bot_low_gas:** "PerpLog's bot is low on gas; stops may not fire.";
    - **link_revoked:** "PerpLog's bot lost access to {n} market(s); their stops are paused.";
  - also fires `new Notification(...)` when `Notification.permission === "granted"`;
  - stays silent on 503.
- `WatchButton({ account })`: label `Watch this account`. It requests Notification permission, then POSTs `/api/watch`. Once watching, it shows "Watching".

- [ ] **Step 1: Write the failing route tests**

```ts
test("alerts since a time, ascending, capped at 50", …);
test("watch adds the account to watched accounts; bad address → 400; other origin → 403", …);
test("both routes return 503 db_unavailable without DATABASE_URL", …);
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/web/app/api/alerts`
Expected: FAIL.

- [ ] **Step 3: Implement the routes and components**

- [ ] **Step 4: Run tests, typecheck, lint, e2e**

Run: `pnpm vitest run apps/web && pnpm -r typecheck && pnpm lint && (cd apps/web && pnpm exec playwright test)`
Expected: PASS. In fixture mode there is no DB, so the toasts stay silent and the 10 existing e2e tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): watch and alerts API with polling toasts and browser notifications"
```

---

### Task 12: Protect Now UI (web)

**Files:**
- Create: `apps/web/components/protect-form.tsx`, `apps/web/e2e/protect.spec.ts`
- Modify: `apps/web/components/positions-panel.tsx`

**Interfaces:**
- Consumes: `LinkWizard` (Task 6), `POST/DELETE /api/stops` (Task 8), positions' `perplogStop` (Task 8), `GET /api/session` (Task 6).
- Produces:
  - In each position row:
    - a `Protect` button;
    - when `perplogStop` is set, a badge (`data-testid="perplog-stop"`) "PerpLog stop @ {price} · {status}" with `Cancel stop`.
  - `Protect`:
    - when `GET /api/session` is not `linked` for this account (401, or a different account) → `LinkWizard`, then the form;
    - when linked → `<ProtectForm position={p} onArmed={refetch} />`.
  - `ProtectForm` fields:
    - `Trigger price` (decimal input, converted with `parseUnits(value, 18)`);
    - `Close` radio `Entire position` / `Fixed size` (size input in base units at `baseDecimals`, sent as `qtyRaw`);
    - a submit button `Arm stop`.
  - Error codes from the API map to one line each. `pool_not_linked` shows the API's `message`.
  - `?protect={pool}` (from leak fixes and alert toasts) opens the form for that row automatically.
  - Hide every Protect control when `GET /api/session` returns 503 `db_unavailable`.

- [ ] **Step 1: Write the failing e2e test** (fixture mode; API calls mocked with `page.route`)

```ts
test("protect flow: link, arm, see the PerpLog stop, cancel", async ({ page }) => {
  // mock: POST /api/session → 201 {status:"pending", botAddress:"0xb0…"}
  //       GET  /api/session  → first {status:"pending"}, then {status:"linked", account, linkedPools:[pool], missingPools:[]}
  //       POST /api/stops    → 201 {stop:{…, status:"armed", triggerPrice}}
  //       GET  /api/accounts/<0xf1a1…>/positions → fixture positions with perplogStop set after arming
  await page.goto("/a/0xf1a1…?tab=positions");
  await page.getByRole("button", { name: "Protect" }).first().click();
  await expect(page.getByTestId("link-wizard")).toBeVisible();
  await page.getByRole("button", { name: "Enable protection" }).click();
  await expect(page.getByTestId("bot-address")).toContainText("0xb0");
  await page.getByLabel("Trigger price").fill("1900");
  await page.getByRole("button", { name: "Arm stop" }).click();
  await expect(page.getByTestId("perplog-stop").first()).toContainText("armed");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd apps/web && pnpm exec playwright test e2e/protect.spec.ts`
Expected: FAIL (no Protect button).

- [ ] **Step 3: Implement `ProtectForm` and the positions-panel changes**

- [ ] **Step 4: Run all checks**

Run: `pnpm -r typecheck && pnpm lint && pnpm test && (cd apps/web && pnpm exec playwright test)`
Expected: PASS, 11/11 e2e.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): Protect Now with link wizard, stop form and cancel"
```

---

### Task 13: GasTreasury (worker)

**Files:**
- Create: `apps/worker/src/gas-treasury.ts`, `apps/worker/test/gas-treasury.test.ts`
- Modify: `apps/worker/src/main.ts` (every 15 s; skipped with a startup warning when `TREASURY_PRIVATE_KEY` is null)

**Interfaces:**
- Consumes: `planTopUp` (Task 1); `listStops`, `getBotKey`, `gasSentTodayWei`, `recordTopUp`, `insertAlert` (Task 4); `ChainPort.balanceOf`, `ChainPort.sendNative`.
- Produces: `export function topUpBots(deps: { db: Db; chain: ChainPort; treasuryKey: Hex; env: WorkerEnv; log: Logger; now?: () => Date }): Promise<void>;`
- Rule:
  - The bot keys considered are the distinct `bot_key_id`s of stops in `armed|triggered|executing`.
  - For each: `planTopUp({ balanceWei: balanceOf(address), sentTodayWei: gasSentTodayWei(id, now) (since UTC midnight), … })`:
    - `send` → `sendNative` + `recordTopUp`;
    - `capped` → `bot_low_gas` alert to the key's account (dedupe 21_600 s).
  - Afterwards, a treasury balance < 5 STT logs `treasury_low` at warn level.
  - A send error is logged, and the next key is still processed.

- [ ] **Step 1: Write the failing tests**

```ts
test("tops up a key with an armed stop below 0.2 STT by 0.5 STT", …);
test("keys without active stops are ignored", …);
test("daily cap → bot_low_gas alert once, no send", …);
test("one failed send does not stop the others", …);
test("warns when the treasury is under 5 STT", …);
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/worker/test/gas-treasury.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement and register the loop**

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run apps/worker && pnpm -r typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): GasTreasury tops up bot keys within a daily cap"
```

---

### Task 14: Deploy, README and live acceptance

**Files:**
- Modify: `README.md`, `.github/workflows/ci.yml` (no change needed if `pnpm test` already covers the new projects; verify)
- Create: `apps/worker/.env.example`, `apps/web/.env.example`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: README**

Add the following sections:
- **"Protection (bot-held stops)"**:
  - why bot-held (C1/C2 in two sentences);
  - the link steps (fixed copy);
  - what the bot can and cannot do: place/cancel/reduce only, no withdrawals, closes only, never more than the live size;
  - the stop lifecycle diagram (spec §6.7).
- **"Alerts"**.
- **"Run the worker"**:
  - local Docker Postgres command from Task 5;
  - env table (spec §11.1 rows used in Plan 2);
  - `openssl rand -base64 32` for the KEK.
- **"Deploy"**:
  - Neon `DATABASE_URL` (pooled) for both apps;
  - Railway service from `apps/worker/Dockerfile` with 1 replica;
  - Vercel env `DATABASE_URL`.

- [ ] **Step 2: Full local verification**

Run: `pnpm lint && pnpm -r typecheck && pnpm test && (cd apps/web && pnpm exec playwright test) && pnpm --filter @perplog/web build`
Expected: all pass, and the build lists `ƒ /api/session`, `ƒ /api/stops`, `ƒ /api/alerts`, `ƒ /api/watch`.

- [ ] **Step 3: Deploy** (needs the user's Neon, Railway and Vercel accounts, spec §17 item 4; if any is missing, record which and skip to Step 4 running locally)

1. Set worker env:
   - `DATABASE_URL`, `KEY_ENCRYPTION_KEY`, `TREASURY_PRIVATE_KEY`, `NETWORK=hideki`.
2. Set web env:
   - `DATABASE_URL`, `NETWORK=hideki`.
3. Deploy the worker. Logs must show `signer lock acquired` and `migrations applied`.
4. Deploy the web app.

- [ ] **Step 4: Live acceptance on Hideki** (needs the user's Arena account and STT)

1. On the deployed (or local) web app, paste the user's account, open Positions, press `Protect`, and link the bot through the wizard. Expected: `linked`, with the pool checklist.
2. In the dreamDEX app, open a small position **without** a stop. Expected: an `unprotected_position` toast within **90 s** (§14.2 #5). Note the measured time.
3. Press `Protect` on it and arm a stop just under (long) or over (short) the mark. Expected:
   - the stop fires;
   - the worker log shows `ms_since_trigger ≤ 3000` (§14.2 #3);
   - the position ends at 0;
   - a `stop_done` toast with an explorer link;
   - the Journal shows the trade with exit `PERPLOG_STOP`.
4. Record the tx hashes and timings in `docs/superpowers/plans/2026-10-27-perplog-plan-2-protection.md` under a final "Acceptance log" heading.

- [ ] **Step 5: Commit**

```bash
git add README.md apps/worker/.env.example apps/web/.env.example docs/superpowers/plans
git commit -m "docs: protection, alerts, worker and deploy; Plan 2 acceptance log"
```

---

## Notes for the executor

- **Order:**
  - Tasks 1 → 2 → 3 → 4 → 5 are sequential;
  - Tasks 6–8 can follow in order;
  - Tasks 9, 10 and 13 depend on 5 (and 9 on 8 for live acceptance);
  - Tasks 11 and 12 depend on 6 and 8.
- **Blocked on the user (spec §17):** Task 3 Step 7, Task 9 Step 6, Task 14 Steps 3–4. Build and unit-test everything else without waiting, and report the blocked steps clearly.
- **Deliberate deviations from the spec, all recorded here:**
  - `enc_*` columns are base64 `text`, not `bytea`;
  - the web app uses `pg` (node-postgres) against Neon's pooled URL instead of the Neon serverless driver, so one driver works with Neon, Railway Postgres and local Docker;
  - `plans`, `trades_cache`, `reconciliations` and `weekly_reports` tables are deferred to Plan 3 or dropped (Plan 1's LRU replaces `trades_cache`);
  - the claim-loop over `executions` (`FOR UPDATE SKIP LOCKED`, 300 ms) is built in Plan 3 with the first web-originated job (`entry`). In Plan 2 every execution originates in the worker, so the StopEngine records `executions` rows directly;
  - creating a stop on a pool cancels the account's previous active stop on that pool (the spec is silent; one stop per position keeps coverage unambiguous);
  - `p-queue` is replaced by the 20-line `KeyedSerial`;
  - spike (d), indexer pagination limits, was settled in Plan 1 (`limit` 1000 with a keyset cursor works), so P0 here has three spikes;
  - the worker's ReportJob (spec §5) belongs to Plan 3 with the weekly report.
