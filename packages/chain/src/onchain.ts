import {
  type Address,
  absBig,
  FALLBACK_DISPLAY_DECIMALS,
  type FundingPayment,
  type MarketInfo,
  type OpenPosition,
  PRICE_DECIMALS,
  ratioBps,
  type StopOrderRecord,
  shortAddress,
  stepDecimals,
  stopCoverageBps,
} from "@perplog/core";
import { perpMarkForPnl, SomniaMarkets, type SomniaMarketsClient } from "@somnia-chain/markets-sdk";
import { createPublicClient, http, type PublicClient } from "viem";
import { HIDEKI, type Network } from "./networks";

const readClients = new Map<Network, SomniaMarketsClient>();

/** Read-only SDK client (no signer), shared per process and network. */
export function createReadClient(network: Network = HIDEKI): SomniaMarketsClient {
  let client = readClients.get(network);
  if (!client) {
    client = new SomniaMarkets({
      chain: network.chain,
      wsRpcUrl: network.rpcWs,
      indexerUrl: network.indexer,
      addresses: network.sdkAddresses,
    }).client;
    readClients.set(network, client);
  }
  return client;
}

const httpClients = new Map<Network, PublicClient>();

/** Plain viem HTTP client (multicall, receipts), shared per process and network. */
export function createHttpClient(network: Network = HIDEKI): PublicClient {
  let client = httpClients.get(network);
  if (!client) {
    client = createPublicClient({ chain: network.chain, transport: http(network.rpcHttp) }) as PublicClient;
    httpClients.set(network, client);
  }
  return client;
}

/** Live signed position size for one account on one pool (positive long, negative short, 0 flat). */
export async function readPositionSize(
  client: Pick<SomniaMarketsClient, "getPerpPosition">,
  marginBank: Address,
  account: Address,
  pool: Address,
): Promise<bigint> {
  return (await client.getPerpPosition({ marginBank, account, pool })).size;
}

/** Mark price used for PnL and triggers; `fromIndex` is true when it fell back to the index price. */
export async function readMark(
  client: Pick<SomniaMarketsClient, "getPerpState">,
  pool: Address,
): Promise<{ price: bigint; fromIndex: boolean }> {
  const mark = perpMarkForPnl(await client.getPerpState(pool));
  return { price: mark.price, fromIndex: mark.fromIndex };
}

export interface CollateralRead {
  collateralRaw: bigint;
  asOfBlock: bigint;
  activePools: Address[];
}

/** Collateral = unlocked + locked balance in the MarginBank (spec §6.3). */
export async function getCollateralRaw(
  client: Pick<SomniaMarketsClient, "getMarginAccount">,
  marginBank: Address,
  account: Address,
): Promise<CollateralRead> {
  const m = await client.getMarginAccount(marginBank, account);
  return {
    collateralRaw: m.unlockedCollateralBalance + m.lockedCollateral,
    asOfBlock: m.asOfBlock,
    activePools: m.activePerpPools.map((p) => p.toLowerCase() as Address),
  };
}

const DAY = 86_400;

export async function getOpenPositions(args: {
  client: Pick<SomniaMarketsClient, "getPerpPosition" | "getPerpState" | "getLiquidationPrice">;
  marginBank: Address;
  account: Address;
  activePools: Address[];
  markets: ReadonlyMap<Address, MarketInfo>;
  stopOrders: StopOrderRecord[];
  funding: FundingPayment[];
  nowSec: number;
}): Promise<OpenPosition[]> {
  const { client, marginBank, account } = args;
  const read = async (pool: Address): Promise<OpenPosition | null> => {
    const ref = { marginBank, account, pool };
    const position = await client.getPerpPosition(ref);
    if (position.size === 0n) return null;
    const [state, liquidationPrice] = await Promise.all([
      client.getPerpState(pool),
      client
        .getLiquidationPrice(ref)
        .then((price) => (price !== null && price > 0n ? price : null))
        .catch(() => null),
    ]);
    const mark = perpMarkForPnl(state);
    const market = args.markets.get(pool);
    const side = position.size > 0n ? "long" : "short";
    const baseDecimals = market?.baseDecimals ?? 18;
    return {
      pool,
      symbol: market?.symbol ?? shortAddress(pool),
      side,
      sizeRaw: position.size,
      baseDecimals,
      sizeDecimals: market ? stepDecimals(market.lotSize, baseDecimals) : FALLBACK_DISPLAY_DECIMALS,
      priceDecimals: market ? stepDecimals(market.tickSize, PRICE_DECIMALS) : FALLBACK_DISPLAY_DECIMALS,
      entryPrice: position.avgEntryPrice,
      markPrice: mark.price,
      markFromIndex: mark.fromIndex,
      liquidationPrice,
      liqDistanceBps:
        liquidationPrice === null ? null : ratioBps(absBig(mark.price - liquidationPrice), mark.price),
      unrealizedPnlRaw: ((mark.price - position.avgEntryPrice) * position.size) / 10n ** BigInt(baseDecimals),
      stopCoverageBps: stopCoverageBps(side, position.size, pool, args.stopOrders),
      fundingLast24hRaw: args.funding
        .filter((f) => f.pool === pool && f.timestamp >= args.nowSec - DAY)
        .reduce((acc, f) => acc + f.amount, 0n),
    };
  };
  const positions = await Promise.all(args.activePools.map(read));
  return positions.filter((p): p is OpenPosition => p !== null);
}
