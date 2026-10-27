import type { watchPositionUpdates } from "@perplog/chain";
import type { PlaceResult, ReceiptResult } from "@perplog/chain/signer";
import type { Address, MarketInfo, Side } from "@perplog/core";
import type { Hash, Hex } from "viem";

/** Everything the worker needs from the outside world; faked in tests. */
export interface ChainPort {
  /** Perp markets from the indexer, cached for 10 minutes. */
  markets(): Promise<MarketInfo[]>;
  /** Signed position size; pinned to `atBlock` when given (a node that has not reached it must throw). */
  readPositionSize(account: Address, pool: Address, atBlock?: bigint): Promise<bigint>;
  /** Latest block number on the node that serves sizes, receipts and nonces. */
  blockNumber(): Promise<bigint>;
  readMark(pool: Address): Promise<{ price: bigint; fromIndex: boolean }>;
  grantedPools(owner: Address, bot: Address, pools: Address[]): Promise<Address[]>;
  placeMarketFor(
    privateKey: Hex,
    p: { owner: Address; pool: Address; isBid: boolean; qtyRaw: bigint; priceBound: bigint },
  ): Promise<PlaceResult>;
  /** The mined outcome of a sent order, or null while it has no receipt. */
  receiptOf(txHash: Hash, pool: Address): Promise<ReceiptResult | null>;
  /** True while `address` has a sent tx that is not mined yet. */
  hasPendingTx(address: Address): Promise<boolean>;
  balanceOf(address: Address): Promise<bigint>;
  sendNative(privateKey: Hex, to: Address, amountWei: bigint): Promise<Hash>;
  pendingStopLosses(account: Address, pool: Address, side: Side): Promise<number>;
  openPositions(accounts: Address[]): Promise<{ account: Address; pool: Address; size: bigint }[]>;
  subscribePositionUpdates: Parameters<typeof watchPositionUpdates>[0]["subscribe"];
}
