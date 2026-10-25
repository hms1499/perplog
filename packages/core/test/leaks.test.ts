import { computeLeaks } from "../src/leaks";
import { enriched } from "./helpers";

const costs = (o: Partial<{ funding: bigint; liquidationFee: bigint }> = {}) => ({
  funding: 0n,
  liquidationFee: 0n,
  tradingFee: 0n,
  builderFee: 0n,
  ...o,
});

test("liquidation leak sums fee and realized loss", () => {
  const leaks = computeLeaks(
    [
      enriched({
        id: "L",
        exitType: "LIQUIDATED",
        realizedPnl: -100n,
        costs: costs({ liquidationFee: 40n }),
        netPnl: -140n,
      }),
    ],
    [],
  );
  const leak = leaks.find((l) => l.id === "LIQUIDATION_COST");
  expect(leak).toMatchObject({
    title: "Liquidations",
    amountRaw: 140n,
    evidenceTradeIds: ["L"],
    fix: "PROTECT_NOW",
  });
});

test("no-stop leak ignores winning trades and trades with a stop", () => {
  const leaks = computeLeaks(
    [
      enriched({ id: "a", hadStop: false, netPnl: -30n }),
      enriched({ id: "b", hadStop: false, netPnl: 50n }),
      enriched({ id: "c", hadStop: true, netPnl: -70n }),
    ],
    [],
  );
  expect(leaks.find((l) => l.id === "NO_STOP_LOSSES")).toMatchObject({
    title: "Losses on trades without a stop-loss",
    amountRaw: 30n,
    evidenceTradeIds: ["a"],
    fix: "ALWAYS_PROTECT",
  });
});

test("funding leak includes positive unattributed funding only", () => {
  const leaks = computeLeaks(
    [
      enriched({ id: "f", costs: costs({ funding: 5n }) }),
      enriched({ id: "g", costs: costs({ funding: -9n }) }),
    ],
    [
      { id: "u1", pool: "0xp", amount: 3n, timestamp: 1, txHash: "0x1" },
      { id: "u2", pool: "0xp", amount: -2n, timestamp: 1, txHash: "0x2" },
    ],
  );
  expect(leaks.find((l) => l.id === "FUNDING_DRAG")).toMatchObject({
    title: "Funding you paid",
    amountRaw: 8n,
    evidenceTradeIds: ["f"],
    fix: "SHOW_FUNDING",
  });
});

test("tilt: oversized trade 10 min after a loss is flagged; 40 min after is not", () => {
  const leaks = computeLeaks(
    [
      enriched({ id: "n1", openedAt: 10, closedAt: 20, maxNotional: 100n, netPnl: 1n }),
      enriched({ id: "n2", openedAt: 30, closedAt: 40, maxNotional: 100n, netPnl: 1n }),
      enriched({ id: "loss", openedAt: 900, closedAt: 1000, maxNotional: 100n, netPnl: -10n }),
      enriched({ id: "X", openedAt: 1600, closedAt: 1650, maxNotional: 150n, netPnl: -25n }),
      enriched({ id: "Y", openedAt: 3500, closedAt: 3600, maxNotional: 300n, netPnl: 40n }),
    ],
    [],
  );
  expect(leaks.find((l) => l.id === "SIZE_UP_AFTER_LOSS")).toMatchObject({
    title: "Sizing up right after a loss",
    amountRaw: 25n,
    evidenceTradeIds: ["X"],
    fix: "FIXED_RISK",
  });
});

test("unknown-market trades (maxNotional 0) never count as tilt", () => {
  const leaks = computeLeaks(
    [
      enriched({ id: "loss", openedAt: 900, closedAt: 1000, maxNotional: 100n, netPnl: -10n }),
      enriched({ id: "unknown", openedAt: 1100, closedAt: 1200, maxNotional: 0n, netPnl: -50n }),
    ],
    [],
  );
  expect(leaks.find((l) => l.id === "SIZE_UP_AFTER_LOSS")).toBeUndefined();
});

test("leaks sorted by amount desc and zero leaks omitted; share uses total loss", () => {
  const leaks = computeLeaks(
    [
      enriched({
        id: "L",
        exitType: "LIQUIDATED",
        realizedPnl: -100n,
        costs: costs({ liquidationFee: 40n }),
        netPnl: -140n,
        hadStop: true,
      }),
      enriched({ id: "m", hadStop: false, netPnl: -60n }),
    ],
    [],
  );
  expect(leaks.map((l) => l.id)).toEqual(["LIQUIDATION_COST", "NO_STOP_LOSSES"]);
  expect(leaks[0]?.shareOfLossBps).toBe(7000);
});
