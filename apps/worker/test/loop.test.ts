import { every } from "../src/loop";
import { fakeLogger } from "./fakes";

afterEach(() => vi.useRealTimers());

test("never overlaps ticks, logs errors and keeps going, and stop() halts it", async () => {
  vi.useFakeTimers();
  const log = fakeLogger();
  let running = 0;
  let maxRunning = 0;
  let calls = 0;
  const loop = every(
    100,
    "t",
    async () => {
      calls++;
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 250)); // slower than the interval
      running--;
      if (calls === 2) throw new Error("tick failed");
    },
    log,
  );
  expect(log.has("loop started")).toBe(true);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(maxRunning).toBe(1);
  expect(calls).toBeGreaterThanOrEqual(3);
  expect(log.entries.some((e) => e.level === "error" && e.obj.name === "t")).toBe(true);
  const before = calls;
  await loop.stop();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(calls).toBe(before);
});
