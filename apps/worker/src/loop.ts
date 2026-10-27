import type { Logger } from "./log";

/**
 * Runs `fn` now and then `ms` after each run finishes, so ticks never overlap.
 * A failing tick is logged and the loop carries on. `stop()` resolves once an in-flight tick has ended.
 */
export function every(
  ms: number,
  name: string,
  fn: () => Promise<void>,
  log: Logger,
): { stop(): Promise<void> } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> = Promise.resolve();

  const tick = async () => {
    timer = null;
    try {
      await fn();
    } catch (err) {
      log.error({ name, err }, "loop tick failed");
    }
    if (!stopped) timer = setTimeout(schedule, ms);
  };

  const schedule = () => {
    inFlight = tick();
  };

  log.info({ name, ms }, "loop started");
  schedule();
  return {
    async stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      await inFlight;
    },
  };
}
