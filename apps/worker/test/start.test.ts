import { createBotKeyRequest, getBotKey } from "@perplog/db";
import { createTestDb } from "@perplog/db/testing";
import { startWorker } from "../src/start";
import { fakeChain, fakeEnv, fakeLogger } from "./fakes";

const lockConn = (answers: boolean[]) => ({
  query: vi.fn(async () => ({ rows: [{ ok: answers.length > 1 ? answers.shift() : answers[0] }] })),
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
  });
  try {
    await vi.waitFor(async () => expect((await getBotKey(db, req.id))?.status).toBe("pending"));
    expect(migrate).toHaveBeenCalledOnce();
    const order = log.entries.map((e) => e.msg);
    expect(order.indexOf("signer lock acquired")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("migrations applied")).toBeGreaterThan(order.indexOf("signer lock acquired"));
    expect(log.entries.find((e) => e.msg === "loop started")?.obj.name).toBe("bot-key-minter");
    expect(log.has("standby")).toBe(false);
  } finally {
    await w.stop();
  }
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
    standbyRetryMs: 60_000,
  });
  try {
    await new Promise((r) => setTimeout(r, 800)); // > 2 minter intervals
    expect(log.has("standby")).toBe(true);
    expect(log.has("signer lock acquired")).toBe(false);
    expect(migrate).not.toHaveBeenCalled();
    expect((await getBotKey(db, req.id))?.status).toBe("requested");
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
  });
  await w.stop();
  const req = await createBotKeyRequest(db);
  await new Promise((r) => setTimeout(r, 700));
  expect((await getBotKey(db, req.id))?.status).toBe("requested");
});
