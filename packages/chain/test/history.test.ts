import { fetchAccountHistory } from "../src/indexer/history";

const ACCOUNT = "0x395225eab84c1b9304d42cb647238dcc90003951";
const PERP_POOL = "0xd6cb1dd58580b84d76068ac21594219ce03aeddf";

const ROWS: Record<string, unknown[]> = {
  PerpPositionChange: [
    {
      id: "c1",
      kind: "OPEN",
      pool: PERP_POOL,
      orderId: "77",
      blockNumber: "10",
      logIndex: 1,
      timestamp: "100",
      txHash: "0xAA",
      sizeBefore: "0",
      sizeAfter: "-5",
      closedSize: "0",
      entryPriceBefore: null,
      entryPriceAfter: "2000",
      exitPrice: null,
      realizedPnl: "0",
    },
  ],
  FundingPayment: [{ id: "f1", pool: PERP_POOL, amount: "3", timestamp: "120", txHash: "0xbb" }],
  PerpFeeRecord: [{ id: "l1", pool: PERP_POOL, amount: "4", timestamp: "130", txHash: "0xcc" }],
  ProtocolFeeRecord: [
    { id: "p1", pool: PERP_POOL, amount: "1", timestamp: "100", txHash: "0xaa" },
    {
      id: "p2",
      pool: "0x0000000000000000000000000000000000000001",
      amount: "9",
      timestamp: "100",
      txHash: "0xdd",
    },
  ],
  BuilderFeeRecord: [{ id: "b1", pool: PERP_POOL, amount: "2", timestamp: "100", txHash: "0xaa" }],
  MarginEvent: [{ id: "m1", kind: "Credited", amount: "1000", timestamp: "50" }],
  PerpMarginPull: [],
  LiquidationEvent: [
    { id: "q1", kind: "PositionLiquidated", pool: PERP_POOL, txHash: "0xcc", timestamp: "130" },
  ],
  StopOrder: [
    {
      id: "s1",
      market_id: PERP_POOL,
      status: "PENDING",
      isBid: true,
      triggerOperator: 0,
      triggerPrice: "2100",
      quantity: "0",
      createdAt: "105",
      updatedAt: "105",
      placedOrderId: null,
    },
  ],
};

function fakeFetch(bodies: string[]) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = String(init?.body);
    bodies.push(body);
    const table = Object.keys(ROWS).find((t) => body.includes(` ${t}(`));
    if (!table) throw new Error(`unexpected query ${body}`);
    return new Response(JSON.stringify({ data: { [table]: ROWS[table] } }));
  });
}

test("fetchAccountHistory runs 9 queries, maps fee kinds, filters non-perp protocol fees", async () => {
  const bodies: string[] = [];
  const h = await fetchAccountHistory(ACCOUNT, {
    indexerUrl: "u",
    perpPools: new Set([PERP_POOL]),
    fetchImpl: fakeFetch(bodies),
  });
  expect(bodies).toHaveLength(9);
  expect(h.fees.map((f) => f.kind)).toEqual(["liquidation", "trading", "builder"]);
  expect(h.changes[0]?.sizeAfter).toBe(-5n);
  expect(h.changes[0]?.txHash).toBe("0xaa");
  expect(h.stopOrders[0]?.createdAt).toBe(105);
  expect(h.stopOrders[0]?.pool).toBe(PERP_POOL);
  expect(h.truncated).toBe(false);
  expect(h.account).toBe(ACCOUNT);
});

test("asOfTimestamp adds an _lte filter to every query", async () => {
  const bodies: string[] = [];
  await fetchAccountHistory(ACCOUNT, {
    indexerUrl: "u",
    perpPools: new Set([PERP_POOL]),
    asOfTimestamp: 1792900000,
    fetchImpl: fakeFetch(bodies),
  });
  expect(bodies).toHaveLength(9);
  for (const body of bodies) expect(body).toContain("_lte: 1792900000");
});
