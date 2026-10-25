# PerpLog — Detailed Design

- **Date:** 2026-10-25
- **Status:** Approved for build (v1.1, English)
- **Context:** dreamDEX Perps Builder Bounty (DoraHacks), MVP track. Submissions close 2026-11-01 23:59 UTC
- **Network:** Somnia Tokyo testnet ("Hideki" in the SDK), chain ID `50383`

---

## 0. One-paragraph summary

PerpLog is a **true-net-PnL trade journal** for dreamDEX perps traders, with **one-click fixes that place real orders**.

Paste an address and you see three things:
- net PnL after funding and liquidation fees, reconciled to the on-chain balance;
- the "leaks" that are costing the trader money;
- the trader's open positions and how well they are protected.

From there the trader can:
- **Protect Now**: attach a stop-loss to an open position;
- **Plan & Place**: enter a trade sized by risk, with its stop attached;
- get **real-time alerts** through Somnia Reactivity when a position opens without a stop;
- share a **weekly report** on X.

---

## 1. Why: evidence

All numbers below were measured on Hideki on 2026-10-25. The scripts and data are listed in §15.

| # | Observation | Number | Source |
|---|---|---|---|
| E1 | Traders open positions without a stop | 79% of new positions had no stop within 10 min (834 positions, 343 real traders, ~9h window) | `PerpPositionChange` OPEN vs `StopOrder.createdAt` |
| E2 | Liquidations are expensive | 147,079 USDso of liquidation fees in 7 days across 571 accounts (~258 USDso per account, against a 1,000 USDso weekly paper credit) | `PerpFeeRecord` kind=LiquidationFee |
| E3 | Most real traders are losing | 256 losing vs 137 winning out of 406 real traders (~9h window) | Σ `realizedPnl` |
| E4 | Official "realized PnL" hides costs | realized −609.7 but net −796.8 (funding 187.1); realized −1,431.2 but net −1,700.2 (liquidation fees 270.5) | Reconciliation identity, §6.3 |
| E5 | The official PnL tooling is buggy | `fetchPositions` dates positions 1970; `fetchBalance` omits perps; order history loses the original size; the explorer shows size 0 | 5+ Feedback-track reports |
| E6 | No competitor in this niche | 0 of ~40 public MVP repos build a journal or net PnL | GitHub scan, 2026-10-25 |

**Methodology note:** the window contains ~3,327 accounts from an automated-looking cohort (≤ 6 position changes and |realized PnL| < 1 USDso). They are **excluded** from E1 and E3. PerpLog applies the same filter to every platform-wide statistic.

---

## 2. Goals, non-goals and anti-goals

### Goals
1. **Trustworthy net PnL.** Every PnL figure reconciles to the on-chain balance (§6.3), and the UI shows the reconciliation status.
2. **Data → action.** Every detected leak has a fix button, and the fix produces a **real order** on dreamDEX.
3. **Meet the bounty's hard requirements:**
   - real perps orders on Tokyo testnet;
   - README covering what it is, who it is for and how to run it;
   - an "X posts" section.
4. **Mainnet-ready.** Network config is isolated, so once perps launch on mainnet, Plan & Place places real orders there (the condition for the $200 second payout).

### Non-goals (not in the MVP)
Mobile app, Telegram bot, AI chat, tax CSV export, copy trading, auto-trading strategies, multi-account/teams, builder fees (roadmap).

### Anti-goals (failure even if it "works")
- **Never custody user funds.** PerpLog's bot key can only place, cancel and reduce orders; the protocol forbids withdrawals.
- **Never increase exposure** unless the user confirmed a specific Plan.
- **Never close more than the current position size.** dreamDEX has no reduce-only flag, so an oversized close flips the position.
- **Never show an unreconciled PnL number** without a warning label.
- No gamification fluff.

---

## 3. Verified technical constraints (2026-10-25)

| # | Constraint | How it was verified | Design consequence |
|---|---|---|---|
| C1 | App users trade from a **Safe smart account**. On Hideki its only owner is an **app-held key**; the user's login EOA is an owner on Shannon only | 40/40 active accounts are single-owner Safes; 20/20 have Hideki owners ⊂ Shannon owners | PerpLog **cannot** get an "account owner" signature on Hideki |
| C2 | `PerpStopRegistry.createPendingOrder` sent by a linked bot reverts `InvalidOrderOwner()`; sent by the account itself, it succeeds | `eth_call` simulation on 2 real accounts (ETH, BNB) | **No exchange-native stops** for app users. Use **bot-held stops** |
| C3 | A linked bot can call `placeOrderFor` (0x80054449), `cancelOrderFor` (0xe37b444b) and `reduceOrderFor` (0x364c2587) for the account | Selectors of real bot transactions; bot-kit `perp-core/src/operator.ts` | All PerpLog writes go through `placeOrderFor` |
| C4 | SDK 0.32.1 has **no** perp `…For` writes | Stated in bot-kit source | Send them with viem using the ABI in §7.4 |
| C5 | The PnL identity (§6.3) reconciled exactly on 8/8 real accounts. `FundingPayment.amount > 0` means the trader **paid** | Compared with `client.getMarginAccount` | The PnL engine uses exactly this identity |
| C6 | Perps trading fees are 0 on testnet (`ProtocolFeeRecord`/`BuilderFeeRecord` empty for sampled accounts) | Indexer queries | Keep the fee terms for mainnet |
| C7 | `MarginBank` (`0x4787…1394`) emits `PositionUpdated` and `FundingSettled`. The observed `MarkPriceUpdated` logs do **not** come from perp markets | `eth_getLogs` over the last ≤6k blocks | Reactivity listens to `PositionUpdated`; mark price comes from polling `client.getPerpState(pool)` |
| C8 | The Hideki RPC caps `eth_getLogs` at 1,000 blocks and refuses historical `eth_call` | Feedback reports, reproduced | History comes **only from the indexer** |
| C9 | IOC orders can partially fill and still report success; fills must be decoded from the receipt | Feedback reports; bot-kit uses `decodePlaceOrder` | Re-read the position after every close |
| C10 | Taker orders can use 10–16M gas (bot-kit sets 10M). Somnia bills gas used, not the limit | Feedback reports | 20M gas limit on every write |
| C11 | Each market has its own base decimals (6–24), tick, lot and minQuantity. Example: BTC has 8 decimals, lot 1000, min 13000 | Indexer market rows | Never assume 18 decimals |
| C12 | Bots are linked in the app: *wallet → Link a bot → tick Perps → paste address*. A market listed after linking needs **re-linking** | bot-kit `linkProblem()` | Check link status **per pool** |
| C13 | Indexer position sizes are **signed** (positive = long, negative = short). `FLIP` changes sign; `closedSize` is absolute | Indexer samples | Trade reconstruction uses the sign for side |
| C14 | SDK reads are methods on `exchange.client`, e.g. `client.getMarginAccount(marginBank, account)` and `client.getPerpState(pool)`. Build the exchange from `hidekiTestnet` (`@somnia-chain/markets-sdk/chains`) | Live call on Hideki | §7.3 |
| C15 | The indexer is Envio HyperIndex; `_meta { progressBlock }` gives the synced head | Live query | Used for fixture capture and "data as of" labels |

---

## 4. User experience

### 4.1 The seven features

| # | Feature | Needs session/link? | Writes on-chain? |
|---|---|---|---|
| ① | **Health Check**: net PnL 7d/30d, % of trades without a stop, liquidation cost, funding paid, top leak, reconciliation badge | No, just paste an address | No |
| ② | **Journal**: one card per round-trip trade; filter by market, side, exit type | No | No |
| ③ | **Leaks**: 4 rules (§6.5), each with an amount, evidence trades and a [Fix] button | No | No |
| ④ | **Protect Now**: open positions (liquidation price, distance, stop coverage %, funding paid in the last 24h) and a button to arm a bot-held stop | Yes (linked session) | Yes, when the stop fires |
| ⑤ | **Plan & Place**: enter risk and stop price, get a size, place the entry with its stop | Yes | Yes |
| ⑥ | **Real-time alerts**: unprotected position, stop done, stop failed, bot low on gas, link revoked | No to view; yes to act | No |
| ⑦ | **Weekly report**: PNG image with a share-to-X button | No | No |

### 4.2 Main flow

```
Landing ──paste address──► ① Health Check ──► ② Journal ◄──────────────┐
                                  │                                     │
                                  ▼                                     │
                            ③ Leaks ──[Fix]──► session needed?          │
                                                 │ no session           │
                                                 ▼                      │
                                  "Enable protection" (Link flow §4.3)  │
                                                 │ done                 │
                                  ┌──────────────┴─────────────┐        │
                                  ▼                            ▼        │
                         ④ Protect Now                 ⑤ Plan & Place   │
                                  └──────────┬─────────────────┘        │
                                             ▼                          │
                              Worker sends placeOrderFor ───────────────┘
                                             │
                              ⑥ Real-time alerts ◄── Reactivity (PositionUpdated)
                                             │
                              ⑦ Weekly report ──► X ──► new users land on Landing
```

### 4.3 "Enable protection" (link-to-login)

Because of C1 there is no owner signature. **Linking the bot is the proof of account ownership**: only the account owner, through the dreamDEX app, can link a bot to that account.

```
Browser                         Web API                      Worker / Chain
   │ click "Enable protection"     │                                │
   │──POST /api/session───────────►│ create session + bot_keys(requested)
   │                               │◄── worker generates & encrypts key
   │◄── httpOnly cookie + botAddr ─│ (status=pending, < 1s)         │
   │ shows: dreamDEX → wallet → Link a bot → tick Perps → paste botAddr
   │──GET /api/session (poll 3s)──►│ isOperatorAuthorized(account, bot, sel)
   │                               │   on EVERY perp pool ─────────►│
   │◄── {linked, account, pools} ──│ on grant: bind account to session
```

**Resolving the account:** the user has already entered the account address in ①. The API checks `isOperatorAuthorized(account, bot, placeOrderFor)` on every pool. If at least one pool returns `true`, the account is bound to the session, and the UI lists any pools still missing a grant (C12).

### 4.4 Language
All UI copy, README and X posts are in **English**; the judges and the community are international.

---

## 5. Architecture

```
                         ┌──────────────────────────────────────────┐
                         │     Somnia Tokyo / Hideki (50383)        │
                         │  PerpPool ×21 · MarginBank · StopRegistry│
                         │  OperatorPermissionsRegistry             │
                         └───▲──────────────▲───────────────▲──────┘
          eth_call / client.getPerpState  WS: somnia_watch  placeOrderFor (tx)
                             │              │               │
 ┌───────────────────────────┼──────────────┼───────────────┼───────────────┐
 │ apps/worker (Railway, 1 always-on replica, Node 24)                      │
 │  ├─ BotKeyMinter       (bot_keys requested → pending)                    │
 │  ├─ LinkWatcher        (poll grants for pending/linked sessions)         │
 │  ├─ ReactivityListener (MarginBank PositionUpdated → event bus)          │
 │  ├─ MarkPoller         (client.getPerpState every 1s for markets with    │
 │  │                      ARMED stops)                                     │
 │  ├─ StopEngine         (stop state machine; decides closes)             │
 │  ├─ ExecutionQueue     (1 queue per bot key; signs & sends placeOrderFor)│
 │  ├─ AlertEngine        (unprotected positions, stop outcomes, low gas)   │
 │  ├─ GasTreasury        (tops up bot keys with STT below threshold)       │
 │  └─ ReportJob          (cron Monday 00:05 UTC → weekly_reports)          │
 └───────────────▲──────────────────────────────────────────▲──────────────┘
                 │ SQL (Postgres)                            │ GraphQL
 ┌───────────────┴──────────────┐              ┌─────────────┴──────────────┐
 │ Postgres (Neon)              │              │ dreamDEX indexer (Envio)   │
 │ sessions, bot_keys, stops,   │              │ hideki-dev.smk.somnia.host │
 │ executions, plans, alerts,   │              │ PerpPositionChange, Fill,  │
 │ trades_cache, reports        │              │ FundingPayment, Fee*, Stop │
 └───────────────▲──────────────┘              └─────────────▲──────────────┘
                 │                                           │
 ┌───────────────┴───────────────────────────────────────────┴──────────────┐
 │ apps/web (Next.js on Vercel)                                             │
 │  UI ①–⑦ · Route Handlers /api/* · OG image (weekly report)               │
 │  NEVER holds the bot-key encryption key; writes only create jobs in DB   │
 └──────────────────────────────────────────────────────────────────────────┘
```

**Separation rules:**
1. **Only the worker signs.** The web app inserts jobs into `executions` (status `queued`) and the worker picks them up. `KEY_ENCRYPTION_KEY` exists only in the worker's env.
2. **All business logic lives in `packages/core` as pure functions** (no I/O): PnL, leaks, sizing, stop decisions. It is tested with real fixtures and no network.
3. **All I/O goes through `packages/chain`**: indexer, SDK, RPC, Reactivity, operator writes.
4. **History from the indexer, current state from the chain.** Reconciliation (§6.3) uses both.

**Build sequencing:** the system is delivered in three plans, each shipping working software:
- **Plan 1:** read-only product (①②③④-view, platform stats). Runs on Vercel with no DB, using an in-process cache in place of `trades_cache`.
- **Plan 2:** DB, worker, link flow, bot-held stops, alerts.
- **Plan 3:** Plan & Place, weekly report, evidence page, submission.

---

## 6. Domain design (`packages/core`)

### 6.1 Units and arithmetic
- All amounts and sizes are **raw `bigint`**: quote USDso has 18 decimals; base uses the market's `baseDecimals`.
- Convert to decimals only at the display layer (viem `formatUnits`). **Never use `number` for money.** Ratios (percent, bps) may be `number` once computed from `bigint` division.
- On-chain prices are raw quote per whole base unit (18 decimals). Notional in quote raw = `|size_raw| * price_raw / 10^baseDecimals`.

### 6.2 Trade reconstruction

**Input:** the `PerpPositionChange` rows of one (account, pool), ordered by (`blockNumber`, `logIndex`). `kind ∈ {OPEN, INCREASE, REDUCE, CLOSE, FLIP}` and sizes are signed (C13).

**Algorithm:**
```
trade = null
for change in changes:
  switch change.kind:
    OPEN:      trade = newTrade(change)                    # sizeBefore = 0, side = sign(sizeAfter)
    INCREASE:  trade.add(change)
    REDUCE:    trade.reduce(change)                        # adds realizedPnl, records exit fill
    CLOSE:     trade.reduce(change); trade.close(change); emit(trade); trade = null
    FLIP:      trade.reduce(change); trade.close(change); emit(trade)
               trade = newTrade(change, size = sizeAfter)  # the flipped remainder opens a new trade
```
If an `INCREASE`/`REDUCE`/`CLOSE` arrives with no open trade (history starts mid-position), the engine starts a synthetic trade at that change and flags it `partialHistory: true`.

**Trade fields:**
- `id = account:pool:openTxHash:openLogIndex`
- `side`, `openedAt`, `closedAt?`
- `entryPrice` (`entryPriceAfter` of the last change before the first reduction)
- `exitVwap` (VWAP of `exitPrice` weighted by `closedSize`), `maxSize` (absolute)
- `realizedPnl = Σ change.realizedPnl`, plus every `txHash`/`orderId` the trade touched

**Open trades** have `closedAt = null`; unrealized PnL comes from the chain (§7.3).

### 6.3 Net PnL and reconciliation (verified, C5)

**Account-level identity** (exact on 8/8 real accounts):
```
collateral_onchain = Σ MarginEvent(kind=Credited)        # paper USDso
                   + Σ MarginEvent(kind=Deposit) − Σ MarginEvent(kind=Withdraw)
                   + Σ PerpMarginPull.amount
                   + Σ PerpPositionChange.realizedPnl
                   − Σ FundingPayment.amount             # > 0 = trader paid
                   − Σ PerpFeeRecord.amount              # liquidation fees
                   − Σ ProtocolFeeRecord.amount (payer)  # trading fees (0 on testnet)
                   − Σ BuilderFeeRecord.amount (payer)
collateral_onchain = client.getMarginAccount(marginBank, account).unlockedCollateralBalance + .lockedCollateral
```

**Per-trade attribution:**
- **Funding:** each `FundingPayment(account, pool, timestamp)` goes to the trade on that (account, pool) with `openedAt < timestamp ≤ closedAt` (open trades: `openedAt < timestamp`). Payments matching no trade go to an "unattributed" bucket, which still counts in totals.
- **Liquidation fees:** `PerpFeeRecord` is matched by `txHash` to the trade containing that transaction on that pool.
- **Trading fees:** `ProtocolFeeRecord`/`BuilderFeeRecord` are matched by `txHash` and pool.
- **Formula:** `netPnl = realizedPnl − funding − liquidationFee − tradingFee − builderFee`.

**Reconciliation status** (shown on Health Check):
- `|delta| ≤ 0.01 USDso`: **✓ Reconciled with chain**
- otherwise: **⚠ Unreconciled (delta X)**, logged for investigation

**Scope:** reconciliation is **lifetime only**. The RPC refuses historical `eth_call` (C8), so there is no collateral value at the start of a time range. ✓ means the sum of all indexed events matches today's on-chain collateral. That proves every component (realized, funding, fees) is captured completely, which makes per-range numbers trustworthy too.

**Assigning trades to a range (7d/30d):**
- a closed trade belongs to the range containing its `closedAt`;
- open trades are shown separately (unrealized) and are not added to the range's net PnL;
- unattributed funding belongs to the range containing its own `timestamp`.

**Automated-cohort filter** (platform statistics only, never applied to an individual account): ≤ 6 position changes **and** |Σ realizedPnl| < 1 USDso.

**History cap:** if an account has more than 20,000 position changes, the engine processes the most recent 20,000. It marks the report `truncated: true` and skips reconciliation (badge "Not reconciled: history truncated").

### 6.4 Exit type

Determined from the trade's last change, in priority order:
1. Its `txHash` matches a `LiquidationEvent` row → **LIQUIDATED**
2. Its `orderId` matches `StopOrder.placedOrderId` with `status=TRIGGERED` → **NATIVE_STOP**
3. Its `txHash` is in PerpLog's `executions` with `kind=stop_close` → **PERPLOG_STOP**
4. Otherwise → **MANUAL**

Open trades get **OPEN**.

### 6.5 Leaks (deterministic rules, no AI)

Each leak is `{ id, title, amountRaw, shareOfLossBps, evidenceTradeIds[], fix }`, sorted by `amountRaw` descending. Leaks with zero amount are omitted.

| ID | Rule | Calculation | Fix |
|---|---|---|---|
| L1 `LIQUIDATION_COST` | Liquidation cost | Σ (liquidationFee + realized loss) of trades with exit = LIQUIDATED | Protect Now on open positions, prioritising those with liquidation distance < 10% |
| L2 `NO_STOP_LOSSES` | Losses on trades without a stop | A trade "had no stop" if at no time while it was open was there a `StopOrder` on (owner, pool) of the opposite side that was PENDING or TRIGGERED, and no PerpLog stop. Leak = Σ negative netPnl of those trades | "Always protect" (alert ⑥ suggests a stop on every new unprotected position) |
| L3 `FUNDING_DRAG` | Funding drag | Σ funding paid, split by market; % of \|gross PnL\| | Show funding in Protect Now and warn in Plan & Place |
| L4 `SIZE_UP_AFTER_LOSS` | Sizing up after a loss | Trades opened within 30 min after a losing trade with max notional ≥ 1.5× the account's median max notional. Leak = Σ negative netPnl of those trades | Plan & Place with fixed risk per trade |

Thresholds (10%, 30 min, 1.5×) live in `core/config.ts`.

### 6.6 Risk-based sizing (Plan & Place)

**Input:** `pool, side, riskRaw R, stopPrice S, entryMode (market | limit L), slippageBps (default 50)`

1. **Reference price P:** market mode uses `bestAsk` for long and `bestBid` for short; limit mode uses `P = L`.
2. **Direction check:** long requires `S < P`; short requires `S > P`.
3. **Size:**
   - `qtyRaw = R * 10^baseDecimals / |P − S|`;
   - round down to lot: `qtyRaw = floor(qtyRaw / lotSize) * lotSize`.
4. **Limits:**
   - `qtyRaw ≥ minQuantity`, otherwise error "risk too small for this market";
   - `qtyRaw ≤ maxQty`, where `maxQty = client.getMaxPerpOrderSize(...).maxQuantity − Σ resting same-side order sizes` (compensates for a reported SDK bug);
   - if capped, show the *effective risk*.
5. **Preview:** estimated liquidation price via `client.previewPerpLiquidationPrice`. If the stop is beyond the liquidation price, **block** with "Stop is beyond your liquidation price; you would be liquidated first".
6. **IOC entry price bound:**
   - long: `floor(P*(1+slip)/tick)*tick`;
   - short: `ceil(P*(1−slip)/tick)*tick`.
7. **Output:** `{ qtyRaw, notionalRaw, leverageEst, liqPriceEst, effectiveRiskRaw, priceBound, warnings[] }`.

### 6.7 Bot-held stop state machine

```
           create
  ──────────────────► ARMED ──(position closed/zero)──► CANCELLED (auto)
                        │  ▲
     mark crosses       │  │ grant revoked → PAUSED → (re-linked) → ARMED
     trigger            ▼
                    TRIGGERED ──► EXECUTING ──(position zero or qty fully closed)──► DONE
                                      │
                                      └─(5 failed attempts / 15s)──► FAILED (alert)
```

**Trigger condition:**
- long position: `mark ≤ trigger`;
- short position: `mark ≥ trigger`;
- the mark is `perpMarkForPnl(client.getPerpState(pool))`; if `markPriceOk = false`, use `indexPrice` and log `stale_mark`.

**Execution** (each attempt; the pure function `planClose()` lives in core):
1. Re-read the live position (`client.getPerpPosition`). If its size is 0, or its side differs from the stop's side → DONE/CANCELLED. **Never send an order in this case.**
2. `qty = min(|size|, qtyMode == entire ? |size| : stop.qtyRaw)`, rounded down to lot.
   - If `qty < minQuantity` but `|size| ≥ minQuantity`, use `qty = |size|` rounded down to lot.
   - If `|size| < minQuantity` → FAILED with `dust_position` and an alert.
3. Price bound: `mark × (1 ∓ slip)`. Slip starts at 150 bps and grows 100 bps per attempt up to 500 bps. Snap to tick on the conservative side.
4. Send `placeOrderFor(owner, isBid = (side == short), 0, priceBound, qty, farFutureNs, ORDER_TYPE.MARKET (=2), 0, 0x0, 0)` with a 20M gas limit.
5. Decode the receipt with `decodePlaceOrder`, record `executions`, re-read the position. If anything remains, go back to step 1.
6. On `ImmediateOrCancelNoFill`, widen slip and retry.

**Size sync:** `PositionUpdated` events (Reactivity) update the per-(account, pool) size cache. `entire` stops always close the *latest* size, avoiding the app's "Entire only covers the original size" bug.

### 6.8 Unprotected-position detection (alert)

When a `PositionUpdated` arrives for a watched account with `newSize ≠ 0` and either (previous size = 0) or (|size| grew):
- schedule a check **60 seconds** later, so the user has time to set a stop in the app;
- after 60s, if there is no PENDING `StopOrder` for (account, pool) on the indexer and no ARMED PerpLog stop → create an `unprotected_position` alert with a "Protect" button.

**Fallback when the WebSocket is down:** a 30s poll of `PerpPosition` (indexer) for watched accounts.

**Watched accounts** are accounts with a linked session plus accounts that enabled "Watch" (paste address → watch; in-app alerts only).

---

## 7. Chain layer (`packages/chain`)

### 7.1 Network config (`networks.ts`)
```ts
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";

export const HIDEKI = {
  key: "hideki",
  chain: hidekiTestnet,                       // chainId 50383
  rpcHttp: "https://api.hideki2.infra.testnet.somnia.network",
  rpcWs:   "wss://api.hideki2.infra.testnet.somnia.network/ws",
  indexer: "https://hideki-dev.smk.somnia.host/v1/graphql",
  marginBank: "0x478769e1177c0773c43a593dccc4ad15f15f1394",
  explorerTx: (h: string) => `https://explorer.testnet.somnia.network/tokyo/tx/${h}`,
  explorerAddress: (a: string) => `https://explorer.testnet.somnia.network/tokyo/address/${a}`,
  sdkAddresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
} as const;
// MAINNET: added when perps launch; every module receives the network by injection.
```

**Market rows:** load the indexer's `Market(where: {perpRegistered: true})` at startup and refresh every 10 minutes. Fields: `poolAddress, baseSymbol, baseDecimals, tickSize, lotSize, minQuantity, stopRegistry, markPrice`. **Never hardcode** pools, stop registries or decimals.

### 7.2 Indexer client
- Plain GraphQL (`fetch` + a zod v4 schema per query), no codegen.
- **Pagination:**
  - order by `[{timestamp: asc}, {id: asc}]` (or `createdAt` for `StopOrder`), `limit: 1000`;
  - keyset cursor `(timestamp, id)`: `_or: [{timestamp: {_gt: t}}, {timestamp: {_eq: t}, id: {_gt: id}}]`;
  - **no offsets** for large sets.
- **Queries per account:** `PerpPositionChange`, `FundingPayment`, `PerpFeeRecord`, `ProtocolFeeRecord` (payer), `BuilderFeeRecord` (payer), `MarginEvent`, `PerpMarginPull`, `LiquidationEvent`, `StopOrder` (owner). Plus `PerpPosition` and `Market`.
- `_meta { progressBlock }` shows "data as of block N" (C15).
- Errors (HTTP ≠ 200, GraphQL `errors`, schema mismatch) throw `IndexerError` with the query name; the API maps it to HTTP 503.

### 7.3 On-chain reads (SDK 0.32.1, C14)
```ts
const exchange = new SomniaMarkets({ chain: HIDEKI.chain, wsRpcUrl: HIDEKI.rpcWs,
                                     indexerUrl: HIDEKI.indexer, addresses: HIDEKI.sdkAddresses });
const client = exchange.client;
```
- `client.getMarginAccount(marginBank, account)`: collateral, equity, imReq/mmReq, marginStatus
- `client.getPerpState(pool)`: markPrice, markPriceOk, indexPrice, fundingRate, …
- `client.getPerpPosition(ref)`, `client.getLiquidationPrice(ref)`, `client.getPerpPositionAnalytics(ref)`
- `client.getMaxPerpOrderSize(...)`, `client.previewPerpLiquidationPrice(...)`
- Pool `isOperatorAuthorized(owner, bot, selector)` (via viem) for link status

### 7.4 Operator writes (viem)

Ported from `dreamdex-bot-kit/packages/perp-core/src/operator.ts` (MIT, attributed):
```ts
const OPERATOR_ABI = [...parseAbi([
  "function placeOrderFor(address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k) payable returns (bool success, uint128 orderId)",
  "function cancelOrderFor(address owner, uint128 orderId)",
  "function reduceOrderFor(address owner, uint128 orderId, uint256 newQuantityRemaining)",
  "function isOperatorAuthorized(address owner, address operator, bytes4 selector) view returns (bool)",
]), ...contractErrorsAbi];
```
- Always `simulateContract` first so reverts are named, then `writeContract` and `waitForTransactionReceipt`.
- Gas limit `20_000_000n` (C10). `expireTimestampNs` is 50 years out, as in the SDK.
- Decode fills with `decodePlaceOrder(receipt, pool)` (SDK export).

### 7.5 Reactivity (WebSocket)

`createReactivity(exchange.client)` from `@somnia-chain/markets-sdk/reactivity` (peer `@somnia-chain/reactivity@^0.2.1`):
```ts
await reactivity.watch({
  eventContractSources: [HIDEKI.marginBank],
  topicOverrides: [TOPIC_POSITION_UPDATED],   // keccak("PositionUpdated(address,address,int128,uint128,int256,int256)")
  ethCalls: [],
  onData: (n) => bus.emit("positionUpdated", decode(n.result)),
});
```
- Watch **all** MarginBank `PositionUpdated` events (~434 per 6k blocks, light) and filter accounts in memory.
- The chain definition must come from `@somnia-chain/markets-sdk/chains`; viem's own definition has no WebSocket URL.
- Reconnect with backoff (1s → 30s). While disconnected, the `degraded` flag switches AlertEngine to the 30s poll.
- **Honest claim to judges:** PerpLog uses *WebSocket Reactivity* (`somnia_watch`) to react to position changes in near real time. No Solidity subscription in the MVP.

---

## 8. Data (Postgres, Drizzle ORM) — Plan 2+

```ts
// packages/db/schema.ts (abridged; numeric(78,0) for every raw value)
sessions      (id uuid pk, account text null, bot_key_id fk, created_at, last_seen_at)
bot_keys      (id uuid pk, address text unique null, enc_pk bytea null, enc_iv bytea null, enc_tag bytea null,
               account text null, status enum(requested,pending,linked,revoked),
               linked_pools text[] default '{}', created_at, linked_at)
watched_accounts (account text pk, source enum(session,watch), created_at)
stops         (id uuid pk, account, pool, position_side enum(long,short),
               trigger_price numeric, trigger_op enum(lte,gte), qty_mode enum(entire,fixed),
               qty_raw numeric null, max_slip_bps int default 500,
               source enum(protect_now,plan), status enum(armed,paused,triggered,executing,done,failed,cancelled),
               attempts int default 0, last_error text, created_at, triggered_at, finished_at)
plans         (id uuid pk, account, pool, side, risk_raw numeric, ref_price numeric, stop_price numeric,
               qty_raw numeric, leverage_est numeric, liq_price_est numeric, note text,
               status enum(pending_entry,entered,partially_entered,entry_failed),
               entry_execution_id fk null, stop_id fk null, created_at)
               -- IOC entry with no fill → entry_failed + alert, NO stop created;
               -- partial fill → partially_entered, stop qty_mode=entire (follows actual size)
executions    (id uuid pk, kind enum(entry,stop_close), status enum(queued,sending,sent,confirmed,failed),
               account, pool, bot_key_id, plan_id null, stop_id null,
               is_bid bool, qty_raw numeric, price_bound numeric,
               tx_hash text null, order_id numeric null, filled_raw numeric null, avg_price numeric null,
               gas_used numeric null, error text null, created_at, updated_at)
alerts        (id uuid pk, account, type enum(unprotected_position,stop_done,stop_failed,bot_low_gas,link_revoked),
               payload jsonb, created_at, read_at null)
trades_cache  (account, pool, trade_id pk, data jsonb, computed_at)   -- cache, 60s TTL for viewed accounts
reconciliations (account pk, delta_raw numeric, ok bool, checked_at)
weekly_reports (account, week_start date, stats jsonb, created_at, pk(account, week_start))
```

- **Job queue:** the worker claims jobs with `SELECT … FROM executions WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 10`, polling every 300ms. No Redis, no queue service.
- **Single signer:** `pg_try_advisory_lock(7331)` at startup; an instance without the lock waits as standby.

---

## 9. API (Next.js Route Handlers)

| Method | Path | Auth | Description | Plan |
|---|---|---|---|---|
| GET | `/api/accounts/:addr/health?range=7d\|30d\|all` | — | ① summary: net PnL, % no stop, liquidation cost, funding, top leak, reconcile status | 1 |
| GET | `/api/accounts/:addr/trades?range&market&exit&side&cursor` | — | ② Journal (paginated) | 1 |
| GET | `/api/accounts/:addr/leaks?range` | — | ③ Leaks | 1 |
| GET | `/api/accounts/:addr/positions` | — | Open positions + liquidation price + stop coverage (native and PerpLog) + funding last 24h | 1 |
| POST | `/api/watch` `{account}` | — | Enable watch (in-app alerts) | 2 |
| POST | `/api/session` | — | Create session + bot key → `{botAddress}` | 2 |
| GET | `/api/session?account=` | cookie | Link status per pool | 2 |
| POST | `/api/stops` `{pool, triggerPrice, qtyMode, qtyRaw?}` | linked session, matching account | Create an ARMED stop. Checks: a position exists on the pool; the bot holds a `placeOrderFor` grant **on that pool** (else 409 with re-link instructions, C12); the trigger is on the correct side of the current mark | 2 |
| DELETE | `/api/stops/:id` | session | Cancel a stop | 2 |
| GET | `/api/alerts?account&since` | — (alerts are per public account, no sensitive data) | Poll every 5s | 2 |
| POST | `/api/plans/quote` | — | Sizing preview (§6.6), no side effects | 3 |
| POST | `/api/plans` `{…quote input, confirm:true}` | session | Create plan + `entry` job + stop (ARMED after the entry confirms) | 3 |
| GET | `/api/executions?account` | — | PerpLog transactions (for /evidence) | 3 |
| GET | `/api/og/report/:addr/:week` | — | Weekly report PNG (`next/og`) | 3 |

- **Validation:** every input goes through zod v4. Addresses are trimmed, lowercased and checked with `isAddress`.
- **Serialization:** `bigint` values are serialized as decimal strings.
- **Errors:** invalid address → 400; indexer failure → 503 `{error:"indexer_unavailable"}`.
- **Write protection (Plan 2):** `SameSite=Lax` cookie + `Origin` header check; rate limit 10 req/min/session for POST, counted in Postgres.

---

## 10. Frontend (`apps/web`)

**Pages:**
- `/`: landing with the address box and 3 platform stats (E1, E2, E4) with sources and a "computed on" date.
- `/a/[address]`: tabs Health · Journal · Leaks · Positions (Protect) · Plan · Report.
- `/evidence`: every PerpLog transaction with Tokyo explorer links. **This page is for judges.**
- `/how-it-works`: Link-a-bot flow, security model, limits (bot-held stops and why).

**Key components:**
- `TradeCard`, `LeakCard` (with [Fix]), `PositionRow` (liquidation-distance bar, "SL covers 40%" badge)
- `PlanForm` (live preview), `LinkWizard` (3 steps, pool checklist), `AlertToast`, `ReconcileBadge`, `EquityChart`

**State and data:**
- TanStack Query v5 (staleTime 15s; Positions refetch every 5s).
- Alerts poll every 5s; while the tab is open, also use the browser Notification API (permission requested when enabling Watch).

**Charts:** Recharts (net equity curve, PnL by market, funding by day).

**Number display:**
- keep `bigint` until the component;
- `formatUsd(raw)` with 2 decimals and thousands separators;
- prices at the market's tick precision;
- always show the unit (USDso).

**Empty and error states:**
- an address with no perps history explains: "No perps activity for this address. Paste the dreamDEX trading account address shown in the app (not your login wallet)";
- indexer errors show a retry button.

---

## 11. Security and key management

| Risk | Mitigation |
|---|---|
| DB leak exposes bot keys | `enc_pk` is AES-256-GCM encrypted with a 32-byte KEK in `KEY_ENCRYPTION_KEY`, **worker env only**. The web app never has the KEK |
| Bot key misuse | The protocol forbids bot withdrawals (C3). The worker only sends orders that come from (a) an ARMED stop of that account or (b) a plan the user confirmed. There is no "send arbitrary order" endpoint |
| Oversized close flips a position | `planClose()` re-reads the size immediately before every send; qty ≤ \|size\|; fuzz-tested |
| Double send | Advisory lock (one signer) + `FOR UPDATE` state machine + one queue per bot key (sequential nonces) |
| User revokes the link | LinkWatcher checks every 60s; stops become PAUSED and a `link_revoked` alert is sent |
| Treasury drained | Gas top-ups only for bot keys with ≥ 1 ARMED stop or pending plan; 0.5 STT when balance < 0.2 STT; cap 2 STT/key/day; log warning when treasury < 5 STT |
| Account impersonation | A session binds to an account only when the on-chain grant exists (§4.3). Read endpoints need no auth because on-chain data is public |

### 11.1 Environment variables

| Variable | web | worker | Notes |
|---|---|---|---|
| `DATABASE_URL` | ✓ (Plan 2) | ✓ | Neon; serverless driver on web, `pg` on worker |
| `NETWORK` | ✓ | ✓ | `hideki` (later `mainnet`) |
| `RPC_HTTP_URL`, `RPC_WS_URL`, `INDEXER_URL` | ✓ | ✓ | Default from `networks.ts`; overridable |
| `KEY_ENCRYPTION_KEY` | ✗ | ✓ | 32 bytes base64; **worker only** |
| `TREASURY_PRIVATE_KEY` | ✗ | ✓ | Funds bot keys with STT on Hideki |
| `GAS_TOPUP_THRESHOLD_STT`, `GAS_TOPUP_AMOUNT_STT`, `GAS_TOPUP_DAILY_CAP_STT` | ✗ | ✓ | Defaults 0.2 / 0.5 / 2 |
| `PUBLIC_BASE_URL` | ✓ | ✗ | OG images and X share links |

The web app **never generates or encrypts** bot keys:
1. `POST /api/session` inserts `bot_keys(status='requested', address=null)`.
2. The worker (polling every 300ms with `FOR UPDATE SKIP LOCKED`) generates a key with `generatePrivateKey()`, encrypts it, writes `address`/`enc_*` and sets `status='pending'`.
3. The web app polls `GET /api/session` until the address appears, normally in under 1s.

---

## 12. Technology

| Layer | Choice | Version | Why |
|---|---|---|---|
| Language / runtime | TypeScript, Node.js | Node 24 LTS, **TypeScript 5.9.3** (not 7.x) | The official SDK is TypeScript; one language everywhere. TS 7 is too new for Next 16 tooling |
| Monorepo | pnpm workspaces (via corepack) | pnpm pinned in `packageManager` at scaffold time | Light; same as bot-kit |
| dreamDEX SDK | `@somnia-chain/markets-sdk` | **0.32.1 (exact pin)** | The version the app runs |
| EVM client | `viem` | ^2.57 | SDK peer (`^2.18.5`) |
| Reactivity | `@somnia-chain/reactivity` | ^0.2.1 | Peer of `markets-sdk/reactivity` (Plan 2) |
| Web | Next.js App Router + React | Next 16.4.x, React 19.3.x | Route Handlers, `next/og`, Vercel |
| UI | Tailwind CSS v4 + shadcn/ui, lucide icons | Tailwind 4.3.x | Fast, professional look |
| Fetching | TanStack Query | v5 | Cache and polling |
| Charts | Recharts | v3 | Equity curve and bars |
| Share images | `next/og` (Satori) | bundled with Next | Weekly report PNG |
| Server cache (Plan 1) | `lru-cache` | v11 | In-process 60s cache per account before Postgres exists |
| DB (Plan 2) | Postgres on **Neon** (via Vercel Marketplace) | PG 16 | Serverless, free tier, reachable from Vercel and Railway |
| ORM (Plan 2) | Drizzle ORM + drizzle-kit | latest | Type-safe, simple migrations |
| Validation | zod | **v4** | Env, API input, indexer responses |
| Worker infra (Plan 2) | `pino` (logs), `p-queue` (per-key queue) | latest | Simple, proven |
| Tests | Vitest (unit/golden), Playwright (smoke e2e) | Vitest 5, Playwright 1.6x | Fast |
| Web hosting | **Vercel** | — | Native fit for Next.js |
| Worker hosting (Plan 2) | **Railway** (Docker, 1 always-on replica) | — | Needs a long-lived process for WebSocket and 1s polling; bot-kit ships a `railway.toml` |
| CI | GitHub Actions: typecheck, lint, test | — | Visible quality signal in the repo |

---

## 13. Repository layout

```
perplog/ (repo root = /Users/vanhuy/Desktop/dreamDEX)
├─ apps/
│  ├─ web/                 # Next.js: app/, components/, lib/, app/api/*
│  └─ worker/              # Plan 2: src/{main, bot-key-minter, link-watcher, reactivity, mark-poller,
│                          #                stop-engine, execution-queue, alerts, gas, report-job}.ts
├─ packages/
│  ├─ core/                # PURE: types, units, trades, costs, reconcile, exit-type, coverage,
│  │                       #       leaks, summary, sizing (P3), stop-machine (P2), close-planner (P2), config
│  ├─ chain/               # I/O: networks, indexer/*, markets, onchain, operator (P2), reactivity (P2)
│  └─ db/                  # Plan 2: schema, migrations, queries, crypto (AES-GCM)
├─ scripts/                # capture-fixture.ts, platform-stats.ts
├─ docs/specs/             # this document
├─ docs/superpowers/plans/ # implementation plans
├─ .github/workflows/ci.yml
├─ README.md               # What / Who / How to run / Judges start here / X posts
└─ pnpm-workspace.yaml
```

Packages export TypeScript source directly (`"exports": {".": "./src/index.ts"}`). Next.js consumes them through `transpilePackages`, so there is no build step for internal packages.

---

## 14. Testing and acceptance

### 14.1 Tests
- **PnL golden tests (mandatory):** real fixtures of the **8 reconciled accounts** plus ≥ 12 random accounts. Each fixture stores the indexer responses and `getMarginAccount` at one block, filtered to `timestamp ≤ asOfTimestamp`. The test asserts `reconcile().deltaRaw == 0` (±0.01 USDso).
- **Trade reconstruction:** OPEN → INCREASE → REDUCE → FLIP → CLOSE, liquidated trade, open trade, partial history.
- **`planClose()` fuzz:** for every combination of (size, side, qtyMode, minQty, lot), the sent qty is ≤ |size| and divisible by lot.
- **Sizing:** markets with 6, 8, 18 and 24 decimals; BTC (lot 1000, min 13000); stop beyond liquidation price is blocked.
- **Stop machine:** every transition, including PAUSED on revoked grant.
- **Integration (read-only, manual or nightly):** live Hideki market list, `getPerpState`, Reactivity receives ≥ 1 `PositionUpdated` within 60s.
- **E2E smoke (Playwright):** paste a sample address → Health Check shows the Reconciled badge.

### 14.2 MVP acceptance criteria
1. Health Check for an account with ≤ 2,000 position changes returns in < 5s (warm cache < 1s).
2. Reconciliation ✓ on ≥ 20 random accounts.
3. A bot-held stop executes within ≤ 3s of trigger detection (measured in logs) and never flips a position.
4. ≥ 20 real PerpLog transactions on Tokyo (entries and stop closes) are listed on `/evidence`.
5. The "unprotected position" alert appears ≤ 90s after opening a position without a stop in the dreamDEX app.
6. README has every required section; a 2–3 minute demo video exists; 2–3 X posts tag @DreamDEXSomnia with accurate, sourced numbers.

---

## 15. Build plan: as fast as possible, by dependency

Phases are not tied to days; each ends with a demoable result. P1–P2 and P3 **can run in parallel**.

| Phase | Content | Depends on | Demo |
|---|---|---|---|
| **P0. Spikes** | (a) a bot of ours linked to a test Arena wallet opens and closes via `placeOrderFor`; (b) Reactivity `watch` receives a real `PositionUpdated`; (c) measure `getPerpState` latency; (d) check indexer pagination limits | **User:** Arena wallet + STT (§17) | 3 working scripts + first tx hash |
| **P1. Core + Journal** | `packages/core` (units, trades, costs, reconcile, exit-type) + golden tests; `packages/chain` indexer; web `/a/[addr]` Health + Journal | — | Paste any address → net PnL with ✓ badge |
| **P2. Leaks + Positions** | `leaks.ts`; Leaks tab; Positions tab (liquidation price, stop coverage, funding last 24h) | P1 | See exactly "where you lose money" |
| **P3. Session + Worker** | DB schema + crypto; `/api/session`; LinkWizard; worker (advisory lock, BotKeyMinter, LinkWatcher, GasTreasury, ExecutionQueue); deploy Railway + Neon | P0(a) | After linking, the UI shows "Protected" |
| **P4. Stops + Alerts** | stop-machine, close-planner, MarkPoller, StopEngine; Reactivity listener; AlertEngine; Protect Now UI | P2, P3 | A bot-held stop fires for real; the tx appears on /evidence |
| **P5. Plan & Place** | sizing + `/api/plans` + PlanForm; entry, then ARMED stop | P4 | Risk-sized entry with a real stop |
| **P6. Report + submission** | `next/og` weekly report; `/evidence`; README; video; 3 X posts; DoraHacks submission | P5 | Submitted |

**Critical path:** P0(a) → P3 → P4 → P5 → P6. P1–P2 need no wallet or STT, so **start immediately**.

**Research scripts and data** (reference during build) live in `/private/tmp/claude-501/-Users-vanhuy-Desktop-dreamDEX/72804448-520f-438f-b875-affca8e66e84/scratchpad/`:
- `sim_stop2.mjs`, `read_margin.mjs`, `pnl_components.json`, `sample_3952.json`, `gq.py`, `rpc.py`;
- the cloned bot-kit in `botkit-src/`.

---

## 16. Decisions made by Claude (review while reading)

1. **Hosting:** web on Vercel, worker on Railway, DB on Neon Postgres. Alternatives: Fly.io or a VPS for the worker, Supabase for the DB.
2. **No Redis or queue service:** the job queue runs on Postgres (`FOR UPDATE SKIP LOCKED`).
3. **One bot key per user**, generated and held encrypted by PerpLog. Linking the bot is the proof of ownership, and the blast radius stays per user.
4. **Bot-held stops** instead of exchange-native stops. Mandatory per C2.
5. **English UI.**
6. **Defaults:**
   - leak thresholds 10% / 30 min / 1.5×;
   - slippage 50 bps on entry, 150 → 500 bps on close;
   - 60s alert grace period;
   - gas top-up of 0.5 STT when below 0.2 STT;
   - history cap of 20,000 changes.
7. **Indexer access:** plain GraphQL + zod, no codegen.
8. **Reactivity:** WebSocket `watch` only in the MVP; no Solidity subscription.
9. **Plan 1 runs without a DB** (in-process LRU cache) so the read-only product can ship before infrastructure accounts exist.

---

## 17. What the user must do (blocks the critical path)

1. **DoraHacks whitelist:** open a ticket in the dreamDEX Discord or message the SomniaHacks Telegram group with your DoraHacks email.
2. **Perps Arena wallet:** create at least 1 account on app.testnet.dreamdex.io and join the Arena for paper USDso. Ideally 2 (demo + testing).
3. **STT for gas:** ask the organizers for ~20 STT for the treasury, explaining it pays gas for users' bot keys. It must arrive on **Hideki**, not Shannon (see the feedback report about top-ups landing on the wrong chain).
4. **Infrastructure accounts:** Vercel, Railway, Neon (or name your preferred alternatives), and a public GitHub repo.
5. **An X account** to post 2–3 updates tagging @DreamDEXSomnia.

---

## 18. Remaining risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Whitelist or STT arrives late | Medium | Blocks P0(a), P3–P5 | Build P1–P2 first; ask today |
| Indexer slow or rate-limited | Low–Medium | Slow Health Check | Cache; incremental sync by cursor; history cap |
| IOC close finds no liquidity on thin alt books | Medium | Stop FAILED | Widen slip to 500 bps, retry, alert; recommend stops on liquid markets |
| Worker down when a stop must fire | Low | Lost protection | Railway auto-restart; on boot, run a catch-up pass over all ARMED stops at the current mark |
| Cohort filter misclassifies | Low | Wrong platform stats | Platform stats only; methodology stated in README |
| Judges see bot-held stops as inferior to native stops | Low | Technical score | Explain C1/C2 on `/how-it-works` with the simulation evidence; this is a protocol limitation that has been reported back to dreamDEX |
