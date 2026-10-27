import type { Address } from "@perplog/core";
import { claimRequestedBotKeys, type Db, getBotKey, listWatchedAccounts, upsertWatch } from "@perplog/db";
import { createTestDb } from "@perplog/db/testing";
import { chain } from "@/lib/chain";
import { GET, POST } from "./route";

let testDb: Db | null;
vi.mock("@perplog/db", async (orig) => {
  const actual = await orig<typeof import("@perplog/db")>();
  return { ...actual, upsertWatch: vi.fn(actual.upsertWatch) };
});
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
const ACC_NO_GRANT = "0x00000000000000000000000000000000000000aa";
const ACC_GRANT = "0x00000000000000000000000000000000000000bb";

const fake = vi.mocked(chain);

function req(method: string, path: string, opts: { origin?: string; cookie?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { origin: opts.origin ?? "http://localhost" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.ip) headers["x-forwarded-for"] = opts.ip;
  return new Request(`http://localhost${path}`, { method, headers });
}
const get = (path: string, cookie?: string) => req("GET", path, { cookie });
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

/** Plays the worker: mints every requested key with the fixed address BOT. */
async function mint(address: Address = BOT) {
  await claimRequestedBotKeys(testDb as Db, 10, () => ({ address, encPk: "pk", iv: "iv", tag: "tag" }));
}

beforeEach(async () => {
  vi.clearAllMocks();
  testDb = await createTestDb();
  fake.perpPools.mockResolvedValue([P1, P2]);
  fake.markets.mockResolvedValue([
    { pool: P1, symbol: "BTC-PERP" },
    { pool: P2, symbol: "ETH-PERP" },
  ] as never);
  fake.grantedPools.mockImplementation(async (owner) => (owner === ACC_GRANT ? [P1] : []));
});

test("POST creates a session once per cookie and sets the cookie", async () => {
  const r1 = await POST(req("POST", "/api/session"));
  expect(r1.status).toBe(201);
  expect(r1.headers.get("set-cookie")).toMatch(/perplog_session=.*HttpOnly.*SameSite=Lax/i);
  expect(await r1.clone().json()).toEqual({ status: "requested", botAddress: null });
  await mint();
  const r2 = await POST(req("POST", "/api/session", { cookie: cookieOf(r1) }));
  expect(await r2.json()).toEqual({ status: "pending", botAddress: BOT });
  expect(r2.headers.get("set-cookie")).toBeNull();
  const rows = await (testDb as Db).query.botKeys.findMany();
  expect(rows).toHaveLength(1);
});

test("POST with an unknown or malformed cookie starts a fresh session", async () => {
  const r = await POST(req("POST", "/api/session", { cookie: "perplog_session=not-a-uuid" }));
  expect(r.status).toBe(201);
  expect(cookieOf(r)).toMatch(/^perplog_session=[0-9a-f-]{36}$/);
});

test("POST from another origin is refused", async () => {
  expect((await POST(req("POST", "/api/session", { origin: "https://evil.example" }))).status).toBe(403);
  const noOrigin = new Request("http://localhost/api/session", { method: "POST" });
  const res = await POST(noOrigin);
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "bad_origin" });
});

test("GET binds the account only when the bot holds a grant for it", async () => {
  const created = await POST(req("POST", "/api/session"));
  const cookie = cookieOf(created);
  expect((await (await GET(get(`/api/session?account=${ACC_GRANT}`, cookie))).json()).status).toBe(
    "requested",
  );
  await mint();

  const pending = await (await GET(get(`/api/session?account=${ACC_NO_GRANT}`, cookie))).json();
  expect(pending).toMatchObject({ status: "pending", botAddress: BOT, account: null });
  expect(fake.grantedPools).toHaveBeenCalledWith(ACC_NO_GRANT, BOT, [P1, P2]);
  expect(await listWatchedAccounts(testDb as Db)).toEqual([]);

  const linked = await (await GET(get(`/api/session?account=${ACC_GRANT}`, cookie))).json();
  expect(linked).toMatchObject({
    status: "linked",
    account: ACC_GRANT,
    linkedPools: [P1],
    missingPools: [P2],
    symbols: { [P1]: "BTC-PERP", [P2]: "ETH-PERP" },
  });
  expect(await listWatchedAccounts(testDb as Db)).toEqual([ACC_GRANT]);

  // Already linked: the bound account answers, the query account is ignored and the chain is not asked again.
  fake.grantedPools.mockClear();
  const again = await (await GET(get(`/api/session?account=${ACC_NO_GRANT}`, cookie))).json();
  expect(again).toMatchObject({
    status: "linked",
    account: ACC_GRANT,
    linkedPools: [P1],
    missingPools: [P2],
  });
  expect(fake.grantedPools).not.toHaveBeenCalled();
});

test("GET rejects an invalid account", async () => {
  const cookie = cookieOf(await POST(req("POST", "/api/session")));
  await mint();
  const res = await GET(get("/api/session?account=nope", cookie));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "invalid_address" });
});

test("GET without a valid cookie is 401", async () => {
  const none = await GET(get("/api/session"));
  expect(none.status).toBe(401);
  expect(await none.json()).toEqual({ error: "no_session" });
  expect((await GET(get("/api/session", "perplog_session=garbage"))).status).toBe(401);
  expect(
    (await GET(get("/api/session", "perplog_session=00000000-0000-4000-8000-000000000000"))).status,
  ).toBe(401);
});

test("without a database every route is 503 db_unavailable", async () => {
  testDb = null;
  for (const res of [await POST(req("POST", "/api/session")), await GET(get("/api/session"))]) {
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "db_unavailable" });
  }
});

test("11th POST within a minute is 429", async () => {
  const cookie = cookieOf(await POST(req("POST", "/api/session")));
  for (let i = 0; i < 10; i++) expect((await POST(req("POST", "/api/session", { cookie }))).status).toBe(201);
  const res = await POST(req("POST", "/api/session", { cookie }));
  expect(res.status).toBe(429);
  expect(await res.json()).toEqual({ error: "rate_limited" });
});

test("without a cookie the limit is per client IP", async () => {
  for (let i = 0; i < 10; i++)
    expect((await POST(req("POST", "/api/session", { ip: "1.2.3.4, 9.9.9.9" }))).status).toBe(201);
  expect((await POST(req("POST", "/api/session", { ip: "1.2.3.4" }))).status).toBe(429);
  expect((await POST(req("POST", "/api/session", { ip: "5.6.7.8" }))).status).toBe(201);
});

test("fresh random-UUID cookies do not escape the per-IP limit", async () => {
  const fresh = () => `perplog_session=${crypto.randomUUID()}`;
  for (let i = 0; i < 10; i++) {
    const res = await POST(req("POST", "/api/session", { cookie: fresh(), ip: "1.2.3.4" }));
    expect(res.status).toBe(201);
  }
  const res = await POST(req("POST", "/api/session", { cookie: fresh(), ip: "1.2.3.4" }));
  expect(res.status).toBe(429);
  expect(await (testDb as Db).query.botKeys.findMany()).toHaveLength(10);
});

test("a failure while binding leaves the key pending and the session unbound", async () => {
  const cookie = cookieOf(await POST(req("POST", "/api/session")));
  await mint();
  vi.mocked(upsertWatch).mockRejectedValueOnce(new Error("db down"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const failed = await GET(get(`/api/session?account=${ACC_GRANT}`, cookie));
  expect(failed.status).toBe(500);
  const [key] = await (testDb as Db).query.botKeys.findMany();
  expect(key).toMatchObject({ status: "pending", account: null });
  expect(await getBotKey(testDb as Db, key?.id as string)).toMatchObject({ status: "pending" });
  expect(await (testDb as Db).query.sessions.findMany()).toMatchObject([{ account: null }]);

  // The retry links it normally.
  const retry = await (await GET(get(`/api/session?account=${ACC_GRANT}`, cookie))).json();
  expect(retry).toMatchObject({ status: "linked", account: ACC_GRANT });
  expect(await listWatchedAccounts(testDb as Db)).toEqual([ACC_GRANT]);
});
