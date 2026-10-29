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
- protects open positions with **bot-held stop-losses** and alerts you when a position has none;
- **Plan & Place:** you say how much you are willing to lose and where your stop goes; PerpLog sizes the trade,
  places the market entry and arms its stop the moment it fills;
- a **weekly report card** you can share on X;
- an **[evidence page](#judges-start-here)** listing every order PerpLog's bots sent, with explorer links.

Nothing is custodied. The journal only reads public chain data. Orders go through a bot key you link from the
dreamDEX app; it can close positions for your stops and open only the one entry you confirm in Plan & Place,
and it can never move funds (see [Protection](#protection-bot-held-stops)).

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
- `apps/web`: Next.js 16 app with the Health, Journal, Leaks, Positions, Plan and Report views, `/evidence` and
  `/how-it-works`, plus the session, stops, plans, watch, alerts and executions routes and the weekly report
  image (`next/og`). It never signs: it only writes rows the worker acts on.
- `packages/db`: Drizzle schema and migrations, AES-256-GCM bot-key encryption, typed queries.
- `apps/worker`: a long-running Node process holding a Postgres advisory lock, so exactly one instance signs.
  It mints bot keys, watches grants, executes stops and plan entries (one send queue per bot key), raises
  alerts and tops up bot gas.

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
- it sends orders that close a position for a stop you armed: it re-reads the live position before every
  close and never sends more than the live size, so a close cannot flip a position;
- the only order that opens a position is the entry of a **Plan & Place** you confirmed: it is sent at most once
  (never retried, even after a restart), only while you are flat on that market, within 30 s of your click, at the
  size PerpLog quoted; its stop is armed as soon as it fills.

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

## Plan & Place

1. Open the **Plan** tab, pick a market and a side, and enter your **max loss if the stop hits** (in USDso) and
   your **stop price**.
2. PerpLog sizes the position from the live book: `size = risk / |entry − stop|`, floored to the market's lot.
   It caps the size at what your margin allows, shows the estimated liquidation price and leverage, and blocks
   a stop that sits beyond your liquidation price.
3. **Place order** queues one market (IOC) entry, bounded at 0.5% slippage. The worker re-checks that you are
   still flat, sends it once, and arms an `entire` stop at your price as soon as it fills. If it does not fill,
   nothing is opened and no stop is armed.

## Weekly report

The **Report** tab draws a 1200×630 card for any week: true net PnL against the realized PnL the app shows,
the biggest leak, trades, win rate, funding and the share of trades without a stop. **Share on X** posts a
link to `/r/<account>/<week>`, whose preview is the card; **Download PNG** saves it.

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

Protection needs Postgres and the worker. Without `DATABASE_URL` the web app stays read-only.

Keep secrets in env files, never on the command line:

```bash
cp apps/worker/.env.example apps/worker/.env && chmod 600 apps/worker/.env
echo "KEY_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> apps/worker/.env   # then set DATABASE_URL, TREASURY_PRIVATE_KEY
cp apps/web/.env.example apps/web/.env.local                             # DATABASE_URL only
```

The worker's `start` script loads `apps/worker/.env` when it exists; variables already set in the environment win
over the file, so hosted deploys set them on the dashboard instead. Next.js loads `apps/web/.env.local`. Both files
are gitignored, and `.dockerignore` keeps them out of the worker image.

Any Postgres 16 works: a local Docker container or a Neon database (see [Neon](#neon) for which URL each
process takes).

```bash
docker run -d --name perplog-pg -e POSTGRES_PASSWORD=pg -p 5433:5432 postgres:16   # or use Neon, see below
pnpm --filter @perplog/worker start      # reads apps/worker/.env
# in another terminal:
pnpm --filter @perplog/web dev           # reads apps/web/.env.local
```

The worker logs `signer lock acquired` and `migrations applied`, then starts its loops. A second instance logs
`standby` and takes over only if the first one goes away.

| Variable | web | worker | Notes |
|---|---|---|---|
| `DATABASE_URL` | ✓ | ✓ | Postgres. On Neon: **direct** URL for the worker, pooled URL for the web |
| `NETWORK` | | ✓ | `hideki` |
| `RPC_HTTP_URL`, `RPC_WS_URL`, `INDEXER_URL` | | ✓ | Optional; defaults in `packages/chain/src/networks.ts` |
| `KEY_ENCRYPTION_KEY` | ✗ | ✓ | 32 bytes base64 (`openssl rand -base64 32`); **worker only** |
| `TREASURY_PRIVATE_KEY` | ✗ | ✓ | Funds bot keys with STT; empty disables top-ups |
| `GAS_TOPUP_THRESHOLD_STT`, `GAS_TOPUP_AMOUNT_STT`, `GAS_TOPUP_DAILY_CAP_STT` | ✗ | ✓ | Defaults 0.2 / 0.5 / 2 |
| `LOG_LEVEL` | | ✓ | Default `info` |

Keep `KEY_ENCRYPTION_KEY` safe: every bot key is encrypted with it, and a new one cannot decrypt the old keys.

### Neon

- **Worker: the direct URL** (host without `-pooler`), with `?sslmode=require`. The worker holds its signer lock
  with a session-level `pg_try_advisory_lock` on one dedicated connection. Neon's pooled URL goes through
  PgBouncer in transaction mode, which does not support session-level advisory locks, so through it the lock
  would no longer guarantee a single signer.
- **Web: the pooled URL.** It only runs short queries.
- Use a separate Neon branch (for example `dev`) for local testing, so test rows never reach production.
- The worker's 10 s lock heartbeat keeps the compute awake: a running worker uses compute hours the whole time.

```bash
# apps/worker/.env
DATABASE_URL=postgresql://USER:PASS@ep-xxx.REGION.aws.neon.tech/neondb?sslmode=require
# apps/web/.env.local
DATABASE_URL=postgresql://USER:PASS@ep-xxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require
```

## Deploy

- **Database:** a Neon Postgres. The worker takes the **direct** URL and the web the **pooled** URL (see
  [Neon](#neon)); the worker applies migrations at boot.
- **Worker:** one instance built from [`apps/worker/Dockerfile`](apps/worker/Dockerfile). Set `DATABASE_URL`,
  `KEY_ENCRYPTION_KEY`, `TREASURY_PRIVATE_KEY` and `NETWORK=hideki`.
  - **Fly.io (paid, about $3.69 a month):** [`fly.toml`](fly.toml) runs one always-on `shared-cpu-1x` 512 MB
    machine in `iad` with no public service, restarted whenever it exits. From the repository root:
    `fly apps create <name>` (and set `app` in `fly.toml` to it), then load the three secrets without echoing
    them: `grep -E '^(DATABASE_URL|KEY_ENCRYPTION_KEY|TREASURY_PRIVATE_KEY)=' apps/worker/.env | fly secrets
    import --stage`, and `fly deploy --ha=false` (one machine). New accounts have no free tier: the trial
    stops machines after 5 minutes, so a card is needed.
  - **Render (free):** New → Blueprint on this repo reads [`render.yaml`](render.yaml) (a free web service in
    Virginia) and asks for the three secrets. A free web service sleeps after 15 minutes without inbound
    traffic, and a sleeping worker fires no stop, so keep it awake: a [cron-job.org](https://cron-job.org) job
    that GETs `https://<service>.onrender.com/healthz` every minute. `/healthz` answers a bare `ok` on any
    path and reveals no state. The free tier has 750 instance hours a month per workspace: run only this one
    free service. Render's free tier is for demos, not for real money.
  - **Railway:** [`apps/worker/railway.toml`](apps/worker/railway.toml), with **1 replica**.
  - **Any machine:** `pnpm --filter @perplog/worker start` (with `caffeinate -i` on a Mac).
  - Two workers on the same database are safe: only the holder of the signer lock signs, the other waits in
    standby and takes over within 10 s once the first stops.
- **Web:** Vercel, with the pooled `DATABASE_URL` set.

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

- Live app: **https://perplog.vercel.app**
- Sample accounts:
  - `0x395225eab84c1b9304d42cb647238dcc90003951`: liquidated twice; net PnL is −1,700.23 against a realized
    −1,431.15;
  - `0xf1a114c1604a272ec6a1da07803fc68a786480e7`: 5 open positions, one with no stop-loss.
- **`/evidence`** on the live app: every order PerpLog's bots sent (stop closes and plan entries), newest
  first, with Somnia explorer links and the median trigger-to-fill latency of stops.
- **`/how-it-works`**: why stops are bot-held and exactly what the bot may send.

## X posts

Drafts are in [`docs/submission/x-posts.md`](docs/submission/x-posts.md); links go here once posted.

## Limits

- Stops are held by PerpLog's worker, not by the exchange: a linked bot cannot arm an exchange-native stop
  (`InvalidOrderOwner()`). If the worker is down, stops do not fire; on restart it re-checks every armed stop.
- Closes and entries are market (IOC) orders: on a thin book they can fill partly or not at all.
- Plan & Place opens new positions only (you must be flat on that market) and only at market.
- Somnia Tokyo testnet only; mainnet needs only a network config change.

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
