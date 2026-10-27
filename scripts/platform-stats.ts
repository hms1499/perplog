/**
 * Regenerate the landing-page platform statistics from the dreamDEX indexer.
 * Usage: pnpm tsx scripts/platform-stats.ts
 */
import { writeFileSync } from "node:fs";
import {
  FEE_FIELDS,
  HIDEKI,
  POSITION_CHANGE_FIELDS,
  paginateDesc,
  positionChangeRow,
  STOP_ORDER_FIELDS,
  stopOrderRow,
} from "@perplog/chain";
import { type Address, computeNoStopStats, type PositionChange, type StopOrderRecord } from "@perplog/core";
import { z } from "zod";

const OUT = new URL("../apps/web/data/platform-stats.json", import.meta.url);
const MAX_CHANGES = 60_000;
const DAY = 86_400;

const owned = <T>(row: z.ZodType<T>, field: string) =>
  z
    .looseObject({ [field]: z.string() })
    .transform((raw) => ({ owner: String(raw[field]).toLowerCase() as Address, row: row.parse(raw) }));

async function main(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const changes = await paginateDesc({
    url: HIDEKI.indexer,
    queryName: "RecentChanges",
    table: "PerpPositionChange",
    fields: `account ${POSITION_CHANGE_FIELDS}`,
    where: "{}",
    orderField: "timestamp",
    rowSchema: owned<PositionChange>(positionChangeRow, "account"),
    maxRows: MAX_CHANGES,
  });
  const windowStart = changes.rows[0]?.row.timestamp ?? now;
  const stops = await paginateDesc({
    url: HIDEKI.indexer,
    queryName: "RecentStops",
    table: "StopOrder",
    fields: `owner ${STOP_ORDER_FIELDS}`,
    where: `{createdAt: {_gte: ${windowStart - 3600}}}`,
    orderField: "createdAt",
    rowSchema: owned<StopOrderRecord>(stopOrderRow, "owner"),
    maxRows: 200_000,
  });
  const liquidationFees = await paginateDesc({
    url: HIDEKI.indexer,
    queryName: "LiquidationFees7d",
    table: "PerpFeeRecord",
    fields: `account ${FEE_FIELDS}`,
    where: `{kind: {_eq: "LiquidationFee"}, timestamp: {_gte: ${now - 7 * DAY}}}`,
    orderField: "timestamp",
    rowSchema: z.object({ account: z.string(), amount: z.union([z.string(), z.number()]) }),
    maxRows: 200_000,
  });

  const changeOwner = new Map(changes.rows.map((r) => [r.row, r.owner]));
  const stopOwner = new Map(stops.rows.map((r) => [r.row, r.owner]));
  const noStop = computeNoStopStats(
    changes.rows.map((r) => r.row),
    stops.rows.map((r) => r.row),
    (c) => changeOwner.get(c) as Address,
    (s) => stopOwner.get(s) as Address,
    now,
  );
  const stats = {
    generatedAt: new Date(now * 1000).toISOString(),
    windowHours: Math.round(((now - windowStart) / 3600) * 10) / 10,
    newPositions: noStop.newPositions,
    realTraders: noStop.accounts,
    noStopPct: noStop.noStopPct,
    liquidationFees7dRaw: liquidationFees.rows.reduce((acc, r) => acc + BigInt(r.amount), 0n).toString(),
    liquidatedAccounts7d: new Set(liquidationFees.rows.map((r) => r.account.toLowerCase())).size,
    method:
      `Latest ${changes.rows.length} position changes (last ${Math.round((now - windowStart) / 360) / 10} hours). ` +
      "A new position counts as protected when a stop-loss on the same account and market was created between " +
      "60 seconds before and 10 minutes after it opened; positions opened in the last 10 minutes are left out. Accounts with at most 6 position changes and less than " +
      "1 USDso of realized PnL in the window are treated as automated and excluded. Liquidation fees are summed " +
      "over the last 7 days.",
  };
  writeFileSync(OUT, `${JSON.stringify(stats, null, 2)}\n`);
  console.log(stats);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
