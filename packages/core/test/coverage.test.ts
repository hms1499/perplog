import { stopCoverageBps, tradeHadStop } from "../src/coverage";
import { stop, trade } from "./helpers";

test("stop cancelled before the trade opened does not count", () => {
  const t = trade({ openedAt: 100, closedAt: 200 });
  expect(tradeHadStop(t, [stop({ createdAt: 50, status: "CANCELLED", updatedAt: 90 })], 1000)).toBe(false);
  expect(tradeHadStop(t, [stop({ createdAt: 50, status: "CANCELLED", updatedAt: 150 })], 1000)).toBe(true);
});

test("stop created after the trade closed does not count", () => {
  expect(
    tradeHadStop(trade({ openedAt: 100, closedAt: 200 }), [stop({ createdAt: 250, updatedAt: 250 })], 1000),
  ).toBe(false);
});

test("a take-profit is not a stop-loss", () => {
  expect(tradeHadStop(trade(), [stop({ isBid: false, triggerOperator: 0 })], 1000)).toBe(false);
});

test("short trades need a buy stop that fires at or above", () => {
  const t = trade({ side: "short" });
  expect(tradeHadStop(t, [stop({ isBid: true, triggerOperator: 0 })], 1000)).toBe(true);
  expect(tradeHadStop(t, [stop({ isBid: false, triggerOperator: 1 })], 1000)).toBe(false);
});

test("coverage: whole-position stop is 100%, partial sums, capped", () => {
  expect(stopCoverageBps("long", 1000n, "0xp", [stop({ quantity: 0n })])).toBe(10000);
  expect(stopCoverageBps("long", 1000n, "0xp", [stop({ quantity: 300n }), stop({ quantity: 200n })])).toBe(
    5000,
  );
  expect(stopCoverageBps("long", 1000n, "0xp", [stop({ quantity: 800n }), stop({ quantity: 800n })])).toBe(
    10000,
  );
  expect(stopCoverageBps("long", 1000n, "0xq", [stop({ quantity: 0n })])).toBe(0);
  expect(stopCoverageBps("long", 0n, "0xp", [stop({ quantity: 0n })])).toBe(0);
});

test("coverage ignores non-pending stops and uses absolute size for shorts", () => {
  expect(stopCoverageBps("long", 1000n, "0xp", [stop({ status: "CANCELLED" })])).toBe(0);
  expect(
    stopCoverageBps("short", -1000n, "0xp", [stop({ isBid: true, triggerOperator: 0, quantity: 250n })]),
  ).toBe(2500);
});
