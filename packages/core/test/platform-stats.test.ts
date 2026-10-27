import { computeNoStopStats } from "../src/platform";
import type { Address, PositionChange, StopOrderRecord } from "../src/types";
import { change, stop } from "./helpers";

const E18 = 10n ** 18n;
type Owned<T> = T & { owner: Address };

test("cohort accounts are excluded and the stop window is −60s..+600s", () => {
  const changes: Owned<PositionChange>[] = [
    { ...change({ id: "a1", kind: "OPEN", pool: "0xp", timestamp: 1000 }), owner: "0xa" },
    { ...change({ id: "a2", kind: "OPEN", pool: "0xq", timestamp: 2000 }), owner: "0xa" },
    { ...change({ id: "a3", kind: "OPEN", pool: "0xr", timestamp: 3000 }), owner: "0xa" },
    {
      ...change({ id: "a4", kind: "CLOSE", pool: "0xp", timestamp: 3500, realizedPnl: -5n * E18 }),
      owner: "0xa",
    },
    { ...change({ id: "b1", kind: "OPEN", pool: "0xp", timestamp: 1000 }), owner: "0xb" },
    {
      ...change({ id: "b2", kind: "CLOSE", pool: "0xp", timestamp: 1100, realizedPnl: -3n * 10n ** 17n }),
      owner: "0xb",
    },
  ];
  const stops: Owned<StopOrderRecord>[] = [
    { ...stop({ id: "s1", pool: "0xp", createdAt: 1300 }), owner: "0xa" },
    { ...stop({ id: "s2", pool: "0xq", createdAt: 2900 }), owner: "0xa" },
    { ...stop({ id: "s3", pool: "0xp", createdAt: 1010 }), owner: "0xb" },
  ];
  expect(
    computeNoStopStats(
      changes,
      stops,
      (c) => (c as Owned<PositionChange>).owner,
      (s) => (s as Owned<StopOrderRecord>).owner,
    ),
  ).toEqual({ newPositions: 3, accounts: 1, withStopPct: 33, noStopPct: 67 });
});

test("no positions gives zeros", () => {
  expect(
    computeNoStopStats(
      [],
      [],
      () => "0xa",
      () => "0xa",
    ),
  ).toEqual({
    newPositions: 0,
    accounts: 0,
    withStopPct: 0,
    noStopPct: 0,
  });
});

test("only a stop-loss for the opened side counts, and too-recent opens are left out", () => {
  const changes: Owned<PositionChange>[] = [
    // Long protected only by a take-profit (sell-at-or-above): unprotected.
    { ...change({ id: "l1", kind: "OPEN", pool: "0xp", timestamp: 1000, sizeAfter: 5n }), owner: "0xa" },
    // Short protected by a buy-at-or-above stop: protected.
    { ...change({ id: "s1", kind: "OPEN", pool: "0xq", timestamp: 1000, sizeAfter: -5n }), owner: "0xa" },
    // Opened 5 minutes before the window end: its stop could still arrive.
    { ...change({ id: "r1", kind: "OPEN", pool: "0xr", timestamp: 9700, sizeAfter: 5n }), owner: "0xa" },
    {
      ...change({ id: "c1", kind: "CLOSE", pool: "0xp", timestamp: 2000, realizedPnl: -5n * E18 }),
      owner: "0xa",
    },
  ];
  const stops: Owned<StopOrderRecord>[] = [
    { ...stop({ id: "tp", pool: "0xp", createdAt: 1010, isBid: false, triggerOperator: 0 }), owner: "0xa" },
    { ...stop({ id: "sl", pool: "0xq", createdAt: 1010, isBid: true, triggerOperator: 0 }), owner: "0xa" },
  ];
  expect(
    computeNoStopStats(
      changes,
      stops,
      (c) => (c as Owned<PositionChange>).owner,
      (s) => (s as Owned<StopOrderRecord>).owner,
      10_000,
    ),
  ).toEqual({ newPositions: 2, accounts: 1, withStopPct: 50, noStopPct: 50 });
});
