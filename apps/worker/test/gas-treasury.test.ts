import type { Address } from "@perplog/core";
import {
  bindBotKey,
  claimRequestedBotKeys,
  createBotKeyRequest,
  type Db,
  gasSentTodayWei,
  insertStop,
  listAlerts,
  recordTopUp,
} from "@perplog/db";
import { createTestDb } from "@perplog/db/testing";
import type { Hash, Hex } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { topUpBots } from "../src/gas-treasury";
import { fakeChain, fakeEnv, fakeLogger } from "./fakes";

const STT = 10n ** 18n;
const POOL = `0x${"b1".repeat(20)}` as Address;
const TREASURY_KEY = generatePrivateKey();
const TREASURY = privateKeyToAddress(TREASURY_KEY).toLowerCase() as Address;
const NOW = new Date("2026-10-27T12:00:00Z");

/** One linked bot key per account; `armed` controls whether it has an armed stop. */
async function bot(
  db: Db,
  n: number,
  armed: boolean,
): Promise<{ id: string; address: Address; account: Address }> {
  const account = `0x${n.toString(16).padStart(2, "0").repeat(20)}` as Address;
  const address = `0x${(n + 0x80).toString(16).padStart(2, "0").repeat(20)}` as Address;
  const req = await createBotKeyRequest(db);
  await claimRequestedBotKeys(db, 1, () => ({ address, encPk: "e", iv: "i", tag: "t" }));
  await bindBotKey(db, req.id, account, [POOL]);
  if (armed) {
    await insertStop(db, {
      account,
      pool: POOL,
      botKeyId: req.id,
      positionSide: "long",
      triggerPrice: 100n,
      triggerOp: "lte",
      qtyMode: "entire",
      status: "armed",
    });
  }
  return { id: req.id, address, account };
}

function chainWith(balances: Map<Address, bigint>, failFor: Set<Address> = new Set()) {
  let tx = 0;
  return fakeChain({
    balanceOf: vi.fn(async (a: Address) => balances.get(a.toLowerCase() as Address) ?? 0n),
    sendNative: vi.fn(async (_pk: Hex, to: Address, amount: bigint): Promise<Hash> => {
      if (failFor.has(to)) throw new Error("nonce too low");
      balances.set(to, (balances.get(to) ?? 0n) + amount);
      tx += 1;
      return `0x${tx.toString(16).padStart(64, "0")}`;
    }),
  });
}

const run = (db: Db, chain: ReturnType<typeof fakeChain>, log = fakeLogger()) =>
  topUpBots({ db, chain, treasuryKey: TREASURY_KEY, env: fakeEnv(), log, now: () => NOW });

test("tops up a key with an armed stop below 0.2 STT by 0.5 STT", async () => {
  const db = await createTestDb();
  const k = await bot(db, 1, true);
  const chain = chainWith(
    new Map([
      [k.address, STT / 10n],
      [TREASURY, 100n * STT],
    ]),
  );
  await run(db, chain);
  expect(chain.sendNative).toHaveBeenCalledOnce();
  expect(chain.sendNative).toHaveBeenCalledWith(TREASURY_KEY, k.address, STT / 2n);
  expect(await gasSentTodayWei(db, k.id, NOW)).toBe(STT / 2n);
});

test("keys without active stops are ignored", async () => {
  const db = await createTestDb();
  const k = await bot(db, 1, false);
  const chain = chainWith(
    new Map([
      [k.address, 0n],
      [TREASURY, 100n * STT],
    ]),
  );
  await run(db, chain);
  expect(chain.sendNative).not.toHaveBeenCalled();
  expect(chain.balanceOf).not.toHaveBeenCalledWith(k.address);
});

test("daily cap → bot_low_gas alert once, no send", async () => {
  const db = await createTestDb();
  const k = await bot(db, 1, true);
  for (let i = 0; i < 4; i++) await recordTopUp(db, k.id, STT / 2n, `0x${i}`);
  const chain = chainWith(
    new Map([
      [k.address, 0n],
      [TREASURY, 100n * STT],
    ]),
  );
  await run(db, chain);
  await run(db, chain);
  expect(chain.sendNative).not.toHaveBeenCalled();
  const alerts = (await listAlerts(db, k.account, 0)).filter((a) => a.type === "bot_low_gas");
  expect(alerts).toHaveLength(1);
});

test("one failed send does not stop the others", async () => {
  const db = await createTestDb();
  const a = await bot(db, 1, true);
  const b = await bot(db, 2, true);
  const chain = chainWith(
    new Map([
      [a.address, 0n],
      [b.address, 0n],
      [TREASURY, 100n * STT],
    ]),
    new Set([a.address]),
  );
  const log = fakeLogger();
  await run(db, chain, log);
  expect(chain.sendNative).toHaveBeenCalledTimes(2);
  expect(await gasSentTodayWei(db, a.id, NOW)).toBe(0n);
  expect(await gasSentTodayWei(db, b.id, NOW)).toBe(STT / 2n);
  expect(log.entries.some((e) => e.level === "error" && e.msg === "gas top-up failed")).toBe(true);
});

test("warns when the treasury is under 5 STT", async () => {
  const db = await createTestDb();
  await bot(db, 1, false);
  const log = fakeLogger();
  await run(db, chainWith(new Map([[TREASURY, 4n * STT]])), log);
  expect(log.entries.find((e) => e.msg === "treasury_low")?.level).toBe("warn");

  const ok = fakeLogger();
  await run(db, chainWith(new Map([[TREASURY, 5n * STT]])), ok);
  expect(ok.has("treasury_low")).toBe(false);
});
