import type { Address } from "@perplog/core";
import { type Db, insertAlert, listWatchedAccounts } from "@perplog/db";
import { createTestDb } from "@perplog/db/testing";
import { chain } from "@/lib/chain";
import { POST as watch } from "../watch/route";
import { GET } from "./route";

let testDb: Db | null;
vi.mock("@/lib/db", () => ({ getDb: () => testDb }));
vi.mock("@/lib/chain", () => ({ chain: { markets: vi.fn() } }));

const ACC = "0x00000000000000000000000000000000000000bb" as Address;
const OTHER = "0x00000000000000000000000000000000000000cc" as Address;
const POOL = "0x00000000000000000000000000000000000000a1" as Address;
const db = () => testDb as Db;

const get = (query: string) => GET(new Request(`http://localhost/api/alerts?${query}`));
const postWatch = (body: unknown, origin = "http://localhost") =>
  watch(
    new Request("http://localhost/api/watch", {
      method: "POST",
      headers: { origin, "x-forwarded-for": "10.0.0.1" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(async () => {
  testDb = await createTestDb();
  vi.mocked(chain.markets).mockResolvedValue([{ pool: POOL, symbol: "ETH-PERP" }] as never);
});

test("alerts since a time, ascending, capped at 50", async () => {
  for (let i = 0; i < 55; i++) {
    await insertAlert(db(), { account: ACC, type: "stop_done", pool: POOL, payload: { i } });
  }
  await insertAlert(db(), { account: OTHER, type: "stop_done", payload: { other: true } });

  const res = await get(`account=${ACC.toUpperCase().replace("0X", "0x")}&since=0`);
  expect(res.status).toBe(200);
  const { alerts } = await res.json();
  expect(alerts).toHaveLength(50);
  expect(alerts[0]).toMatchObject({ type: "stop_done", pool: POOL, symbol: "ETH-PERP", payload: { i: 0 } });
  expect(typeof alerts[0].id).toBe("string");
  expect(Number.isNaN(Date.parse(alerts[0].createdAt))).toBe(false);
  const times = alerts.map((a: { createdAt: string }) => Date.parse(a.createdAt));
  expect([...times].sort((a, b) => a - b)).toEqual(times);

  const later = await (await get(`account=${ACC}&since=${Date.now() + 60_000}`)).json();
  expect(later.alerts).toEqual([]);

  expect((await get("account=nope&since=0")).status).toBe(400);
  expect((await get(`account=${ACC}&since=abc`)).status).toBe(400);
});

test("watch adds the account to watched accounts; bad address → 400; other origin → 403", async () => {
  const res = await postWatch({ account: ACC });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ watching: true });
  expect(await listWatchedAccounts(db())).toEqual([ACC]);

  expect((await postWatch({ account: "0x123" })).status).toBe(400);
  const bad = await postWatch({ account: OTHER }, "https://evil.example");
  expect(bad.status).toBe(403);
  expect(await bad.json()).toEqual({ error: "bad_origin" });
  expect(await listWatchedAccounts(db())).toEqual([ACC]);
});

test("watch is rate-limited to 10 POSTs a minute", async () => {
  for (let i = 0; i < 10; i++) expect((await postWatch({ account: ACC })).status).toBe(200);
  const res = await postWatch({ account: ACC });
  expect(res.status).toBe(429);
  expect(await res.json()).toEqual({ error: "rate_limited" });
});

test("both routes return 503 db_unavailable without DATABASE_URL", async () => {
  testDb = null;
  const a = await get(`account=${ACC}&since=0`);
  expect(a.status).toBe(503);
  expect(await a.json()).toEqual({ error: "db_unavailable" });
  const w = await postWatch({ account: ACC });
  expect(w.status).toBe(503);
  expect(await w.json()).toEqual({ error: "db_unavailable" });
});

test("alerts still load with symbol null when the market list is unavailable", async () => {
  vi.mocked(chain.markets).mockRejectedValue(new Error("indexer down"));
  await insertAlert(db(), { account: ACC, type: "stop_failed", pool: POOL, payload: { reason: "x" } });
  const res = await get(`account=${ACC}&since=0`);
  expect(res.status).toBe(200);
  expect((await res.json()).alerts[0]).toMatchObject({ pool: POOL, symbol: null });
});
