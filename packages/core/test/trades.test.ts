import { reconstructTrades } from "../src/trades";
import type { Address, PositionChange } from "../src/types";

const POOL: Address = "0xd6cb1dd58580b84d76068ac21594219ce03aeddf";

const ch = (o: Partial<PositionChange>): PositionChange => ({
  id: "x",
  kind: "OPEN",
  pool: POOL,
  orderId: null,
  blockNumber: 0n,
  logIndex: 0,
  timestamp: 0,
  txHash: "0x0",
  sizeBefore: 0n,
  sizeAfter: 0n,
  closedSize: 0n,
  entryPriceBefore: null,
  entryPriceAfter: null,
  exitPrice: null,
  realizedPnl: 0n,
  ...o,
});

// Real rows from account 0x3952…3951 on the ETH pool.
const real = [
  ch({
    id: "a",
    kind: "OPEN",
    blockNumber: 22060539n,
    logIndex: 3,
    timestamp: 1791857137,
    txHash: "0x6e5a",
    sizeAfter: 406400000000000000n,
    entryPriceAfter: 2462200000000000000000n,
  }),
  ch({
    id: "b",
    kind: "INCREASE",
    blockNumber: 22060539n,
    logIndex: 9,
    timestamp: 1791857137,
    txHash: "0x6e5a",
    sizeBefore: 406400000000000000n,
    sizeAfter: 888900000000000000n,
    entryPriceAfter: 2462227140285746428169n,
  }),
  ch({
    id: "c",
    kind: "REDUCE",
    blockNumber: 22129661n,
    logIndex: 2,
    timestamp: 1791864053,
    txHash: "0x52e7",
    sizeBefore: 888900000000000000n,
    sizeAfter: 849000000000000000n,
    closedSize: 39900000000000000n,
    entryPriceAfter: 2462227140285746428169n,
    exitPrice: 2505530000000000000000n,
    realizedPnl: 1727784102598717516n,
  }),
  ch({
    id: "d",
    kind: "REDUCE",
    blockNumber: 22129661n,
    logIndex: 7,
    timestamp: 1791864053,
    txHash: "0x52e7",
    sizeBefore: 849000000000000000n,
    sizeAfter: 481800000000000000n,
    closedSize: 367200000000000000n,
    entryPriceAfter: 2462227140285746428169n,
    exitPrice: 2505530000000000000000n,
    realizedPnl: 15900810087073911576n,
  }),
  ch({
    id: "e",
    kind: "CLOSE",
    blockNumber: 22129661n,
    logIndex: 12,
    timestamp: 1791864053,
    txHash: "0x52e7",
    sizeBefore: 481800000000000000n,
    sizeAfter: 0n,
    closedSize: 481800000000000000n,
    entryPriceAfter: 0n,
    exitPrice: 2505470000000000000000n,
    realizedPnl: 20834409810327370908n,
  }),
];

test("long round trip from real rows", () => {
  const [t] = reconstructTrades("0x3952", real);
  expect(t).toMatchObject({
    side: "long",
    openedAt: 1791857137,
    closedAt: 1791864053,
    entryPrice: 2462227140285746428169n,
    exitVwap: 2505497478906513668579n,
    maxSize: 888900000000000000n,
    closedSize: 888900000000000000n,
    realizedPnl: 38463004000000000000n,
    partialHistory: false,
  });
  expect(t?.id).toBe(`0x3952:${POOL}:0x6e5a:3`);
});

test("FLIP closes one trade and opens the opposite", () => {
  const trades = reconstructTrades("0xa", [
    ch({
      id: "1",
      kind: "OPEN",
      blockNumber: 1n,
      timestamp: 10,
      txHash: "0x1",
      sizeAfter: 338600000000000000n,
      entryPriceAfter: 2316548187673371911448n,
    }),
    ch({
      id: "2",
      kind: "FLIP",
      blockNumber: 2n,
      timestamp: 20,
      txHash: "0x2",
      sizeBefore: 338600000000000000n,
      sizeAfter: -2684100000000000000n,
      closedSize: 338600000000000000n,
      entryPriceAfter: 2316630000000000000000n,
      exitPrice: 2316630000000000000000n,
      realizedPnl: 27701653796270783n,
    }),
  ]);
  expect(trades).toHaveLength(2);
  expect(trades[0]).toMatchObject({ side: "long", closedAt: 20, realizedPnl: 27701653796270783n });
  expect(trades[1]).toMatchObject({
    side: "short",
    closedAt: null,
    openedAt: 20,
    maxSize: 2684100000000000000n,
    entryPrice: 2316630000000000000000n,
  });
});

test("history starting mid-position is flagged partial", () => {
  const [t] = reconstructTrades("0xa", [
    ch({
      id: "x",
      kind: "CLOSE",
      blockNumber: 5n,
      timestamp: 50,
      txHash: "0x5",
      sizeBefore: -53800000n,
      sizeAfter: 0n,
      closedSize: 53800000n,
      entryPriceBefore: 4400000000000000000n,
      exitPrice: 4500000000000000000n,
      realizedPnl: -236720000000000000n,
    }),
  ]);
  expect(t).toMatchObject({
    side: "short",
    partialHistory: true,
    closedAt: 50,
    realizedPnl: -236720000000000000n,
  });
});

test("unordered input is sorted by block then logIndex", () => {
  expect(reconstructTrades("0x3952", [...real].reverse())[0]?.realizedPnl).toBe(38463004000000000000n);
});

test("full OPEN → INCREASE → REDUCE → INCREASE → FLIP → CLOSE lifecycle (spec §14.1)", () => {
  const step = (n: number, o: Partial<PositionChange>) =>
    ch({ id: `${n}`, blockNumber: BigInt(n), timestamp: n * 10, txHash: `0x${n}`, ...o });
  const trades = reconstructTrades("0xa", [
    step(1, { kind: "OPEN", sizeAfter: 1n, entryPriceAfter: 100n }),
    step(2, { kind: "INCREASE", sizeBefore: 1n, sizeAfter: 3n, entryPriceAfter: 120n }),
    step(3, {
      kind: "REDUCE",
      sizeBefore: 3n,
      sizeAfter: 2n,
      closedSize: 1n,
      exitPrice: 130n,
      realizedPnl: 10n,
    }),
    // Adding after a reduction moves the on-chain average, but the trade keeps its entry.
    step(4, { kind: "INCREASE", sizeBefore: 2n, sizeAfter: 4n, entryPriceAfter: 125n }),
    step(5, {
      kind: "FLIP",
      sizeBefore: 4n,
      sizeAfter: -2n,
      closedSize: 4n,
      exitPrice: 110n,
      entryPriceAfter: 110n,
      realizedPnl: -40n,
    }),
    step(6, {
      kind: "CLOSE",
      sizeBefore: -2n,
      sizeAfter: 0n,
      closedSize: 2n,
      exitPrice: 105n,
      realizedPnl: 10n,
    }),
  ]);
  expect(trades).toHaveLength(2);
  expect(trades[0]).toMatchObject({
    side: "long",
    openedAt: 10,
    closedAt: 50,
    entryPrice: 120n,
    maxSize: 4n,
    closedSize: 5n,
    realizedPnl: -30n,
    // (1 × 130 + 4 × 110) / 5
    exitVwap: 114n,
    txHashes: ["0x1", "0x2", "0x3", "0x4", "0x5"],
    partialHistory: false,
  });
  expect(trades[1]).toMatchObject({
    side: "short",
    openedAt: 50,
    closedAt: 60,
    entryPrice: 110n,
    maxSize: 2n,
    closedSize: 2n,
    realizedPnl: 10n,
    exitVwap: 105n,
    txHashes: ["0x5", "0x6"],
    partialHistory: false,
  });
});
