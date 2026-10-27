/**
 * Adapted from dreamdex-bot-kit (packages/perp-core/src/operator.ts).
 *
 * @license
 * Copyright DreamDEX S.A.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://github.com/somnia-chain/dreamdex-bot-kit/blob/main/LICENSE
 */

// Signing side of bot-key mode. Imported only by the worker through the
// "@perplog/chain/signer" subpath; never re-exported from the package barrel,
// so the web app cannot pull in wallet code.

import type { Address } from "@perplog/core";
import { decodePlaceOrder, ORDER_TYPE } from "@somnia-chain/markets-sdk";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  type Hash,
  type Hex,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Network } from "./networks";
import { OPERATOR_ABI, ORDER_GAS, summarizeFills } from "./operator";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/** Resting-order expiry the SDK uses: fifty years out, in nanoseconds. */
function farFutureNs(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 50 * 365 * 24 * 3600) * 1_000_000_000n;
}

/** A write that reverted, in simulation (named pool error) or on-chain (`reverted_onchain`). */
export class OperatorRevert extends Error {
  readonly errorName: string;
  constructor(errorName: string) {
    super(`placeOrderFor reverted: ${errorName}`);
    this.name = "OperatorRevert";
    this.errorName = errorName;
  }
}

export interface BotWallet {
  address: Address;
  publicClient: PublicClient;
  walletClient: WalletClient;
}

export function createBotWallet(privateKey: Hex, network: Network): BotWallet {
  const account = privateKeyToAccount(privateKey);
  const transport = http(network.rpcHttp);
  return {
    address: account.address.toLowerCase() as Address,
    publicClient: createPublicClient({ chain: network.chain, transport }) as PublicClient,
    walletClient: createWalletClient({ account, chain: network.chain, transport }),
  };
}

export interface PlaceResult {
  txHash: Hash;
  orderId: bigint | null;
  filledRaw: bigint;
  avgPrice: bigint | null;
  gasUsed: bigint;
}

/** IOC market `placeOrderFor` for `owner`. Simulates first so a revert arrives as its named error. */
export async function placeMarketFor(
  wallet: BotWallet,
  p: { owner: Address; pool: Address; isBid: boolean; qtyRaw: bigint; priceBound: bigint },
): Promise<PlaceResult> {
  let request: unknown;
  try {
    ({ request } = await wallet.publicClient.simulateContract({
      address: p.pool,
      abi: OPERATOR_ABI,
      functionName: "placeOrderFor",
      args: [
        p.owner,
        p.isBid,
        0n,
        p.priceBound,
        p.qtyRaw,
        farFutureNs(),
        ORDER_TYPE.MARKET,
        0,
        ZERO_ADDRESS,
        0n,
      ],
      account: wallet.walletClient.account,
      gas: ORDER_GAS,
    }));
  } catch (err) {
    const cause =
      err instanceof BaseError ? err.walk((e) => e instanceof ContractFunctionRevertedError) : null;
    if (cause instanceof ContractFunctionRevertedError) {
      throw new OperatorRevert(cause.data?.errorName ?? "unknown");
    }
    throw err;
  }
  const txHash = await wallet.walletClient.writeContract(request as never);
  const receipt = await wallet.publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new OperatorRevert("reverted_onchain");
  const { orderId, fills } = decodePlaceOrder(receipt, p.pool);
  return { txHash, orderId: orderId ?? null, ...summarizeFills(fills), gasUsed: receipt.gasUsed };
}
