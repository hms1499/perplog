/**
 * Generate a throwaway bot key for the operator spike and store it in .env.spike (git-ignored).
 * Usage: pnpm tsx scripts/new-bot-key.ts
 * Then link the printed address in the dreamDEX app (wallet -> Link a bot -> tick Perps),
 * fund it with >= 0.5 STT on Hideki, and add OWNER=<your account> to .env.spike.
 */
import { existsSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const FILE = new URL("../.env.spike", import.meta.url);

if (existsSync(FILE)) {
  console.error(".env.spike already exists; refusing to overwrite a key. Delete it first to rotate.");
  process.exit(1);
}
const key = generatePrivateKey();
writeFileSync(FILE, `BOT_PRIVATE_KEY=${key}\n# OWNER=0x...your dreamDEX account address\n`, { mode: 0o600 });
console.log(`Wrote BOT_PRIVATE_KEY to .env.spike`);
console.log(`Bot address: ${privateKeyToAccount(key).address.toLowerCase()}`);
process.exit(0);
