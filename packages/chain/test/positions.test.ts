import type { Address, MarketInfo, StopOrderRecord } from "@perplog/core";
import { getOpenPositions } from "../src/onchain";

const E18 = 10n ** 18n;
const POOL: Address = "0x00000000000000000000000000000000000000e1";
const FLAT: Address = "0x00000000000000000000000000000000000000f1";
const ETH: MarketInfo = {
  pool: POOL,
  symbol: "ETH",
  baseDecimals: 18,
  tickSize: 1n,
  lotSize: 1n,
  minQuantity: 1n,
  stopRegistry: null,
};

function fakeClient(o: { size: bigint; entry: bigint; mark: bigint; liq: bigint | null | Error }) {
  return {
    getPerpPosition: vi.fn(async ({ pool }: { pool: Address }) => ({
      size: pool === FLAT ? 0n : o.size,
      avgEntryPrice: o.entry,
      entryFundingIndex: 0n,
      lastUpdatedTimestampNs: 0n,
    })),
    getPerpState: vi.fn(async () => ({ markPrice: o.mark, markPriceOk: true, indexPrice: o.mark })),
    getLiquidationPrice: vi.fn(async () => {
      if (o.liq instanceof Error) throw o.liq;
      return o.liq;
    }),
  };
}

const base = {
  marginBank: "0x478769e1177c0773c43a593dccc4ad15f15f1394" as Address,
  account: "0x00000000000000000000000000000000000000aa" as Address,
  markets: new Map([[POOL, ETH]]),
  nowSec: 1_000_000,
};

test("short position: unrealized pnl positive when mark below entry", async () => {
  const stop: StopOrderRecord = {
    id: "s",
    pool: POOL,
    status: "PENDING",
    isBid: true,
    triggerOperator: 0,
    triggerPrice: 2600n * E18,
    quantity: 0n,
    createdAt: 1,
    updatedAt: 1,
    placedOrderId: null,
  };
  const [p] = await getOpenPositions({
    ...base,
    client: fakeClient({ size: -2n * E18, entry: 2500n * E18, mark: 2400n * E18, liq: 2700n * E18 }) as never,
    activePools: [POOL],
    stopOrders: [stop],
    funding: [
      { id: "f1", pool: POOL, amount: 3n, timestamp: base.nowSec - 100, txHash: "0x1" },
      { id: "f2", pool: POOL, amount: 9n, timestamp: base.nowSec - 90_000, txHash: "0x2" },
    ],
  });
  expect(p).toMatchObject({
    symbol: "ETH",
    side: "short",
    sizeRaw: -2n * E18,
    unrealizedPnlRaw: 200n * E18,
    stopCoverageBps: 10000,
    fundingLast24hRaw: 3n,
    markFromIndex: false,
  });
});

test("flat pools are skipped and liquidation price errors become null", async () => {
  const positions = await getOpenPositions({
    ...base,
    client: fakeClient({ size: E18, entry: 100n * E18, mark: 100n * E18, liq: new Error("revert") }) as never,
    activePools: [FLAT, POOL],
    stopOrders: [],
    funding: [],
  });
  expect(positions).toHaveLength(1);
  expect(positions[0]).toMatchObject({ liquidationPrice: null, liqDistanceBps: null, stopCoverageBps: 0 });
});

test("liqDistanceBps from mark and liquidation price", async () => {
  const [p] = await getOpenPositions({
    ...base,
    client: fakeClient({ size: E18, entry: 100n * E18, mark: 100n * E18, liq: 90n * E18 }) as never,
    activePools: [POOL],
    stopOrders: [],
    funding: [],
  });
  expect(p?.liqDistanceBps).toBe(1000);
});
