import type { Address } from "@perplog/core";
import { fetchOpenPerpPositions, fetchPendingStopLosses } from "../src/indexer/live";

const A = `0x${"aa".repeat(20)}` as Address;
const POOL = `0x${"e1".repeat(20)}` as Address;

test("fetchOpenPerpPositions signs sizes by isLong", async () => {
  const bodies: string[] = [];
  const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body));
    return new Response(
      JSON.stringify({
        data: {
          PerpPosition: [
            { account: A.toUpperCase().replace("0X", "0x"), pool: POOL, isLong: false, size: "7" },
            { account: A, pool: POOL, isLong: true, size: "3" },
          ],
        },
      }),
    );
  });
  const rows = await fetchOpenPerpPositions("u", [A], fetchImpl);
  expect(rows).toEqual([
    { account: A, pool: POOL, size: -7n },
    { account: A, pool: POOL, size: 3n },
  ]);
  expect(bodies[0]).toContain("PerpPosition(");
  expect(JSON.parse(bodies[0] ?? "{}").query).toContain(`"${A}"`);
  expect(JSON.parse(bodies[0] ?? "{}").query).toContain('size: {_neq: "0"}');
});

test("fetchOpenPerpPositions batches accounts by 100 and skips empty input", async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { PerpPosition: [] } })));
  expect(await fetchOpenPerpPositions("u", [], fetchImpl)).toEqual([]);
  expect(fetchImpl).not.toHaveBeenCalled();
  const accounts = Array.from({ length: 250 }, (_, i) => `0x${i.toString(16).padStart(40, "0")}` as Address);
  await fetchOpenPerpPositions("u", accounts, fetchImpl);
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});

test("fetchPendingStopLosses counts only stop-losses for the side", async () => {
  const bodies: string[] = [];
  const row = (id: string, isBid: boolean, op: number) => ({
    id,
    market_id: POOL,
    status: "PENDING",
    isBid,
    triggerOperator: op,
    triggerPrice: "100",
    quantity: "0",
    createdAt: "1",
    updatedAt: "1",
    placedOrderId: null,
  });
  const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body));
    return new Response(
      JSON.stringify({
        data: { StopOrder: [row("1", false, 1), row("2", false, 0), row("3", true, 0)] },
      }),
    );
  });
  expect(await fetchPendingStopLosses("u", A, POOL, "long", fetchImpl)).toBe(1);
  expect(await fetchPendingStopLosses("u", A, POOL, "short", fetchImpl)).toBe(1);
  expect(bodies[0]).toContain("StopOrder(");
  expect(JSON.parse(bodies[0] ?? "{}").query).toContain('status: {_eq: "PENDING"}');
});
