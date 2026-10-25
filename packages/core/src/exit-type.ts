import type { ExitType, LiquidationRecord, StopOrderRecord, Trade } from "./types";

/** How a trade ended, in priority order (spec §6.4). */
export function classifyExit(
  trade: Trade,
  liquidations: LiquidationRecord[],
  stopOrders: StopOrderRecord[],
  perplogStopTxs: ReadonlySet<string>,
): ExitType {
  if (trade.closedAt === null) return "OPEN";
  const { txHash, orderId } = trade.lastChange;
  if (liquidations.some((l) => l.txHash === txHash)) return "LIQUIDATED";
  if (orderId !== null && stopOrders.some((s) => s.status === "TRIGGERED" && s.placedOrderId === orderId)) {
    return "NATIVE_STOP";
  }
  if (perplogStopTxs.has(txHash)) return "PERPLOG_STOP";
  return "MANUAL";
}
