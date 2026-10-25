import { attributeCosts } from "../src/costs";
import type { Address, Hash, PositionChange, Trade } from "../src/types";

const t = (
  id: string,
  pool: Address,
  openedAt: number,
  closedAt: number | null,
  txs: Hash[],
  pnl: bigint,
): Trade => ({
  id,
  pool,
  side: "long",
  openedAt,
  closedAt,
  entryPrice: 0n,
  exitVwap: null,
  maxSize: 0n,
  closedSize: 0n,
  realizedPnl: pnl,
  txHashes: txs,
  orderIds: [],
  lastChange: {} as PositionChange,
  partialHistory: false,
});

test("funding at the shared boundary goes to the closing trade", () => {
  const r = attributeCosts(
    [t("A", "0xp", 100, 200, ["0x1"], 10n), t("B", "0xp", 200, null, ["0x2"], 0n)],
    [{ id: "f", pool: "0xp", amount: 3n, timestamp: 200, txHash: "0x9" }],
    [],
  );
  expect(r.trades[0]?.costs.funding).toBe(3n);
  expect(r.trades[0]?.netPnl).toBe(7n);
  expect(r.trades[1]?.costs.funding).toBe(0n);
});

test("negative funding (received) increases net pnl", () => {
  const r = attributeCosts(
    [t("A", "0xp", 100, 200, ["0x1"], 10n)],
    [{ id: "f", pool: "0xp", amount: -5n, timestamp: 150, txHash: "0x9" }],
    [],
  );
  expect(r.trades[0]?.netPnl).toBe(15n);
});

test("liquidation fee matched by tx hash", () => {
  const r = attributeCosts(
    [t("A", "0xp", 100, 200, ["0x1", "0xliq"], -100n)],
    [],
    [{ id: "x", kind: "liquidation", pool: "0xp", amount: 40n, timestamp: 200, txHash: "0xliq" }],
  );
  expect(r.trades[0]?.costs.liquidationFee).toBe(40n);
  expect(r.trades[0]?.netPnl).toBe(-140n);
});

test("unmatched funding is reported as unattributed", () => {
  const r = attributeCosts([], [{ id: "f", pool: "0xq", amount: 2n, timestamp: 5, txHash: "0x9" }], []);
  expect(r.unattributed.funding).toBe(2n);
  expect(r.unattributedFunding).toHaveLength(1);
});

test("fees on other pools or unknown txs stay unattributed", () => {
  const r = attributeCosts(
    [t("A", "0xp", 100, 200, ["0x1"], 0n)],
    [],
    [
      { id: "a", kind: "trading", pool: "0xq", amount: 7n, timestamp: 150, txHash: "0x1" },
      { id: "b", kind: "builder", pool: null, amount: 2n, timestamp: 150, txHash: "0x1" },
    ],
  );
  expect(r.trades[0]?.costs.tradingFee).toBe(0n);
  expect(r.trades[0]?.costs.builderFee).toBe(2n);
  expect(r.unattributed.tradingFee).toBe(7n);
});
