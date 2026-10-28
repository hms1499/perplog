import { capEntry, sizeEntry, stopBeyondLiquidation } from "../src/sizing";
import type { MarketInfo } from "../src/types";

const E18 = 10n ** 18n;

const market = (over: Partial<MarketInfo> = {}): MarketInfo => ({
  pool: `0x${"b1".repeat(20)}`,
  symbol: "X-PERP",
  baseDecimals: 18,
  tickSize: 10n ** 14n,
  lotSize: 10n ** 15n,
  minQuantity: 10n ** 15n,
  stopRegistry: null,
  ...over,
});

const ok = (r: ReturnType<typeof sizeEntry>) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r;
};

test("long sizes from bestAsk and floors to the lot", () => {
  const r = ok(
    sizeEntry({
      market: market(),
      side: "long",
      riskRaw: 10n * E18,
      stopPrice: 95n * E18,
      bestBid: 99n * E18,
      bestAsk: 100n * E18,
    }),
  );
  expect(r).toEqual({
    ok: true,
    refPrice: 100n * E18,
    qtyRaw: 2n * E18,
    priceBound: 1005n * 10n ** 17n,
    notionalRaw: 200n * E18,
    effectiveRiskRaw: 10n * E18,
  });
});

test("short sizes from bestBid; priceBound rounds up to the tick", () => {
  const r = ok(
    sizeEntry({
      market: market(),
      side: "short",
      riskRaw: 10n * E18,
      stopPrice: 103n * E18,
      bestBid: 100_000_030_000_000_000_000n,
      bestAsk: 101n * E18,
    }),
  );
  expect(r.refPrice).toBe(100_000_030_000_000_000_000n);
  // 10e18 · 1e18 / 2.99997e18 = 3.33336…e18, floored to the 1e15 lot.
  expect(r.qtyRaw).toBe(3_333_000_000_000_000_000n);
  // 100.00003 · 0.995 = 99.50002985 → ceil to 0.0001.
  expect(r.priceBound).toBe(99_500_100_000_000_000_000n);
});

test.each([
  // baseDecimals, lot, min, P, S, R, expected qty
  [6, 10n, 10n, 2000n * E18, 1900n * E18, 50n * E18, 500_000n],
  [8, 1000n, 13_000n, 64_248n * E18, 63_900n * E18, 25n * E18, 7_183_000n],
  [24, E18, E18, E18, 9n * 10n ** 17n, 10n * E18, 10n ** 26n],
] as const)("%i base decimals give the exact floored quantity", (baseDecimals, lot, min, p, s, risk, qty) => {
  const r = ok(
    sizeEntry({
      market: market({ baseDecimals, lotSize: lot, minQuantity: min }),
      side: "long",
      riskRaw: risk,
      stopPrice: s,
      bestBid: null,
      bestAsk: p,
    }),
  );
  expect(r.qtyRaw).toBe(qty);
  expect(r.qtyRaw % lot).toBe(0n);
});

test("BTC lot 1000 min 13000: a risk below one min lot is risk_too_small", () => {
  expect(
    sizeEntry({
      market: market({ baseDecimals: 8, lotSize: 1000n, minQuantity: 13_000n }),
      side: "long",
      riskRaw: 10n ** 16n,
      stopPrice: 63_900n * E18,
      bestBid: null,
      bestAsk: 64_248n * E18,
    }),
  ).toEqual({ ok: false, error: "risk_too_small" });
});

test("long with stop ≥ P is stop_wrong_side; short with stop ≤ P is stop_wrong_side", () => {
  const base = { market: market(), riskRaw: 10n * E18, bestBid: 99n * E18, bestAsk: 100n * E18 };
  expect(sizeEntry({ ...base, side: "long", stopPrice: 100n * E18 })).toEqual({
    ok: false,
    error: "stop_wrong_side",
  });
  expect(sizeEntry({ ...base, side: "short", stopPrice: 99n * E18 })).toEqual({
    ok: false,
    error: "stop_wrong_side",
  });
});

test("missing ask for a long (or bid for a short) is no_liquidity", () => {
  const base = { market: market(), riskRaw: 10n * E18 };
  expect(
    sizeEntry({ ...base, side: "long", stopPrice: 95n * E18, bestBid: 99n * E18, bestAsk: null }),
  ).toEqual({ ok: false, error: "no_liquidity" });
  expect(
    sizeEntry({ ...base, side: "short", stopPrice: 105n * E18, bestBid: null, bestAsk: 100n * E18 }),
  ).toEqual({ ok: false, error: "no_liquidity" });
});

test("capEntry floors maxQty to the lot, sets capped, recomputes effectiveRiskRaw; below minQuantity is risk_too_small", () => {
  const m = market();
  const size = ok(
    sizeEntry({
      market: m,
      side: "long",
      riskRaw: 10n * E18,
      stopPrice: 95n * E18,
      bestBid: null,
      bestAsk: 100n * E18,
    }),
  );
  expect(capEntry(size, 5n * E18, m, 95n * E18)).toEqual({ ...size, capped: false });
  expect(capEntry(size, 1_234_567_000_000_000_000n, m, 95n * E18)).toEqual({
    ...size,
    qtyRaw: 1_234_000_000_000_000_000n,
    notionalRaw: 123_400_000_000_000_000_000n,
    effectiveRiskRaw: 6_170_000_000_000_000_000n,
    capped: true,
  });
  expect(capEntry(size, 5n * 10n ** 14n, m, 95n * E18)).toEqual({ ok: false, error: "risk_too_small" });
});

test("stopBeyondLiquidation: long blocks liq ≥ stop, short blocks liq ≤ stop, null never blocks", () => {
  expect(stopBeyondLiquidation("long", 95n, 96n)).toBe(true);
  expect(stopBeyondLiquidation("long", 95n, 95n)).toBe(true);
  expect(stopBeyondLiquidation("long", 95n, 90n)).toBe(false);
  expect(stopBeyondLiquidation("short", 105n, 104n)).toBe(true);
  expect(stopBeyondLiquidation("short", 105n, 110n)).toBe(false);
  expect(stopBeyondLiquidation("long", 95n, null)).toBe(false);
});
