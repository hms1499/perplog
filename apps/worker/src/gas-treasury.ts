import { type Address, planTopUp } from "@perplog/core";
import { type Db, gasSentTodayWei, getBotKey, insertAlert, listStops, recordTopUp } from "@perplog/db";
import type { Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import type { WorkerEnv } from "./env";
import type { Logger } from "./log";
import type { ChainPort } from "./ports";

export const GAS_TREASURY_INTERVAL_MS = 15_000;
/** Below this the treasury itself needs refilling by hand. */
export const TREASURY_LOW_WEI = 5n * 10n ** 18n;
const LOW_GAS_DEDUPE_SEC = 21_600;

/**
 * One GasTreasury tick: every bot key that will have to sign (it holds an armed, triggered or executing stop)
 * is topped up from the treasury when its balance is low, within a daily cap per key. A key at its cap gets a
 * `bot_low_gas` alert instead. One key's failure never stops the others.
 */
export async function topUpBots(deps: {
  db: Db;
  chain: ChainPort;
  treasuryKey: Hex;
  env: WorkerEnv;
  log: Logger;
  now?: () => Date;
}): Promise<void> {
  const { db, chain, treasuryKey, env, log } = deps;
  const now = deps.now ?? (() => new Date());
  const keyIds = [
    ...new Set((await listStops(db, ["armed", "triggered", "executing"])).map((s) => s.botKeyId)),
  ];

  for (const id of keyIds) {
    try {
      const key = await getBotKey(db, id);
      if (!key?.address || !key.account) continue;
      const address = key.address as Address;
      const plan = planTopUp({
        balanceWei: await chain.balanceOf(address),
        sentTodayWei: await gasSentTodayWei(db, id, now()),
        thresholdWei: env.GAS_TOPUP_THRESHOLD_WEI,
        amountWei: env.GAS_TOPUP_AMOUNT_WEI,
        dailyCapWei: env.GAS_TOPUP_DAILY_CAP_WEI,
      });
      if (plan.action === "send") {
        const txHash = await chain.sendNative(treasuryKey, address, plan.amountWei);
        await recordTopUp(db, id, plan.amountWei, txHash, now());
        log.info({ botKeyId: id, address, amountWei: plan.amountWei.toString(), txHash }, "gas_topped_up");
      } else if (plan.action === "capped") {
        const inserted = await insertAlert(db, {
          account: key.account as Address,
          type: "bot_low_gas",
          payload: { botAddress: address },
          dedupeWithinSec: LOW_GAS_DEDUPE_SEC,
        });
        if (inserted) log.warn({ botKeyId: id, address }, "bot low on gas, daily top-up cap reached");
      }
    } catch (err) {
      log.error({ err, botKeyId: id }, "gas top-up failed");
    }
  }

  const treasury = privateKeyToAddress(treasuryKey);
  const balance = await chain.balanceOf(treasury);
  if (balance < TREASURY_LOW_WEI) {
    log.warn({ treasury, balanceWei: balance.toString() }, "treasury_low");
  }
}
