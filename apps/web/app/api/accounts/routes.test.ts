import { IndexerError } from "@perplog/chain";
import { accountService } from "@/lib/service";
import { GET as health } from "./[address]/health/route";
import { GET as leaks } from "./[address]/leaks/route";
import { GET as positions } from "./[address]/positions/route";
import { GET as trades } from "./[address]/trades/route";

vi.mock("@/lib/service", () => ({
  accountService: {
    getHealth: vi.fn(),
    getTrades: vi.fn(),
    getLeaks: vi.fn(),
    getPositions: vi.fn(),
  },
}));

const service = vi.mocked(accountService);
const ADDRESS = "0x31b0480ff2ec5d0a4d9480a9f8c8802897c08281";
const ctx = (address: string) => ({ params: Promise.resolve({ address }) });
const req = (path: string) => new Request(`http://localhost${path}`);

beforeEach(() => vi.clearAllMocks());

test("health 400 on invalid address", async () => {
  const res = await health(req("/api/accounts/nope/health"), ctx("nope"));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "invalid_address" });
});

test("health 503 when the indexer throws IndexerError", async () => {
  service.getHealth.mockRejectedValue(new IndexerError("PositionChanges", "HTTP 502"));
  const res = await health(req(`/api/accounts/${ADDRESS}/health`), ctx(ADDRESS));
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: "indexer_unavailable" });
});

test("bigints serialize as strings", async () => {
  service.getHealth.mockResolvedValue({ netPnlRaw: -796800000000000000000n } as never);
  const res = await health(req(`/api/accounts/${ADDRESS}/health?range=30d`), ctx(ADDRESS));
  expect(res.status).toBe(200);
  expect((await res.json()).netPnlRaw).toBe("-796800000000000000000");
  expect(service.getHealth).toHaveBeenCalledWith(ADDRESS, "30d");
});

test("mixed-case address with whitespace is accepted", async () => {
  service.getHealth.mockResolvedValue({} as never);
  const raw = encodeURIComponent(" 0x31B0480FF2EC5D0A4D9480A9F8C8802897C08281 ");
  const res = await health(req(`/api/accounts/${raw}/health`), ctx(decodeURIComponent(raw)));
  expect(res.status).toBe(200);
  expect(service.getHealth).toHaveBeenCalledWith(ADDRESS, "7d");
});

test("invalid range is rejected", async () => {
  const res = await health(req(`/api/accounts/${ADDRESS}/health?range=1y`), ctx(ADDRESS));
  expect(res.status).toBe(400);
});

test("trades passes validated filters to the service", async () => {
  service.getTrades.mockResolvedValue({ trades: [], nextCursor: null });
  const res = await trades(
    req(`/api/accounts/${ADDRESS}/trades?range=all&exit=LIQUIDATED&side=short&cursor=50&limit=20`),
    ctx(ADDRESS),
  );
  expect(res.status).toBe(200);
  expect(service.getTrades).toHaveBeenCalledWith(ADDRESS, {
    range: "all",
    exit: "LIQUIDATED",
    side: "short",
    cursor: "50",
    limit: 20,
  });
});

test("leaks and positions return 200", async () => {
  service.getLeaks.mockResolvedValue([]);
  service.getPositions.mockResolvedValue([]);
  expect((await leaks(req(`/api/accounts/${ADDRESS}/leaks`), ctx(ADDRESS))).status).toBe(200);
  expect((await positions(req(`/api/accounts/${ADDRESS}/positions`), ctx(ADDRESS))).status).toBe(200);
});

test("unexpected errors become a generic 500", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  service.getLeaks.mockRejectedValue(new Error("secret stack"));
  const res = await leaks(req(`/api/accounts/${ADDRESS}/leaks`), ctx(ADDRESS));
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: "internal" });
});
