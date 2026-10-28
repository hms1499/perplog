import type { Address, MarketInfo } from "@perplog/core";
import { createBotKeyRequest, type Db, insertStop, recordExecution } from "@perplog/db";
import { createTestDb } from "@perplog/db/testing";
import { chain } from "@/lib/chain";
import { GET } from "./route";

let testDb: Db | null = null;
vi.mock("@/lib/db", () => ({ getDb: () => testDb }));
vi.mock("@/lib/chain", () => ({ chain: { markets: vi.fn() } }));

const P1 = "0x00000000000000000000000000000000000000a1" as Address;
const ACC = "0x00000000000000000000000000000000000000bb" as Address;
const OTHER = "0x00000000000000000000000000000000000000cc" as Address;
const HASH = `0x${"ab".repeat(32)}`;

const MARKET: MarketInfo = {
  pool: P1,
  symbol: "BTC-PERP",
  baseDecimals: 8,
  tickSize: 10n,
  lotSize: 10n,
  minQuantity: 10n,
  stopRegistry: null,
};

const get = (query = "") => GET(new Request(`http://localhost/api/executions${query}`));

beforeEach(async () => {
  testDb = await createTestDb();
  vi.mocked(chain.markets).mockResolvedValue([MARKET]);
});

async function seed() {
  const db = testDb as Db;
  const key = await createBotKeyRequest(db);
  const triggeredAt = new Date("2026-10-28T09:00:00Z");
  const stop = await insertStop(db, {
    account: ACC,
    pool: P1,
    botKeyId: key.id,
    positionSide: "long",
    triggerPrice: 1n,
    triggerOp: "lte",
    qtyMode: "entire",
    status: "done",
    triggeredAt,
  });
  const base = { pool: P1, botKeyId: key.id, qtyRaw: 10n, priceBound: 1n, txHash: HASH };
  await recordExecution(db, {
    ...base,
    kind: "stop_close",
    status: "confirmed",
    account: ACC,
    stopId: stop.id,
    isBid: false,
    filledRaw: 10n,
    avgPrice: 64_000n * 10n ** 18n,
    updatedAt: new Date(triggeredAt.getTime() + 2_400),
  });
  await recordExecution(db, { ...base, kind: "entry", status: "confirmed", account: OTHER, isBid: true });
  // No hash: never on /evidence.
  await recordExecution(db, {
    ...base,
    txHash: null,
    kind: "entry",
    status: "failed",
    account: ACC,
    isBid: true,
  });
}

test("executions lists rows with explorer links and totals, including medianStopLatencyMs", async () => {
  await seed();
  const res = await get();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.totals).toEqual({ transactions: 2, entries: 1, stopCloses: 1, medianStopLatencyMs: 2_400 });
  expect(body.rows).toHaveLength(2);
  const close = body.rows.find((r: { kind: string }) => r.kind === "stop_close");
  expect(close).toMatchObject({
    status: "confirmed",
    account: ACC,
    pool: P1,
    symbol: "BTC-PERP",
    isBid: false,
    filledRaw: "10",
    avgPrice: (64_000n * 10n ** 18n).toString(),
    txHash: HASH,
    explorerUrl: `https://explorer.testnet.somnia.network/tokyo/tx/${HASH}`,
  });
  expect(typeof close.createdAt).toBe("string");
});

test("?account filters rows and totals to that account", async () => {
  await seed();
  const body = await (await get(`?account=${OTHER.toUpperCase().replace("0X", "0x")}`)).json();
  expect(body.rows.map((r: { account: string }) => r.account)).toEqual([OTHER]);
  expect(body.totals).toMatchObject({ transactions: 1, entries: 1, stopCloses: 0 });
});

test("no DB → 503", async () => {
  testDb = null;
  const res = await get();
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: "db_unavailable" });
});

test("bad account → 400", async () => {
  const res = await get("?account=nope");
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "invalid_address" });
});
