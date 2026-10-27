import { randomBytes } from "node:crypto";
import { createBotKeyRequest, getBotKey } from "@perplog/db";
import { decryptPrivateKey } from "@perplog/db/crypto";
import { createTestDb } from "@perplog/db/testing";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { mintRequestedKeys } from "../src/bot-key-minter";

const KEK = randomBytes(32);

test("mintRequestedKeys encrypts each requested key so it decrypts to an address-matching key", async () => {
  const PK = generatePrivateKey();
  const db = await createTestDb();
  const req = await createBotKeyRequest(db);
  expect(await mintRequestedKeys(db, KEK, () => PK)).toBe(1);
  const row = await getBotKey(db, req.id);
  expect(row?.status).toBe("pending");
  expect(row?.address).toBe(privateKeyToAddress(PK).toLowerCase());
  expect(row?.encPk).not.toContain(PK.slice(2));
  expect(
    decryptPrivateKey({ encPk: row?.encPk ?? "", iv: row?.encIv ?? "", tag: row?.encTag ?? "" }, KEK, req.id),
  ).toBe(PK);
  // nothing left to mint
  expect(await mintRequestedKeys(db, KEK, () => PK)).toBe(0);
});

test("mints several requests with distinct keys, each bound to its own row id", async () => {
  const db = await createTestDb();
  const a = await createBotKeyRequest(db);
  const b = await createBotKeyRequest(db);
  expect(await mintRequestedKeys(db, KEK)).toBe(2);
  const [ra, rb] = [await getBotKey(db, a.id), await getBotKey(db, b.id)];
  expect(ra?.address).not.toBe(rb?.address);
  const enc = (r: typeof ra) => ({ encPk: r?.encPk ?? "", iv: r?.encIv ?? "", tag: r?.encTag ?? "" });
  const pkA = decryptPrivateKey(enc(ra), KEK, a.id);
  expect(privateKeyToAddress(pkA).toLowerCase()).toBe(ra?.address);
  // AAD binds the ciphertext to its row: it must not decrypt under another id
  expect(() => decryptPrivateKey(enc(ra), KEK, b.id)).toThrow();
});
