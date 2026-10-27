import type { OrderFill } from "@somnia-chain/markets-sdk";
import { getAbiItem, toFunctionSelector } from "viem";
import { grantedPools, OPERATOR_ABI, OPERATOR_SELECTOR, summarizeFills } from "../src/operator";

function fill(q: bigint, p: bigint): OrderFill {
  return { quantityFilled: q, fillPrice: p } as unknown as OrderFill;
}

describe("operator", () => {
  test("grantedPools keeps pools whose placeOrderFor grant is true and treats failures as not granted", async () => {
    const calls: { contracts: Record<string, unknown>[]; allowFailure?: boolean }[] = [];
    const client = {
      multicall: async (a: { contracts: Record<string, unknown>[]; allowFailure?: boolean }) => {
        calls.push(a);
        return [
          { status: "success", result: true },
          { status: "success", result: false },
          { status: "failure", error: new Error("x") },
        ];
      },
    };
    expect(await grantedPools(client as never, "0xa", "0xb", ["0x1", "0x2", "0x3"])).toEqual(["0x1"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.allowFailure).toBe(true);
    expect(calls[0]?.contracts.map((c) => c.address)).toEqual(["0x1", "0x2", "0x3"]);
    for (const c of calls[0]?.contracts ?? []) {
      expect(c.functionName).toBe("isOperatorAuthorized");
      expect(c.args).toEqual(["0xa", "0xb", "0x80054449"]);
    }
  });

  test("grantedPools with no pools makes no call", async () => {
    const multicall = vi.fn();
    expect(await grantedPools({ multicall } as never, "0xa", "0xb", [])).toEqual([]);
    expect(multicall).not.toHaveBeenCalled();
  });

  test("summarizeFills: total and VWAP; no fills → 0 and null", () => {
    expect(summarizeFills([fill(2n, 100n), fill(1n, 130n)])).toEqual({ filledRaw: 3n, avgPrice: 110n });
    expect(summarizeFills([])).toEqual({ filledRaw: 0n, avgPrice: null });
  });

  test("OPERATOR_ABI selectors match the granted ones", () => {
    for (const name of ["placeOrderFor", "cancelOrderFor", "reduceOrderFor"] as const) {
      const item = getAbiItem({ abi: OPERATOR_ABI, name });
      expect(toFunctionSelector(item as never)).toBe(OPERATOR_SELECTOR[name]);
    }
  });
});
