import type { Address } from "@perplog/core";
import { claimRequestedBotKeys, type Db } from "@perplog/db";
import { encryptPrivateKey } from "@perplog/db/crypto";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";

const BATCH = 20;

/**
 * Fills every `requested` bot key with a fresh keypair. The private key exists only in memory for the
 * duration of the callback; what is stored is AES-GCM ciphertext bound to the row id, plus the address.
 * Returns how many keys were minted.
 */
export function mintRequestedKeys(
  db: Db,
  kek: Buffer,
  generate: () => Hex = generatePrivateKey,
): Promise<number> {
  return claimRequestedBotKeys(db, BATCH, (id) => {
    const pk = generate();
    const { encPk, iv, tag } = encryptPrivateKey(pk, kek, id);
    return { address: privateKeyToAddress(pk).toLowerCase() as Address, encPk, iv, tag };
  });
}
