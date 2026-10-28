import type { Address, MarketInfo } from "@perplog/core";
import {
  bindBotKey,
  bindSession,
  claimQueuedEntries,
  claimRequestedBotKeys,
  createBotKeyRequest,
  createSession,
  type Db,
  settleEntryFilled,
} from "@perplog/db";
import { createTestDb } from "@perplog/db/testing";
import { ChainUnavailableError } from "@/lib/account-service";
import { chain } from "@/lib/chain";
import { GET } from "./[id]/route";
import { POST as QUOTE } from "./quote/route";
import { POST } from "./route";

let testDb: Db | null = null;
vi.mock("@/lib/db", () => ({ getDb: () => testDb }));
vi.mock("@/lib/chain", () => ({
  chain: {
    perpPools: vi.fn(),
    markets: vi.fn(),
    grantedPools: vi.fn(),
    readPositionSize: vi.fn(),
    readMark: vi.fn(),
    bookTop: vi.fn(),
    maxOrderSize: vi.fn(),
    liquidationPreview: vi.fn(),
  },
}));

const E18 = 10n ** 18n;
const P1 = "0x00000000000000000000000000000000000000a1" as Address;
const ACC = "0x00000000000000000000000000000000000000bb" as Address;
const OTHER = "0x00000000000000000000000000000000000000cc" as Address;
const BOT = "0x00000000000000000000000000000000000000b0" as Address;
const fake = vi.mocked(chain);

const MARKET: MarketInfo = {
  pool: P1,
  symbol: "X-PERP",
  baseDecimals: 18,
  tickSize: 10n ** 14n,
  lotSize: 10n ** 15n,
  minQuantity: 10n ** 15n,
  stopRegistry: null,
};

const body = (over: Record<string, unknown> = {}) => ({
  account: ACC,
  pool: P1,
  side: "long",
  riskRaw: (10n * E18).toString(),
  stopPrice: (95n * E18).toString(),
  ...over,
});

const quote = (b: unknown) =>
  QUOTE(new Request("http://localhost/api/plans/quote", { method: "POST", body: JSON.stringify(b) }));

beforeEach(() => {
  vi.resetAllMocks();
  testDb = null;
  fake.markets.mockResolvedValue([MARKET]);
  fake.bookTop.mockResolvedValue({ bestBid: 99n * E18, bestAsk: 100n * E18 });
  fake.maxOrderSize.mockResolvedValue(50n * E18);
  fake.liquidationPreview.mockResolvedValue({ liqPrice: 80n * E18, leverageBps: 20_000n });
});

describe("POST /api/plans/quote", () => {
  test("quote sizes a long from the ask and returns decimal strings", async () => {
    const res = await quote(body());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      qtyRaw: (2n * E18).toString(),
      refPrice: (100n * E18).toString(),
      stopPrice: (95n * E18).toString(),
      priceBound: (1005n * 10n ** 17n).toString(),
      notionalRaw: (200n * E18).toString(),
      effectiveRiskRaw: (10n * E18).toString(),
      capped: false,
      liqPriceEst: (80n * E18).toString(),
      leverageEstBps: "20000",
      warnings: [],
    });
    expect(fake.maxOrderSize).toHaveBeenCalledWith(ACC, P1, true, 1005n * 10n ** 17n);
    expect(fake.liquidationPreview).toHaveBeenCalledWith(ACC, P1, true, 2n * E18, 100n * E18);
  });

  test("the stop snaps to the tick away from the entry", async () => {
    const res = await quote(body({ stopPrice: "95000050000000000000" }));
    expect((await res.json()).stopPrice).toBe("95000000000000000000");
  });

  test("missing ask → 400 no_liquidity", async () => {
    fake.bookTop.mockResolvedValue({ bestBid: 99n * E18, bestAsk: null });
    const res = await quote(body());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no_liquidity" });
  });

  test("stop beyond the projected liquidation price → 400 stop_beyond_liquidation", async () => {
    fake.liquidationPreview.mockResolvedValue({ liqPrice: 96n * E18, leverageBps: 90_000n });
    const res = await quote(body());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "stop_beyond_liquidation" });
  });

  test("a max size below the risk size returns capped with the warning", async () => {
    fake.maxOrderSize.mockResolvedValue(1_234_567_000_000_000_000n);
    const res = await quote(body());
    const q = await res.json();
    expect(q).toMatchObject({ qtyRaw: "1234000000000000000", capped: true });
    expect(q.warnings).toEqual(["Capped by your available margin; effective risk shown."]);
  });

  test("a stale mark (not priceable) → 400 not_priceable", async () => {
    fake.maxOrderSize.mockResolvedValue(null);
    const res = await quote(body());
    expect(await res.json()).toEqual({ error: "not_priceable" });
  });

  test("unknown pool → 400 unknown_pool", async () => {
    const res = await quote(body({ pool: "0x00000000000000000000000000000000000000ff" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown_pool" });
  });

  test.each([["0"], ["-1"], ["1.5"]])('riskRaw "%s" → 400 invalid_input', async (riskRaw) => {
    const res = await quote(body({ riskRaw }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_input" });
  });

  test("a bad account or side → 400 invalid_input", async () => {
    expect((await quote(body({ account: "nope" }))).status).toBe(400);
    expect((await quote(body({ side: "up" }))).status).toBe(400);
  });

  test("chain failure → 503 chain_unavailable", async () => {
    fake.bookTop.mockRejectedValue(new ChainUnavailableError(new Error("rpc down")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await quote(body());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "chain_unavailable" });
  });
});

const db = () => testDb as Db;

/** A session whose bot key is minted and linked to `account` on P1. */
async function linkedSession(account: Address, bot: Address = BOT): Promise<string> {
  const key = await createBotKeyRequest(db());
  await claimRequestedBotKeys(db(), 10, () => ({ address: bot, encPk: "pk", iv: "iv", tag: "tag" }));
  const session = await createSession(db(), key.id);
  await bindBotKey(db(), key.id, account, [P1]);
  await bindSession(db(), session.id, account);
  return `perplog_session=${session.id}`;
}

function place(b: unknown, cookie?: string) {
  const headers: Record<string, string> = { origin: "http://localhost" };
  if (cookie) headers.cookie = cookie;
  return POST(
    new Request("http://localhost/api/plans", { method: "POST", headers, body: JSON.stringify(b) }),
  );
}

function read(id: string, cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return GET(new Request(`http://localhost/api/plans/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

describe("POST /api/plans and GET /api/plans/:id", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
    fake.grantedPools.mockResolvedValue([P1]);
    fake.readPositionSize.mockResolvedValue(0n);
  });

  test("places a plan with a queued entry sized by the server, not the client", async () => {
    const cookie = await linkedSession(ACC);
    const res = await place({ ...body(), qtyRaw: "999", confirm: true }, cookie);
    expect(res.status).toBe(201);
    const { plan } = await res.json();
    expect(plan).toMatchObject({
      pool: P1,
      side: "long",
      qtyRaw: (2n * E18).toString(),
      stopPrice: (95n * E18).toString(),
      status: "pending_entry",
      stopId: null,
      txHash: null,
    });
    const [entry] = await claimQueuedEntries(db(), 10);
    expect(entry).toMatchObject({ planId: plan.id, kind: "entry", qtyRaw: 2n * E18, isBid: true });
  });

  test("no DATABASE_URL → 503 db_unavailable", async () => {
    testDb = null;
    const res = await place({ ...body(), confirm: true });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "db_unavailable" });
  });

  test("no session → 401; unlinked → 403", async () => {
    expect((await place({ ...body(), confirm: true })).status).toBe(401);
    const key = await createBotKeyRequest(db());
    const session = await createSession(db(), key.id);
    const res = await place({ ...body(), confirm: true }, `perplog_session=${session.id}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_linked" });
  });

  test("another account → 403 account_mismatch", async () => {
    const cookie = await linkedSession(ACC);
    const res = await place({ ...body({ account: OTHER }), confirm: true }, cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "account_mismatch" });
  });

  test("without confirm: true → 400 invalid_input", async () => {
    const cookie = await linkedSession(ACC);
    expect((await place(body(), cookie)).status).toBe(400);
  });

  test("open position → 409 position_open", async () => {
    const cookie = await linkedSession(ACC);
    fake.readPositionSize.mockResolvedValue(-5n);
    const res = await place({ ...body(), confirm: true }, cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "position_open" });
  });

  test("second POST while pending → 409 plan_pending", async () => {
    const cookie = await linkedSession(ACC);
    expect((await place({ ...body(), confirm: true }, cookie)).status).toBe(201);
    const res = await place({ ...body(), confirm: true }, cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "plan_pending" });
  });

  test("missing grant → 409 pool_not_linked", async () => {
    const cookie = await linkedSession(ACC);
    fake.grantedPools.mockResolvedValue([]);
    const res = await place({ ...body(), confirm: true }, cookie);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("pool_not_linked");
  });

  test("a failing server quote → 400 with its error, and nothing is queued", async () => {
    const cookie = await linkedSession(ACC);
    fake.bookTop.mockResolvedValue({ bestBid: null, bestAsk: null });
    const res = await place({ ...body(), confirm: true }, cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no_liquidity" });
    expect(await claimQueuedEntries(db(), 10)).toEqual([]);
  });

  test("GET returns the owner's plan with its entry tx hash and 404 for anyone else", async () => {
    const cookie = await linkedSession(ACC);
    const { plan } = await (await place({ ...body(), confirm: true }, cookie)).json();
    const [entry] = await claimQueuedEntries(db(), 10);
    const hash = `0x${"ab".repeat(32)}`;
    await settleEntryFilled(db(), {
      executionId: entry?.id ?? "",
      fill: { txHash: hash, orderId: 1n, filledRaw: 2n * E18, avgPrice: 100n * E18, gasUsed: 1n },
    });

    const mine = await read(plan.id, cookie);
    expect(mine.status).toBe(200);
    const view = (await mine.json()).plan;
    expect(view).toMatchObject({ id: plan.id, status: "entered", txHash: hash });
    expect(view.stopId).toMatch(/^[0-9a-f-]{36}$/);

    const otherCookie = await linkedSession(OTHER, "0x00000000000000000000000000000000000000b1" as Address);
    expect((await read(plan.id, otherCookie)).status).toBe(404);
    expect((await read(plan.id)).status).toBe(404);
    expect((await read("not-a-uuid", cookie)).status).toBe(404);
  });
});

describe("GET /api/markets", () => {
  test("lists the markets with raw sizes as decimal strings", async () => {
    const { GET: MARKETS } = await import("../markets/route");
    const res = await MARKETS();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        pool: P1,
        symbol: "X-PERP",
        baseDecimals: 18,
        tickSize: (10n ** 14n).toString(),
        lotSize: (10n ** 15n).toString(),
        minQuantity: (10n ** 15n).toString(),
        stopRegistry: null,
      },
    ]);
  });
});
