import { z } from "zod";
import { gql, IndexerError, paginateDesc } from "../src/indexer/client";
import { FUNDING_FIELDS, fundingRow } from "../src/indexer/schemas";

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("gql throws IndexerError on GraphQL errors", async () => {
  const fetchImpl = vi.fn(async () => respond({ errors: [{ message: "boom" }] }));
  await expect(
    gql({ url: "u", queryName: "Q", query: "{x}", schema: z.any(), fetchImpl }),
  ).rejects.toMatchObject({
    name: "IndexerError",
    queryName: "Q",
  });
});

test("gql throws IndexerError on HTTP 502", async () => {
  const fetchImpl = vi.fn(async () => new Response("bad", { status: 502 }));
  await expect(
    gql({ url: "u", queryName: "Q", query: "{x}", schema: z.any(), fetchImpl }),
  ).rejects.toBeInstanceOf(IndexerError);
});

test("gql throws IndexerError when the response does not match the schema", async () => {
  const fetchImpl = vi.fn(async () => respond({ data: { n: "not a number" } }));
  await expect(
    gql({ url: "u", queryName: "Q", query: "{x}", schema: z.object({ n: z.number() }), fetchImpl }),
  ).rejects.toBeInstanceOf(IndexerError);
});

test("gql gives up on a stalled indexer with IndexerError", { timeout: 2000 }, async () => {
  // Accepts the request and never answers, unless the caller aborts.
  const fetchImpl = vi.fn(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );
  await expect(
    gql({ url: "u", queryName: "Q", query: "{x}", schema: z.any(), fetchImpl, timeoutMs: 20 }),
  ).rejects.toBeInstanceOf(IndexerError);
});

test("gql throws IndexerError when a 200 response is not JSON", async () => {
  const fetchImpl = vi.fn(async () => new Response("<html>gateway</html>", { status: 200 }));
  await expect(
    gql({ url: "u", queryName: "Q", query: "{x}", schema: z.any(), fetchImpl }),
  ).rejects.toBeInstanceOf(IndexerError);
});

test("paginateDesc throws IndexerError when a bigint field is not an integer", async () => {
  const fetchImpl = vi.fn(async () =>
    respond({
      data: { FundingPayment: [{ id: "f1", pool: "0xA", amount: "1.5", timestamp: "10", txHash: "0xB" }] },
    }),
  );
  await expect(
    paginateDesc({
      url: "u",
      queryName: "Q",
      table: "FundingPayment",
      fields: FUNDING_FIELDS,
      where: "{}",
      orderField: "timestamp",
      rowSchema: fundingRow,
      maxRows: 10,
      fetchImpl,
    }),
  ).rejects.toBeInstanceOf(IndexerError);
});

const row = z.object({ id: z.string(), timestamp: z.coerce.number() });
const rows = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `r${from - i}`, timestamp: String(from - i) }));

test("paginateDesc walks pages with a keyset cursor and returns ascending rows", async () => {
  const bodies: string[] = [];
  const pages = [rows(2000, 1000), rows(1000, 3)];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body));
    return respond({ data: { T: pages.shift() } });
  });
  const result = await paginateDesc({
    url: "u",
    queryName: "Q",
    table: "T",
    fields: "id timestamp",
    where: '{account: {_eq: "0xa"}}',
    orderField: "timestamp",
    rowSchema: row,
    maxRows: 10_000,
    fetchImpl,
  });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(bodies[1]).toContain("_lt");
  expect(bodies[1]).toContain("1001");
  expect(result.rows).toHaveLength(1003);
  expect(result.rows[0]?.timestamp).toBe(998);
  expect(result.rows.at(-1)?.timestamp).toBe(2000);
  expect(result.truncated).toBe(false);
});

test("paginateDesc truncates at maxRows", async () => {
  let next = 100_000;
  const fetchImpl = vi.fn(async () => {
    const page = rows(next, 1000);
    next -= 1000;
    return respond({ data: { T: page } });
  });
  const result = await paginateDesc({
    url: "u",
    queryName: "Q",
    table: "T",
    fields: "id timestamp",
    where: "{}",
    orderField: "timestamp",
    rowSchema: row,
    maxRows: 1500,
    fetchImpl,
  });
  expect(result.rows).toHaveLength(1500);
  expect(result.truncated).toBe(true);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

test("paginateDesc does not flag truncation when the history is exactly maxRows long", async () => {
  // A fake indexer holding exactly 2000 rows that honours the query's limit.
  const all = rows(2000, 2000);
  let served = 0;
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const limit = Number(/limit: (\d+)/.exec(String(init?.body))?.[1]);
    const page = all.slice(served, served + limit);
    served += page.length;
    return respond({ data: { T: page } });
  });
  const result = await paginateDesc({
    url: "u",
    queryName: "Q",
    table: "T",
    fields: "id timestamp",
    where: "{}",
    orderField: "timestamp",
    rowSchema: row,
    maxRows: 2000,
    fetchImpl,
  });
  expect(result.rows).toHaveLength(2000);
  expect(result.truncated).toBe(false);
});
