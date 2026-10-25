import { shortAddress } from "./address";
import { tradeHadStop } from "./coverage";
import { classifyExit } from "./exit-type";
import type { AccountHistory, Address, CostAttribution, EnrichedTrade, MarketInfo } from "./types";
import { notionalRaw } from "./units";

export function enrichTrades(
  attribution: CostAttribution,
  history: AccountHistory,
  markets: ReadonlyMap<Address, MarketInfo>,
  nowSec: number,
  perplogStopTxs: ReadonlySet<string> = new Set(),
): EnrichedTrade[] {
  return attribution.trades.map((t) => {
    const market = markets.get(t.pool);
    return {
      ...t,
      exitType: classifyExit(t, history.liquidations, history.stopOrders, perplogStopTxs),
      hadStop: tradeHadStop(t, history.stopOrders, nowSec),
      maxNotional: market ? notionalRaw(t.maxSize, t.entryPrice, market.baseDecimals) : 0n,
      symbol: market?.symbol ?? shortAddress(t.pool),
    };
  });
}
