import type { Address } from "@perplog/core";
import { readMarkOn, readPositionSizeOn } from "../src/onchain";

const BANK = `0x${"0b".repeat(20)}` as Address;
const ACCOUNT = `0x${"a1".repeat(20)}` as Address;
const POOL = `0x${"b1".repeat(20)}` as Address;

type Client = Parameters<typeof readPositionSizeOn>[0];

test("readPositionSizeOn reads MarginBank.getPosition, at the given block when there is one", async () => {
  const readContract = vi.fn(async (_args: Record<string, unknown>) => ({
    size: -42n,
    avgEntryPrice: 1n,
    entryFundingIndex: 0n,
    lastUpdatedTimestampNs: 0n,
  }));
  const client = { readContract } as unknown as Client;
  expect(await readPositionSizeOn(client, BANK, ACCOUNT, POOL, 77n)).toBe(-42n);
  expect(readContract).toHaveBeenCalledWith(
    expect.objectContaining({
      address: BANK,
      functionName: "getPosition",
      args: [ACCOUNT, POOL],
      blockNumber: 77n,
    }),
  );
  await readPositionSizeOn(client, BANK, ACCOUNT, POOL);
  expect(readContract.mock.calls[1]?.[0]).not.toHaveProperty("blockNumber");
});

test("readMarkOn uses the mark when the feed is ok and falls back to the index otherwise", async () => {
  const client = (ok: boolean, mark: bigint) =>
    ({
      readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
        functionName === "tryGetMarkPrice" ? [ok, mark] : [900n, 1n],
      ),
    }) as unknown as Parameters<typeof readMarkOn>[0];
  expect(await readMarkOn(client(true, 1_000n), POOL)).toEqual({ price: 1_000n, fromIndex: false });
  expect(await readMarkOn(client(false, 1_000n), POOL)).toEqual({ price: 900n, fromIndex: true });
  expect(await readMarkOn(client(true, 0n), POOL)).toEqual({ price: 900n, fromIndex: true });
});
