import type {
  Address,
  ChangeKind,
  FeeKind,
  FeeRecord,
  FundingPayment,
  Hash,
  LiquidationRecord,
  MarginEvent,
  MarginPull,
  MarketInfo,
  PositionChange,
  StopOrderRecord,
} from "@perplog/core";
import { z } from "zod";

const big = z.union([z.string(), z.number()]).transform((v) => BigInt(v));
const num = z.union([z.string(), z.number()]).transform((v) => Number(v));
const address = z.string().transform((v) => v.toLowerCase() as Address);
const hash = z.string().transform((v) => v.toLowerCase() as Hash);

export const POSITION_CHANGE_FIELDS =
  "id kind pool orderId blockNumber logIndex timestamp txHash sizeBefore sizeAfter closedSize entryPriceBefore entryPriceAfter exitPrice realizedPnl";

export const positionChangeRow: z.ZodType<PositionChange> = z
  .object({
    id: z.string(),
    kind: z.enum(["OPEN", "INCREASE", "REDUCE", "CLOSE", "FLIP"]),
    pool: address,
    orderId: z.union([z.string(), z.number()]).nullable(),
    blockNumber: big,
    logIndex: num,
    timestamp: num,
    txHash: hash,
    sizeBefore: big,
    sizeAfter: big,
    closedSize: big,
    entryPriceBefore: big.nullable(),
    entryPriceAfter: big.nullable(),
    exitPrice: big.nullable(),
    realizedPnl: big,
  })
  .transform((r) => ({
    ...r,
    kind: r.kind as ChangeKind,
    orderId: r.orderId === null ? null : String(r.orderId),
  }));

export const FUNDING_FIELDS = "id pool amount timestamp txHash";

export const fundingRow: z.ZodType<FundingPayment> = z.object({
  id: z.string(),
  pool: address,
  amount: big,
  timestamp: num,
  txHash: hash,
});

export const FEE_FIELDS = "id pool amount timestamp txHash";

const feeRow = (kind: FeeKind): z.ZodType<FeeRecord> =>
  z
    .object({ id: z.string(), pool: address.nullable(), amount: big, timestamp: num, txHash: hash })
    .transform((r) => ({ ...r, kind }));

export const perpFeeRow = feeRow("liquidation");
export const protocolFeeRow = feeRow("trading");
export const builderFeeRow = feeRow("builder");

export const MARGIN_EVENT_FIELDS = "id kind amount timestamp";

export const marginEventRow: z.ZodType<MarginEvent> = z.object({
  id: z.string(),
  kind: z.string(),
  amount: big,
  timestamp: num,
});

export const MARGIN_PULL_FIELDS = "id amount timestamp";

export const marginPullRow: z.ZodType<MarginPull> = z.object({ id: z.string(), amount: big, timestamp: num });

export const LIQUIDATION_FIELDS = "id kind pool txHash timestamp";

export const liquidationRow: z.ZodType<LiquidationRecord> = z.object({
  id: z.string(),
  kind: z.string(),
  pool: address.nullable(),
  txHash: hash,
  timestamp: num,
});

export const STOP_ORDER_FIELDS =
  "id market_id status isBid triggerOperator triggerPrice quantity createdAt updatedAt placedOrderId";

export const stopOrderRow: z.ZodType<StopOrderRecord> = z
  .object({
    id: z.string(),
    market_id: address,
    status: z.string(),
    isBid: z.boolean(),
    triggerOperator: num,
    triggerPrice: big,
    quantity: big,
    createdAt: num,
    updatedAt: num,
    placedOrderId: z.union([z.string(), z.number()]).nullable(),
  })
  .transform(({ market_id, placedOrderId, ...r }) => ({
    ...r,
    pool: market_id,
    placedOrderId: placedOrderId === null ? null : String(placedOrderId),
  }));

export const MARKET_FIELDS = "poolAddress baseSymbol baseDecimals tickSize lotSize minQuantity stopRegistry";

export const marketRow: z.ZodType<MarketInfo> = z
  .object({
    poolAddress: address,
    baseSymbol: z.string(),
    baseDecimals: num,
    tickSize: big,
    lotSize: big,
    minQuantity: big,
    stopRegistry: address.nullable(),
  })
  .transform(({ poolAddress, baseSymbol, ...r }) => ({ pool: poolAddress, symbol: baseSymbol, ...r }));
