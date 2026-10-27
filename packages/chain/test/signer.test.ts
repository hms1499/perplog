import type { Address } from "@perplog/core";
import { type Hash, TransactionReceiptNotFoundError } from "viem";
import {
  type BotWallet,
  hasPendingTx,
  OperatorRevert,
  placeMarketFor,
  receiptOf,
  TxOutcomeUnknown,
} from "../src/signer";

const POOL = `0x${"b1".repeat(20)}` as Address;
const OWNER = `0x${"a1".repeat(20)}` as Address;
const HASH = `0x${"ab".repeat(32)}` as Hash;
const ORDER = { owner: OWNER, pool: POOL, isBid: false, qtyRaw: 10n, priceBound: 100n };

const receipt = (status: "success" | "reverted") => ({ status, logs: [], gasUsed: 123n });

function fakeWallet(over: {
  simulate?: () => Promise<unknown>;
  write?: () => Promise<Hash>;
  wait?: () => Promise<unknown>;
}) {
  const simulateContract = vi.fn(over.simulate ?? (async () => ({ request: {} })));
  const writeContract = vi.fn(over.write ?? (async () => HASH));
  const waitForTransactionReceipt = vi.fn(over.wait ?? (async () => receipt("success")));
  const wallet = {
    address: OWNER,
    publicClient: { simulateContract, waitForTransactionReceipt },
    walletClient: { writeContract, account: undefined },
  } as unknown as BotWallet;
  return { wallet, simulateContract, writeContract, waitForTransactionReceipt };
}

describe("signer", () => {
  test("OperatorRevert carries the error name", () => {
    const e = new OperatorRevert("ImmediateOrCancelNoFill");
    expect(e).toBeInstanceOf(Error);
    expect(e.errorName).toBe("ImmediateOrCancelNoFill");
  });

  test("an error before broadcast is rethrown as is: it is safe to retry", async () => {
    const boom = new Error("fetch failed");
    const w = fakeWallet({ simulate: () => Promise.reject(boom) });
    await expect(placeMarketFor(w.wallet, ORDER)).rejects.toBe(boom);
    expect(w.writeContract).not.toHaveBeenCalled();
  });

  test("writeContract throwing makes the outcome unknown, without a hash", async () => {
    const w = fakeWallet({ write: () => Promise.reject(new Error("already known")) });
    const err = await placeMarketFor(w.wallet, ORDER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TxOutcomeUnknown);
    expect((err as TxOutcomeUnknown).txHash).toBeNull();
    expect((err as TxOutcomeUnknown).message).toContain("already known");
  });

  test("a receipt wait that fails after broadcast makes the outcome unknown, with the hash", async () => {
    const w = fakeWallet({ wait: () => Promise.reject(new Error("HTTP 429")) });
    const err = await placeMarketFor(w.wallet, ORDER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TxOutcomeUnknown);
    expect((err as TxOutcomeUnknown).txHash).toBe(HASH);
  });

  test("a reverted receipt is a known outcome: OperatorRevert reverted_onchain", async () => {
    const w = fakeWallet({ wait: async () => receipt("reverted") });
    const err = await placeMarketFor(w.wallet, ORDER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OperatorRevert);
    expect((err as OperatorRevert).errorName).toBe("reverted_onchain");
  });

  test("a mined receipt is decoded into the result", async () => {
    const w = fakeWallet({});
    expect(await placeMarketFor(w.wallet, ORDER)).toEqual({
      txHash: HASH,
      orderId: null,
      filledRaw: 0n,
      avgPrice: null,
      gasUsed: 123n,
    });
  });

  test("receiptOf: null when not found, decoded when mined, reverted flagged, other errors thrown", async () => {
    const client = (impl: () => Promise<unknown>) =>
      ({ getTransactionReceipt: vi.fn(impl) }) as unknown as Parameters<typeof receiptOf>[0];
    expect(
      await receiptOf(
        client(() => Promise.reject(new TransactionReceiptNotFoundError({ hash: HASH }))),
        HASH,
        POOL,
      ),
    ).toBeNull();
    expect(
      await receiptOf(
        client(async () => receipt("success")),
        HASH,
        POOL,
      ),
    ).toEqual({
      txHash: HASH,
      orderId: null,
      filledRaw: 0n,
      avgPrice: null,
      gasUsed: 123n,
      reverted: false,
    });
    expect(
      await receiptOf(
        client(async () => receipt("reverted")),
        HASH,
        POOL,
      ),
    ).toMatchObject({
      filledRaw: 0n,
      reverted: true,
    });
    await expect(
      receiptOf(
        client(() => Promise.reject(new Error("HTTP 503"))),
        HASH,
        POOL,
      ),
    ).rejects.toThrow("HTTP 503");
  });

  test("hasPendingTx compares the pending and latest nonces", async () => {
    const client = (pending: number, latest: number) =>
      ({
        getTransactionCount: vi.fn(async ({ blockTag }: { blockTag: string }) =>
          blockTag === "pending" ? pending : latest,
        ),
      }) as unknown as Parameters<typeof hasPendingTx>[0];
    expect(await hasPendingTx(client(5, 4), OWNER)).toBe(true);
    expect(await hasPendingTx(client(4, 4), OWNER)).toBe(false);
  });
});
