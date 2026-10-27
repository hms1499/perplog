import { decryptPrivateKey, encryptPrivateKey, parseKek } from "../src/crypto";

const PK = `0x${"ab".repeat(32)}` as const;

test("round-trips a key and rejects a wrong AAD or KEK", () => {
  const kek = parseKek(Buffer.alloc(32, 7).toString("base64"));
  const enc = encryptPrivateKey(PK, kek, "id-1");
  expect(decryptPrivateKey(enc, kek, "id-1")).toBe(PK);
  expect(() => decryptPrivateKey(enc, kek, "id-2")).toThrow();
  const other = parseKek(Buffer.alloc(32, 8).toString("base64"));
  expect(() => decryptPrivateKey(enc, other, "id-1")).toThrow();
  expect(() => parseKek(Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
});

test("uses a fresh IV per encryption and does not leak the key in the ciphertext", () => {
  const kek = parseKek(Buffer.alloc(32, 7).toString("base64"));
  const a = encryptPrivateKey(PK, kek, "id-1");
  const b = encryptPrivateKey(PK, kek, "id-1");
  expect(a.iv).not.toBe(b.iv);
  expect(a.encPk).not.toBe(b.encPk);
  expect(Buffer.from(a.encPk, "base64").toString("hex")).not.toContain(PK.slice(2));
});
