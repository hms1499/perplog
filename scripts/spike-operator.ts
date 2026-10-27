/**
 * Spike (a): a linked bot key opens and closes the smallest position for a real account.
 * Needs .env.spike with OWNER and BOT_PRIVATE_KEY (see scripts/new-bot-key.ts), the bot linked
 * with Perps in the dreamDEX app, and >= 0.5 STT on the bot.
 * Usage: pnpm tsx --env-file=.env.spike scripts/spike-operator.ts
 * SENDS REAL TRANSACTIONS on Hideki testnet.
 */
import {
  createHttpClient,
  createReadClient,
  fetchPerpMarkets,
  grantedPools,
  HIDEKI,
  readMark,
  readPositionSize,
} from "@perplog/chain";
import { createBotWallet, placeMarketFor } from "@perplog/chain/signer";
import { type Address, closePriceBound, planClose } from "@perplog/core";
import type { Hex } from "viem";

const SLIP_BPS = 150;

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is missing (put it in .env.spike)`);
  return v;
}

async function main(): Promise<void> {
  const owner = need("OWNER").toLowerCase() as Address;
  const wallet = createBotWallet(need("BOT_PRIVATE_KEY") as Hex, HIDEKI);
  const client = createReadClient();
  const markets = await fetchPerpMarkets(HIDEKI.indexer);

  console.log(`owner ${owner}\nbot   ${wallet.address}`);
  const granted = await grantedPools(
    createHttpClient(),
    owner,
    wallet.address,
    markets.map((m) => m.pool),
  );
  console.log("granted pools:");
  for (const m of markets) console.log(`  ${granted.includes(m.pool) ? "YES" : "no "} ${m.symbol} ${m.pool}`);

  const market = markets.find((m) => /^W?ETH$/i.test(m.symbol) || /^W?ETH[-/]/i.test(m.symbol));
  if (!market) throw new Error("no ETH perp market found");
  if (!granted.includes(market.pool))
    throw new Error(`bot has no placeOrderFor grant on ${market.symbol}; link it with Perps first`);

  const before = await readPositionSize(client, HIDEKI.marginBank, owner, market.pool);
  if (before !== 0n) throw new Error(`owner already has a ${market.symbol} position (${before}); aborting`);

  const openMark = await readMark(client, market.pool);
  console.log(`${market.symbol} mark ${openMark.price}${openMark.fromIndex ? " (index fallback)" : ""}`);
  const open = await placeMarketFor(wallet, {
    owner,
    pool: market.pool,
    isBid: true,
    qtyRaw: market.minQuantity,
    priceBound: closePriceBound(openMark.price, "short", SLIP_BPS, market.tickSize),
  });
  console.log(`open  ${HIDEKI.explorerTx(open.txHash)} filled ${open.filledRaw} gasUsed ${open.gasUsed}`);

  const size = await readPositionSize(client, HIDEKI.marginBank, owner, market.pool);
  console.log(`size after open: ${size}`);
  const plan = planClose({
    positionSize: size,
    stopSide: "long",
    qtyMode: "entire",
    qtyRaw: null,
    closedSoFarRaw: 0n,
    lotSize: market.lotSize,
    minQuantity: market.minQuantity,
  });
  if (plan.action !== "send") throw new Error(`nothing to close: ${JSON.stringify(plan)}`);

  const closeMark = await readMark(client, market.pool);
  let close: Awaited<ReturnType<typeof placeMarketFor>>;
  try {
    close = await placeMarketFor(wallet, {
      owner,
      pool: market.pool,
      isBid: plan.isBid,
      qtyRaw: plan.qtyRaw,
      priceBound: closePriceBound(closeMark.price, "long", SLIP_BPS, market.tickSize),
    });
  } catch (err) {
    console.error(`CLOSE FAILED, position ${size} on ${market.pool} is still open. Close it by hand.`);
    throw err;
  }
  console.log(`close ${HIDEKI.explorerTx(close.txHash)} filled ${close.filledRaw} gasUsed ${close.gasUsed}`);

  const after = await readPositionSize(client, HIDEKI.marginBank, owner, market.pool);
  console.log(`size after close: ${after} (expected 0)`);
  if (after !== 0n) throw new Error("position is not flat after the close");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
