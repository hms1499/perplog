import { type AccountHistory, type Address, HISTORY_MAX_CHANGES } from "@perplog/core";
import { z } from "zod";
import { type Fetch, gql, paginateDesc } from "./client";
import {
  builderFeeRow,
  FEE_FIELDS,
  FUNDING_FIELDS,
  fundingRow,
  LIQUIDATION_FIELDS,
  liquidationRow,
  MARGIN_EVENT_FIELDS,
  MARGIN_PULL_FIELDS,
  marginEventRow,
  marginPullRow,
  POSITION_CHANGE_FIELDS,
  perpFeeRow,
  positionChangeRow,
  protocolFeeRow,
  STOP_ORDER_FIELDS,
  stopOrderRow,
} from "./schemas";

export interface FetchHistoryOptions {
  indexerUrl: string;
  perpPools: ReadonlySet<Address>;
  maxChanges?: number;
  asOfTimestamp?: number;
  fetchImpl?: Fetch;
}

/** Load every indexed event of an account (spec §7.2), oldest first. */
export async function fetchAccountHistory(
  account: Address,
  opts: FetchHistoryOptions,
): Promise<AccountHistory> {
  const maxRows = opts.maxChanges ?? HISTORY_MAX_CHANGES;
  const asOf = opts.asOfTimestamp;
  const page = <Row>(
    queryName: string,
    table: string,
    fields: string,
    ownerField: string,
    rowSchema: z.ZodType<Row>,
    orderField: "timestamp" | "createdAt" = "timestamp",
  ) =>
    paginateDesc({
      url: opts.indexerUrl,
      queryName,
      table,
      fields,
      where: `{${ownerField}: {_eq: "${account}"}${asOf === undefined ? "" : `, ${orderField}: {_lte: ${asOf}}`}}`,
      orderField,
      rowSchema,
      maxRows,
      fetchImpl: opts.fetchImpl,
    });

  const [
    changes,
    funding,
    perpFees,
    protocolFees,
    builderFees,
    marginEvents,
    marginPulls,
    liquidations,
    stops,
  ] = await Promise.all([
    page("PositionChanges", "PerpPositionChange", POSITION_CHANGE_FIELDS, "account", positionChangeRow),
    page("FundingPayments", "FundingPayment", FUNDING_FIELDS, "account", fundingRow),
    page("PerpFees", "PerpFeeRecord", FEE_FIELDS, "account", perpFeeRow),
    page("ProtocolFees", "ProtocolFeeRecord", FEE_FIELDS, "payer", protocolFeeRow),
    page("BuilderFees", "BuilderFeeRecord", FEE_FIELDS, "payer", builderFeeRow),
    page("MarginEvents", "MarginEvent", MARGIN_EVENT_FIELDS, "account", marginEventRow),
    page("MarginPulls", "PerpMarginPull", MARGIN_PULL_FIELDS, "account", marginPullRow),
    page("Liquidations", "LiquidationEvent", LIQUIDATION_FIELDS, "account", liquidationRow),
    page("StopOrders", "StopOrder", STOP_ORDER_FIELDS, "owner", stopOrderRow, "createdAt"),
  ]);

  const isPerp = (pool: Address | null) => pool !== null && opts.perpPools.has(pool);
  const results = [
    changes,
    funding,
    perpFees,
    protocolFees,
    builderFees,
    marginEvents,
    marginPulls,
    liquidations,
    stops,
  ];
  return {
    account,
    asOfTimestamp: asOf ?? Math.floor(Date.now() / 1000),
    truncated: results.some((r) => r.truncated),
    changes: changes.rows,
    funding: funding.rows,
    fees: [
      ...perpFees.rows,
      ...protocolFees.rows.filter((f) => isPerp(f.pool)),
      ...builderFees.rows.filter((f) => isPerp(f.pool)),
    ],
    marginEvents: marginEvents.rows,
    marginPulls: marginPulls.rows,
    liquidations: liquidations.rows,
    stopOrders: stops.rows,
  };
}

/** The block the indexer has processed up to (Envio `_meta.progressBlock`). */
export async function fetchIndexerHead(indexerUrl: string, fetchImpl?: Fetch): Promise<bigint> {
  const data = await gql({
    url: indexerUrl,
    queryName: "IndexerHead",
    query: "query IndexerHead { _meta { progressBlock } }",
    schema: z.object({
      _meta: z.array(z.object({ progressBlock: z.union([z.string(), z.number()]) })).min(1),
    }),
    fetchImpl,
  });
  return BigInt(data._meta[0]?.progressBlock ?? 0);
}
