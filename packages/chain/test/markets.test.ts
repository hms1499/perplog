import { fetchPerpMarkets } from "../src/indexer/markets";

test("fetchPerpMarkets maps rows", async () => {
  const fetchImpl = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          data: {
            Market: [
              {
                poolAddress: "0xF71B619450BAFE953F47B9B556416A3A67B443B5",
                baseSymbol: "LINK",
                baseDecimals: 18,
                tickSize: "1000",
                lotSize: "10",
                minQuantity: "100",
                stopRegistry: null,
              },
            ],
          },
        }),
      ),
  );
  const markets = await fetchPerpMarkets("u", fetchImpl);
  expect(markets).toEqual([
    {
      pool: "0xf71b619450bafe953f47b9b556416a3a67b443b5",
      symbol: "LINK",
      baseDecimals: 18,
      tickSize: 1000n,
      lotSize: 10n,
      minQuantity: 100n,
      stopRegistry: null,
    },
  ]);
});
