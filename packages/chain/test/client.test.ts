import { z } from "zod";
import { gql, IndexerError, paginateDesc } from "../src/indexer/client";

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
