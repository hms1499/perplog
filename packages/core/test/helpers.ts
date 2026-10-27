import type { CostedTrade, EnrichedTrade, PositionChange, StopOrderRecord, Trade } from "../src/types";

export const change = (o: Partial<PositionChange> = {}): PositionChange => ({
  id: "c",
  kind: "CLOSE",
  pool: "0xp",
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

export const trade = (o: Partial<Trade> = {}): Trade => ({
  id: "t",
  pool: "0xp",
  side: "long",
  openedAt: 100,
  closedAt: 200,
  entryPrice: 0n,
  exitVwap: null,
  maxSize: 0n,
  closedSize: 0n,
  realizedPnl: 0n,
  txHashes: [],
  orderIds: [],
  lastChange: change(),
  partialHistory: false,
  ...o,
});

export const costed = (o: Partial<CostedTrade> = {}): CostedTrade => ({
  ...trade(o),
  costs: { funding: 0n, liquidationFee: 0n, tradingFee: 0n, builderFee: 0n },
  netPnl: 0n,
  ...o,
});

export const enriched = (o: Partial<EnrichedTrade> = {}): EnrichedTrade => ({
  ...costed(o),
  exitType: "MANUAL",
  hadStop: true,
  maxNotional: 100n,
  symbol: "ETH",
  baseDecimals: 18,
  sizeDecimals: 4,
  priceDecimals: 2,
  ...o,
});

export const stop = (o: Partial<StopOrderRecord> = {}): StopOrderRecord => ({
  id: "s",
  pool: "0xp",
  status: "PENDING",
  isBid: false,
  triggerOperator: 1,
  triggerPrice: 0n,
  quantity: 0n,
  createdAt: 50,
  updatedAt: 50,
  placedOrderId: null,
  ...o,
});
