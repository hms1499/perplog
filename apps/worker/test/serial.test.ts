import { KeyedSerial } from "../src/serial";

const gate = () => {
  let open!: () => void;
  const promise = new Promise<void>((r) => {
    open = r;
  });
  return { promise, open };
};

test("runs one job at a time per key and in parallel across keys", async () => {
  const s = new KeyedSerial();
  const events: string[] = [];
  const a1 = gate();
  const job = (name: string, g?: { promise: Promise<void> }) => async () => {
    events.push(`start ${name}`);
    await g?.promise;
    events.push(`end ${name}`);
    return name;
  };
  const p1 = s.run("A", job("a1", a1));
  const p2 = s.run("A", job("a2"));
  const p3 = s.run("B", job("b1"));
  await p3;
  // B is not blocked by A's pending job; a2 has not started because a1 still holds A
  expect(events).toEqual(["start a1", "start b1", "end b1"]);
  a1.open();
  expect(await Promise.all([p1, p2])).toEqual(["a1", "a2"]);
  expect(events.slice(3)).toEqual(["end a1", "start a2", "end a2"]);
});

test("a failing job rejects its own caller but does not block the next one on that key", async () => {
  const s = new KeyedSerial();
  const bad = s.run("A", async () => {
    throw new Error("boom");
  });
  const good = s.run("A", async () => 42);
  await expect(bad).rejects.toThrow("boom");
  expect(await good).toBe(42);
});
