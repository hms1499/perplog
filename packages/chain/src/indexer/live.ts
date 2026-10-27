import { type Address, isStopLossFor, type Side } from "@perplog/core";
import { z } from "zod";
import { type Fetch, gql } from "./client";
import { STOP_ORDER_FIELDS, stopOrderRow } from "./schemas";

const ACCOUNT_BATCH = 100;

const address = z.string().transform((v) => v.toLowerCase() as Address);

const perpPositionRow = z
  .object({
    account: address,
    pool: address,
    isLong: z.boolean(),
    // The indexer stores the absolute size; the side is `isLong`.
    size: z.union([z.string(), z.number()]).transform((v) => BigInt(v)),
  })
  .transform((r) => ({ account: r.account, pool: r.pool, size: r.isLong ? r.size : -r.size }));

/** Non-flat perp positions of `accounts` from the indexer, signed (long positive, short negative). */
export async function fetchOpenPerpPositions(
  indexerUrl: string,
  accounts: Address[],
  fetchImpl?: Fetch,
): Promise<{ account: Address; pool: Address; size: bigint }[]> {
  const out: { account: Address; pool: Address; size: bigint }[] = [];
  for (let i = 0; i < accounts.length; i += ACCOUNT_BATCH) {
    const batch = accounts.slice(i, i + ACCOUNT_BATCH).map((a) => JSON.stringify(a.toLowerCase()));
    const data = await gql({
      url: indexerUrl,
      queryName: "OpenPerpPositions",
      query: `query OpenPerpPositions { PerpPosition(where: {account: {_in: [${batch.join(", ")}]}, size: {_neq: "0"}}, limit: 10000) { account pool isLong size } }`,
      schema: z.object({ PerpPosition: z.array(perpPositionRow) }),
      fetchImpl,
    });
    out.push(...data.PerpPosition);
  }
  return out;
}

/** How many PENDING stop-losses for `side` the account has on `pool` (take-profits do not count). */
export async function fetchPendingStopLosses(
  indexerUrl: string,
  account: Address,
  pool: Address,
  side: Side,
  fetchImpl?: Fetch,
): Promise<number> {
  const data = await gql({
    url: indexerUrl,
    queryName: "PendingStopLosses",
    query: `query PendingStopLosses { StopOrder(where: {owner: {_eq: ${JSON.stringify(account.toLowerCase())}}, market_id: {_eq: ${JSON.stringify(pool.toLowerCase())}}, status: {_eq: "PENDING"}}, limit: 1000) { ${STOP_ORDER_FIELDS} } }`,
    schema: z.object({ StopOrder: z.array(stopOrderRow) }),
    fetchImpl,
  });
  return data.StopOrder.filter((s) => isStopLossFor(side, s)).length;
}
