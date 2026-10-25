import { isAutomatedCohort } from "../src/cohort";
import { expectedCollateral, reconcile } from "../src/reconcile";
import type { AccountHistory, PositionChange } from "../src/types";

const h = (over: Partial<AccountHistory>): AccountHistory => ({
  account: "0x3952",
  asOfTimestamp: 0,
  truncated: false,
  changes: [],
  funding: [],
  fees: [],
  marginEvents: [],
  marginPulls: [],
  liquidations: [],
  stopOrders: [],
  ...over,
});

test("identity matches the verified account 0x3952", () => {
  const hist = h({
    marginEvents: [
      { id: "c1", kind: "Credited", amount: 2000n * 10n ** 18n, timestamp: 1 },
      { id: "l1", kind: "Locked", amount: 999n, timestamp: 2 },
    ],
    changes: [{ realizedPnl: -1431151600000000000000n } as PositionChange],
    funding: [{ id: "f", pool: "0xp", amount: -1464400000000000000n, timestamp: 3, txHash: "0x1" }],
    fees: [
      {
        id: "x",
        kind: "liquidation",
        pool: "0xp",
        amount: 270540700000000000000n,
        timestamp: 4,
        txHash: "0x2",
      },
    ],
  });
  // 2000 − 1431.1516 + 1.4644 − 270.5407 = 299.7721
  expect(expectedCollateral(hist)).toBe(299772100000000000000n);
  expect(reconcile(hist, 299772100000000000000n + 5n * 10n ** 15n).ok).toBe(true);
  expect(reconcile(hist, 299772100000000000000n + 2n * 10n ** 16n).ok).toBe(false);
});

test("deposits, withdrawals and margin pulls", () => {
  const hist = h({
    marginEvents: [
      { id: "d", kind: "Deposit", amount: 100n, timestamp: 1 },
      { id: "w", kind: "Withdraw", amount: 30n, timestamp: 2 },
      { id: "u", kind: "Unlocked", amount: 999n, timestamp: 3 },
    ],
    marginPulls: [{ id: "p", amount: 5n, timestamp: 4 }],
  });
  expect(expectedCollateral(hist)).toBe(75n);
  expect(reconcile(hist, 75n).deltaRaw).toBe(0n);
});

test("cohort filter", () => {
  expect(isAutomatedCohort(5, -324100000000000000n)).toBe(true);
  expect(isAutomatedCohort(7, -1n)).toBe(false);
  expect(isAutomatedCohort(5, -2n * 10n ** 18n)).toBe(false);
});
