import type { Address } from "@perplog/core";
import {
  bindBotKey,
  bindSession,
  claimRequestedBotKeys,
  createBotKeyRequest,
  createSession,
  type Db,
  insertStop,
  listAccountStops,
  transitionStop,
} from "@perplog/db";
import { createTestDb } from "@perplog/db/testing";
import { chain } from "@/lib/chain";
import { DELETE } from "./[id]/route";
import { POST } from "./route";

let testDb: Db | null;
vi.mock("@/lib/db", () => ({ getDb: () => testDb }));
vi.mock("@/lib/chain", () => ({
  chain: {
    perpPools: vi.fn(),
    markets: vi.fn(),
    grantedPools: vi.fn(),
    readPositionSize: vi.fn(),
    readMark: vi.fn(),
  },
}));

const P1 = "0x00000000000000000000000000000000000000a1" as Address;
const P2 = "0x00000000000000000000000000000000000000a2" as Address;
const BOT = "0x00000000000000000000000000000000000000b0" as Address;
const ACC = "0x00000000000000000000000000000000000000bb" as Address;
const OTHER = "0x00000000000000000000000000000000000000cc" as Address;

const fake = vi.mocked(chain);
const db = () => testDb as Db;

interface Linked {
  cookie: string;
  keyId: string;
  sessionId: string;
}

/** A session whose bot key is minted and linked to `account`. */
async function linkedSession(account: Address, bot: Address): Promise<Linked> {
  const key = await createBotKeyRequest(db());
  await claimRequestedBotKeys(db(), 10, () => ({ address: bot, encPk: "pk", iv: "iv", tag: "tag" }));
  const session = await createSession(db(), key.id);
  await bindBotKey(db(), key.id, account, [P1]);
  await bindSession(db(), session.id, account);
  return { cookie: `perplog_session=${session.id}`, keyId: key.id, sessionId: session.id };
}

function post(body: unknown, opts: { origin?: string; cookie?: string; raw?: string } = {}) {
  const headers: Record<string, string> = { origin: opts.origin ?? "http://localhost" };
  if (opts.cookie) headers.cookie = opts.cookie;
  return new Request("http://localhost/api/stops", {
    method: "POST",
    headers,
    body: opts.raw ?? JSON.stringify(body),
  });
}

function del(id: string, opts: { origin?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = { origin: opts.origin ?? "http://localhost" };
  if (opts.cookie) headers.cookie = opts.cookie;
  return new Request(`http://localhost/api/stops/${id}`, { method: "DELETE", headers });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const body = (o: Record<string, unknown> = {}) => ({
  pool: P1,
  triggerPrice: "950",
  qtyMode: "entire",
  ...o,
});

let me: Linked;

beforeEach(async () => {
  vi.clearAllMocks();
  testDb = await createTestDb();
  me = await linkedSession(ACC, BOT);
  fake.markets.mockResolvedValue([
    { pool: P1, symbol: "BTC-PERP", tickSize: 7n, lotSize: 10n, minQuantity: 100n },
  ] as never);
  fake.readPositionSize.mockResolvedValue(20_000n);
  fake.readMark.mockResolvedValue({ price: 1000n, fromIndex: false });
  fake.grantedPools.mockImplementation(async (_owner, _bot, pools) => pools);
});

test("arms a long stop below the mark, snapped up to the tick", async () => {
  const res = await POST(post(body(), { cookie: me.cookie }));
  expect(res.status).toBe(201);
  const { stop } = await res.json();
  expect(stop).toMatchObject({
    pool: P1,
    positionSide: "long",
    triggerPrice: "952",
    qtyMode: "entire",
    qtyRaw: null,
    status: "armed",
  });
  expect(fake.grantedPools).toHaveBeenCalledWith(ACC, BOT, [P1]);
  const [row] = await listAccountStops(db(), ACC, ["armed"]);
  expect(row).toMatchObject({
    id: stop.id,
    account: ACC,
    pool: P1,
    botKeyId: me.keyId,
    triggerOp: "lte",
    triggerPrice: 952n,
    positionSide: "long",
  });
});

test("arms a short stop above the mark, snapped down to the tick", async () => {
  fake.readPositionSize.mockResolvedValue(-20_000n);
  const res = await POST(post(body({ triggerPrice: "1050" }), { cookie: me.cookie }));
  expect(res.status).toBe(201);
  const { stop } = await res.json();
  expect(stop).toMatchObject({ positionSide: "short", triggerPrice: "1050" });
  const [row] = await listAccountStops(db(), ACC, ["armed"]);
  expect(row).toMatchObject({ triggerOp: "gte", triggerPrice: 1050n });
});

test("a short trigger is floored to the tick", async () => {
  fake.readPositionSize.mockResolvedValue(-20_000n);
  const res = await POST(post(body({ triggerPrice: "1052" }), { cookie: me.cookie }));
  expect((await res.json()).stop.triggerPrice).toBe("1050");
});

test("stores account and pool lowercased even when the body is mixed case", async () => {
  const mixed = `0x${P1.slice(2).replace("a", "A")}`;
  fake.markets.mockResolvedValue([
    { pool: P1, symbol: "BTC-PERP", tickSize: 7n, lotSize: 10n, minQuantity: 100n },
  ] as never);
  const res = await POST(post(body({ pool: mixed }), { cookie: me.cookie }));
  expect(res.status).toBe(201);
  const [row] = await listAccountStops(db(), ACC, ["armed"]);
  expect(row?.pool).toBe(P1);
  expect(row?.account).toBe(ACC);
});

test("fixed quantity is floored to a lot and stored", async () => {
  const res = await POST(post(body({ qtyMode: "fixed", qtyRaw: "1234" }), { cookie: me.cookie }));
  expect(res.status).toBe(201);
  expect((await res.json()).stop).toMatchObject({ qtyMode: "fixed", qtyRaw: "1230" });
});

test("a second stop on the same pool cancels the first", async () => {
  const first = (await (await POST(post(body(), { cookie: me.cookie }))).json()).stop.id;
  const second = (await (await POST(post(body({ triggerPrice: "900" }), { cookie: me.cookie }))).json()).stop
    .id;
  const armed = await listAccountStops(db(), ACC, ["armed"]);
  expect(armed.map((s) => s.id)).toEqual([second]);
  const cancelled = await listAccountStops(db(), ACC, ["cancelled"]);
  expect(cancelled.map((s) => s.id)).toEqual([first]);
});

test("bad_quantity: below the minimum, above the position, or zero after flooring", async () => {
  for (const qtyRaw of ["50", "20010", "5"]) {
    const res = await POST(post(body({ qtyMode: "fixed", qtyRaw }), { cookie: me.cookie }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_quantity" });
  }
});

test("trigger_wrong_side: a long trigger at or above the mark, a short trigger at or below it", async () => {
  for (const triggerPrice of ["1000", "1100"]) {
    const res = await POST(post(body({ triggerPrice }), { cookie: me.cookie }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "trigger_wrong_side" });
  }
  fake.readPositionSize.mockResolvedValue(-20_000n);
  const short = await POST(post(body({ triggerPrice: "900" }), { cookie: me.cookie }));
  expect(short.status).toBe(400);
  expect(await short.json()).toEqual({ error: "trigger_wrong_side" });
  // The snap counts: 996 is below the mark but rounds up to 1001, which is above it.
  const snapped = await POST(post(body({ triggerPrice: "996" }), { cookie: me.cookie }));
  expect(snapped.status).toBe(400);
  expect(await listAccountStops(db(), ACC, ["armed"])).toEqual([]);
});

test("no_position when the size is zero", async () => {
  fake.readPositionSize.mockResolvedValue(0n);
  const res = await POST(post(body(), { cookie: me.cookie }));
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "no_position" });
});

test("pool_not_linked carries the re-link instructions", async () => {
  fake.grantedPools.mockResolvedValue([]);
  const res = await POST(post(body(), { cookie: me.cookie }));
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({
    error: "pool_not_linked",
    message:
      "PerpLog's bot is not linked for this market. In the dreamDEX app, open your wallet → Link a bot → tick Perps and paste the same bot address again.",
  });
  expect(await listAccountStops(db(), ACC, ["armed"])).toEqual([]);
});

test("a failing grant read is a 503, not a stop", async () => {
  const { ChainUnavailableError } = await import("@/lib/account-service");
  fake.grantedPools.mockRejectedValue(new ChainUnavailableError("rpc down"));
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const res = await POST(post(body(), { cookie: me.cookie }));
  spy.mockRestore();
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: "chain_unavailable" });
});

test("unknown_pool when the pool is not a listed market", async () => {
  const res = await POST(post(body({ pool: P2 }), { cookie: me.cookie }));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "unknown_pool" });
});

test("invalid_input for a malformed body", async () => {
  const bad: unknown[] = [
    body({ pool: "nope" }),
    body({ triggerPrice: "9.5" }),
    body({ triggerPrice: "-1" }),
    body({ triggerPrice: "0" }),
    body({ triggerPrice: 950 }),
    body({ qtyMode: "half" }),
    body({ qtyMode: "fixed" }),
    body({ qtyMode: "fixed", qtyRaw: "0" }),
    body({ qtyMode: "fixed", qtyRaw: "abc" }),
    "not-an-object",
  ];
  for (const b of bad) {
    const res = await POST(post(b, { cookie: me.cookie }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_input" });
  }
});

test("invalid_input for an unparsable body", async () => {
  const unparsable = await POST(post(null, { cookie: me.cookie, raw: "{" }));
  expect(unparsable.status).toBe(400);
  expect(await unparsable.json()).toEqual({ error: "invalid_input" });
});

test("401 no_session without a known session cookie", async () => {
  for (const cookie of [
    undefined,
    "perplog_session=garbage",
    "perplog_session=00000000-0000-4000-8000-000000000000",
  ]) {
    const res = await POST(post(body(), { cookie }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "no_session" });
  }
});

test("403 not_linked when the session has no bound account", async () => {
  const key = await createBotKeyRequest(db());
  const session = await createSession(db(), key.id);
  const res = await POST(post(body(), { cookie: `perplog_session=${session.id}` }));
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "not_linked" });
});

test("a foreign origin is refused before anything else", async () => {
  const res = await POST(post(body(), { cookie: me.cookie, origin: "https://evil.example" }));
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "bad_origin" });
  expect(
    (await DELETE(del("x", { cookie: me.cookie, origin: "https://evil.example" }), ctx("x"))).status,
  ).toBe(403);
});

test("POSTs are rate-limited per verified session", async () => {
  let last = 0;
  for (let i = 0; i < 11; i++) last = (await POST(post(body(), { cookie: me.cookie }))).status;
  expect(last).toBe(429);
});

test("without a database every route is 503 db_unavailable", async () => {
  testDb = null;
  const res = await POST(post(body(), { cookie: me.cookie }));
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: "db_unavailable" });
  const gone = await DELETE(del("x", { cookie: me.cookie }), ctx("x"));
  expect(gone.status).toBe(503);
});

test("DELETE cancels an armed stop", async () => {
  const id = (await (await POST(post(body(), { cookie: me.cookie }))).json()).stop.id;
  const res = await DELETE(del(id, { cookie: me.cookie }), ctx(id));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(await listAccountStops(db(), ACC, ["cancelled"])).toHaveLength(1);
});

test("DELETE of a triggered stop is 409 and leaves it triggered", async () => {
  const id = (await (await POST(post(body(), { cookie: me.cookie }))).json()).stop.id;
  expect(await transitionStop(db(), id, ["armed"], "triggered")).toBe(true);
  const res = await DELETE(del(id, { cookie: me.cookie }), ctx(id));
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "stop_in_progress" });
  expect(await listAccountStops(db(), ACC, ["triggered"])).toHaveLength(1);
});

test("DELETE of another account's stop is 404 and leaves it armed", async () => {
  const theirs = await linkedSession(OTHER, "0x00000000000000000000000000000000000000b1" as Address);
  const stop = await insertStop(db(), {
    account: OTHER,
    pool: P1,
    botKeyId: theirs.keyId,
    positionSide: "long",
    triggerPrice: 900n,
    triggerOp: "lte",
    qtyMode: "entire",
    status: "armed",
  });
  const res = await DELETE(del(stop.id, { cookie: me.cookie }), ctx(stop.id));
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found" });
  expect(await listAccountStops(db(), OTHER, ["armed"])).toHaveLength(1);
});

test("DELETE of an unknown or malformed id is 404; without a session 401; unlinked 403", async () => {
  for (const id of ["nope", "00000000-0000-4000-8000-000000000000"]) {
    const res = await DELETE(del(id, { cookie: me.cookie }), ctx(id));
    expect(res.status).toBe(404);
  }
  expect((await DELETE(del("x"), ctx("x"))).status).toBe(401);
  const key = await createBotKeyRequest(db());
  const session = await createSession(db(), key.id);
  expect((await DELETE(del("x", { cookie: `perplog_session=${session.id}` }), ctx("x"))).status).toBe(403);
});
