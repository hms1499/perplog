import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Hex } from "viem";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEX_RE = /^0x(?:[0-9a-fA-F]{2})+$/;

export type EncryptedKey = { encPk: string; iv: string; tag: string };

/** Parses the base64 key-encryption key; it must decode to exactly 32 bytes. */
export function parseKek(base64: string): Buffer {
  const kek = Buffer.from(base64, "base64");
  if (kek.length !== 32)
    throw new Error(`KEY_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${kek.length})`);
  return kek;
}

/** AES-256-GCM. `aad` (the bot key id) binds the ciphertext to its row. */
export function encryptPrivateKey(pk: Hex, kek: Buffer, aad: string): EncryptedKey {
  if (!HEX_RE.test(pk)) throw new Error("private key must be 0x-prefixed hex");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, kek, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad));
  const enc = Buffer.concat([cipher.update(Buffer.from(pk.slice(2), "hex")), cipher.final()]);
  return {
    encPk: enc.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptPrivateKey(enc: EncryptedKey, kek: Buffer, aad: string): Hex {
  const tag = Buffer.from(enc.tag, "base64");
  if (tag.length !== TAG_BYTES) throw new Error("invalid auth tag length");
  const decipher = createDecipheriv(ALGO, kek, Buffer.from(enc.iv, "base64"), { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  const pk = Buffer.concat([decipher.update(Buffer.from(enc.encPk, "base64")), decipher.final()]);
  return `0x${pk.toString("hex")}`;
}
