import { formatAmount, formatUsd, notionalRaw, ratioBps, stepDecimals } from "../src/units";

test("formatUsd negative with separators", () => {
  expect(formatUsd(-1234567000000000000000n)).toBe("-1,234.57 USDso");
});

test("formatUsd never negative zero", () => {
  expect(formatUsd(-4000000000000000n)).toBe("0.00 USDso");
});

test("formatAmount 24 decimals", () => {
  expect(formatAmount(15000000000000000000000000n, 24, 4)).toBe("15.0000");
});

test("formatAmount 6 decimals", () => {
  expect(formatAmount(-53800000n, 6, 2)).toBe("-53.80");
});

test("formatAmount rounds half away from zero", () => {
  expect(formatAmount(5n, 3, 2)).toBe("0.01");
  expect(formatAmount(-5n, 3, 2)).toBe("-0.01");
});

test("notional uses abs size and base decimals (8)", () => {
  // 0.00013 BTC * 80,000 = 10.4 USDso
  expect(notionalRaw(-13000n, 80000n * 10n ** 18n, 8)).toBe(10400000000000000000n);
});

test("ratioBps floors and handles zero", () => {
  expect(ratioBps(1n, 3n)).toBe(3333);
  expect(ratioBps(5n, 0n)).toBe(0);
});

test("stepDecimals shows exactly the digits a tick or lot can move", () => {
  // Real Hideki markets: ETH tick 0.01, 1000PEPE tick 1e-7, BTC tick 0.1, BTC lot 1e-5 (8 decimals).
  expect(stepDecimals(10n ** 16n, 18)).toBe(2);
  expect(stepDecimals(10n ** 11n, 18)).toBe(7);
  expect(stepDecimals(10n ** 17n, 18)).toBe(1);
  expect(stepDecimals(1000n, 8)).toBe(5);
  expect(stepDecimals(5n * 10n ** 15n, 18)).toBe(3);
  expect(stepDecimals(10n ** 18n, 18)).toBe(0);
  expect(stepDecimals(0n, 18)).toBe(18);
});
