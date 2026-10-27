import type { Address } from "@perplog/core";
import {
  bindBotKey,
  bindSession,
  claimRequestedBotKeys,
  createBotKeyRequest,
  createSession,
  getBotKey,
  getSession,
  listLinkedBotKeys,
  setLinkedPools,
} from "../src";
import { createTestDb } from "../src/testing";

const ACCOUNT = `0x${"a1".repeat(20)}` as Address;
const POOL = `0x${"b2".repeat(20)}` as Address;
const POOL2 = `0x${"b3".repeat(20)}` as Address;
let n = 0;
const fakeFill = (id: string) => ({
  address: `0x${(++n).toString(16).padStart(40, "0")}` as Address,
  encPk: `enc-${id}`,
  iv: "iv",
  tag: "tag",
});

test("claimRequestedBotKeys fills each requested key once", async () => {
  const db = await createTestDb();
  const a = await createBotKeyRequest(db);
  const b = await createBotKeyRequest(db);
  expect(a.status).toBe("requested");
  expect(await claimRequestedBotKeys(db, 10, fakeFill)).toBe(2);
  expect(await claimRequestedBotKeys(db, 10, fakeFill)).toBe(0);
  for (const id of [a.id, b.id]) {
    const row = await getBotKey(db, id);
    expect(row?.status).toBe("pending");
    expect(row?.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(row?.encPk).toBe(`enc-${id}`);
  }
});

test("claimRequestedBotKeys respects the limit", async () => {
  const db = await createTestDb();
  await createBotKeyRequest(db);
  await createBotKeyRequest(db);
  expect(await claimRequestedBotKeys(db, 1, fakeFill)).toBe(1);
  expect(await claimRequestedBotKeys(db, 1, fakeFill)).toBe(1);
});

test("bind, update pools and list linked keys", async () => {
  const db = await createTestDb();
  const k = await createBotKeyRequest(db);
  await claimRequestedBotKeys(db, 1, fakeFill);
  expect(await listLinkedBotKeys(db)).toEqual([]);
  await bindBotKey(db, k.id, ACCOUNT, [POOL]);
  const linked = await listLinkedBotKeys(db);
  expect(linked.map((r) => r.id)).toEqual([k.id]);
  expect(linked[0]?.account).toBe(ACCOUNT);
  expect(linked[0]?.linkedPools).toEqual([POOL]);
  expect(linked[0]?.linkedAt).toBeInstanceOf(Date);
  await setLinkedPools(db, k.id, [POOL, POOL2], "linked");
  expect((await getBotKey(db, k.id))?.linkedPools).toEqual([POOL, POOL2]);
  await setLinkedPools(db, k.id, [], "revoked");
  expect((await getBotKey(db, k.id))?.status).toBe("revoked");
  expect(await listLinkedBotKeys(db)).toEqual([]);
  expect(await getBotKey(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
});

test("sessions carry their bot key and can be bound to an account", async () => {
  const db = await createTestDb();
  const k = await createBotKeyRequest(db);
  const s = await createSession(db, k.id);
  const got = await getSession(db, s.id);
  expect(got?.botKey?.id).toBe(k.id);
  expect(got?.account).toBeNull();
  await bindSession(db, s.id, ACCOUNT);
  expect((await getSession(db, s.id))?.account).toBe(ACCOUNT);
  expect(await getSession(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
});
