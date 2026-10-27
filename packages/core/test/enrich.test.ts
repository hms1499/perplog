import { enrichTrades } from "../src/enrich";
import type { AccountHistory, MarketInfo } from "../src/types";
import { costed } from "./helpers";

const history: AccountHistory = {
  account: "0xa",
  asOfTimestamp: 1000,
  truncated: false,
  changes: [],
  funding: [],
  fees: [],
  marginEvents: [],
  marginPulls: [],
  liquidations: [],
  stopOrders: [],
};

const ETH: MarketInfo = {
  pool: "0xp",
  symbol: "ETH",
  baseDecimals: 18,
  tickSize: 10n ** 16n,
  lotSize: 10n ** 14n,
  minQuantity: 1n,
  stopRegistry: null,
};

test("enrich computes notional and symbol for known pools", () => {
  const [t] = enrichTrades(
    {
      trades: [costed({ maxSize: 2n * 10n ** 18n, entryPrice: 2500n * 10n ** 18n })],
      unattributed: { funding: 0n, liquidationFee: 0n, tradingFee: 0n, builderFee: 0n },
      unattributedFunding: [],
    },
    history,
    new Map([["0xp", ETH]]),
    1000,
  );
  expect(t).toMatchObject({
    symbol: "ETH",
    maxNotional: 5000n * 10n ** 18n,
    exitType: "MANUAL",
    hadStop: false,
    baseDecimals: 18,
    sizeDecimals: 4,
    priceDecimals: 2,
  });
});

test("enrich falls back for unknown pools", () => {
  const pool = "0x1234567890abcdef1234567890abcdef1234abcd";
  const [t] = enrichTrades(
    {
      trades: [costed({ pool, maxSize: 5n, entryPrice: 7n })],
      unattributed: { funding: 0n, liquidationFee: 0n, tradingFee: 0n, builderFee: 0n },
      unattributedFunding: [],
    },
    history,
    new Map(),
    1000,
  );
  expect(t).toMatchObject({
    symbol: "0x1234…abcd",
    maxNotional: 0n,
    baseDecimals: 18,
    sizeDecimals: 4,
    priceDecimals: 4,
  });
});
