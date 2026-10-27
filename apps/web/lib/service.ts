import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createReadClient,
  fetchAccountHistory,
  fetchPerpMarkets,
  getCollateralRaw,
  getOpenPositions,
  HIDEKI,
} from "@perplog/chain";
import { type AccountFixture, type Address, type MarketInfo, readFixture } from "@perplog/core";
import { type AccountServiceDeps, createAccountService } from "./account-service";

function liveDeps(): AccountServiceDeps {
  return {
    fetchMarkets: () => fetchPerpMarkets(HIDEKI.indexer),
    fetchHistory: (account, perpPools) =>
      fetchAccountHistory(account, { indexerUrl: HIDEKI.indexer, perpPools }),
    fetchCollateral: (account) => getCollateralRaw(createReadClient(), HIDEKI.marginBank, account),
    fetchOpenPositions: (account, data) =>
      getOpenPositions({
        client: createReadClient(),
        marginBank: HIDEKI.marginBank,
        account,
        activePools: data.activePools,
        markets: data.markets,
        stopOrders: data.history.stopOrders,
        funding: data.history.funding,
        nowSec: Math.floor(Date.now() / 1000),
      }),
    now: () => Math.floor(Date.now() / 1000),
  };
}

/** Serves captured fixtures instead of the network (demos and deterministic e2e tests). */
function fixtureDeps(dir: string): AccountServiceDeps {
  // Only hits are kept, so arbitrary addresses cannot grow the map.
  const loaded = new Map<Address, AccountFixture>();
  const load = (account: Address): AccountFixture | null => {
    const hit = loaded.get(account);
    if (hit) return hit;
    try {
      const fixture = readFixture(readFileSync(join(dir, `${account}.json`), "utf8"));
      loaded.set(account, fixture);
      return fixture;
    } catch {
      return null;
    }
  };
  const wallClock = () => Math.floor(Date.now() / 1000);
  return {
    fetchMarkets: async () => {
      // Union of every fixture's market list, so any captured account resolves its pools.
      const markets = new Map<Address, MarketInfo>();
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
        for (const m of readFixture(readFileSync(join(dir, file), "utf8")).markets) markets.set(m.pool, m);
      }
      return [...markets.values()];
    },
    fetchHistory: async (account) => {
      return (
        load(account)?.history ?? {
          account,
          asOfTimestamp: wallClock(),
          truncated: false,
          changes: [],
          funding: [],
          fees: [],
          marginEvents: [],
          marginPulls: [],
          liquidations: [],
          stopOrders: [],
        }
      );
    },
    fetchCollateral: async (account) => ({
      collateralRaw: load(account)?.collateralRaw ?? 0n,
      activePools: [],
    }),
    fetchOpenPositions: async (account) => load(account)?.openPositions ?? [],
    // Ranges are measured from each fixture's capture time; the cache runs on the wall clock.
    now: (account) => (account && load(account)?.asOfTimestamp) || wallClock(),
  };
}

const fixtureDir = process.env.PERPLOG_FIXTURE_DIR;

export const accountService = createAccountService(fixtureDir ? fixtureDeps(fixtureDir) : liveDeps());
