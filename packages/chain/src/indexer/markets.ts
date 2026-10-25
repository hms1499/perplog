import type { MarketInfo } from "@perplog/core";
import { z } from "zod";
import { type Fetch, gql } from "./client";
import { MARKET_FIELDS, marketRow } from "./schemas";

export async function fetchPerpMarkets(indexerUrl: string, fetchImpl?: Fetch): Promise<MarketInfo[]> {
  const data = await gql({
    url: indexerUrl,
    queryName: "PerpMarkets",
    query: `query PerpMarkets { Market(where: {perpRegistered: {_eq: true}}, limit: 200) { ${MARKET_FIELDS} } }`,
    schema: z.object({ Market: z.array(marketRow) }),
    fetchImpl,
  });
  return data.Market;
}
