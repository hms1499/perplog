export type Address = `0x${string}`;
export type Hash = `0x${string}`;
export type Side = "long" | "short";
export type ChangeKind = "OPEN" | "INCREASE" | "REDUCE" | "CLOSE" | "FLIP";

/** One indexed position change. Sizes are signed: positive = long, negative = short. */
export interface PositionChange {
  id: string;
  kind: ChangeKind;
  pool: Address;
  orderId: string | null;
  blockNumber: bigint;
  logIndex: number;
  /** Unix seconds. */
  timestamp: number;
  txHash: Hash;
  sizeBefore: bigint;
  sizeAfter: bigint;
  /** Always absolute. */
  closedSize: bigint;
  entryPriceBefore: bigint | null;
  entryPriceAfter: bigint | null;
  exitPrice: bigint | null;
  realizedPnl: bigint;
}

/** `amount > 0` means the trader paid funding. */
export interface FundingPayment {
  id: string;
  pool: Address;
  amount: bigint;
  timestamp: number;
  txHash: Hash;
}

export type FeeKind = "liquidation" | "trading" | "builder";

export interface FeeRecord {
  id: string;
  kind: FeeKind;
  pool: Address | null;
  amount: bigint;
  timestamp: number;
  txHash: Hash;
}

export interface MarginEvent {
  id: string;
  kind: string;
  amount: bigint;
  timestamp: number;
}

export interface MarginPull {
  id: string;
  amount: bigint;
  timestamp: number;
}

export interface LiquidationRecord {
  id: string;
  kind: string;
  pool: Address | null;
  txHash: Hash;
  timestamp: number;
}

export interface StopOrderRecord {
  id: string;
  pool: Address;
  status: string;
  isBid: boolean;
  /** 0 = GTE (fires at or above), 1 = LTE (fires at or below). */
  triggerOperator: number;
  triggerPrice: bigint;
  /** 0 means the whole position. */
  quantity: bigint;
  createdAt: number;
  updatedAt: number;
  placedOrderId: string | null;
}

export interface AccountHistory {
  account: Address;
  asOfTimestamp: number;
  truncated: boolean;
  changes: PositionChange[];
  funding: FundingPayment[];
  fees: FeeRecord[];
  marginEvents: MarginEvent[];
  marginPulls: MarginPull[];
  liquidations: LiquidationRecord[];
  stopOrders: StopOrderRecord[];
}

export interface MarketInfo {
  pool: Address;
  symbol: string;
  baseDecimals: number;
  tickSize: bigint;
  lotSize: bigint;
  minQuantity: bigint;
  stopRegistry: Address | null;
}

export interface Trade {
  id: string;
  pool: Address;
  side: Side;
  openedAt: number;
  closedAt: number | null;
  entryPrice: bigint;
  exitVwap: bigint | null;
  maxSize: bigint;
  closedSize: bigint;
  realizedPnl: bigint;
  txHashes: Hash[];
  orderIds: string[];
  lastChange: PositionChange;
  partialHistory: boolean;
}

export interface TradeCosts {
  funding: bigint;
  liquidationFee: bigint;
  tradingFee: bigint;
  builderFee: bigint;
}

export interface CostedTrade extends Trade {
  costs: TradeCosts;
  netPnl: bigint;
}

export interface CostAttribution {
  trades: CostedTrade[];
  unattributed: TradeCosts;
  unattributedFunding: FundingPayment[];
}

export type ExitType = "LIQUIDATED" | "NATIVE_STOP" | "PERPLOG_STOP" | "MANUAL" | "OPEN";

export interface EnrichedTrade extends CostedTrade {
  exitType: ExitType;
  hadStop: boolean;
  maxNotional: bigint;
  symbol: string;
  /** Display precision from the market (lot and tick); defaults when the market is unknown. */
  baseDecimals: number;
  sizeDecimals: number;
  priceDecimals: number;
}

export interface ReconcileResult {
  expectedRaw: bigint;
  actualRaw: bigint;
  deltaRaw: bigint;
  ok: boolean;
}

export type LeakId = "LIQUIDATION_COST" | "NO_STOP_LOSSES" | "FUNDING_DRAG" | "SIZE_UP_AFTER_LOSS";
export type LeakFix = "PROTECT_NOW" | "ALWAYS_PROTECT" | "SHOW_FUNDING" | "FIXED_RISK";

export interface Leak {
  id: LeakId;
  title: string;
  amountRaw: bigint;
  shareOfLossBps: number;
  evidenceTradeIds: string[];
  fix: LeakFix;
}

export type Range = "7d" | "30d" | "all";

/** Cumulative net PnL after the event at `at` (unix seconds). */
export interface EquityPoint {
  at: number;
  netRaw: bigint;
}

export interface HealthSummary {
  range: Range;
  tradeCount: number;
  openTradeCount: number;
  netPnlRaw: bigint;
  realizedPnlRaw: bigint;
  fundingPaidRaw: bigint;
  /** Σ liquidation fees only; the Health breakdown uses this, never liquidationCostRaw (which adds the loss). */
  liquidationFeesRaw: bigint;
  /** Σ trading + builder fees. realized − funding − liquidationFees − tradingFees = net. */
  tradingFeesRaw: bigint;
  liquidationCostRaw: bigint;
  tradesWithoutStopPct: number;
  winRatePct: number;
  topLeak: Leak | null;
  reconcile: ReconcileResult | null;
  /** Ends at `netPnlRaw`; thinned out to at most `EQUITY_MAX_POINTS`. */
  equity: EquityPoint[];
}

export interface OpenPosition {
  pool: Address;
  symbol: string;
  side: Side;
  sizeRaw: bigint;
  baseDecimals: number;
  sizeDecimals: number;
  priceDecimals: number;
  entryPrice: bigint;
  markPrice: bigint;
  markFromIndex: boolean;
  liquidationPrice: bigint | null;
  liqDistanceBps: number | null;
  unrealizedPnlRaw: bigint;
  stopCoverageBps: number;
  fundingLast24hRaw: bigint;
}
