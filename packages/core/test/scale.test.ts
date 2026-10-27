import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { attributeCosts } from "../src/costs";
import { enrichTrades } from "../src/enrich";
import { readFixture } from "../src/fixture";
import { reconstructTrades } from "../src/trades";
import type { AccountHistory, FeeRecord, FundingPayment, StopOrderRecord, Trade } from "../src/types";
import { change, stop, trade } from "./helpers";

const dir = new URL("./fixtures/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

// Pins the per-trade attribution of every captured account, so speed-ups cannot move a cost.
test.each(files)("attribution and enrichment of %s are unchanged", (file) => {
  const { history, markets } = readFixture(readFileSync(new URL(file, dir), "utf8"));
  const attribution = attributeCosts(
    reconstructTrades(history.account, history.changes),
    history.funding,
    history.fees,
  );
  const trades = enrichTrades(
    attribution,
    history,
    new Map(markets.map((m) => [m.pool, m])),
    history.asOfTimestamp,
  );
  const rows = trades.map(
    (t) =>
      `${t.id}|${t.costs.funding}|${t.costs.liquidationFee}|${t.costs.tradingFee}|${t.netPnl}|${t.exitType}|${t.hadStop}`,
  );
  expect({
    trades: trades.length,
    unattributedFunding: attribution.unattributed.funding.toString(),
    digest: createHash("sha256").update(rows.join("\n")).digest("hex").slice(0, 16),
  }).toMatchSnapshot();
});

const POOL = "0xp" as const;
const N_TRADES = 10_000;

function syntheticAccount() {
  const trades: Trade[] = Array.from({ length: N_TRADES }, (_, i) =>
    trade({
      id: `t${i}`,
      pool: POOL,
      side: i % 2 ? "short" : "long",
      openedAt: i * 100,
      closedAt: i * 100 + 50,
      txHashes: [`0xo${i}`, `0xc${i}`],
      lastChange: change({ txHash: `0xc${i}`, orderId: String(i) }),
    }),
  );
  const funding: FundingPayment[] = Array.from({ length: 2 * N_TRADES }, (_, i) => ({
    id: `f${i}`,
    pool: POOL,
    amount: 1n,
    timestamp: i * 50 + 25,
    txHash: `0xf${i}`,
  }));
  const fees: FeeRecord[] = Array.from({ length: 2 * N_TRADES }, (_, i) => ({
    id: `fee${i}`,
    kind: "trading",
    pool: null,
    amount: 1n,
    timestamp: 0,
    txHash: `0xc${i % N_TRADES}`,
  }));
  const stopOrders: StopOrderRecord[] = Array.from({ length: 2 * N_TRADES }, (_, i) =>
    stop({
      id: `s${i}`,
      pool: POOL,
      status: i % 3 ? "CANCELLED" : "TRIGGERED",
      isBid: i % 2 === 1,
      triggerOperator: i % 2 ? 0 : 1,
      createdAt: i * 50,
      updatedAt: i * 50 + 30,
      placedOrderId: String(i),
    }),
  );
  const history: AccountHistory = {
    account: "0xa",
    asOfTimestamp: N_TRADES * 100,
    truncated: false,
    changes: [],
    funding,
    fees,
    marginEvents: [],
    marginPulls: [],
    liquidations: Array.from({ length: 1000 }, (_, i) => ({
      id: `l${i}`,
      kind: "PositionLiquidated",
      pool: POOL,
      txHash: `0xc${i * 10}` as const,
      timestamp: 0,
    })),
    stopOrders,
  };
  return { trades, history };
}

test("attribution and enrichment stay fast at the history cap", () => {
  const { trades, history } = syntheticAccount();
  const started = performance.now();
  const attribution = attributeCosts(trades, history.funding, history.fees);
  enrichTrades(attribution, history, new Map(), history.asOfTimestamp);
  const elapsedMs = performance.now() - started;
  // The quadratic version took ~5s on an M-series laptop; the indexed one takes tens of ms.
  expect(elapsedMs).toBeLessThan(1000);
});
