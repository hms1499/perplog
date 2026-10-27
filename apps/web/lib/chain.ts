import {
  createHttpClient,
  createReadClient,
  fetchPerpMarkets,
  grantedPools,
  HIDEKI,
  readMark,
  readPositionSize,
} from "@perplog/chain";
import type { Address, MarketInfo } from "@perplog/core";
import { ChainUnavailableError } from "./account-service";

const MARKETS_TTL_MS = 10 * 60_000;
let cached: { at: number; markets: MarketInfo[] } | null = null;

async function markets(): Promise<MarketInfo[]> {
  if (cached && Date.now() - cached.at < MARKETS_TTL_MS) return cached.markets;
  const fresh = await fetchPerpMarkets(HIDEKI.indexer);
  cached = { at: Date.now(), markets: fresh };
  return fresh;
}

/** The web's on-chain reads in one mockable object. Read-only: the web never signs. */
export const chain = {
  markets,
  async perpPools(): Promise<Address[]> {
    return (await markets()).map((m) => m.pool);
  },
  async grantedPools(owner: Address, bot: Address, pools: Address[]): Promise<Address[]> {
    try {
      return await grantedPools(createHttpClient(HIDEKI), owner, bot, pools);
    } catch (error) {
      throw new ChainUnavailableError(error);
    }
  },
  async readPositionSize(account: Address, pool: Address): Promise<bigint> {
    try {
      return await readPositionSize(createReadClient(HIDEKI), HIDEKI.marginBank, account, pool);
    } catch (error) {
      throw new ChainUnavailableError(error);
    }
  },
  async readMark(pool: Address): Promise<{ price: bigint; fromIndex: boolean }> {
    try {
      return await readMark(createReadClient(HIDEKI), pool);
    } catch (error) {
      throw new ChainUnavailableError(error);
    }
  },
};
