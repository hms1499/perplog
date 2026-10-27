import { closePriceBound, planClose } from "../src/close-planner";
import type { Side } from "../src/types";

const base = {
  stopSide: "long" as const,
  qtyMode: "entire" as const,
  qtyRaw: null,
  closedSoFarRaw: 0n,
  lotSize: 1000n,
  minQuantity: 13000n,
};

test("closes the latest size of a long, rounded down to lot", () =>
  expect(planClose({ ...base, positionSize: 25_999n })).toEqual({
    action: "send",
    isBid: false,
    qtyRaw: 25_000n,
  }));

test("short closes with a bid", () =>
  expect(planClose({ ...base, stopSide: "short", positionSize: -20_000n })).toEqual({
    action: "send",
    isBid: true,
    qtyRaw: 20_000n,
  }));

test("flat position ends the stop", () =>
  expect(planClose({ ...base, positionSize: 0n })).toEqual({
    action: "stop",
    event: "position_closed",
  }));

test("flipped position ends the stop without sending", () => {
  expect(planClose({ ...base, positionSize: -20_000n })).toEqual({
    action: "stop",
    event: "position_flipped",
  });
  expect(planClose({ ...base, stopSide: "short", positionSize: 20_000n })).toEqual({
    action: "stop",
    event: "position_flipped",
  });
});

test("fixed qty never exceeds what is left of it", () =>
  expect(
    planClose({
      ...base,
      qtyMode: "fixed",
      qtyRaw: 30_000n,
      closedSoFarRaw: 15_000n,
      positionSize: 100_000n,
    }),
  ).toEqual({ action: "send", isBid: false, qtyRaw: 15_000n }));

test("fixed qty never exceeds the live position", () =>
  expect(planClose({ ...base, qtyMode: "fixed", qtyRaw: 30_000n, positionSize: 20_500n })).toEqual({
    action: "send",
    isBid: false,
    qtyRaw: 20_000n,
  }));

test("fixed qty fully closed ends the stop", () =>
  expect(
    planClose({
      ...base,
      qtyMode: "fixed",
      qtyRaw: 30_000n,
      closedSoFarRaw: 30_000n,
      positionSize: 70_000n,
    }),
  ).toEqual({ action: "stop", event: "filled" }));

test("fixed qty below minQuantity closes the whole position instead", () =>
  expect(planClose({ ...base, qtyMode: "fixed", qtyRaw: 5_000n, positionSize: 20_500n })).toEqual({
    action: "send",
    isBid: false,
    qtyRaw: 20_000n,
  }));

test("dust position fails", () =>
  expect(planClose({ ...base, positionSize: 12_999n })).toEqual({
    action: "fail",
    reason: "dust_position",
  }));

test("a position smaller than one lot fails even with minQuantity 0", () =>
  expect(planClose({ ...base, minQuantity: 0n, positionSize: 999n })).toEqual({
    action: "fail",
    reason: "dust_position",
  }));

test("fuzz: sent qty is positive, <= |size|, a lot multiple, and on the closing side", () => {
  let seed = 123456789n;
  const next = (): bigint => {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n;
    return seed;
  };
  const pick = <T>(items: readonly T[]): T => items[Number(next() >> 33n) % items.length] as T;
  const range = (lo: bigint, hi: bigint): bigint => lo + (((next() << 64n) | next()) % (hi - lo + 1n));

  const lots = [1n, 1000n, 10n ** 12n];
  const limit = 10n ** 24n;
  let sends = 0;
  for (let i = 0; i < 20_000; i++) {
    const lotSize = pick(lots);
    const minQuantity = pick([0n, lotSize, 13n * lotSize]);
    const stopSide = pick<Side>(["long", "short"]);
    // Bias towards sizes near the lot/min scale so dust and rounding paths are hit.
    const size = pick([
      range(-limit, limit),
      range(-20n * lotSize, 20n * lotSize),
      range(-limit, 0n),
      range(0n, limit),
    ]);
    const qtyMode = pick<"entire" | "fixed">(["entire", "fixed"]);
    const qtyRaw = pick([null, range(0n, limit), range(0n, 20n * lotSize)]);
    const closedSoFarRaw = pick([0n, range(0n, limit), range(0n, 20n * lotSize)]);
    const plan = planClose({
      positionSize: size,
      stopSide,
      qtyMode,
      qtyRaw,
      closedSoFarRaw,
      lotSize,
      minQuantity,
    });
    if (plan.action !== "send") continue;
    sends += 1;
    const abs = size < 0n ? -size : size;
    expect(plan.qtyRaw > 0n).toBe(true);
    expect(plan.qtyRaw <= abs).toBe(true);
    expect(plan.qtyRaw % lotSize).toBe(0n);
    expect(plan.isBid).toBe(stopSide === "short");
    expect(size >= 0n ? "long" : "short").toBe(stopSide);
  }
  // The generator must actually exercise the send path.
  expect(sends).toBeGreaterThan(1000);
});

test("price bound: sell floors, buy ceils, both on tick", () => {
  expect(closePriceBound(100_000n, "long", 150, 7n)).toBe(98_497n); // 98_500 floored to tick 7
  expect(closePriceBound(100_000n, "short", 150, 7n)).toBe(101_500n); // 101_500 is on tick (7 x 14_500)
  expect(closePriceBound(100_001n, "short", 150, 7n)).toBe(101_507n); // 101_501.015 ceiled to tick 7
});

test("price bound is never below one tick", () => {
  expect(closePriceBound(5n, "long", 500, 7n)).toBe(7n);
  expect(closePriceBound(100n, "long", 10_000, 7n)).toBe(7n);
});
