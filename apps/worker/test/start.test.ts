import { createBotKeyRequest, getBotKey } from "@perplog/db";
import { createTestDb } from "@perplog/db/testing";
import { startWorker } from "../src/start";
import { fakeChain, fakeEnv, fakeLogger } from "./fakes";

const lockConn = (answers: boolean[]) => ({
  query: vi.fn(async (sql: string) =>
    sql === "SELECT 1"
      ? { rows: [{ "?column?": 1 }] }
      : { rows: [{ ok: answers.length > 1 ? answers.shift() : answers[0] }] },
  ),
});

test("with the lock: logs it, migrates, starts the bot-key-minter loop and mints a requested key", async () => {
  const db = await createTestDb();
  const req = await createBotKeyRequest(db);
  const log = fakeLogger();
  const migrate = vi.fn(async () => {});
  const w = await startWorker({
    db,
    lockConn: lockConn([true]),
    migrate,
    env: fakeEnv(),
    chain: fakeChain(),
    log,
    onFatal: vi.fn(),
  });
  try {
    await vi.waitFor(async () => expect((await getBotKey(db, req.id))?.status).toBe("pending"));
    expect(migrate).toHaveBeenCalledOnce();
    const order = log.entries.map((e) => e.msg);
    expect(order.indexOf("signer lock acquired")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("migrations applied")).toBeGreaterThan(order.indexOf("signer lock acquired"));
    expect(log.entries.find((e) => e.msg === "loop started")?.obj.name).toBe("bot-key-minter");
    const loops = log.entries.filter((e) => e.msg === "loop started").map((e) => e.obj.name);
    expect(loops).toEqual(["bot-key-minter", "link-watcher", "stop-engine", "watched-accounts"]);
    expect(log.has("standby")).toBe(false);
  } finally {
    await w.stop();
  }
});

test("with the lock: subscribes to Reactivity position updates", async () => {
  const db = await createTestDb();
  const unsubscribe = vi.fn(async () => {});
  const chain = fakeChain({ subscribePositionUpdates: vi.fn(async () => ({ unsubscribe })) });
  const w = await startWorker({
    db,
    lockConn: lockConn([true]),
    migrate: vi.fn(async () => {}),
    env: fakeEnv(),
    chain,
    log: fakeLogger(),
    onFatal: vi.fn(),
  });
  await vi.waitFor(() => expect(chain.subscribePositionUpdates).toHaveBeenCalledOnce());
  await w.stop();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

test("without the lock: logs standby and does not migrate or mint", async () => {
  const db = await createTestDb();
  const req = await createBotKeyRequest(db);
  const log = fakeLogger();
  const migrate = vi.fn(async () => {});
  const w = await startWorker({
    db,
    lockConn: lockConn([false]),
    migrate,
    env: fakeEnv(),
    chain: fakeChain(),
    log,
    onFatal: vi.fn(),
    standbyRetryMs: 60_000,
  });
  try {
    await new Promise((r) => setTimeout(r, 800)); // > 2 minter intervals
    expect(log.has("standby")).toBe(true);
    expect(log.has("signer lock acquired")).toBe(false);
    expect(migrate).not.toHaveBeenCalled();
    expect((await getBotKey(db, req.id))?.status).toBe("requested");
    expect(log.has("loop started")).toBe(false);
  } finally {
    await w.stop();
  }
});

test("a standby worker takes over once the lock frees up", async () => {
  const db = await createTestDb();
  const req = await createBotKeyRequest(db);
  const log = fakeLogger();
  const w = await startWorker({
    db,
    lockConn: lockConn([false, true]),
    migrate: async () => {},
    env: fakeEnv(),
    chain: fakeChain(),
    log,
    onFatal: vi.fn(),
    standbyRetryMs: 50,
  });
  try {
    await vi.waitFor(async () => expect((await getBotKey(db, req.id))?.status).toBe("pending"));
    expect(log.has("standby")).toBe(true);
    expect(log.has("signer lock acquired")).toBe(true);
  } finally {
    await w.stop();
  }
});

test("stop() halts the loops: later requests are not minted", async () => {
  const db = await createTestDb();
  const log = fakeLogger();
  const w = await startWorker({
    db,
    lockConn: lockConn([true]),
    migrate: async () => {},
    env: fakeEnv(),
    chain: fakeChain(),
    log,
    onFatal: vi.fn(),
  });
  await w.stop();
  const req = await createBotKeyRequest(db);
  await new Promise((r) => setTimeout(r, 700));
  expect((await getBotKey(db, req.id))?.status).toBe("requested");
});

/** Grants the lock, then answers the heartbeat with `beat`. */
const lockConnBeating = (beat: () => Promise<unknown>) => ({
  query: vi.fn(async (sql: string) => {
    if (sql === "SELECT 1") {
      await beat();
      return { rows: [{ "?column?": 1 }] };
    }
    return { rows: [{ ok: true }] };
  }),
});

test("a healthy lock connection is pinged every heartbeat and nothing stops", async () => {
  const db = await createTestDb();
  const log = fakeLogger();
  const conn = lockConnBeating(async () => {});
  const onFatal = vi.fn();
  const w = await startWorker({
    db,
    lockConn: conn,
    migrate: async () => {},
    env: fakeEnv(),
    chain: fakeChain(),
    log,
    onFatal,
    lockHeartbeatMs: 20,
  });
  try {
    await vi.waitFor(() =>
      expect(conn.query.mock.calls.filter(([q]) => q === "SELECT 1").length).toBeGreaterThanOrEqual(3),
    );
    expect(onFatal).not.toHaveBeenCalled();
    expect(log.has("signer_lock_lost")).toBe(false);
    const req = await createBotKeyRequest(db);
    await vi.waitFor(async () => expect((await getBotKey(db, req.id))?.status).toBe("pending"));
  } finally {
    await w.stop();
  }
});

test.each([
  ["fails", () => Promise.reject(new Error("Connection terminated unexpectedly"))],
  ["hangs", () => new Promise(() => {})],
])("a heartbeat that %s means the lock is lost: loops stop, then onFatal", async (_name, beat) => {
  const db = await createTestDb();
  const log = fakeLogger();
  const conn = lockConnBeating(beat);
  const onFatal = vi.fn();
  const w = await startWorker({
    db,
    lockConn: conn,
    migrate: async () => {},
    env: fakeEnv(),
    chain: fakeChain(),
    log,
    onFatal,
    lockHeartbeatMs: 20,
  });
  try {
    await vi.waitFor(() => expect(onFatal).toHaveBeenCalledOnce());
    expect(onFatal.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(log.entries.find((e) => e.msg === "signer_lock_lost")?.level).toBe("error");
    // The loops are down: a new request is never minted.
    const req = await createBotKeyRequest(db);
    await new Promise((r) => setTimeout(r, 700));
    expect((await getBotKey(db, req.id))?.status).toBe("requested");
    // No further heartbeats after the loss.
    const beats = conn.query.mock.calls.filter(([q]) => q === "SELECT 1").length;
    await new Promise((r) => setTimeout(r, 100));
    expect(conn.query.mock.calls.filter(([q]) => q === "SELECT 1").length).toBe(beats);
    expect(onFatal).toHaveBeenCalledOnce();
  } finally {
    await w.stop();
  }
});

test("the gas-treasury loop runs only with a treasury key; without one it warns at startup", async () => {
  const boot = async (treasury: `0x${string}` | null) => {
    const log = fakeLogger();
    const w = await startWorker({
      db: await createTestDb(),
      lockConn: lockConn([true]),
      migrate: vi.fn(async () => {}),
      env: fakeEnv({ TREASURY_PRIVATE_KEY: treasury }),
      chain: fakeChain({ balanceOf: vi.fn(async () => 10n ** 20n) }),
      log,
      onFatal: vi.fn(),
    });
    await w.stop();
    return log;
  };
  const without = await boot(null);
  expect(without.entries.some((e) => e.level === "warn" && e.msg === "gas treasury disabled")).toBe(true);
  expect(without.entries.some((e) => e.msg === "loop started" && e.obj.name === "gas-treasury")).toBe(false);

  const withKey = await boot(`0x${"11".repeat(32)}`);
  expect(withKey.entries.some((e) => e.msg === "loop started" && e.obj.name === "gas-treasury")).toBe(true);
  expect(withKey.has("gas treasury disabled")).toBe(false);
});
