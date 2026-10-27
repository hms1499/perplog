import type {
  Address,
  CostAttribution,
  CostedTrade,
  FeeKind,
  FeeRecord,
  FundingPayment,
  Trade,
  TradeCosts,
} from "./types";
import { lowerBound, prefixMax } from "./units";

const zeroCosts = (): TradeCosts => ({ funding: 0n, liquidationFee: 0n, tradingFee: 0n, builderFee: 0n });

const FEE_FIELD: Record<FeeKind, keyof TradeCosts> = {
  liquidation: "liquidationFee",
  trading: "tradingFee",
  builder: "builderFee",
};

interface PoolTrades {
  trades: CostedTrade[];
  openedAt: number[];
  /** Running max of `closedAt`, with open trades as +Infinity. */
  reach: number[];
}

/** `trades` must be sorted by `openedAt`; each pool keeps that order. */
function indexByPool(trades: CostedTrade[]): Map<Address, PoolTrades> {
  const byPool = new Map<Address, CostedTrade[]>();
  for (const t of trades) {
    const list = byPool.get(t.pool);
    if (list) list.push(t);
    else byPool.set(t.pool, [t]);
  }
  const index = new Map<Address, PoolTrades>();
  for (const [pool, list] of byPool) {
    index.set(pool, {
      trades: list,
      openedAt: list.map((t) => t.openedAt),
      reach: prefixMax(list.map((t) => t.closedAt ?? Number.POSITIVE_INFINITY)),
    });
  }
  return index;
}

/** The earliest-opened trade of the pool that was open at the payment (opened before, closed at or after). */
function fundingOwner(index: Map<Address, PoolTrades>, row: FundingPayment): CostedTrade | undefined {
  const pool = index.get(row.pool);
  if (!pool) return undefined;
  const openedBefore = lowerBound(pool.openedAt, row.timestamp);
  const firstStillOpen = lowerBound(pool.reach, row.timestamp);
  return firstStillOpen < openedBefore ? pool.trades[firstStillOpen] : undefined;
}

function indexByTx(trades: CostedTrade[]): Map<string, CostedTrade[]> {
  const index = new Map<string, CostedTrade[]>();
  for (const t of trades) {
    for (const tx of t.txHashes) {
      const list = index.get(tx);
      if (list) list.push(t);
      else index.set(tx, [t]);
    }
  }
  return index;
}

function feeOwner(index: Map<string, CostedTrade[]>, fee: FeeRecord): CostedTrade | undefined {
  return index.get(fee.txHash)?.find((t) => fee.pool === null || fee.pool === t.pool);
}

/** Attribute funding and fees to trades and compute net PnL (spec §6.3). */
export function attributeCosts(
  trades: Trade[],
  funding: FundingPayment[],
  fees: FeeRecord[],
): CostAttribution {
  const costed: CostedTrade[] = [...trades]
    .sort((a, b) => a.openedAt - b.openedAt)
    .map((t) => ({ ...t, costs: zeroCosts(), netPnl: 0n }));
  const unattributed = zeroCosts();
  const unattributedFunding: FundingPayment[] = [];
  const byPool = indexByPool(costed);
  const byTx = indexByTx(costed);

  for (const row of funding) {
    const owner = fundingOwner(byPool, row);
    if (owner) owner.costs.funding += row.amount;
    else {
      unattributed.funding += row.amount;
      unattributedFunding.push(row);
    }
  }
  for (const fee of fees) {
    const field = FEE_FIELD[fee.kind];
    const owner = feeOwner(byTx, fee);
    if (owner) owner.costs[field] += fee.amount;
    else unattributed[field] += fee.amount;
  }
  for (const t of costed) {
    t.netPnl =
      t.realizedPnl - t.costs.funding - t.costs.liquidationFee - t.costs.tradingFee - t.costs.builderFee;
  }
  return { trades: costed, unattributed, unattributedFunding };
}
