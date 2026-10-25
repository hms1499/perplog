import type {
  CostAttribution,
  CostedTrade,
  FeeKind,
  FeeRecord,
  FundingPayment,
  Trade,
  TradeCosts,
} from "./types";

const zeroCosts = (): TradeCosts => ({ funding: 0n, liquidationFee: 0n, tradingFee: 0n, builderFee: 0n });

const FEE_FIELD: Record<FeeKind, keyof TradeCosts> = {
  liquidation: "liquidationFee",
  trading: "tradingFee",
  builder: "builderFee",
};

function fundingOwner(trades: CostedTrade[], row: FundingPayment): CostedTrade | undefined {
  return trades.find(
    (t) =>
      t.pool === row.pool &&
      t.openedAt < row.timestamp &&
      (t.closedAt === null || row.timestamp <= t.closedAt),
  );
}

function feeOwner(trades: CostedTrade[], fee: FeeRecord): CostedTrade | undefined {
  return trades.find((t) => t.txHashes.includes(fee.txHash) && (fee.pool === null || fee.pool === t.pool));
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

  for (const row of funding) {
    const owner = fundingOwner(costed, row);
    if (owner) owner.costs.funding += row.amount;
    else {
      unattributed.funding += row.amount;
      unattributedFunding.push(row);
    }
  }
  for (const fee of fees) {
    const field = FEE_FIELD[fee.kind];
    const owner = feeOwner(costed, fee);
    if (owner) owner.costs[field] += fee.amount;
    else unattributed[field] += fee.amount;
  }
  for (const t of costed) {
    t.netPnl =
      t.realizedPnl - t.costs.funding - t.costs.liquidationFee - t.costs.tradingFee - t.costs.builderFee;
  }
  return { trades: costed, unattributed, unattributedFunding };
}
