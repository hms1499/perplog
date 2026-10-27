import type { AccountHistory, Address, MarketInfo, PositionChange } from "@perplog/core";
import { type AccountServiceDeps, ChainUnavailableError, createAccountService } from "./account-service";

const ACCOUNT: Address = "0x00000000000000000000000000000000000000aa";
const POOL: Address = "0x00000000000000000000000000000000000000e1";
const E18 = 10n ** 18n;
const NOW = 2_000_000_000;

const market: MarketInfo = {
  pool: POOL,
  symbol: "ETH",
  baseDecimals: 18,
  tickSize: 1n,
  lotSize: 1n,
  minQuantity: 1n,
  stopRegistry: null,
};

const change = (o: Partial<PositionChange>): PositionChange => ({
  id: "c",
  kind: "OPEN",
  pool: POOL,
  orderId: null,
  blockNumber: 1n,
  logIndex: 0,
  timestamp: NOW - 100,
  txHash: "0x01",
  sizeBefore: 0n,
  sizeAfter: E18,
  closedSize: 0n,
  entryPriceBefore: null,
  entryPriceAfter: 100n * E18,
  exitPrice: null,
  realizedPnl: 0n,
  ...o,
});

function roundTrip(i: number, pnl: bigint, liquidated = false): PositionChange[] {
  const t = NOW - 10_000 + i * 100;
  return [
    change({ id: `o${i}`, blockNumber: BigInt(i * 2), timestamp: t, txHash: `0xo${i}` }),
    change({
      id: `c${i}`,
      kind: "CLOSE",
      blockNumber: BigInt(i * 2 + 1),
      timestamp: t + 50,
      txHash: liquidated ? "0xliq" : `0xc${i}`,
      sizeBefore: E18,
      sizeAfter: 0n,
      closedSize: E18,
      exitPrice: 100n * E18,
      realizedPnl: pnl,
    }),
  ];
}

const emptyHistory = (o: Partial<AccountHistory> = {}): AccountHistory => ({
  account: ACCOUNT,
  asOfTimestamp: NOW,
  truncated: false,
  changes: [],
  funding: [],
  fees: [],
  marginEvents: [],
  marginPulls: [],
  liquidations: [],
  stopOrders: [],
  ...o,
});

function deps(
  history: AccountHistory,
  clock = { now: NOW },
): AccountServiceDeps & { calls: { history: number } } {
  const calls = { history: 0 };
  return {
    calls,
    fetchMarkets: async () => [market],
    fetchHistory: async () => {
      calls.history += 1;
      await new Promise((r) => setTimeout(r, 5));
      return history;
    },
    fetchCollateral: async () => ({ collateralRaw: 0n, activePools: [] }),
    fetchOpenPositions: async () => [],
    now: () => clock.now,
  };
}

test("empty history → empty true, zero summary, no throw", async () => {
  const service = createAccountService(deps(emptyHistory()));
  const health = await service.getHealth(ACCOUNT, "7d");
  expect(health).toMatchObject({
    empty: true,
    tradeCount: 0,
    netPnlRaw: 0n,
    topLeak: null,
    truncated: false,
  });
});

test("truncated history → reconcile null", async () => {
  const service = createAccountService(deps(emptyHistory({ truncated: true, changes: roundTrip(1, E18) })));
  const health = await service.getHealth(ACCOUNT, "all");
  expect(health.truncated).toBe(true);
  expect(health.reconcile).toBeNull();
});

test("reconciles when history is complete", async () => {
  const history = emptyHistory({
    changes: roundTrip(1, 5n * E18),
    marginEvents: [{ id: "m", kind: "Credited", amount: 1000n * E18, timestamp: 1 }],
  });
  const d = deps(history);
  d.fetchCollateral = async () => ({ collateralRaw: 1005n * E18, activePools: [] });
  const health = await createAccountService(d).getHealth(ACCOUNT, "all");
  expect(health.reconcile?.ok).toBe(true);
});

test("results are cached for the TTL and concurrent calls share one fetch", async () => {
  const clock = { now: NOW };
  const d = deps(emptyHistory({ changes: roundTrip(1, E18) }), clock);
  const service = createAccountService(d, 60_000);
  await Promise.all([service.getHealth(ACCOUNT, "7d"), service.getHealth(ACCOUNT, "30d")]);
  expect(d.calls.history).toBe(1);
  await service.getLeaks(ACCOUNT, "7d");
  expect(d.calls.history).toBe(1);
  clock.now += 61;
  await service.getHealth(ACCOUNT, "7d");
  expect(d.calls.history).toBe(2);
});

test("getTrades paginates with cursor and filters by exit type", async () => {
  const changes = [
    ...roundTrip(1, E18),
    ...roundTrip(2, -E18, true),
    ...roundTrip(3, 2n * E18),
    ...roundTrip(4, 3n * E18),
  ];
  const history = emptyHistory({
    changes,
    liquidations: [{ id: "l", kind: "PositionLiquidated", pool: POOL, txHash: "0xliq", timestamp: NOW }],
  });
  const service = createAccountService(deps(history));
  const page1 = await service.getTrades(ACCOUNT, { range: "all", limit: 2 });
  expect(page1.trades).toHaveLength(2);
  expect(page1.trades[0]?.closedAt).toBeGreaterThan(page1.trades[1]?.closedAt ?? 0);
  expect(page1.nextCursor).toBe("2");
  const page2 = await service.getTrades(ACCOUNT, { range: "all", limit: 2, cursor: "2" });
  expect(page2.trades).toHaveLength(2);
  expect(page2.nextCursor).toBeNull();
  const liquidated = await service.getTrades(ACCOUNT, { range: "all", exit: "LIQUIDATED" });
  expect(liquidated.trades.map((t) => t.exitType)).toEqual(["LIQUIDATED"]);
});

test("a failed collateral read degrades to an unreconciled report instead of failing", async () => {
  const d = deps(emptyHistory({ changes: roundTrip(1, 5n * E18) }));
  d.fetchCollateral = async () => {
    throw new Error("WebSocket closed");
  };
  const service = createAccountService(d);
  const health = await service.getHealth(ACCOUNT, "all");
  expect(health).toMatchObject({ empty: false, tradeCount: 1, netPnlRaw: 5n * E18, truncated: false });
  expect(health.reconcile).toBeNull();
  expect(health.chainReadFailed).toBe(true);
  expect((await service.getTrades(ACCOUNT, { range: "all" })).trades).toHaveLength(1);
});

test("positions report the chain as unavailable when the collateral read failed", async () => {
  const d = deps(emptyHistory({ changes: roundTrip(1, E18) }));
  d.fetchCollateral = async () => {
    throw new Error("WebSocket closed");
  };
  await expect(createAccountService(d).getPositions(ACCOUNT)).rejects.toBeInstanceOf(ChainUnavailableError);
});

test("positions report the chain as unavailable when the position read fails", async () => {
  const d = deps(emptyHistory({ changes: roundTrip(1, E18) }));
  d.fetchOpenPositions = async () => {
    throw new Error("request timed out");
  };
  await expect(createAccountService(d).getPositions(ACCOUNT)).rejects.toBeInstanceOf(ChainUnavailableError);
});

test("a degraded result is retried soon instead of being cached for the full TTL", async () => {
  const clock = { now: NOW };
  const d = deps(emptyHistory({ changes: roundTrip(1, E18) }), clock);
  let rpcUp = false;
  d.fetchCollateral = async () => {
    if (!rpcUp) throw new Error("WebSocket closed");
    return { collateralRaw: 0n, activePools: [] };
  };
  const service = createAccountService(d, 60_000);
  expect((await service.getHealth(ACCOUNT, "all")).chainReadFailed).toBe(true);
  rpcUp = true;
  clock.now += 11;
  expect((await service.getHealth(ACCOUNT, "all")).chainReadFailed).toBe(false);
  expect(d.calls.history).toBe(2);
});

test("getTrades tells an active account with nothing in range apart from an empty one", async () => {
  const old = roundTrip(1, E18).map((c) => ({ ...c, timestamp: c.timestamp - 8 * 86_400 }));
  const active = await createAccountService(deps(emptyHistory({ changes: old }))).getTrades(ACCOUNT, {
    range: "7d",
  });
  expect(active).toMatchObject({ trades: [], empty: false });
  const empty = await createAccountService(deps(emptyHistory())).getTrades(ACCOUNT, { range: "7d" });
  expect(empty).toMatchObject({ trades: [], empty: true });
});

test("getTrades narrows to one leak's evidence and paginates it", async () => {
  const changes = [
    ...roundTrip(1, -E18, true),
    ...roundTrip(2, 2n * E18),
    ...roundTrip(3, -2n * E18, true),
    ...roundTrip(4, 3n * E18),
    ...roundTrip(5, -3n * E18, true),
  ];
  const history = emptyHistory({
    changes,
    liquidations: [{ id: "l", kind: "PositionLiquidated", pool: POOL, txHash: "0xliq", timestamp: NOW }],
  });
  const service = createAccountService(deps(history));
  const page1 = await service.getTrades(ACCOUNT, { range: "all", leak: "LIQUIDATION_COST", limit: 2 });
  expect(page1.trades.map((t) => t.realizedPnl)).toEqual([-3n * E18, -2n * E18]);
  expect(page1.nextCursor).toBe("2");
  const page2 = await service.getTrades(ACCOUNT, { range: "all", leak: "LIQUIDATION_COST", cursor: "2" });
  expect(page2.trades.map((t) => t.realizedPnl)).toEqual([-E18]);
  expect(page2.nextCursor).toBeNull();
});

test("the cache is bounded by the rows it holds, not only by the number of accounts", async () => {
  const OTHER: Address = "0x00000000000000000000000000000000000000bb";
  // 4 changes + 2 trades = 6 rows per account.
  const history = emptyHistory({ changes: [...roundTrip(1, E18), ...roundTrip(2, E18)] });
  const roomy = deps(history);
  const big = createAccountService(roomy, 60_000, 100);
  await big.getHealth(ACCOUNT, "all");
  await big.getHealth(OTHER, "all");
  await big.getHealth(ACCOUNT, "all");
  expect(roomy.calls.history).toBe(2);

  const tight = deps(history);
  const small = createAccountService(tight, 60_000, 10);
  await small.getHealth(ACCOUNT, "all");
  await small.getHealth(OTHER, "all");
  await small.getHealth(ACCOUNT, "all");
  expect(tight.calls.history).toBe(3);
});

test("ranges use the clock of the account asked about", async () => {
  const OTHER: Address = "0x00000000000000000000000000000000000000bb";
  const d = deps(emptyHistory({ changes: roundTrip(1, E18) }));
  // Fixture mode pins each account to its own capture time.
  d.now = (account?: Address) => (account === OTHER ? NOW + 30 * 86_400 : NOW);
  const service = createAccountService(d);
  expect((await service.getHealth(ACCOUNT, "7d")).tradeCount).toBe(1);
  expect((await service.getHealth(OTHER, "7d")).tradeCount).toBe(0);
  expect((await service.getTrades(OTHER, { range: "7d" })).trades).toHaveLength(0);
});
