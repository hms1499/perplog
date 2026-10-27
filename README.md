# PerpLog

Your true perps PnL on dreamDEX, after funding and liquidation fees.

## What it is

PerpLog is a trade journal for [dreamDEX](https://app.testnet.dreamdex.io) perpetual futures on Somnia Tokyo
testnet. Paste a dreamDEX trading account address and PerpLog:
- rebuilds every round-trip trade from the chain's indexed events;
- subtracts the funding and liquidation fees that the app's "realized PnL" leaves out;
- checks the total against the account's collateral on-chain, and shows **✓ Reconciled with chain** when every
  event adds up to the exact on-chain balance;
- ranks the leaks that cost the most money: liquidations, losing trades without a stop-loss, funding paid, and
  sizing up right after a loss;
- shows open positions with their liquidation distance and how much of each position a stop-loss covers;
- protects open positions with **bot-held stop-losses** and alerts you when a position has none.

Nothing is custodied. The journal only reads public chain data; protection uses a bot key that can only close
your positions (see [Protection](#protection-bot-held-stops)).

## Who it is for

Perps traders on dreamDEX, starting with the Perps Arena on testnet. On the current testnet:
- about **77%** of new positions opened by real traders have no stop-loss within 10 minutes;
- traders paid about **147,000 USDso** in liquidation fees in the last 7 days.

See [Data sources & methodology](#data-sources--methodology).

## How it works

```
dreamDEX indexer (Envio GraphQL) ──► packages/chain ──► packages/core (pure, bigint math) ──► apps/web (Next.js)
Somnia RPC + Reactivity         ──┘          │                                                  │ writes rows
                                             └──► apps/worker (the only signer) ◄── packages/db (Postgres) ◄┘
```

- `packages/core`: trade reconstruction, funding and fee attribution, net PnL, reconciliation, exit
  classification, leak rules, health summary. Pure functions, all money as `bigint`.
- `packages/chain`: indexer client with keyset pagination, on-chain reads through `@somnia-chain/markets-sdk`
  0.32.1 (margin account, perp state, positions, liquidation price).
- `apps/web`: Next.js 16 app with the Health, Journal, Leaks and Positions views, plus the session, stops,
  watch and alerts routes. It never signs: it only writes rows the worker acts on.
- `packages/db`: Drizzle schema and migrations, AES-256-GCM bot-key encryption, typed queries.
- `apps/worker`: a long-running Node process holding a Postgres advisory lock, so exactly one instance signs.
  It mints bot keys, watches grants, executes stops, raises alerts and tops up bot gas.

The design spec, with the verified protocol constraints, is in
[`docs/specs/2026-10-25-perplog-design.md`](docs/specs/2026-10-25-perplog-design.md).

### The reconciliation identity

For every account, PerpLog checks:

```
collateral on-chain = paper credit + deposits − withdrawals + margin pulls
                    + Σ realized PnL − Σ funding paid − Σ liquidation fees − Σ trading and builder fees
```

It holds exactly on all 22 real accounts in the golden test fixtures.

## Protection (bot-held stops)

On dreamDEX, app users trade from a Safe whose only owner on testnet is an app-held key (C1), so PerpLog can
never get an owner signature. An exchange-native stop created by a linked bot reverts with `InvalidOrderOwner()`
(C2). PerpLog therefore holds the stop itself and closes the position through the bot when the mark crosses
the trigger.

Link the bot once per account:
1. Open an account in PerpLog, go to **Positions** and press **Protect**, then **Enable protection**.
2. In the dreamDEX app: open your wallet → Link a bot → tick Perps → paste this address.
3. PerpLog confirms the link and lists the markets it covers.

What the bot can and cannot do:
- it can only place, cancel or reduce orders (`placeOrderFor`, `cancelOrderFor`, `reduceOrderFor`); it cannot
  withdraw or move funds;
- it only sends orders that close a position for a stop you armed;
- it re-reads the live position before every order and never sends more than the live size, so it cannot open
  or flip a position.

Stop lifecycle:

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

A close is a market (IOC) order bounded at the mark ± 1.5% slippage, widening by 1% per attempt up to the
stop's cap (5% by default).

## Alerts

Press **Watch this account** (or link a bot) and PerpLog shows in-app toasts, plus browser notifications when
you allow them:
- **unprotected position:** a position opened or grew and, 60 s later, has neither a PerpLog stop nor a native
  stop-loss. Reactivity `PositionUpdated` events drive it; when the feed goes quiet for 60 s, the worker polls
  the indexer every 30 s, so the alert still arrives within 90 s;
- **stop done** (with the transaction) and **stop failed** (with the reason);
- **bot low on gas:** the bot's daily top-up cap is reached;
- **link revoked:** the bot lost access to a market; its stops are paused until you link it again.

## Run locally

Requirements: Node 24 and corepack.

```bash
corepack enable
pnpm install
pnpm --filter @perplog/web dev          # live data from Somnia Tokyo testnet
```

Open <http://localhost:3000> and paste a trading account address, for example
`0x31b0480ff2ec5d0a4d9480a9f8c8802897c08281`.

Fixture mode serves captured accounts with no network access, for demos and end-to-end tests:

```bash
cd apps/web
PERPLOG_FIXTURE_DIR=../../packages/core/test/fixtures pnpm dev
```

## Run the worker

Protection needs Postgres and the worker. Without `DATABASE_URL` the web app stays read-only. Every variable is
listed in [`apps/worker/.env.example`](apps/worker/.env.example) and [`apps/web/.env.example`](apps/web/.env.example);
the processes read the real environment, not these files.

```bash
docker run -d --name perplog-pg -e POSTGRES_PASSWORD=pg -p 5433:5432 postgres:16
export KEY_ENCRYPTION_KEY=$(openssl rand -base64 32)
DATABASE_URL=postgres://postgres:pg@localhost:5433/postgres NETWORK=hideki \
  pnpm --filter @perplog/worker start
# in another terminal:
DATABASE_URL=postgres://postgres:pg@localhost:5433/postgres pnpm --filter @perplog/web dev
```

The worker logs `signer lock acquired` and `migrations applied`, then starts its loops. A second instance logs
`standby` and takes over only if the first one goes away.

| Variable | web | worker | Notes |
|---|---|---|---|
| `DATABASE_URL` | ✓ | ✓ | Postgres; Neon's pooled URL in production |
| `NETWORK` | | ✓ | `hideki` |
| `RPC_HTTP_URL`, `RPC_WS_URL`, `INDEXER_URL` | | ✓ | Optional; defaults in `packages/chain/src/networks.ts` |
| `KEY_ENCRYPTION_KEY` | ✗ | ✓ | 32 bytes base64 (`openssl rand -base64 32`); **worker only** |
| `TREASURY_PRIVATE_KEY` | ✗ | ✓ | Funds bot keys with STT; empty disables top-ups |
| `GAS_TOPUP_THRESHOLD_STT`, `GAS_TOPUP_AMOUNT_STT`, `GAS_TOPUP_DAILY_CAP_STT` | ✗ | ✓ | Defaults 0.2 / 0.5 / 2 |
| `LOG_LEVEL` | | ✓ | Default `info` |

Keep `KEY_ENCRYPTION_KEY` safe: every bot key is encrypted with it, and a new one cannot decrypt the old keys.

## Deploy

- **Database:** a Neon Postgres. Use its pooled `DATABASE_URL` for both apps; the worker applies migrations at
  boot.
- **Worker:** a Railway service built from [`apps/worker/Dockerfile`](apps/worker/Dockerfile) through
  [`apps/worker/railway.toml`](apps/worker/railway.toml), with **1 replica**. Set `DATABASE_URL`,
  `KEY_ENCRYPTION_KEY`, `TREASURY_PRIVATE_KEY` and `NETWORK=hideki`.
- **Web:** Vercel, with `DATABASE_URL` set.

## Tests

```bash
pnpm test        # unit tests, golden reconciliation of 22 real accounts, worker and DB tests (in-process Postgres)
pnpm typecheck
pnpm lint
pnpm --filter @perplog/web exec playwright test   # end-to-end, fixture mode
```

Refresh the data behind the tests and the landing page:

```bash
pnpm tsx scripts/capture-fixture.ts <account> [account...]
pnpm tsx scripts/platform-stats.ts
```

## Judges start here

- Live app: _coming with the deployment_
- Sample accounts:
  - `0x395225eab84c1b9304d42cb647238dcc90003951`: liquidated twice; net PnL is −1,700.23 against a realized
    −1,431.15;
  - `0xf1a114c1604a272ec6a1da07803fc68a786480e7`: 5 open positions, one with no stop-loss.
- On-chain evidence page for PerpLog orders: _coming with the protection release_

## X posts

_Coming with the submission._

## Data sources & methodology

- Indexer: `https://hideki-dev.smk.somnia.host/v1/graphql`.
- RPC: `https://api.hideki2.infra.testnet.somnia.network` (chain 50383).
- Platform statistics come from [`scripts/platform-stats.ts`](scripts/platform-stats.ts), and the methodology is
  written into [`apps/web/data/platform-stats.json`](apps/web/data/platform-stats.json):
  - A new position counts as protected when a stop order on the same account and market was created between
    60 seconds before and 10 minutes after it opened.
  - Accounts with at most 6 position changes and less than 1 USDso of realized PnL in the window are treated
    as automated and excluded.
- The operator-call ABI used in later releases is ported from
  [`somnia-chain/dreamdex-bot-kit`](https://github.com/somnia-chain/dreamdex-bot-kit) (MIT).

## License

MIT
