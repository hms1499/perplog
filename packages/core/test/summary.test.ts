import { buildHealthSummary, filterRange } from "../src/summary";
import { enriched } from "./helpers";

const NOW = 100 * 86400;
const DAY = 86400;

test("trade closed 8 days ago is excluded from 7d but included in 30d", () => {
  const t = enriched({ id: "old", closedAt: NOW - 8 * DAY });
  expect(filterRange([t], "7d", NOW)).toHaveLength(0);
  expect(filterRange([t], "30d", NOW)).toHaveLength(1);
  expect(filterRange([t], "all", NOW)).toHaveLength(1);
});

test("open trades are counted separately and excluded from net pnl", () => {
  const s = buildHealthSummary({
    trades: [
      enriched({ id: "c", closedAt: NOW - DAY, netPnl: 10n, realizedPnl: 12n }),
      enriched({ id: "o", closedAt: null, netPnl: 999n, realizedPnl: 999n }),
    ],
    unattributedFunding: [],
    range: "7d",
    nowSec: NOW,
    reconcile: null,
  });
  expect(s).toMatchObject({ tradeCount: 1, openTradeCount: 1, netPnlRaw: 10n, realizedPnlRaw: 12n });
});

test("net pnl subtracts unattributed funding inside the range only", () => {
  const s = buildHealthSummary({
    trades: [
      enriched({
        id: "c",
        closedAt: NOW - DAY,
        netPnl: 10n,
        costs: { funding: 2n, liquidationFee: 0n, tradingFee: 0n, builderFee: 0n },
      }),
    ],
    unattributedFunding: [
      { id: "in", pool: "0xp", amount: 3n, timestamp: NOW - DAY, txHash: "0x1" },
      { id: "out", pool: "0xp", amount: 50n, timestamp: NOW - 9 * DAY, txHash: "0x2" },
    ],
    range: "7d",
    nowSec: NOW,
    reconcile: null,
  });
  expect(s.netPnlRaw).toBe(7n);
  expect(s.fundingPaidRaw).toBe(5n);
});

test("percentages round and are 0 with no trades", () => {
  const s = buildHealthSummary({
    trades: [
      enriched({ id: "a", closedAt: NOW - DAY, hadStop: false, netPnl: 5n }),
      enriched({ id: "b", closedAt: NOW - DAY, hadStop: true, netPnl: 5n }),
      enriched({ id: "c", closedAt: NOW - DAY, hadStop: true, netPnl: -5n }),
    ],
    unattributedFunding: [],
    range: "7d",
    nowSec: NOW,
    reconcile: null,
  });
  expect(s.tradesWithoutStopPct).toBe(33);
  expect(s.winRatePct).toBe(67);
  const empty = buildHealthSummary({
    trades: [],
    unattributedFunding: [],
    range: "7d",
    nowSec: NOW,
    reconcile: null,
  });
  expect(empty).toMatchObject({
    tradesWithoutStopPct: 0,
    winRatePct: 0,
    tradeCount: 0,
    topLeak: null,
    netPnlRaw: 0n,
  });
});

test("liquidation cost and top leak come from the leak rules", () => {
  const s = buildHealthSummary({
    trades: [
      enriched({
        id: "L",
        closedAt: NOW - DAY,
        exitType: "LIQUIDATED",
        realizedPnl: -100n,
        netPnl: -140n,
        costs: { funding: 0n, liquidationFee: 40n, tradingFee: 0n, builderFee: 0n },
      }),
    ],
    unattributedFunding: [],
    range: "7d",
    nowSec: NOW,
    reconcile: null,
  });
  expect(s.liquidationCostRaw).toBe(140n);
  expect(s.topLeak?.id).toBe("LIQUIDATION_COST");
});
