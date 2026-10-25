/**
 * Capture a reconcilable snapshot of dreamDEX accounts for golden tests.
 * Usage: pnpm tsx scripts/capture-fixture.ts <account> [account...]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  createReadClient,
  fetchAccountHistory,
  fetchIndexerHead,
  fetchPerpMarkets,
  getCollateralRaw,
  HIDEKI,
} from "@perplog/chain";
import { type AccountFixture, type Address, normalizeAddress, writeFixture } from "@perplog/core";
import { createPublicClient, http } from "viem";

const OUT_DIR = new URL("../packages/core/test/fixtures/", import.meta.url);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForIndexer(block: bigint): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if ((await fetchIndexerHead(HIDEKI.indexer)) >= block) return;
    await sleep(1000);
  }
  throw new Error(`indexer did not reach block ${block} within 60s`);
}

async function capture(account: Address): Promise<AccountFixture> {
  const client = createReadClient();
  const publicClient = createPublicClient({ chain: HIDEKI.chain, transport: http(HIDEKI.rpcHttp) });
  const { collateralRaw, asOfBlock } = await getCollateralRaw(client, HIDEKI.marginBank, account);
  const block = await publicClient.getBlock({ blockNumber: asOfBlock });
  const rawTs = Number(block.timestamp);
  const asOfTimestamp = rawTs > 1e12 ? Math.floor(rawTs / 1000) : rawTs;
  await waitForIndexer(asOfBlock);
  const markets = await fetchPerpMarkets(HIDEKI.indexer);
  const history = await fetchAccountHistory(account, {
    indexerUrl: HIDEKI.indexer,
    perpPools: new Set(markets.map((m) => m.pool)),
    asOfTimestamp,
  });
  return { account, asOfBlock, asOfTimestamp, collateralRaw, history, markets, openPositions: [] };
}

async function main(): Promise<void> {
  const accounts = process.argv.slice(2).map((a) => {
    const n = normalizeAddress(a);
    if (!n) throw new Error(`invalid address: ${a}`);
    return n;
  });
  if (accounts.length === 0) throw new Error("usage: capture-fixture.ts <account> [account...]");
  mkdirSync(OUT_DIR, { recursive: true });
  for (const account of accounts) {
    const fixture = await capture(account);
    writeFileSync(new URL(`${account}.json`, OUT_DIR), writeFixture(fixture));
    console.log(
      `${account}: block ${fixture.asOfBlock}, ${fixture.history.changes.length} changes, truncated=${fixture.history.truncated}`,
    );
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
