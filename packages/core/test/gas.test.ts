import { planTopUp } from "../src/gas";

const E = 10n ** 17n; // 0.1 STT
const cfg = { thresholdWei: 2n * E, amountWei: 5n * E, dailyCapWei: 20n * E };

test("no top-up at or above the threshold", () => {
  expect(planTopUp({ ...cfg, balanceWei: 3n * E, sentTodayWei: 0n })).toEqual({ action: "none" });
  expect(planTopUp({ ...cfg, balanceWei: 2n * E, sentTodayWei: 0n })).toEqual({ action: "none" });
});

test("tops up the full amount below the threshold", () =>
  expect(planTopUp({ ...cfg, balanceWei: E, sentTodayWei: 0n })).toEqual({
    action: "send",
    amountWei: 5n * E,
  }));

test("tops up only what is left of the daily cap", () =>
  expect(planTopUp({ ...cfg, balanceWei: E, sentTodayWei: 17n * E })).toEqual({
    action: "send",
    amountWei: 3n * E,
  }));

test("capped once the daily cap is used", () => {
  expect(planTopUp({ ...cfg, balanceWei: E, sentTodayWei: 20n * E })).toEqual({ action: "capped" });
  expect(planTopUp({ ...cfg, balanceWei: E, sentTodayWei: 21n * E })).toEqual({ action: "capped" });
});
