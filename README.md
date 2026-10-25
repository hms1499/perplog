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
- shows open positions with their liquidation distance and how much of each position a stop-loss covers.

Nothing is signed and nothing is custodied: this release only reads public chain data.

## Who it is for

Perps traders on dreamDEX, starting with the Perps Arena on testnet. On the current testnet:
- about **77%** of new positions opened by real traders have no stop-loss within 10 minutes;
- traders paid about **147,000 USDso** in liquidation fees in the last 7 days.

See [Data sources & methodology](#data-sources--methodology).

## How it works

```
dreamDEX indexer (Envio GraphQL) ──► packages/chain ──► packages/core (pure, bigint math) ──► apps/web (Next.js)
Somnia RPC (markets-sdk reads)  ──┘
```

- `packages/core`: trade reconstruction, funding and fee attribution, net PnL, reconciliation, exit
  classification, leak rules, health summary. Pure functions, all money as `bigint`.
- `packages/chain`: indexer client with keyset pagination, on-chain reads through `@somnia-chain/markets-sdk`
  0.32.1 (margin account, perp state, positions, liquidation price).
- `apps/web`: Next.js 16 app with read-only API routes and the Health, Journal, Leaks and Positions views.

The design spec, with the verified protocol constraints, is in
[`docs/specs/2026-10-25-perplog-design.md`](docs/specs/2026-10-25-perplog-design.md).

### The reconciliation identity

For every account, PerpLog checks:

```
collateral on-chain = paper credit + deposits − withdrawals + margin pulls
                    + Σ realized PnL − Σ funding paid − Σ liquidation fees − Σ trading and builder fees
```

It holds exactly on all 22 real accounts in the golden test fixtures.

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

## Tests

```bash
pnpm test        # unit tests + golden reconciliation of 22 real accounts
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
