/**
 * Spike (c): how long does readMark take on the busiest pools, and how often is it the index price?
 * Usage: pnpm tsx scripts/spike-mark-latency.ts
 */
import { createReadClient, fetchPerpMarkets, gql, HIDEKI, readMark } from "@perplog/chain";
import type { Address } from "@perplog/core";
import { z } from "zod";

const CALLS = 30;
const TOP = 3;

const percentile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN;

async function main(): Promise<void> {
  const markets = await fetchPerpMarkets(HIDEKI.indexer);
  const known = new Map(markets.map((m) => [m.pool, m]));
  // Activity = position changes among the latest 3000.
  const recent = await gql({
    url: HIDEKI.indexer,
    queryName: "RecentActivity",
    query:
      "query RecentActivity { PerpPositionChange(order_by: [{timestamp: desc}, {id: desc}], limit: 3000) { pool } }",
    schema: z.object({ PerpPositionChange: z.array(z.object({ pool: z.string() })) }),
  });
  const counts = new Map<Address, number>();
  for (const { pool } of recent.PerpPositionChange) {
    const p = pool.toLowerCase() as Address;
    if (known.has(p)) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP);
  if (top.length === 0) throw new Error("no active perp pools found in the indexer");

  const client = createReadClient();
  const all: number[] = [];
  let fromIndex = 0;
  for (const [pool, n] of top) {
    const times: number[] = [];
    let idx = 0;
    for (let i = 0; i < CALLS; i++) {
      const t0 = performance.now();
      const mark = await readMark(client, pool);
      times.push(performance.now() - t0);
      if (mark.fromIndex) idx++;
    }
    const sorted = [...times].sort((a, b) => a - b);
    console.log(
      `${known.get(pool)?.symbol ?? pool} (${pool}, ${n} recent changes): p50 ${percentile(sorted, 50).toFixed(0)} ms, p95 ${percentile(sorted, 95).toFixed(0)} ms, fromIndex ${idx}/${CALLS}`,
    );
    all.push(...times);
    fromIndex += idx;
  }
  const sorted = [...all].sort((a, b) => a - b);
  console.log(
    `ALL (${all.length} calls): p50 ${percentile(sorted, 50).toFixed(0)} ms, p95 ${percentile(sorted, 95).toFixed(0)} ms, fromIndex ${fromIndex}/${all.length} (${((fromIndex / all.length) * 100).toFixed(0)}%)`,
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
