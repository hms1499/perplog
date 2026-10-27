import {
  createHttpClient,
  createReadClient,
  fetchOpenPerpPositions,
  fetchPendingStopLosses,
  fetchPerpMarkets,
  grantedPools,
  HIDEKI,
  type Network,
  reactivitySubscriber,
  readMark,
  readPositionSize,
  withOverrides,
} from "@perplog/chain";
import { createBotWallet, hasPendingTx, placeMarketFor, receiptOf } from "@perplog/chain/signer";
import type { MarketInfo } from "@perplog/core";
import { privateKeyToAccount } from "viem/accounts";
import type { WorkerEnv } from "./env";
import type { ChainPort } from "./ports";

const MARKETS_TTL_MS = 10 * 60_000;

/**
 * The network with the env's endpoint overrides applied. Call it ONCE at boot: the chain package caches
 * its clients by Network object identity, and `withOverrides` returns a new object on every call.
 */
export function networkFromEnv(env: WorkerEnv): Network {
  return withOverrides(HIDEKI, {
    rpcHttp: env.RPC_HTTP_URL,
    rpcWs: env.RPC_WS_URL,
    indexer: env.INDEXER_URL,
  });
}

export function liveChain(network: Network): ChainPort {
  let marketsCache: { at: number; markets: MarketInfo[] } | null = null;

  return {
    async markets() {
      const now = Date.now();
      if (!marketsCache || now - marketsCache.at > MARKETS_TTL_MS) {
        marketsCache = { at: now, markets: await fetchPerpMarkets(network.indexer) };
      }
      return marketsCache.markets;
    },
    readPositionSize: (account, pool) =>
      readPositionSize(createReadClient(network), network.marginBank, account, pool),
    readMark: (pool) => readMark(createReadClient(network), pool),
    grantedPools: (owner, bot, pools) => grantedPools(createHttpClient(network), owner, bot, pools),
    // The wallet is built per call so a decrypted key is never retained.
    placeMarketFor: (privateKey, p) => placeMarketFor(createBotWallet(privateKey, network), p),
    receiptOf: (txHash, pool) => receiptOf(createHttpClient(network), txHash, pool),
    hasPendingTx: (address) => hasPendingTx(createHttpClient(network), address),
    balanceOf: (address) => createHttpClient(network).getBalance({ address }),
    sendNative: (privateKey, to, amountWei) =>
      createBotWallet(privateKey, network).walletClient.sendTransaction({
        account: privateKeyToAccount(privateKey),
        chain: network.chain,
        to,
        value: amountWei,
      }),
    pendingStopLosses: (account, pool, side) => fetchPendingStopLosses(network.indexer, account, pool, side),
    openPositions: (accounts) => fetchOpenPerpPositions(network.indexer, accounts),
    // Lazy: the SDK client (and its WebSocket) is only touched when a subscription is actually opened.
    subscribePositionUpdates: (onData) =>
      reactivitySubscriber(createReadClient(network), network.marginBank)(onData),
  };
}
