/**
 * Adapted from dreamdex-bot-kit (packages/perp-core/src/operator.ts).
 *
 * @license
 * Copyright DreamDEX S.A.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://github.com/somnia-chain/dreamdex-bot-kit/blob/main/LICENSE
 */

// Bot-key mode: a bot key that trades FOR a DreamDEX account. The account links
// the key in the dreamDEX app (wallet -> Link a bot -> Perps), which writes an
// operator grant per selector. The key then sends `placeOrderFor(owner, ...)`:
// margin locks from the account's MarginBank balance, fills settle to the
// account, the key pays gas only and cannot withdraw. The markets SDK has no
// perp `...For` writes, so they are sent here with viem.

import type { Address } from "@perplog/core";
import { contractErrorsAbi, type OrderFill } from "@somnia-chain/markets-sdk";
import { type PublicClient, parseAbi } from "viem";

/** The three selectors a linked bot key is granted, as the registry keys them. */
export const OPERATOR_SELECTOR = {
  placeOrderFor: "0x80054449",
  cancelOrderFor: "0xe37b444b",
  reduceOrderFor: "0x364c2587",
} as const;

export const OPERATOR_ABI = [
  ...parseAbi([
    "function placeOrderFor(address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k) payable returns (bool success, uint128 orderId)",
    "function cancelOrderFor(address owner, uint128 orderId)",
    "function reduceOrderFor(address owner, uint128 orderId, uint256 newQuantityRemaining)",
    "function isOperatorAuthorized(address owner, address operator, bytes4 selector) view returns (bool)",
  ]),
  // The pool reverts with named errors (`ImmediateOrCancelNoFill`, ...). With
  // them in the ABI the simulation error carries the name.
  ...contractErrorsAbi,
] as const;

/** Gas limit for every order write. Somnia bills gas used, not the limit. */
export const ORDER_GAS = 20_000_000n;

/** Pools (from `pools`) on which `bot` holds the `placeOrderFor` grant for `owner`. Failed reads count as not granted. */
export async function grantedPools(
  client: Pick<PublicClient, "multicall">,
  owner: Address,
  bot: Address,
  pools: Address[],
): Promise<Address[]> {
  if (pools.length === 0) return [];
  const results = await client.multicall({
    allowFailure: true,
    contracts: pools.map((pool) => ({
      address: pool,
      abi: OPERATOR_ABI,
      functionName: "isOperatorAuthorized" as const,
      args: [owner, bot, OPERATOR_SELECTOR.placeOrderFor] as const,
    })),
  });
  return pools.filter((_, i) => {
    const r = results[i];
    return r?.status === "success" && r.result === true;
  });
}

/** Total filled quantity and its volume-weighted average price (null when nothing filled). */
export function summarizeFills(fills: OrderFill[]): { filledRaw: bigint; avgPrice: bigint | null } {
  let filledRaw = 0n;
  let notional = 0n;
  for (const f of fills) {
    filledRaw += f.quantityFilled;
    notional += f.quantityFilled * f.fillPrice;
  }
  return { filledRaw, avgPrice: filledRaw === 0n ? null : notional / filledRaw };
}
