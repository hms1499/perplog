import type { Address, MarketInfo } from "@perplog/core";
import { ChainUnavailableError } from "@/lib/account-service";
import { chain } from "@/lib/chain";
import { POST as QUOTE } from "./quote/route";

vi.mock("@/lib/db", () => ({ getDb: () => null }));
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
