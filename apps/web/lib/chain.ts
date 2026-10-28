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
  /** Best resting bid and ask on the pool's book, read on-chain; null for an empty side. */
  async bookTop(pool: Address): Promise<{ bestBid: bigint | null; bestAsk: bigint | null }> {
    try {
      const { tops } = await createReadClient(HIDEKI).getBookTopsOnchain([{ id: pool, poolAddress: pool }]);
      const top = tops[pool];
      return {
        bestBid: top?.bestBid ? BigInt(top.bestBid) : null,
        bestAsk: top?.bestAsk ? BigInt(top.bestAsk) : null,
      };
    } catch (error) {
      throw new ChainUnavailableError(error);
    }
  },
  /** Largest lot-aligned order the account's margin allows at `price`; null when the mark is not priceable. */
  async maxOrderSize(account: Address, pool: Address, isBid: boolean, price: bigint): Promise<bigint | null> {
    try {
      const max = await createReadClient(HIDEKI).getMaxPerpOrderSize({
        pool,
        marginBank: HIDEKI.marginBank,
        account,
        isBid,
        price,
      });
      return max.priceable ? max.maxQuantity : null;
    } catch (error) {
      throw new ChainUnavailableError(error);
    }
  },
  /** Projected liquidation price and leverage after the order; null when the mark is not priceable. */
  async liquidationPreview(
    account: Address,
    pool: Address,
    isBid: boolean,
    qtyRaw: bigint,
    price: bigint,
  ): Promise<{ liqPrice: bigint | null; leverageBps: bigint | null } | null> {
    try {
      const preview = await createReadClient(HIDEKI).previewPerpLiquidationPrice({
        pool,
        marginBank: HIDEKI.marginBank,
        account,
        isBid,
        quantity: qtyRaw,
        price,
      });
      if (!preview.priceable) return null;
      return {
        liqPrice: preview.projectedLiquidationPrice,
        leverageBps: preview.projectedPositionLeverageBps,
      };
    } catch (error) {
      throw new ChainUnavailableError(error);
    }
  },
};
