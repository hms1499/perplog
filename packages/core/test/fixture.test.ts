import { type AccountFixture, readFixture, writeFixture } from "../src/fixture";

test("fixture round-trips bigints", () => {
  const f: AccountFixture = {
    account: "0xa",
    asOfBlock: 32673096n,
    asOfTimestamp: 1,
    collateralRaw: -5n,
    history: {
      account: "0xa",
      asOfTimestamp: 1,
      truncated: false,
      changes: [],
      funding: [{ id: "f", pool: "0xp", amount: 123456789012345678901234n, timestamp: 2, txHash: "0x1" }],
      fees: [],
      marginEvents: [],
      marginPulls: [],
      liquidations: [],
      stopOrders: [],
    },
    markets: [],
    openPositions: [],
  };
  expect(readFixture(writeFixture(f))).toEqual(f);
});
