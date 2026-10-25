# PerpLog Plan 1 — Read-only Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the read-only PerpLog web app for any dreamDEX account. It covers:
- **Health Check**, with reconciled net PnL;
- **Journal**;
- **Leaks**;
- **Positions**, view only;
- landing-page platform stats.

**Architecture:** pnpm monorepo with three workspaces:
- `packages/core`: pure TypeScript domain logic (trades, costs, reconciliation, leaks, summary), all money as `bigint`;
- `packages/chain`: I/O, i.e. the Envio indexer over GraphQL and on-chain reads through `@somnia-chain/markets-sdk`;
- `apps/web`: Next.js 16 app whose Route Handlers compose the two packages behind a 60s in-process LRU cache. There is no database in this plan.

Golden tests reconcile real captured accounts against on-chain collateral.

**Tech Stack:** Node 24, TypeScript 5.9.3, pnpm (corepack), Vitest 5, zod 4, viem 2.57, @somnia-chain/markets-sdk 0.32.1 (exact), Next.js 16.4, React 19.3, Tailwind 4.3, shadcn/ui, TanStack Query 5, Recharts 3, lru-cache 11, Playwright 1.6x, Biome (lint/format), tsx (scripts).

**Spec:** `docs/specs/2026-10-25-perplog-design.md`. Plan 1 covers phases **P1 and P2** of §15. Plans 2 and 3 cover P0 and P3–P6.

## Global Constraints

- All code, comments, identifiers, UI copy, README and commit messages are in **English**.
- Node 24 LTS; **TypeScript 5.9.3** (not 7.x); `@somnia-chain/markets-sdk` pinned to exactly `0.32.1`; viem `^2.57`; zod `^4`.
- **Money is always raw `bigint`** (USDso has 18 decimals; base uses the market's `baseDecimals`). Never `number` for money. Ratios become `number` only after `bigint` division.
- Never hardcode pools, stop registries or decimals. Read markets from the indexer `Market(where: {perpRegistered: {_eq: true}})`.
- Network constants (spec §7.1):
  - indexer `https://hideki-dev.smk.somnia.host/v1/graphql`;
  - RPC `https://api.hideki2.infra.testnet.somnia.network`;
  - WS `wss://api.hideki2.infra.testnet.somnia.network/ws`;
  - MarginBank `0x478769e1177c0773c43a593dccc4ad15f15f1394`;
  - explorer tx URL `https://explorer.testnet.somnia.network/tokyo/tx/<hash>`.
- Addresses are normalized to lowercase `0x` + 40 hex before any query. The indexer stores lowercase.
- Indexer sizes are **signed** (positive = long, negative = short); `closedSize` is absolute; timestamps are unix **seconds**.
- `FundingPayment.amount > 0` means the trader **paid**.
- Reconciliation tolerance is `10n ** 16n` raw (0.01 USDso).
- History cap: the most recent **20,000** position changes. Beyond that the report is `truncated` and reconciliation is skipped.
- Internal packages export TypeScript source (`"exports": {".": "./src/index.ts"}`); Next uses `transpilePackages`.
- Commit messages are Conventional Commits and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- E2E selectors are fixed:
  - `data-testid` values `top-leak`, `trade-card`, `leak-card`, `position-row`, `equity-chart`;
  - form controls are labelled `Market`, `Exit`, `Side`;
  - the landing button is labelled `Analyze`.

## Review Focus

1. **Wrong or empty address.** A user pastes their login wallet (not the Safe trading account) or an address with no perps history. Expected: a friendly empty state with the copy from spec §10, never an error page or a zero-filled report. Tests: Task 12 (`empty: true`) and Task 13 (copy visible).
2. **Huge bot accounts (> 20,000 changes).** Expected: the response arrives without timeout, with `truncated: true`, `reconcile: null` and the badge "Not reconciled: history truncated". Tests: Task 6 (`paginateDesc` stops at `maxRows`) and Task 12 (truncation disables reconciliation).
3. **Indexer down or erroring.** Expected: HTTP 503 `{"error":"indexer_unavailable"}` and a retry button in the UI. Never a 500 stack trace. Test: Task 12.
4. **Trade on a pool missing from the market list** (new or delisted market). Expected: symbol falls back to `0x1234…abcd`, `maxNotional = 0n`, the trade is excluded from L4, no crash. Tests: Task 8 and Task 9.
5. **Address formatting.** Mixed case, surrounding whitespace, missing `0x`, or arbitrary text. Expected: normalize the valid forms; reject the rest with HTTP 400 `{"error":"invalid_address"}`. Tests: Task 2 and Task 12.

---

## File Structure

```
/Users/vanhuy/Desktop/dreamDEX            (repo root)
├─ package.json, pnpm-workspace.yaml, tsconfig.base.json, vitest.config.ts, biome.json, .gitignore
├─ .github/workflows/ci.yml
├─ packages/core/
│  ├─ package.json, tsconfig.json
│  ├─ src/index.ts            re-exports
│  ├─ src/types.ts            all domain types (Task 2)
│  ├─ src/address.ts          normalizeAddress, shortAddress
│  ├─ src/units.ts            formatting + bigint math
│  ├─ src/config.ts           thresholds
│  ├─ src/trades.ts           reconstructTrades
│  ├─ src/costs.ts            attributeCosts
│  ├─ src/reconcile.ts        expectedCollateral, reconcile
│  ├─ src/cohort.ts           isAutomatedCohort
│  ├─ src/fixture.ts          writeFixture / readFixture (bigint-safe JSON)
│  ├─ src/exit-type.ts        classifyExit
│  ├─ src/coverage.ts         tradeHadStop, stopCoverageBps
│  ├─ src/enrich.ts           enrichTrades
│  ├─ src/leaks.ts            computeLeaks
│  ├─ src/summary.ts          filterRange, buildHealthSummary
│  └─ test/*.test.ts, test/fixtures/*.json
├─ packages/chain/
│  ├─ src/index.ts, src/networks.ts
│  ├─ src/indexer/client.ts   gql, paginateDesc, IndexerError
│  ├─ src/indexer/schemas.ts  zod row schemas → core types
│  ├─ src/indexer/markets.ts  fetchPerpMarkets
│  ├─ src/indexer/history.ts  fetchAccountHistory, fetchIndexerHead
│  ├─ src/onchain.ts          createReadClient, getCollateralRaw, getOpenPositions
│  └─ test/*.test.ts
├─ scripts/capture-fixture.ts, scripts/platform-stats.ts
└─ apps/web/
   ├─ next.config.ts, playwright.config.ts, e2e/*.spec.ts
   ├─ lib/account-service.ts, lib/service.ts, lib/json.ts, lib/format.ts
   ├─ app/layout.tsx, app/page.tsx, app/a/[address]/page.tsx, app/providers.tsx
   ├─ app/api/accounts/[address]/{health,trades,leaks,positions}/route.ts
   ├─ components/{address-form,reconcile-badge,health-panel,trade-card,journal-panel,
   │              leak-card,leaks-panel,positions-panel,equity-chart,empty-state,error-state}.tsx
   └─ data/platform-stats.json
```

---

### Task 1: Workspace scaffold, tooling and CI

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `biome.json`, `.gitignore`, `.github/workflows/ci.yml`
- Create: `packages/core/{package.json,tsconfig.json,src/index.ts}`, `packages/chain/{package.json,tsconfig.json,src/index.ts}`
- Test: `packages/core/test/smoke.test.ts`

**Interfaces:**
- Produces: workspace packages `@perplog/core` and `@perplog/chain` (`"type": "module"`, `"exports": {".": "./src/index.ts"}`); root scripts `test`, `typecheck`, `lint`.

- [ ] **Step 1: Init repo and package manager**

Run, from the repo root: `git init && corepack enable && corepack use pnpm@latest`
Expected: `package.json` gets a `packageManager: "pnpm@…"` field.

- [ ] **Step 2: Write root config**

- Root `package.json`:
  - scripts `"test": "vitest run"`, `"typecheck": "pnpm -r typecheck"`, `"lint": "biome check ."`;
  - devDependencies `typescript@5.9.3`, `vitest@^5`, `tsx@^4`, `@biomejs/biome@latest`.
- `pnpm-workspace.yaml`: `packages: ["apps/*", "packages/*"]`.
- `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `target ES2022`, `module ESNext`, `moduleResolution Bundler`, `skipLibCheck`, `verbatimModuleSyntax`.
- `vitest.config.ts`: `test.projects = ["packages/*"]` (apps/web is added in Task 12).
- `.gitignore`: `node_modules`, `.next`, `.env*`, `playwright-report`, `test-results`.

- [ ] **Step 3: Write the failing smoke test**

```ts
// packages/core/test/smoke.test.ts
import { VERSION } from "../src/index";
test("core package loads", () => { expect(VERSION).toBe("0.1.0"); });
```

- [ ] **Step 4: Run it to see it fail**

Run: `pnpm install && pnpm vitest run packages/core`
Expected: FAIL, `VERSION` is not exported.

- [ ] **Step 5: Create both packages**

- `packages/core/src/index.ts`: `export const VERSION = "0.1.0";`
- `packages/chain/package.json`: depends on `@perplog/core: "workspace:*"`, `@somnia-chain/markets-sdk: "0.32.1"`, `viem: "^2.57"`, `zod: "^4"`.
- Each package gets `"typecheck": "tsc --noEmit"` and a `tsconfig.json` extending the base.

- [ ] **Step 6: Run tests, typecheck, lint**

Run: `pnpm install && pnpm test && pnpm typecheck && pnpm lint`
Expected: 1 test passes; typecheck and lint are clean.

- [ ] **Step 7: Add CI**

`.github/workflows/ci.yml`: on push/PR, Node 24 → `corepack enable` → `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm typecheck` → `pnpm test`.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold pnpm monorepo with core and chain packages"
```

---

### Task 2: Domain types, address and unit helpers

**Files:**
- Create: `packages/core/src/types.ts`, `packages/core/src/address.ts`, `packages/core/src/units.ts`, `packages/core/src/config.ts`
- Modify: `packages/core/src/index.ts` (re-export all)
- Test: `packages/core/test/address.test.ts`, `packages/core/test/units.test.ts`

**Interfaces:**
- Produces, in `types.ts` (exact names; every later task uses them):

```ts
export type Address = `0x${string}`;
export type Hash = `0x${string}`;
export type Side = "long" | "short";
export type ChangeKind = "OPEN" | "INCREASE" | "REDUCE" | "CLOSE" | "FLIP";
export interface PositionChange { id: string; kind: ChangeKind; pool: Address; orderId: string | null;
  blockNumber: bigint; logIndex: number; timestamp: number; txHash: Hash;
  sizeBefore: bigint; sizeAfter: bigint; closedSize: bigint;
  entryPriceBefore: bigint | null; entryPriceAfter: bigint | null; exitPrice: bigint | null; realizedPnl: bigint }
export interface FundingPayment { id: string; pool: Address; amount: bigint; timestamp: number; txHash: Hash }
export type FeeKind = "liquidation" | "trading" | "builder";
export interface FeeRecord { id: string; kind: FeeKind; pool: Address | null; amount: bigint; timestamp: number; txHash: Hash }
export interface MarginEvent { id: string; kind: string; amount: bigint; timestamp: number }
export interface MarginPull { id: string; amount: bigint; timestamp: number }
export interface LiquidationRecord { id: string; kind: string; pool: Address | null; txHash: Hash; timestamp: number }
export interface StopOrderRecord { id: string; pool: Address; status: string; isBid: boolean; triggerOperator: number;
  triggerPrice: bigint; quantity: bigint; createdAt: number; updatedAt: number; placedOrderId: string | null }
export interface AccountHistory { account: Address; asOfTimestamp: number; truncated: boolean;
  changes: PositionChange[]; funding: FundingPayment[]; fees: FeeRecord[]; marginEvents: MarginEvent[];
  marginPulls: MarginPull[]; liquidations: LiquidationRecord[]; stopOrders: StopOrderRecord[] }
export interface MarketInfo { pool: Address; symbol: string; baseDecimals: number; tickSize: bigint;
  lotSize: bigint; minQuantity: bigint; stopRegistry: Address | null }
export interface Trade { id: string; pool: Address; side: Side; openedAt: number; closedAt: number | null;
  entryPrice: bigint; exitVwap: bigint | null; maxSize: bigint; closedSize: bigint; realizedPnl: bigint;
  txHashes: Hash[]; orderIds: string[]; lastChange: PositionChange; partialHistory: boolean }
export interface TradeCosts { funding: bigint; liquidationFee: bigint; tradingFee: bigint; builderFee: bigint }
export interface CostedTrade extends Trade { costs: TradeCosts; netPnl: bigint }
export interface CostAttribution { trades: CostedTrade[]; unattributed: TradeCosts; unattributedFunding: FundingPayment[] }
export type ExitType = "LIQUIDATED" | "NATIVE_STOP" | "PERPLOG_STOP" | "MANUAL" | "OPEN";
export interface EnrichedTrade extends CostedTrade { exitType: ExitType; hadStop: boolean; maxNotional: bigint; symbol: string }
export interface ReconcileResult { expectedRaw: bigint; actualRaw: bigint; deltaRaw: bigint; ok: boolean }
export type LeakId = "LIQUIDATION_COST" | "NO_STOP_LOSSES" | "FUNDING_DRAG" | "SIZE_UP_AFTER_LOSS";
export type LeakFix = "PROTECT_NOW" | "ALWAYS_PROTECT" | "SHOW_FUNDING" | "FIXED_RISK";
export interface Leak { id: LeakId; title: string; amountRaw: bigint; shareOfLossBps: number; evidenceTradeIds: string[]; fix: LeakFix }
export type Range = "7d" | "30d" | "all";
export interface HealthSummary { range: Range; tradeCount: number; openTradeCount: number; netPnlRaw: bigint;
  realizedPnlRaw: bigint; fundingPaidRaw: bigint; liquidationCostRaw: bigint; tradesWithoutStopPct: number;
  winRatePct: number; topLeak: Leak | null; reconcile: ReconcileResult | null }
export interface OpenPosition { pool: Address; symbol: string; side: Side; sizeRaw: bigint; entryPrice: bigint;
  markPrice: bigint; markFromIndex: boolean; liquidationPrice: bigint | null; liqDistanceBps: number | null;
  unrealizedPnlRaw: bigint; stopCoverageBps: number; fundingLast24hRaw: bigint }
```

- Produces, in `address.ts`: `normalizeAddress(input: string): Address | null` and `shortAddress(a: Address): string` (`0x1234…abcd`).
- Produces, in `units.ts`:
  - `absBig(x: bigint): bigint`
  - `formatAmount(raw: bigint, decimals: number, fractionDigits?: number /* default 2 */): string`: round half away from zero, thousands separators `,`, leading `-` for negatives, never `-0.00`
  - `formatUsd(raw: bigint): string`, e.g. `"-1,234.57 USDso"`
  - `notionalRaw(sizeRaw: bigint, priceRaw: bigint, baseDecimals: number): bigint` = `|size| * price / 10^dec`
  - `ratioBps(num: bigint, den: bigint): number`: floor; 0 when `den == 0n`
- Produces, in `config.ts`: `LIQ_DISTANCE_WARN_BPS = 1000`, `TILT_WINDOW_SEC = 1800`, `TILT_MULTIPLE_NUM = 3n`, `TILT_MULTIPLE_DEN = 2n`, `HISTORY_MAX_CHANGES = 20_000`, `RECONCILE_TOLERANCE_RAW = 10n ** 16n`, `COHORT_MAX_CHANGES = 6`, `COHORT_MAX_ABS_PNL_RAW = 10n ** 18n`.

- [ ] **Step 1: Write failing tests**

```ts
// address.test.ts
test.each([
  ["  0xABCDEF0123456789abcdef0123456789ABCDEF01 ", "0xabcdef0123456789abcdef0123456789abcdef01"],
  ["abcdef0123456789abcdef0123456789abcdef01", "0xabcdef0123456789abcdef0123456789abcdef01"],
])("normalizes %s", (i, o) => expect(normalizeAddress(i)).toBe(o));
test.each(["", "0x123", "vitalik.eth", "0xZZcdef0123456789abcdef0123456789abcdef01"])(
  "rejects %s", (i) => expect(normalizeAddress(i)).toBeNull());
test("shortAddress", () =>
  expect(shortAddress("0x31b0480ff2ec5d0a4d9480a9f8c8802897c08281")).toBe("0x31b0…8281"));

// units.test.ts
test("formatUsd negative with separators", () => expect(formatUsd(-1234567000000000000000n)).toBe("-1,234.57 USDso"));
test("formatUsd never negative zero", () => expect(formatUsd(-4000000000000000n)).toBe("0.00 USDso"));
test("formatAmount 24 decimals", () => expect(formatAmount(15000000000000000000000000n, 24, 4)).toBe("15.0000"));
test("formatAmount 6 decimals", () => expect(formatAmount(-53800000n, 6, 2)).toBe("-53.80"));
test("notional uses abs size and base decimals (8)", () =>
  expect(notionalRaw(-13000n, 80000n * 10n ** 18n, 8)).toBe(10400000000000000000n)); // 0.00013 BTC * 80k = 10.4
test("ratioBps floors and handles zero", () => {
  expect(ratioBps(1n, 3n)).toBe(3333); expect(ratioBps(5n, 0n)).toBe(0); });
```

- [ ] **Step 2: Run, verify they fail**

Run: `pnpm vitest run packages/core/test/address.test.ts packages/core/test/units.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `types.ts`, `address.ts`, `units.ts`, `config.ts`; re-export from `index.ts`**

`normalizeAddress`: trim; lowercase; prefix `0x` if absent; must match `/^0x[0-9a-f]{40}$/`.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm vitest run packages/core && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "feat(core): domain types, address and unit helpers"
```

---

### Task 3: Trade reconstruction

**Files:**
- Create: `packages/core/src/trades.ts`
- Test: `packages/core/test/trades.test.ts`

**Interfaces:**
- Consumes: `PositionChange`, `Trade`, `Address` (Task 2).
- Produces: `reconstructTrades(account: Address, changes: PositionChange[]): Trade[]`. Groups by pool, sorts by (`blockNumber`, `logIndex`), applies the spec §6.2 algorithm. Output is sorted by `openedAt` ascending.
- Trade fields:
  - `id = \`${account}:${pool}:${openTxHash}:${openLogIndex}\``;
  - `side` from `sign(sizeAfter)` of the opening change;
  - `entryPrice` = `entryPriceAfter` of the last change before the first reduction;
  - `exitVwap = Σ(closedSize × exitPrice) / Σ closedSize` (integer division), `null` if nothing closed;
  - `maxSize` is the max |size|;
  - `lastChange` is the last change applied to the trade.
- Partial history: an `INCREASE`/`REDUCE`/`CLOSE` with no open trade starts one with `partialHistory: true`, `side = sign(sizeBefore)` and `entryPrice = entryPriceBefore ?? 0n`.

- [ ] **Step 1: Write failing tests (real rows from account `0x3952…3951`, ETH pool `0xd6cb…eddf`)**

```ts
const POOL = "0xd6cb1dd58580b84d76068ac21594219ce03aeddf";
const ch = (o: Partial<PositionChange>): PositionChange => ({ id: o.id!, kind: o.kind!, pool: POOL, orderId: null,
  blockNumber: 0n, logIndex: 0, timestamp: 0, txHash: "0x0", sizeBefore: 0n, sizeAfter: 0n, closedSize: 0n,
  entryPriceBefore: null, entryPriceAfter: null, exitPrice: null, realizedPnl: 0n, ...o });
const real = [
  ch({ id: "a", kind: "OPEN", blockNumber: 22060539n, logIndex: 3, timestamp: 1791857137, txHash: "0x6e5a",
       sizeAfter: 406400000000000000n, entryPriceAfter: 2462200000000000000000n }),
  ch({ id: "b", kind: "INCREASE", blockNumber: 22060539n, logIndex: 9, timestamp: 1791857137, txHash: "0x6e5a",
       sizeBefore: 406400000000000000n, sizeAfter: 888900000000000000n, entryPriceAfter: 2462227140285746428169n }),
  ch({ id: "c", kind: "REDUCE", blockNumber: 22129661n, logIndex: 2, timestamp: 1791864053, txHash: "0x52e7",
       sizeBefore: 888900000000000000n, sizeAfter: 849000000000000000n, closedSize: 39900000000000000n,
       entryPriceAfter: 2462227140285746428169n, exitPrice: 2505530000000000000000n, realizedPnl: 1727784102598717516n }),
  ch({ id: "d", kind: "REDUCE", blockNumber: 22129661n, logIndex: 7, timestamp: 1791864053, txHash: "0x52e7",
       sizeBefore: 849000000000000000n, sizeAfter: 481800000000000000n, closedSize: 367200000000000000n,
       entryPriceAfter: 2462227140285746428169n, exitPrice: 2505530000000000000000n, realizedPnl: 15900810087073911576n }),
  ch({ id: "e", kind: "CLOSE", blockNumber: 22129661n, logIndex: 12, timestamp: 1791864053, txHash: "0x52e7",
       sizeBefore: 481800000000000000n, sizeAfter: 0n, closedSize: 481800000000000000n,
       entryPriceAfter: 0n, exitPrice: 2505470000000000000000n, realizedPnl: 20834409810327370908n }),
];
test("long round trip from real rows", () => {
  const [t] = reconstructTrades("0x3952", real);
  expect(t).toMatchObject({ side: "long", openedAt: 1791857137, closedAt: 1791864053,
    entryPrice: 2462227140285746428169n, exitVwap: 2505497478906513668579n,
    maxSize: 888900000000000000n, closedSize: 888900000000000000n, realizedPnl: 38463004000000000000n,
    partialHistory: false });
  expect(t.id).toBe(`0x3952:${POOL}:0x6e5a:3`);
});
test("FLIP closes one trade and opens the opposite", () => {
  const trades = reconstructTrades("0xa", [
    ch({ id: "1", kind: "OPEN", blockNumber: 1n, timestamp: 10, txHash: "0x1", sizeAfter: 338600000000000000n,
         entryPriceAfter: 2316548187673371911448n }),
    ch({ id: "2", kind: "FLIP", blockNumber: 2n, timestamp: 20, txHash: "0x2", sizeBefore: 338600000000000000n,
         sizeAfter: -2684100000000000000n, closedSize: 338600000000000000n,
         entryPriceAfter: 2316630000000000000000n, exitPrice: 2316630000000000000000n, realizedPnl: 27701653796270783n }),
  ]);
  expect(trades).toHaveLength(2);
  expect(trades[0]).toMatchObject({ side: "long", closedAt: 20, realizedPnl: 27701653796270783n });
  expect(trades[1]).toMatchObject({ side: "short", closedAt: null, openedAt: 20,
    maxSize: 2684100000000000000n, entryPrice: 2316630000000000000000n });
});
test("history starting mid-position is flagged partial", () => {
  const [t] = reconstructTrades("0xa", [ch({ id: "x", kind: "CLOSE", blockNumber: 5n, timestamp: 50, txHash: "0x5",
    sizeBefore: -53800000n, sizeAfter: 0n, closedSize: 53800000n, entryPriceBefore: 4400000000000000000n,
    exitPrice: 4500000000000000000n, realizedPnl: -236720000000000000n })]);
  expect(t).toMatchObject({ side: "short", partialHistory: true, closedAt: 50, realizedPnl: -236720000000000000n });
});
test("unordered input is sorted by block then logIndex", () => {
  expect(reconstructTrades("0x3952", [...real].reverse())[0]!.realizedPnl).toBe(38463004000000000000n);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm vitest run packages/core/test/trades.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `reconstructTrades` per the Interfaces block**

- [ ] **Step 4: Run, verify pass**

Run: `pnpm vitest run packages/core/test/trades.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "feat(core): reconstruct round-trip trades from position changes"
```

---

### Task 4: Cost attribution and net PnL

**Files:**
- Create: `packages/core/src/costs.ts`
- Test: `packages/core/test/costs.test.ts`

**Interfaces:**
- Consumes: `Trade`, `FundingPayment`, `FeeRecord`, `CostAttribution` (Task 2).
- Produces: `attributeCosts(trades: Trade[], funding: FundingPayment[], fees: FeeRecord[]): CostAttribution`.
- Rules (spec §6.3):
  - **Funding** goes to the trade on the same pool with `openedAt < ts ≤ closedAt` (open trades: `openedAt < ts`). If two trades match, the earlier-opened one wins. Unmatched rows go into `unattributedFunding` and `unattributed.funding`.
  - **Fees** are matched by `txHash ∈ trade.txHashes` and the same pool (a fee with `pool: null` matches by txHash only). The first matching trade by `openedAt` wins. Unmatched fees add to `unattributed`.
  - `netPnl = realizedPnl − funding − liquidationFee − tradingFee − builderFee`.

- [ ] **Step 1: Write failing tests**

```ts
const t = (id: string, pool: Address, openedAt: number, closedAt: number | null, txs: Hash[], pnl: bigint): Trade =>
  ({ id, pool, side: "long", openedAt, closedAt, entryPrice: 0n, exitVwap: null, maxSize: 0n, closedSize: 0n,
     realizedPnl: pnl, txHashes: txs, orderIds: [], lastChange: {} as PositionChange, partialHistory: false });
test("funding at the shared boundary goes to the closing trade", () => {
  const r = attributeCosts([t("A", "0xp", 100, 200, ["0x1"], 10n), t("B", "0xp", 200, null, ["0x2"], 0n)],
    [{ id: "f", pool: "0xp", amount: 3n, timestamp: 200, txHash: "0x9" }], []);
  expect(r.trades[0]!.costs.funding).toBe(3n);
  expect(r.trades[0]!.netPnl).toBe(7n);
  expect(r.trades[1]!.costs.funding).toBe(0n);
});
test("negative funding (received) increases net pnl", () => {
  const r = attributeCosts([t("A", "0xp", 100, 200, ["0x1"], 10n)],
    [{ id: "f", pool: "0xp", amount: -5n, timestamp: 150, txHash: "0x9" }], []);
  expect(r.trades[0]!.netPnl).toBe(15n);
});
test("liquidation fee matched by tx hash", () => {
  const r = attributeCosts([t("A", "0xp", 100, 200, ["0x1", "0xliq"], -100n)], [],
    [{ id: "x", kind: "liquidation", pool: "0xp", amount: 40n, timestamp: 200, txHash: "0xliq" }]);
  expect(r.trades[0]!.costs.liquidationFee).toBe(40n);
  expect(r.trades[0]!.netPnl).toBe(-140n);
});
test("unmatched funding is reported as unattributed", () => {
  const r = attributeCosts([], [{ id: "f", pool: "0xq", amount: 2n, timestamp: 5, txHash: "0x9" }], []);
  expect(r.unattributed.funding).toBe(2n);
  expect(r.unattributedFunding).toHaveLength(1);
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm vitest run packages/core/test/costs.test.ts` → FAIL
- [ ] **Step 3: Implement `attributeCosts`**
- [ ] **Step 4: Run, verify pass** — `pnpm vitest run packages/core/test/costs.test.ts` → PASS (4)
- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "feat(core): attribute funding and fees to trades, compute net pnl"
```

---

### Task 5: Reconciliation, cohort filter and fixture serialization

**Files:**
- Create: `packages/core/src/reconcile.ts`, `packages/core/src/cohort.ts`, `packages/core/src/fixture.ts`
- Test: `packages/core/test/reconcile.test.ts`, `packages/core/test/fixture.test.ts`

**Interfaces:**
- Consumes: `AccountHistory`, `ReconcileResult`, `MarketInfo`, `OpenPosition`, config constants (Task 2).
- Produces:
  - `expectedCollateral(h: AccountHistory): bigint`. This is the spec §6.3 identity:
    - **add:** Σ `marginEvents` with kind `Credited` or `Deposit`; Σ `marginPulls`; Σ `changes.realizedPnl`;
    - **subtract:** kind `Withdraw`; Σ `funding.amount`; Σ every `fees.amount`;
    - **ignore:** kinds `Locked`/`Unlocked`.
  - `reconcile(h: AccountHistory, actualRaw: bigint): ReconcileResult`: `ok = |actual − expected| ≤ RECONCILE_TOLERANCE_RAW`; `deltaRaw = actual − expected`.
  - `isAutomatedCohort(changeCount: number, realizedPnlRaw: bigint): boolean` = `changeCount ≤ 6 && |pnl| < 10^18`.
  - In `fixture.ts`:
    - `interface AccountFixture { account: Address; asOfBlock: bigint; asOfTimestamp: number; collateralRaw: bigint; history: AccountHistory; markets: MarketInfo[]; openPositions: OpenPosition[] }`
    - `writeFixture(f: AccountFixture): string`: pretty JSON; bigint encoded as `{"$bigint":"<decimal>"}`
    - `readFixture(json: string): AccountFixture`: reviver restores bigint

- [ ] **Step 1: Write failing tests**

```ts
// reconcile.test.ts — numbers from real account 0x3952…3951 (spec C5)
const h = (over: Partial<AccountHistory>): AccountHistory => ({ account: "0x3952", asOfTimestamp: 0, truncated: false,
  changes: [], funding: [], fees: [], marginEvents: [], marginPulls: [], liquidations: [], stopOrders: [], ...over });
test("identity matches the verified account 0x3952", () => {
  const hist = h({
    marginEvents: [{ id: "c1", kind: "Credited", amount: 2000n * 10n ** 18n, timestamp: 1 },
                   { id: "l1", kind: "Locked", amount: 999n, timestamp: 2 }],
    changes: [{ realizedPnl: -1431151600000000000000n } as PositionChange],
    funding: [{ id: "f", pool: "0xp", amount: -1464400000000000000n, timestamp: 3, txHash: "0x1" }],
    fees: [{ id: "x", kind: "liquidation", pool: "0xp", amount: 270540700000000000000n, timestamp: 4, txHash: "0x2" }],
  });
  // 2000 − 1431.1516 + 1.4644 − 270.5407 = 299.7721
  expect(expectedCollateral(hist)).toBe(299772100000000000000n);
  expect(reconcile(hist, 299772100000000000000n + 5n * 10n ** 15n).ok).toBe(true);   // within 0.01
  expect(reconcile(hist, 299772100000000000000n + 2n * 10n ** 16n).ok).toBe(false);  // 0.02 off
});
test("cohort filter", () => {
  expect(isAutomatedCohort(5, -324100000000000000n)).toBe(true);
  expect(isAutomatedCohort(7, -1n)).toBe(false);
  expect(isAutomatedCohort(5, -2n * 10n ** 18n)).toBe(false);
});
// fixture.test.ts
test("fixture round-trips bigints", () => {
  const f = { account: "0xa", asOfBlock: 32673096n, asOfTimestamp: 1, collateralRaw: -5n,
    history: h({}), markets: [], openPositions: [] } as AccountFixture;
  expect(readFixture(writeFixture(f))).toEqual(f);
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm vitest run packages/core/test/reconcile.test.ts packages/core/test/fixture.test.ts` → FAIL
- [ ] **Step 3: Implement the three modules**
- [ ] **Step 4: Run, verify pass** — same command → PASS
- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "feat(core): collateral reconciliation, cohort filter, fixture serialization"
```

---

### Task 6: Chain package — networks, indexer client, markets

**Files:**
- Create: `packages/chain/src/networks.ts`, `packages/chain/src/indexer/client.ts`, `packages/chain/src/indexer/schemas.ts`, `packages/chain/src/indexer/markets.ts`
- Modify: `packages/chain/src/index.ts`
- Test: `packages/chain/test/client.test.ts`, `packages/chain/test/markets.test.ts`

**Interfaces:**
- Consumes: core types (Task 2).
- Produces:
  - `networks.ts`: `HIDEKI` exactly as spec §7.1, plus `type Network = typeof HIDEKI`.
  - `client.ts`:
    - `class IndexerError extends Error { readonly queryName: string }`
    - `type Fetch = typeof fetch`
    - `gql<T>(args: { url: string; queryName: string; query: string; variables?: Record<string, unknown>; schema: z.ZodType<T>; fetchImpl?: Fetch }): Promise<T>`: POST JSON. Throws `IndexerError` on non-200, on a GraphQL `errors` array and on schema failure.
    - `paginateDesc<Raw, Row>(args: { url: string; queryName: string; table: string; fields: string; where: string; orderField: "timestamp" | "createdAt"; rowSchema: z.ZodType<Row, Raw>; maxRows: number; fetchImpl?: Fetch }): Promise<{ rows: Row[]; truncated: boolean }>`
  - `schemas.ts`: zod v4 schemas that turn raw indexer rows into core types. Bigint-like strings use `z.coerce.bigint()`; timestamps become `number`; addresses are lowercased. Exports `positionChangeRow`, `fundingRow`, `perpFeeRow`, `protocolFeeRow`, `builderFeeRow`, `marginEventRow`, `marginPullRow`, `liquidationRow`, `stopOrderRow`, `marketRow`.
  - `markets.ts`: `fetchPerpMarkets(indexerUrl: string, fetchImpl?: Fetch): Promise<MarketInfo[]>`. Queries `Market(where:{perpRegistered:{_eq:true}}, limit: 200){ poolAddress baseSymbol baseDecimals tickSize lotSize minQuantity stopRegistry }`.

**Algorithm for `paginateDesc`:**
1. Order by `[{<orderField>: desc}, {id: desc}]`, `limit: 1000`.
2. The keyset cursor `(t, id)` from the last row of each page adds `_or: [{<orderField>: {_lt: t}}, {<orderField>: {_eq: t}, id: {_lt: id}}]` to `where`.
3. Stop when a page has fewer than 1000 rows (`truncated: false`) or when `rows.length ≥ maxRows` (slice to `maxRows`, `truncated: true`).
4. Return the rows **reversed to ascending order**.

- [ ] **Step 1: Write failing tests (mocked `fetchImpl`)**

```ts
test("gql throws IndexerError on GraphQL errors", async () => {
  const f = vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: "boom" }] }), { status: 200 }));
  await expect(gql({ url: "u", queryName: "Q", query: "{x}", schema: z.any(), fetchImpl: f }))
    .rejects.toMatchObject({ name: "IndexerError", queryName: "Q" });
});
test("gql throws IndexerError on HTTP 502", async () => {
  const f = vi.fn(async () => new Response("bad", { status: 502 }));
  await expect(gql({ url: "u", queryName: "Q", query: "{x}", schema: z.any(), fetchImpl: f }))
    .rejects.toBeInstanceOf(IndexerError);
});
test("paginateDesc walks pages with a keyset cursor and returns ascending rows", async () => {
  // page 1: 1000 rows with ts 2000..1001; page 2: 3 rows ts 1000..998
  // assert: 2 fetch calls; second request body contains `_lt` on the last cursor;
  //         result length 1003, first row ts 998, truncated false
});
test("paginateDesc truncates at maxRows", async () => {
  // always-full pages; maxRows 1500 → rows.length 1500, truncated true, 2 fetch calls
});
test("fetchPerpMarkets maps rows", async () => {
  // one raw row {poolAddress:"0xF71B…", baseSymbol:"LINK", baseDecimals:18, tickSize:"1000", lotSize:"10",
  //   minQuantity:"100", stopRegistry:null} → { pool: "0xf71b…", symbol: "LINK", tickSize: 1000n, … }
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm vitest run packages/chain` → FAIL
- [ ] **Step 3: Implement `networks.ts`, `client.ts`, `schemas.ts`, `markets.ts`**
- [ ] **Step 4: Run, verify pass** — `pnpm vitest run packages/chain` → PASS
- [ ] **Step 5: Live check (manual, network)**

Run: `pnpm tsx -e "import {fetchPerpMarkets,HIDEKI} from './packages/chain/src/index.ts'; fetchPerpMarkets(HIDEKI.indexer).then(m=>console.log(m.length, m[0]))"`
Expected: `21` and a market object with a lowercase `pool`.

- [ ] **Step 6: Commit**

```bash
git add packages/chain && git commit -m "feat(chain): network config, indexer client with keyset pagination, markets"
```

---

### Task 7: Account history, on-chain collateral, fixture capture and golden tests

**Files:**
- Create: `packages/chain/src/indexer/history.ts`, `packages/chain/src/onchain.ts` (collateral part), `scripts/capture-fixture.ts`
- Create: `packages/core/test/fixtures/*.json` (generated), `packages/core/test/golden.test.ts`
- Test: `packages/chain/test/history.test.ts`

**Interfaces:**
- Consumes: `paginateDesc`, the row schemas, `HIDEKI` (Task 6); `AccountHistory`, `reconcile`, `readFixture`/`writeFixture` (Tasks 2 and 5).
- Produces:
  - `fetchAccountHistory(account: Address, opts: { indexerUrl: string; perpPools: ReadonlySet<Address>; maxChanges?: number /* HISTORY_MAX_CHANGES */; asOfTimestamp?: number; fetchImpl?: Fetch }): Promise<AccountHistory>`.
    - Runs 9 paginated queries in parallel:

      | Table | Filter | Maps to |
      |---|---|---|
      | `PerpPositionChange` | `account` | changes |
      | `FundingPayment` | `account` | funding |
      | `PerpFeeRecord` | `account`, all kinds | fees, kind `liquidation` |
      | `ProtocolFeeRecord` | `payer` | fees, kind `trading` |
      | `BuilderFeeRecord` | `payer` | fees, kind `builder` |
      | `MarginEvent` | `account` | marginEvents |
      | `PerpMarginPull` | `account` | marginPulls |
      | `LiquidationEvent` | `account` | liquidations |
      | `StopOrder` | `owner`, ordered by `createdAt` | stopOrders |

    - `ProtocolFeeRecord`/`BuilderFeeRecord` rows are kept only if `pool ∈ perpPools`.
    - With `asOfTimestamp`, every query adds `<orderField>: {_lte: asOfTimestamp}`.
    - `truncated` is true if any query truncated. `asOfTimestamp` defaults to `Math.floor(Date.now()/1000)`.
  - `fetchIndexerHead(indexerUrl: string, fetchImpl?: Fetch): Promise<bigint>`, from `_meta { progressBlock }`.
  - `onchain.ts`:
    - `createReadClient(network?: Network): SomniaMarketsClient`: a module-level singleton of `new SomniaMarkets({ chain: network.chain, wsRpcUrl: network.rpcWs, indexerUrl: network.indexer, addresses: network.sdkAddresses }).client`;
    - `getCollateralRaw(client: SomniaMarketsClient, marginBank: Address, account: Address): Promise<{ collateralRaw: bigint; asOfBlock: bigint; activePools: Address[] }>` = `unlockedCollateralBalance + lockedCollateral` from `client.getMarginAccount`.
  - `scripts/capture-fixture.ts <account...>` writes `packages/core/test/fixtures/<account>.json`:
    1. `getCollateralRaw` → `asOfBlock`;
    2. read that block's timestamp via the viem public client;
    3. poll `fetchIndexerHead` until `≥ asOfBlock`;
    4. `fetchAccountHistory` with `asOfTimestamp` = the block timestamp;
    5. `fetchPerpMarkets`;
    6. `openPositions: []` (filled in Task 11);
    7. `writeFixture`.

- [ ] **Step 1: Write failing unit test for history mapping**

```ts
test("fetchAccountHistory runs 9 queries, maps fee kinds, filters non-perp protocol fees", async () => {
  // fake fetch routes by queryName (in the request body) and returns one row per table;
  // ProtocolFeeRecord returns two rows: pool in perpPools and pool not in perpPools
  // assert: fees has kinds ["liquidation","trading","builder"] (non-perp trading fee dropped),
  //         changes[0].sizeAfter is a bigint, stopOrders[0].createdAt is a number, truncated false
});
test("asOfTimestamp adds an _lte filter to every query", async () => {
  // assert every captured request body contains `_lte: 1792900000`
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm vitest run packages/chain/test/history.test.ts` → FAIL
- [ ] **Step 3: Implement `history.ts` and the collateral part of `onchain.ts`**
- [ ] **Step 4: Run, verify pass** — `pnpm vitest run packages/chain/test/history.test.ts` → PASS
- [ ] **Step 5: Write the golden test**

```ts
// packages/core/test/golden.test.ts
const dir = new URL("./fixtures/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
test("at least 8 golden fixtures exist", () => expect(files.length).toBeGreaterThanOrEqual(8));
test.each(files)("reconciles %s exactly", (file) => {
  const f = readFixture(readFileSync(new URL(file, dir), "utf8"));
  const r = reconcile(f.history, f.collateralRaw);
  expect(r.ok, `delta ${r.deltaRaw}`).toBe(true);
});
```

- [ ] **Step 6: Implement `scripts/capture-fixture.ts`, then capture the 8 verified accounts**

Run:
```bash
pnpm tsx scripts/capture-fixture.ts \
  0xf1a114c1604a272ec6a1da07803fc68a786480e7 0xe4695e02a6ffc85ddd48858fd3325f2a670b1a29 \
  0x82b8c30420254b65c3049e327705882f94bf75ea 0xc985242918864200f42914bba676fdd95b75ff16 \
  0x395225eab84c1b9304d42cb647238dcc90003951 0x1d78dee0329baba38bc11d42e7e5543854e6207d \
  0x5ce801abdca4ddfea9be1735b60b394e9ebe4872 0x31b0480ff2ec5d0a4d9480a9f8c8802897c08281
```
Expected: 8 files under `packages/core/test/fixtures/`.

- [ ] **Step 7: Run golden tests**

Run: `pnpm vitest run packages/core/test/golden.test.ts`
Expected: PASS for all 8.
If one fails, re-capture that account once (it may have traded mid-capture). If it still fails, stop and investigate. **Do not loosen the tolerance.**

- [ ] **Step 8: Capture ≥ 12 more random accounts**

Take accounts from the indexer's recent `PerpPositionChange` that have 10–2,000 changes. Capture them and re-run the golden tests.
Expected: ≥ 20 fixtures, all PASS (spec acceptance criterion 2).

- [ ] **Step 9: Commit**

```bash
git add packages scripts && git commit -m "feat: account history fetch, collateral read, golden reconciliation fixtures"
```

---

### Task 8: Exit type, stop coverage and trade enrichment

**Files:**
- Create: `packages/core/src/exit-type.ts`, `packages/core/src/coverage.ts`, `packages/core/src/enrich.ts`
- Test: `packages/core/test/exit-type.test.ts`, `packages/core/test/coverage.test.ts`, `packages/core/test/enrich.test.ts`

**Interfaces:**
- Consumes: `Trade`, `CostAttribution`, `AccountHistory`, `MarketInfo`, `notionalRaw`, `shortAddress`.
- Produces:
  - `classifyExit(trade: Trade, liquidations: LiquidationRecord[], stopOrders: StopOrderRecord[], perplogStopTxs: ReadonlySet<string>): ExitType`. Priority per spec §6.4, using `trade.lastChange.txHash` and `trade.lastChange.orderId`. Open trades → `"OPEN"`.
  - `isStopLossFor(side: Side, s: StopOrderRecord): boolean`: long → `!s.isBid && s.triggerOperator === 1` (LTE); short → `s.isBid && s.triggerOperator === 0` (GTE).
  - `tradeHadStop(trade: Trade, stopOrders: StopOrderRecord[], nowSec: number): boolean`. True if some stop-loss for the trade's side on the same pool overlapped the trade: `createdAt ≤ (closedAt ?? nowSec)` **and** `(status === "PENDING" || updatedAt ≥ openedAt)`.
  - `stopCoverageBps(side: Side, sizeRaw: bigint, pool: Address, stopOrders: StopOrderRecord[]): number`. Sums PENDING stop-loss quantities on that pool; `quantity == 0n` means the whole position (10000); capped at 10000; 0 when the size is 0.
  - `enrichTrades(attr: CostAttribution, history: AccountHistory, markets: ReadonlyMap<Address, MarketInfo>, nowSec: number, perplogStopTxs?: ReadonlySet<string>): EnrichedTrade[]`.
    - `symbol`: the market symbol, or `shortAddress(pool)` when the pool is unknown.
    - `maxNotional`: `notionalRaw(maxSize, entryPrice, baseDecimals)`, or `0n` when the pool is unknown.

- [ ] **Step 1: Write failing tests**

```ts
test("liquidation tx wins over a triggered stop", () => { /* lastChange.txHash in liquidations & orderId in stop → "LIQUIDATED" */ });
test("triggered stop matched by placedOrderId → NATIVE_STOP", () => { /* status TRIGGERED, placedOrderId === lastChange.orderId */ });
test("perplog stop tx → PERPLOG_STOP; otherwise MANUAL; open → OPEN", () => { /* three asserts */ });
test("stop cancelled before the trade opened does not count", () => {
  // trade 100..200; stop created 50, CANCELLED, updatedAt 90 → false; updatedAt 150 → true
});
test("a take-profit is not a stop-loss", () => { /* long trade, stop !isBid with triggerOperator 0 → false */ });
test("coverage: whole-position stop is 100%, partial sums, capped", () => {
  // long size 1000; stops qty 0 → 10000; stops 300 + 200 → 5000; 800 + 800 → 10000
});
test("enrich falls back for unknown pools", () => {
  // trade on a pool not in markets → symbol "0x1234…abcd", maxNotional 0n
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm vitest run packages/core/test/exit-type.test.ts packages/core/test/coverage.test.ts packages/core/test/enrich.test.ts` → FAIL
- [ ] **Step 3: Implement the three modules**
- [ ] **Step 4: Run, verify pass** — same command → PASS
- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "feat(core): exit classification, stop-loss coverage, trade enrichment"
```

---

### Task 9: Leaks

**Files:**
- Create: `packages/core/src/leaks.ts`
- Test: `packages/core/test/leaks.test.ts`

**Interfaces:**
- Consumes: `EnrichedTrade`, `Leak`, `FundingPayment`, config constants, `ratioBps`.
- Produces: `computeLeaks(trades: EnrichedTrade[], unattributedFunding: FundingPayment[]): Leak[]`. Input trades are already range-filtered (closed only); unattributed funding is range-filtered too.
  - `totalLoss` = Σ |netPnl| of trades with `netPnl < 0`.
  - `shareOfLossBps = ratioBps(amountRaw, totalLoss)`.
  - Drop leaks with `amountRaw ≤ 0n`; sort by `amountRaw` descending.
- Titles are exact copy:

| id | title | amountRaw | evidence | fix |
|---|---|---|---|---|
| `LIQUIDATION_COST` | `Liquidations` | Σ over `exitType === "LIQUIDATED"` of `liquidationFee + max(0, −realizedPnl)` | those trade ids | `PROTECT_NOW` |
| `NO_STOP_LOSSES` | `Losses on trades without a stop-loss` | Σ \|netPnl\| over `!hadStop && netPnl < 0` | those ids | `ALWAYS_PROTECT` |
| `FUNDING_DRAG` | `Funding you paid` | Σ `costs.funding` (positive part per trade) + Σ positive unattributed funding | trades with `costs.funding > 0` | `SHOW_FUNDING` |
| `SIZE_UP_AFTER_LOSS` | `Sizing up right after a loss` | Σ \|netPnl\| over "tilt" trades with `netPnl < 0` | tilt trade ids (all, winning or losing) | `FIXED_RISK` |

- **Tilt trade:** one with `maxNotional > 0n`, opened within `TILT_WINDOW_SEC` after the `closedAt` of the most recent earlier-closed losing trade (any pool), with `maxNotional * TILT_MULTIPLE_DEN ≥ median * TILT_MULTIPLE_NUM`. `median` is the lower median of the non-zero `maxNotional` values.

- [ ] **Step 1: Write failing tests**

```ts
test("liquidation leak sums fee and realized loss", () => { /* one LIQUIDATED trade: fee 40, realized −100 → 140 */ });
test("no-stop leak ignores winning trades and trades with a stop", () => { /* … */ });
test("funding leak includes positive unattributed funding only", () => { /* trade funding 5, unattributed [+3, −2] → 8 */ });
test("tilt: oversized trade 10 min after a loss is flagged; 40 min after is not", () => {
  // notionals 100,100,100 (median 100); losing trade closes at t=1000;
  // trade X opens t=1600 with notional 150 → flagged; trade Y opens t=3500 with notional 300 → not flagged
});
test("unknown-market trades (maxNotional 0) never count as tilt", () => { /* … */ });
test("leaks sorted by amount desc and zero leaks omitted; share uses total loss", () => {
  // total loss 200, liquidation leak 140 → shareOfLossBps 7000
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm vitest run packages/core/test/leaks.test.ts` → FAIL
- [ ] **Step 3: Implement `computeLeaks`**
- [ ] **Step 4: Run, verify pass** — `pnpm vitest run packages/core/test/leaks.test.ts` → PASS
- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "feat(core): deterministic leak rules L1-L4"
```

---

### Task 10: Range filter and health summary

**Files:**
- Create: `packages/core/src/summary.ts`
- Test: `packages/core/test/summary.test.ts`

**Interfaces:**
- Consumes: `EnrichedTrade`, `FundingPayment`, `ReconcileResult`, `computeLeaks`.
- Produces:
  - `rangeStart(range: Range, nowSec: number): number`: `7d → now − 7·86400`, `30d → now − 30·86400`, `all → 0`.
  - `filterRange(trades: EnrichedTrade[], range: Range, nowSec: number): EnrichedTrade[]`: closed trades with `closedAt ≥ rangeStart`.
  - `filterFundingRange(rows: FundingPayment[], range: Range, nowSec: number): FundingPayment[]`.
  - `buildHealthSummary(args: { trades: EnrichedTrade[] /* all, unfiltered */; unattributedFunding: FundingPayment[]; range: Range; nowSec: number; reconcile: ReconcileResult | null }): HealthSummary`:
    - `tradeCount` = number of closed trades in range; `openTradeCount` = all trades with `closedAt === null`;
    - `netPnlRaw` = Σ netPnl(range) − Σ unattributed funding(range);
    - `realizedPnlRaw` = Σ realizedPnl(range);
    - `fundingPaidRaw` = Σ costs.funding(range) + Σ unattributed funding(range);
    - `liquidationCostRaw` = the amount of the `LIQUIDATION_COST` leak, or `0n`;
    - `tradesWithoutStopPct` and `winRatePct` are `Math.round(100 × count / tradeCount)` (0 when no trades);
    - `topLeak` = the first leak or `null`.

- [ ] **Step 1: Write failing tests**

```ts
test("trade closed 8 days ago is excluded from 7d but included in 30d", () => { /* … */ });
test("open trades are counted separately and excluded from net pnl", () => { /* … */ });
test("net pnl subtracts unattributed funding inside the range only", () => { /* … */ });
test("percentages round and are 0 with no trades", () => {
  // 3 trades, 1 without stop → 33; 2 winners → 67; empty → 0 and 0
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm vitest run packages/core/test/summary.test.ts` → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, verify pass** — `pnpm vitest run packages/core` → all PASS
- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "feat(core): range filtering and health summary"
```

---

### Task 11: Open positions (on-chain)

**Files:**
- Modify: `packages/chain/src/onchain.ts`, `scripts/capture-fixture.ts` (store `openPositions`)
- Test: `packages/chain/test/positions.test.ts`

**Interfaces:**
- Consumes: `createReadClient`, `getCollateralRaw` (Task 7); `stopCoverageBps` (Task 8); `MarketInfo`, `OpenPosition`.
- Produces: `getOpenPositions(args: { client: Pick<SomniaMarketsClient, "getPerpPosition" | "getPerpState" | "getLiquidationPrice">; marginBank: Address; account: Address; activePools: Address[]; markets: ReadonlyMap<Address, MarketInfo>; stopOrders: StopOrderRecord[]; funding: FundingPayment[]; nowSec: number }): Promise<OpenPosition[]>`. For each active pool, in parallel:
  - `ref = { marginBank, account, pool }`;
  - `size`/`entry` from `getPerpPosition(ref)` (`size` is signed); skip if `size === 0n`;
  - `mark` from `perpMarkForPnl(await getPerpState(pool))`; `markFromIndex = fromIndex`;
  - `liquidationPrice = await getLiquidationPrice(ref)`;
  - `liqDistanceBps = ratioBps(|mark − liq|, mark)`, or `null` when there is no liquidation price;
  - `unrealizedPnlRaw = (mark − entry) * size / 10^baseDecimals`. The sign is natural because size is signed;
  - `stopCoverageBps` via Task 8;
  - `fundingLast24hRaw` = Σ funding on that pool with `timestamp ≥ nowSec − 86400`;
  - unknown pool → symbol `shortAddress(pool)`, `baseDecimals = 18`.
- `getLiquidationPrice` failures resolve to `null`; they must not fail the whole call.

- [ ] **Step 1: Write failing tests (fake client)**

```ts
test("short position: unrealized pnl positive when mark below entry", async () => {
  // size −2_000_000_000_000_000_000n (18 dec), entry 2500e18, mark 2400e18 → unrealized +200e18
});
test("flat pools are skipped and liquidation price errors become null", async () => { /* … */ });
test("liqDistanceBps from mark and liquidation price", async () => { /* mark 100e18, liq 90e18 → 1000 */ });
```

- [ ] **Step 2: Run, verify fail** — `pnpm vitest run packages/chain/test/positions.test.ts` → FAIL
- [ ] **Step 3: Implement `getOpenPositions`; extend `capture-fixture.ts` to store `openPositions`**
- [ ] **Step 4: Run, verify pass** — `pnpm vitest run packages/chain` → PASS
- [ ] **Step 5: Live check (manual)**

Run the capture script for `0xf1a114c1604a272ec6a1da07803fc68a786480e7` (5 active pools at research time).
Expected: `openPositions` is non-empty, each entry has a non-zero `markPrice`.

- [ ] **Step 6: Commit**

```bash
git add packages scripts && git commit -m "feat(chain): open positions with mark, liquidation distance, coverage, funding"
```

---

### Task 12: Account service and API routes (web app bootstrap)

**Files:**
- Create the app: `pnpm dlx create-next-app@16.4.3 apps/web --typescript --tailwind --app --no-src-dir --no-eslint --import-alias "@/*" --use-pnpm --yes` (delete any nested `.git`)
- Modify: `apps/web/package.json` (name `@perplog/web`; deps `@perplog/core`, `@perplog/chain` as `workspace:*`, `lru-cache@^11`, `zod@^4`; script `"typecheck": "tsc --noEmit"`)
- Modify: `apps/web/next.config.ts` (`transpilePackages: ["@perplog/core", "@perplog/chain"]`, `serverExternalPackages: ["@somnia-chain/markets-sdk"]`)
- Modify: root `vitest.config.ts` (add `"apps/web"` project with node environment)
- Create: `apps/web/lib/account-service.ts`, `apps/web/lib/service.ts`, `apps/web/lib/json.ts`
- Create: `apps/web/app/api/accounts/[address]/{health,trades,leaks,positions}/route.ts`
- Test: `apps/web/lib/account-service.test.ts`, `apps/web/app/api/accounts/routes.test.ts`

**Interfaces:**
- Consumes: everything in core; `fetchPerpMarkets`, `fetchAccountHistory`, `createReadClient`, `getCollateralRaw`, `getOpenPositions`, `HIDEKI`, `IndexerError` (chain); `readFixture`.
- Produces:

```ts
// apps/web/lib/account-service.ts
export interface AccountData { account: Address; markets: Map<Address, MarketInfo>; history: AccountHistory;
  collateralRaw: bigint | null; activePools: Address[]; attribution: CostAttribution; trades: EnrichedTrade[];
  reconcile: ReconcileResult | null; asOfTimestamp: number; empty: boolean }
export interface AccountServiceDeps {
  fetchMarkets(): Promise<MarketInfo[]>;
  fetchHistory(account: Address, perpPools: ReadonlySet<Address>): Promise<AccountHistory>;
  fetchCollateral(account: Address): Promise<{ collateralRaw: bigint; activePools: Address[] }>;
  fetchOpenPositions(account: Address, data: AccountData): Promise<OpenPosition[]>;
  now(): number;  // unix seconds
}
export type HealthResponse = HealthSummary & { empty: boolean; truncated: boolean; asOfTimestamp: number };
export interface TradesQuery { range: Range; market?: Address; exit?: ExitType; side?: Side; cursor?: string; limit?: number }
export function createAccountService(deps: AccountServiceDeps, cacheTtlMs?: number /* 60_000 */): {
  getAccountData(a: Address): Promise<AccountData>;
  getHealth(a: Address, range: Range): Promise<HealthResponse>;
  getTrades(a: Address, q: TradesQuery): Promise<{ trades: EnrichedTrade[]; nextCursor: string | null }>;
  getLeaks(a: Address, range: Range): Promise<Leak[]>;
  getPositions(a: Address): Promise<OpenPosition[]>;
};
```

- **`getAccountData` rules:**
  - markets are cached for 10 minutes;
  - `empty = history.changes.length === 0`;
  - `reconcile = history.truncated ? null : reconcile(history, collateralRaw)`;
  - trades = `enrichTrades(attributeCosts(reconstructTrades(...)))`;
  - the result is cached per account in an LRU (max 500 entries, `cacheTtlMs`); concurrent calls for the same account share one in-flight promise.
- **`getTrades`:**
  - `range` filters closed trades by `closedAt`; open trades are always included when `range = "all"`;
  - sort by `(closedAt ?? ∞)` descending; `limit` defaults to 50 (max 200);
  - `cursor` is the stringified offset; `nextCursor` is `null` at the end.
- **`lib/service.ts`:** the default instance.
  - If `process.env.PERPLOG_FIXTURE_DIR` is set, deps read `<dir>/<account>.json` via `readFixture`; an unknown account behaves like an empty history; `now()` = the fixture's `asOfTimestamp`.
  - Otherwise deps use `@perplog/chain` with `HIDEKI`.
- **`lib/json.ts`:**
  - `json(data: unknown, init?: ResponseInit): Response` serializes bigint as a decimal string;
  - `handleRoute(fn: () => Promise<Response>): Promise<Response>` maps `IndexerError` → 503 `{"error":"indexer_unavailable"}` and anything else → 500 `{"error":"internal"}` (logs the error).
- **Routes:**
  - `GET` only, `export const dynamic = "force-dynamic"`;
  - the address param goes through `normalizeAddress`; invalid → 400 `{"error":"invalid_address"}`;
  - `range` is zod-validated (`7d | 30d | all`, default `7d`); `trades` also validates `market`, `exit`, `side`, `cursor`, `limit`.

- [ ] **Step 1: Write failing service tests (fake deps)**

```ts
test("empty history → empty true, zero summary, no throw", async () => { /* … */ });
test("truncated history → reconcile null", async () => { /* … */ });
test("results are cached for the TTL and concurrent calls share one fetch", async () => {
  // two parallel getHealth calls → fetchHistory called once; after advancing fake time 61s → called again
});
test("getTrades paginates with cursor and filters by exit type", async () => { /* … */ });
```

- [ ] **Step 2: Write failing route tests (call the exported `GET` with a `Request` and params)**

```ts
test("health 400 on invalid address", async () => { /* status 400, body {error:"invalid_address"} */ });
test("health 503 when the indexer throws IndexerError", async () => { /* status 503, {error:"indexer_unavailable"} */ });
test("bigints serialize as strings", async () => { /* body.netPnlRaw is a string like "-796800000000000000000" */ });
test("mixed-case address with whitespace is accepted", async () => { /* 200 */ });
```
The route tests inject the service with `vi.mock("@/lib/service")`.

- [ ] **Step 3: Run, verify fail** — `pnpm vitest run apps/web` → FAIL
- [ ] **Step 4: Implement the service, `json.ts`, `service.ts` and the four routes**
- [ ] **Step 5: Run, verify pass** — `pnpm vitest run apps/web && pnpm typecheck` → PASS
- [ ] **Step 6: Live check**

Run: `pnpm --filter @perplog/web dev`, then `curl -s localhost:3000/api/accounts/0x31b0480ff2ec5d0a4d9480a9f8c8802897c08281/health | head -c 400`
Expected: JSON with `reconcile.ok` and string bigints.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(web): account service with cache and read-only API routes"
```

---

### Task 13: App shell, landing page and Health tab

**Files:**
- Setup: `cd apps/web && pnpm dlx shadcn@4.22.1 init --defaults`, then `pnpm dlx shadcn@4.22.1 add card tabs badge button input table skeleton tooltip select`
- Add deps: `@tanstack/react-query@^5`
- Create: `apps/web/app/providers.tsx`, `apps/web/lib/format.ts`, `apps/web/components/{address-form,reconcile-badge,health-panel,empty-state,error-state}.tsx`, `apps/web/app/a/[address]/page.tsx`
- Modify: `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`
- Create: `apps/web/data/platform-stats.json` (placeholder values, generated in Task 16)
- Test: `apps/web/playwright.config.ts`, `apps/web/e2e/health.spec.ts`

**Interfaces:**
- Consumes: the API routes (Task 12); `formatUsd`, `shortAddress` (core); fixture mode (`PERPLOG_FIXTURE_DIR`).
- Produces:
  - `lib/format.ts`: `fromApiBigint(s: string): bigint`, `pct(n: number): string`.
  - Components:
    - `<AddressForm />`: validates with `normalizeAddress` and navigates to `/a/<addr>`; invalid input shows `Enter a valid 0x address`.
    - `<ReconcileBadge reconcile={…} truncated={…} />`. Copy is exact: `✓ Reconciled with chain`; `⚠ Unreconciled (delta {formatUsd})`; `Not reconciled: history truncated`.
    - `<HealthPanel address range />`: range switcher `7D | 30D | All`; stat cards `Net PnL`, `Realized PnL`, `Funding paid`, `Liquidation cost`, `Trades without stop-loss`, `Win rate`; the top-leak callout (`data-testid="top-leak"`); and a footer `Data as of {local time of asOfTimestamp}` (spec C15).
    - `<EmptyState />`. Exact copy: `No perps activity for this address. Paste the dreamDEX trading account address shown in the app (not your login wallet).`
    - `<ErrorState onRetry />`. Exact copy: `The dreamDEX indexer is not responding.` plus a `Retry` button.
  - Page `/a/[address]` has tabs `Health | Journal | Leaks | Positions`; the selected tab is in `?tab=`.
  - The landing page renders `AddressForm`, the 3 stats from `data/platform-stats.json` and the tagline `Your true perps PnL on dreamDEX — after funding and liquidation fees.`

- [ ] **Step 1: Write the failing e2e test (fixture mode)**

```ts
// apps/web/e2e/health.spec.ts — playwright webServer: `PERPLOG_FIXTURE_DIR=../../packages/core/test/fixtures pnpm dev`
test("liquidated account shows reconciled badge and liquidation as top leak", async ({ page }) => {
  await page.goto("/a/0x395225eab84c1b9304d42cb647238dcc90003951?range=all");
  await expect(page.getByText("✓ Reconciled with chain")).toBeVisible();
  await expect(page.getByTestId("top-leak")).toContainText("Liquidations");
});
test("unknown address shows empty state", async ({ page }) => {
  await page.goto("/a/0x000000000000000000000000000000000000dead");
  await expect(page.getByText("No perps activity for this address.")).toBeVisible();
});
test("landing form rejects bad input and navigates on valid input", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox").fill("hello");
  await page.getByRole("button", { name: "Analyze" }).click();
  await expect(page.getByText("Enter a valid 0x address")).toBeVisible();
  await page.getByRole("textbox").fill(" 0x31B0480FF2EC5D0A4D9480A9F8C8802897C08281 ");
  await page.getByRole("button", { name: "Analyze" }).click();
  await expect(page).toHaveURL(/\/a\/0x31b0480ff2ec5d0a4d9480a9f8c8802897c08281/);
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @perplog/web exec playwright test e2e/health.spec.ts` → FAIL
- [ ] **Step 3: Implement providers, components, landing and the account page (Health tab)**
- [ ] **Step 4: Run, verify pass** — same command → PASS (3)
- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "feat(web): landing, account page shell and health tab"
```

---

### Task 14: Journal and Leaks tabs

**Files:**
- Create: `apps/web/components/{trade-card,journal-panel,leak-card,leaks-panel}.tsx`
- Modify: `apps/web/app/a/[address]/page.tsx`
- Test: `apps/web/e2e/journal-leaks.spec.ts`

**Interfaces:**
- Consumes: `/api/accounts/:addr/trades` and `/leaks` (Task 12); `HIDEKI.explorerTx` (chain, imported client-side as a plain function).
- Produces:
  - `<TradeCard trade />`. Shows:
    - symbol, side badge (`Long`/`Short`), opened/closed time (local), entry → exit VWAP, max size;
    - `Realized`, `Funding`, `Liquidation fee`, `Net` (net in bold, green/red);
    - an exit badge: `Liquidated` / `Stop-loss (dreamDEX)` / `Stop-loss (PerpLog)` / `Manual` / `Open`;
    - `No stop-loss` badge when `!hadStop`;
    - a link `View tx` to the explorer for `lastChange.txHash`.
  - `<JournalPanel address />`: filters for market (select from the trades' symbols), exit type and side; a "Load more" button driven by `nextCursor`.
  - `<LeakCard leak />`: title, `formatUsd(amountRaw)`, `{share}% of your losses`, evidence count with "Show trades" expanding the matching trade cards, and a `Fix` button.
    - `PROTECT_NOW`/`ALWAYS_PROTECT` go to `?tab=positions` and show the note `One-click protection is coming in the next release.`
    - `SHOW_FUNDING` goes to positions.
    - `FIXED_RISK` shows the note `Risk-sized entries (Plan & Place) are coming in the next release.`
  - `<LeaksPanel address range />`: list of leaks, or `No leaks found in this period.`

- [ ] **Step 1: Write the failing e2e test (fixture mode)**

```ts
test("journal shows liquidated trade with explorer link and filters by exit", async ({ page }) => {
  await page.goto("/a/0x395225eab84c1b9304d42cb647238dcc90003951?tab=journal&range=all");
  await page.getByLabel("Exit").selectOption("LIQUIDATED");
  const card = page.getByTestId("trade-card").first();
  await expect(card).toContainText("Liquidated");
  await expect(card.getByRole("link", { name: "View tx" }))
    .toHaveAttribute("href", /explorer\.testnet\.somnia\.network\/tokyo\/tx\/0x/);
});
test("leaks tab lists liquidations first with share of losses", async ({ page }) => {
  await page.goto("/a/0x395225eab84c1b9304d42cb647238dcc90003951?tab=leaks&range=all");
  await expect(page.getByTestId("leak-card").first()).toContainText("Liquidations");
  await expect(page.getByTestId("leak-card").first()).toContainText("% of your losses");
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @perplog/web exec playwright test e2e/journal-leaks.spec.ts` → FAIL
- [ ] **Step 3: Implement the components and wire the tabs**
- [ ] **Step 4: Run, verify pass** — same command → PASS
- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "feat(web): journal and leaks tabs"
```

---

### Task 15: Positions tab and equity chart

**Files:**
- Add deps: `recharts@^3`
- Create: `apps/web/components/{positions-panel,equity-chart}.tsx`
- Modify: `apps/web/components/health-panel.tsx` (embed the chart), `apps/web/app/a/[address]/page.tsx`
- Test: `apps/web/e2e/positions.spec.ts`

**Interfaces:**
- Consumes: `/api/accounts/:addr/positions` and `/trades?range=…` (Task 12).
- Produces:
  - `<PositionsPanel address />`: refetches every 5s. Table columns:
    - `Market`, `Side`, `Size`, `Entry`, `Mark` (`index` tag when `markFromIndex`), `Unrealized PnL`;
    - `Liq. price`, `Distance` (a bar that turns red below `LIQ_DISTANCE_WARN_BPS`);
    - `Stop-loss coverage` (`None` / `{n}%` / `Full`), `Funding (24h)`.
    - Empty: `No open positions.`
    - Footer note: `Protect buttons arrive in the next release.`
  - `<EquityChart trades />`: a cumulative net PnL line over closed trades in the selected range, x = `closedAt`. Numbers are converted to `number` **only for plotting**, via `Number(formatUnits(raw, 18))`.

- [ ] **Step 1: Write the failing e2e test**

Fixture mode, account `0xf1a114c1604a272ec6a1da07803fc68a786480e7` (fixture captured with open positions in Task 11):
```ts
test("positions tab lists open positions with coverage and distance", async ({ page }) => {
  await page.goto("/a/0xf1a114c1604a272ec6a1da07803fc68a786480e7?tab=positions");
  await expect(page.getByTestId("position-row").first()).toBeVisible();
  await expect(page.getByTestId("position-row").first()).toContainText(/None|%|Full/);
});
test("health tab renders the equity chart", async ({ page }) => {
  await page.goto("/a/0x31b0480ff2ec5d0a4d9480a9f8c8802897c08281?range=all");
  await expect(page.getByTestId("equity-chart")).toBeVisible();
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @perplog/web exec playwright test e2e/positions.spec.ts` → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, verify pass** — same command → PASS
- [ ] **Step 5: Commit**

```bash
git add apps/web && git commit -m "feat(web): positions tab and net equity chart"
```

---

### Task 16: Platform stats, README and deploy config

**Files:**
- Create: `scripts/platform-stats.ts`, `README.md`, `apps/web/vercel.json` (not needed if defaults work; create only if the build requires it)
- Modify: `apps/web/data/platform-stats.json` (generated)
- Test: `packages/core/test/platform-stats.test.ts` (for the pure aggregation helper)

**Interfaces:**
- Consumes: `paginateDesc`, the row schemas, `HIDEKI` (chain); `isAutomatedCohort`, `isStopLossFor` (core).
- Produces:
  - In `packages/core/src/platform.ts`: `computeNoStopStats(changes: PositionChange[], stops: StopOrderRecord[], accountOf: (c: PositionChange) => Address): { newPositions: number; accounts: number; withStopPct: number }`.
    - Excludes cohort accounts: count ≤ 6 and |Σ realized| < 1 USDso, computed within the window.
    - An OPEN "has a stop" if a stop on the same (account, pool) was created between `ts − 60` and `ts + 600`.
    - **Note:** `PositionChange` has no account field, so the script passes `accountOf`.
  - `scripts/platform-stats.ts` writes `apps/web/data/platform-stats.json`:

    ```
    { generatedAt, windowHours, newPositions, realTraders, noStopPct,
      liquidationFees7dRaw, liquidatedAccounts7d, method }
    ```

    - Sources: the latest ≤ 60,000 `PerpPositionChange` rows (with `account`); `StopOrder` rows from the window start − 1h; `PerpFeeRecord` with kind `LiquidationFee` over 7 days.
    - `method` is a one-paragraph plain-English methodology (cohort exclusion, windows).
  - `README.md` sections, in order:
    1. `What it is`
    2. `Who it is for`
    3. `How it works` (link to the spec)
    4. `Run locally` (`corepack enable && pnpm install && pnpm --filter @perplog/web dev`, plus fixture mode)
    5. `Tests` (`pnpm test`, golden reconciliation)
    6. `Judges start here` (placeholder list: live URL, sample accounts, evidence page in Plan 3)
    7. `X posts` (placeholder, filled in Plan 3)
    8. `Data sources & methodology`
    9. `License` (MIT)

- [ ] **Step 1: Write failing test for `computeNoStopStats`**

```ts
test("cohort accounts are excluded and the stop window is −60s..+600s", () => {
  // account A: 3 OPENs, one with a stop created ts+300, one with a stop created ts+900 (outside) → 1/3
  // account B: 1 OPEN, realized −0.3 USDso total, 2 changes → excluded as cohort
  // expect { newPositions: 3, accounts: 1, withStopPct: 33 }
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm vitest run packages/core/test/platform-stats.test.ts` → FAIL
- [ ] **Step 3: Implement `platform.ts` and `scripts/platform-stats.ts`; run the script**

Run: `pnpm tsx scripts/platform-stats.ts`
Expected: `apps/web/data/platform-stats.json` updated with today's `generatedAt` and `noStopPct` within 10 points of the spec's E1 (≈ 79% without a stop).

- [ ] **Step 4: Write `README.md`**
- [ ] **Step 5: Full verification**

Run:
```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @perplog/web build && pnpm --filter @perplog/web exec playwright test
```
Expected: all pass, and the Next build succeeds.

- [ ] **Step 6: Deploy preview (only when the user has provided a Vercel account)**

Run: `cd apps/web && vercel deploy` (root directory `apps/web`, install command `pnpm install` at the repo root).
Expected: a preview URL whose `/a/0x31b0480ff2ec5d0a4d9480a9f8c8802897c08281` shows a reconciliation badge.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: platform stats, README, deploy-ready build"
```
