import { buildWeeklyReport, isoWeekStart, weekStartSec } from "../src/weekly";
import { enriched } from "./helpers";

// Monday 2026-10-26 00:00 UTC.
const MON = Date.UTC(2026, 9, 26) / 1000;
const DAY = 86_400;

test("isoWeekStart maps every day of a week to its Monday (UTC)", () => {
  for (let d = 0; d < 7; d++) {
    expect(isoWeekStart(MON + d * DAY)).toBe("2026-10-26");
    expect(isoWeekStart(MON + d * DAY + DAY - 1)).toBe("2026-10-26");
  }
  expect(isoWeekStart(MON - 1)).toBe("2026-10-19");
  expect(isoWeekStart(MON + 7 * DAY)).toBe("2026-11-02");
  expect(weekStartSec("2026-10-26")).toBe(MON);
});

test("weekStartSec rejects anything but a Monday in YYYY-MM-DD form", () => {
  expect(weekStartSec("2026-10-27")).toBeNull();
  expect(weekStartSec("2026-10-26T00:00")).toBeNull();
  expect(weekStartSec("26-10-2026")).toBeNull();
  expect(weekStartSec("2026-02-30")).toBeNull();
});

test("buildWeeklyReport counts only trades closed in the week and PERPLOG_STOP exits", () => {
  const trades = [
    enriched({ id: "before", closedAt: MON - 1, netPnl: -1_000n, realizedPnl: -1_000n }),
    enriched({
      id: "win",
      closedAt: MON + DAY,
      netPnl: 30n,
      realizedPnl: 40n,
      costs: { funding: 10n, liquidationFee: 0n, tradingFee: 0n, builderFee: 0n },
    }),
    enriched({
      id: "stopped",
      closedAt: MON + 2 * DAY,
      netPnl: -20n,
      realizedPnl: -20n,
      exitType: "PERPLOG_STOP",
      hadStop: true,
    }),
    enriched({ id: "nostop", closedAt: MON + 3 * DAY, netPnl: -50n, realizedPnl: -50n, hadStop: false }),
    enriched({ id: "open", closedAt: null, netPnl: 999n, realizedPnl: 999n }),
    enriched({ id: "after", closedAt: MON + 7 * DAY, netPnl: 5_000n, realizedPnl: 5_000n }),
  ];
  const funding = [
    { id: "f1", pool: trades[0]?.pool ?? "0x", amount: 7n, timestamp: MON + DAY, txHash: "0x01" },
    { id: "f2", pool: trades[0]?.pool ?? "0x", amount: 100n, timestamp: MON - DAY, txHash: "0x02" },
  ] as Parameters<typeof buildWeeklyReport>[0]["unattributedFunding"];

  const r = buildWeeklyReport({ trades, unattributedFunding: funding, weekStart: "2026-10-26" });
  expect(r).toMatchObject({
    weekStart: "2026-10-26",
    tradeCount: 3,
    realizedPnlRaw: -30n,
    netPnlRaw: 30n - 20n - 50n - 7n,
    fundingPaidRaw: 10n + 7n,
    winRatePct: 33,
    tradesWithoutStopPct: 33,
    perplogStops: 1,
  });
  expect(r.topLeak?.id).toBe("NO_STOP_LOSSES");
});

test("an empty week is all zeros with no top leak", () => {
  expect(buildWeeklyReport({ trades: [], unattributedFunding: [], weekStart: "2026-10-26" })).toEqual({
    weekStart: "2026-10-26",
    tradeCount: 0,
    netPnlRaw: 0n,
    realizedPnlRaw: 0n,
    winRatePct: 0,
    fundingPaidRaw: 0n,
    liquidationCostRaw: 0n,
    tradesWithoutStopPct: 0,
    topLeak: null,
    perplogStops: 0,
  });
});
