import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createReadClient,
  fetchAccountHistory,
  fetchPerpMarkets,
  getCollateralRaw,
  getOpenPositions,
  HIDEKI,
} from "@perplog/chain";
import { type AccountFixture, type Address, readFixture } from "@perplog/core";
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
  const load = (account: Address): AccountFixture | null => {
    try {
      return readFixture(readFileSync(join(dir, `${account}.json`), "utf8"));
    } catch {
      return null;
    }
  };
  let lastAsOf = Math.floor(Date.now() / 1000);
  return {
    fetchMarkets: async () => {
      const any = readFileSync(join(dir, "0x395225eab84c1b9304d42cb647238dcc90003951.json"), "utf8");
      return readFixture(any).markets;
    },
    fetchHistory: async (account) => {
      const f = load(account);
      if (f) lastAsOf = f.asOfTimestamp;
      return (
        f?.history ?? {
          account,
          asOfTimestamp: lastAsOf,
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
    now: () => lastAsOf,
  };
}

const fixtureDir = process.env.PERPLOG_FIXTURE_DIR;

export const accountService = createAccountService(fixtureDir ? fixtureDeps(fixtureDir) : liveDeps());
