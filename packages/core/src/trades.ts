import type { Address, Hash, PositionChange, Side, Trade } from "./types";
import { absBig } from "./units";

interface Draft {
  trade: Trade;
  exitNotional: bigint;
  reducing: boolean;
}

const sideOf = (size: bigint): Side => (size >= 0n ? "long" : "short");

function compareChanges(a: PositionChange, b: PositionChange): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}

function touch(draft: Draft, change: PositionChange): void {
  const { trade } = draft;
  if (!trade.txHashes.includes(change.txHash)) trade.txHashes.push(change.txHash);
  if (change.orderId !== null && !trade.orderIds.includes(change.orderId))
    trade.orderIds.push(change.orderId);
  trade.lastChange = change;
}

function start(
  account: Address,
  change: PositionChange,
  size: bigint,
  entryPrice: bigint,
  partialHistory: boolean,
): Draft {
  const draft: Draft = {
    trade: {
      id: `${account}:${change.pool}:${change.txHash}:${change.logIndex}`,
      pool: change.pool,
      side: sideOf(size),
      openedAt: change.timestamp,
      closedAt: null,
      entryPrice,
      exitVwap: null,
      maxSize: absBig(size),
      closedSize: 0n,
      realizedPnl: 0n,
      txHashes: [] as Hash[],
      orderIds: [],
      lastChange: change,
      partialHistory,
    },
    exitNotional: 0n,
    reducing: false,
  };
  touch(draft, change);
  return draft;
}

function add(draft: Draft, change: PositionChange): void {
  const size = absBig(change.sizeAfter);
  if (size > draft.trade.maxSize) draft.trade.maxSize = size;
  if (!draft.reducing && change.entryPriceAfter !== null) draft.trade.entryPrice = change.entryPriceAfter;
  touch(draft, change);
}

function reduce(draft: Draft, change: PositionChange): void {
  const { trade } = draft;
  draft.reducing = true;
  const before = absBig(change.sizeBefore);
  if (before > trade.maxSize) trade.maxSize = before;
  trade.closedSize += change.closedSize;
  trade.realizedPnl += change.realizedPnl;
  if (change.exitPrice !== null) draft.exitNotional += change.closedSize * change.exitPrice;
  touch(draft, change);
}

function finish(draft: Draft, closedAt: number | null): Trade {
  const { trade } = draft;
  trade.closedAt = closedAt;
  trade.exitVwap = trade.closedSize > 0n ? draft.exitNotional / trade.closedSize : null;
  return trade;
}

function reconstructPool(account: Address, changes: PositionChange[]): Trade[] {
  const trades: Trade[] = [];
  let draft: Draft | null = null;
  for (const change of changes) {
    if (change.kind === "OPEN") {
      if (draft) trades.push(finish(draft, null));
      draft = start(account, change, change.sizeAfter, change.entryPriceAfter ?? 0n, false);
      continue;
    }
    if (!draft) {
      draft = start(account, change, change.sizeBefore, change.entryPriceBefore ?? 0n, true);
    }
    switch (change.kind) {
      case "INCREASE":
        add(draft, change);
        break;
      case "REDUCE":
        reduce(draft, change);
        break;
      case "CLOSE":
        reduce(draft, change);
        trades.push(finish(draft, change.timestamp));
        draft = null;
        break;
      case "FLIP":
        reduce(draft, change);
        trades.push(finish(draft, change.timestamp));
        draft = start(account, change, change.sizeAfter, change.entryPriceAfter ?? 0n, false);
        break;
    }
  }
  if (draft) trades.push(finish(draft, null));
  return trades;
}

/** Rebuild round-trip trades per pool from indexed position changes (spec §6.2). */
export function reconstructTrades(account: Address, changes: PositionChange[]): Trade[] {
  const byPool = new Map<Address, PositionChange[]>();
  for (const change of changes) {
    const list = byPool.get(change.pool) ?? [];
    list.push(change);
    byPool.set(change.pool, list);
  }
  const trades: Trade[] = [];
  for (const list of byPool.values()) {
    trades.push(...reconstructPool(account, [...list].sort(compareChanges)));
  }
  return trades.sort((a, b) => a.openedAt - b.openedAt);
}
