import type { Address, MarketInfo } from "@perplog/core";
import { ChainUnavailableError } from "@/lib/account-service";
import { chain } from "@/lib/chain";
import { GET } from "./[pool]/book/route";

vi.mock("@/lib/chain", () => ({ chain: { markets: vi.fn(), bookTop: vi.fn() } }));

const E18 = 10n ** 18n;
const POOL = "0x00000000000000000000000000000000000000a1" as Address;
const fake = vi.mocked(chain);
const MARKET: MarketInfo = {
  pool: POOL,
  symbol: "X-PERP",
  baseDecimals: 18,
  tickSize: 10n ** 14n,
  lotSize: 10n ** 15n,
  minQuantity: 10n ** 15n,
  stopRegistry: null,
};

const get = (pool: string) =>
  GET(new Request(`http://test/api/markets/${pool}/book`), { params: Promise.resolve({ pool }) });

beforeEach(() => {
  vi.resetAllMocks();
  fake.markets.mockResolvedValue([MARKET]);
});

describe("GET /api/markets/[pool]/book", () => {
  it("answers the best bid and ask as decimal strings, uncached", async () => {
    fake.bookTop.mockResolvedValue({ bestBid: 1204n * 10n ** 15n, bestAsk: 1206n * 10n ** 15n });
    const res = await get(POOL.toUpperCase().replace("0X", "0x"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      bestBid: (1204n * 10n ** 15n).toString(),
      bestAsk: "1206000000000000000",
    });
    expect(fake.bookTop).toHaveBeenCalledWith(POOL);
  });

  it("answers null for an empty side", async () => {
    fake.bookTop.mockResolvedValue({ bestBid: null, bestAsk: 2n * E18 });
    expect(await (await get(POOL)).json()).toEqual({ bestBid: null, bestAsk: (2n * E18).toString() });
  });

  it("rejects a pool that is not a market", async () => {
    const res = await get("0x00000000000000000000000000000000000000ff");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown_pool" });
    expect(fake.bookTop).not.toHaveBeenCalled();
  });

  it("answers 503 when the chain read fails", async () => {
    fake.bookTop.mockRejectedValue(new ChainUnavailableError(new Error("rpc down")));
    const res = await get(POOL);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "chain_unavailable" });
  });
});
