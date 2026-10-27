/**
 * Spike (b): does Somnia Reactivity deliver MarginBank PositionUpdated events on Hideki?
 * Usage: pnpm tsx scripts/spike-reactivity.ts [--full]
 * Default: exit 0 on the first decoded update (exit 1 after 120 s of nothing).
 * --full: listen for the whole 120 s window and report events per minute.
 */
import { createReadClient, HIDEKI, reactivitySubscriber, watchPositionUpdates } from "@perplog/chain";

const WINDOW_MS = 120_000;
const full = process.argv.includes("--full");
const startedAt = Date.now();
let count = 0;

const finish = async (code: number): Promise<never> => {
  await handle.stop().catch(() => {});
  const secs = (Date.now() - startedAt) / 1000;
  console.log(
    `${count} PositionUpdated in ${secs.toFixed(1)} s = ${((count / secs) * 60).toFixed(2)} events/min`,
  );
  process.exit(code);
};

const handle = watchPositionUpdates({
  subscribe: reactivitySubscriber(createReadClient(), HIDEKI.marginBank),
  onUpdate: (u) => {
    count++;
    console.log(
      `+${((Date.now() - startedAt) / 1000).toFixed(1)}s PositionUpdated account=${u.account} pool=${u.pool} newSize=${u.newSize}`,
    );
    if (!full) void finish(0);
  },
  onStatus: (s) => console.log(`+${((Date.now() - startedAt) / 1000).toFixed(1)}s feed ${s}`),
});

setTimeout(() => void finish(full && count > 0 ? 0 : 1), WINDOW_MS);
