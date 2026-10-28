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
  type TransactionReceipt,
  TransactionReceiptNotFoundError,
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

/**
 * A write whose outcome is not known: `writeContract` threw (the node may still have accepted the tx), or the
 * tx was broadcast and then the receipt wait, or decoding it, failed. The order may yet fill, so the caller must
 * NOT resend until it has resolved the outcome (receipt found, or no tx pending for the sender).
 * `txHash` is known once `writeContract` returned, null when `writeContract` itself threw.
 */
export class TxOutcomeUnknown extends Error {
  readonly txHash: Hash | null;
  constructor(txHash: Hash | null, cause: unknown) {
    const why =
      cause instanceof Error
        ? ((cause as Error & { shortMessage?: string }).shortMessage ?? cause.message)
        : String(cause);
    super(`placeOrderFor outcome unknown${txHash ? ` for ${txHash}` : ""}: ${why}`, { cause });
    this.name = "TxOutcomeUnknown";
    this.txHash = txHash;
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
  /** The block the tx was mined in: state read at an earlier block does not include its fills. */
  blockNumber: bigint;
  /** Set by `placeMarketFor` only: how long each RPC step of the send took. */
  stepsMs?: { simulate: number; broadcast: number; receipt: number };
}

/** A mined `placeOrderFor` receipt as a result; a reverted receipt is a known outcome with nothing filled. */
export interface ReceiptResult extends PlaceResult {
  reverted: boolean;
}

function decodeReceipt(receipt: TransactionReceipt, txHash: Hash, pool: Address): ReceiptResult {
  if (receipt.status !== "success") {
    return {
      txHash,
      orderId: null,
      filledRaw: 0n,
      avgPrice: null,
      gasUsed: receipt.gasUsed,
      blockNumber: receipt.blockNumber,
      reverted: true,
    };
  }
  const { orderId, fills } = decodePlaceOrder(receipt, pool);
  return {
    txHash,
    orderId: orderId ?? null,
    ...summarizeFills(fills),
    gasUsed: receipt.gasUsed,
    blockNumber: receipt.blockNumber,
    reverted: false,
  };
}

/** The outcome of a sent `placeOrderFor`, or null while it has no receipt (pending, or dropped). */
export async function receiptOf(
  client: Pick<PublicClient, "getTransactionReceipt">,
  txHash: Hash,
  pool: Address,
): Promise<ReceiptResult | null> {
  let receipt: TransactionReceipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch (err) {
    if (err instanceof TransactionReceiptNotFoundError) return null;
    throw err;
  }
  return decodeReceipt(receipt, txHash, pool);
}

/** True while `address` has a tx in the mempool that is not mined yet (pending nonce ahead of latest). */
export async function hasPendingTx(
  client: Pick<PublicClient, "getTransactionCount">,
  address: Address,
): Promise<boolean> {
  const [pending, latest] = await Promise.all([
    client.getTransactionCount({ address, blockTag: "pending" }),
    client.getTransactionCount({ address, blockTag: "latest" }),
  ]);
  return pending > latest;
}

/**
 * IOC market `placeOrderFor` for `owner`. Simulates first so a revert arrives as its named error.
 *
 * Errors before broadcast (simulation) are thrown as is, or as `OperatorRevert`: nothing was sent, a retry is
 * safe. Anything thrown by or after `writeContract` becomes `TxOutcomeUnknown`. A mined but reverted tx is
 * `OperatorRevert("reverted_onchain")`: a known outcome, nothing filled.
 */
export async function placeMarketFor(
  wallet: BotWallet,
  p: { owner: Address; pool: Address; isBid: boolean; qtyRaw: bigint; priceBound: bigint },
  now: () => number = Date.now,
): Promise<PlaceResult> {
  const t0 = now();
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
  const t1 = now();
  let txHash: Hash;
  try {
    txHash = await wallet.walletClient.writeContract(request as never);
  } catch (err) {
    throw new TxOutcomeUnknown(null, err);
  }
  const t2 = now();
  let result: ReceiptResult;
  try {
    const receipt = await wallet.publicClient.waitForTransactionReceipt({ hash: txHash });
    result = decodeReceipt(receipt, txHash, p.pool);
  } catch (err) {
    throw new TxOutcomeUnknown(txHash, err);
  }
  if (result.reverted) throw new OperatorRevert("reverted_onchain");
  const { reverted: _reverted, ...placed } = result;
  return { ...placed, stepsMs: { simulate: t1 - t0, broadcast: t2 - t1, receipt: now() - t2 } };
}
