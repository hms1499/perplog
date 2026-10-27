import type { ExitType, LiquidationRecord, StopOrderRecord, Trade } from "./types";

/** Classifies how trades ended, in priority order (spec §6.4), with set lookups built once. */
export function createExitClassifier(
  liquidations: LiquidationRecord[],
  stopOrders: StopOrderRecord[],
  perplogStopTxs: ReadonlySet<string>,
): (trade: Trade) => ExitType {
  const liquidationTxs = new Set<string>(liquidations.map((l) => l.txHash));
  const triggeredOrderIds = new Set<string>();
  for (const s of stopOrders) {
    if (s.status === "TRIGGERED" && s.placedOrderId !== null) triggeredOrderIds.add(s.placedOrderId);
  }
  return (trade) => {
    if (trade.closedAt === null) return "OPEN";
    const { txHash, orderId } = trade.lastChange;
    if (liquidationTxs.has(txHash)) return "LIQUIDATED";
    if (orderId !== null && triggeredOrderIds.has(orderId)) return "NATIVE_STOP";
    if (perplogStopTxs.has(txHash)) return "PERPLOG_STOP";
    return "MANUAL";
  };
}

export function classifyExit(
  trade: Trade,
  liquidations: LiquidationRecord[],
  stopOrders: StopOrderRecord[],
  perplogStopTxs: ReadonlySet<string>,
): ExitType {
  return createExitClassifier(liquidations, stopOrders, perplogStopTxs)(trade);
}
