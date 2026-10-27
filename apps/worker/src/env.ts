import { parseKek } from "@perplog/db/crypto";
import type { Hex } from "viem";
import { parseEther } from "viem";
import { z } from "zod";

export interface WorkerEnv {
  DATABASE_URL: string;
  KEY_ENCRYPTION_KEY: Buffer;
  TREASURY_PRIVATE_KEY: Hex | null;
  NETWORK: "hideki";
  RPC_HTTP_URL?: string;
  RPC_WS_URL?: string;
  INDEXER_URL?: string;
  GAS_TOPUP_THRESHOLD_WEI: bigint;
  GAS_TOPUP_AMOUNT_WEI: bigint;
  GAS_TOPUP_DAILY_CAP_WEI: bigint;
  LOG_LEVEL: string;
}

// A hosting dashboard often leaves a variable present but empty: that means "unset".
const blankIsUnset = (v: unknown) => (v === "" ? undefined : v);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankIsUnset, schema.optional());

/** STT is the 18-decimal native token: "0.2" -> 200000000000000000n. */
const stt = (fallback: string) =>
  z.preprocess(
    blankIsUnset,
    z
      .string()
      .regex(/^\d+(\.\d{1,18})?$/, "must be a decimal STT amount")
      .default(fallback)
      .transform((v) => parseEther(v)),
  );

// Messages must never echo the offending value: two of these fields are secrets.
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  KEY_ENCRYPTION_KEY: z.string().transform((v, ctx) => {
    try {
      return parseKek(v);
    } catch {
      ctx.addIssue({ code: "custom", message: "must be base64 decoding to exactly 32 bytes" });
      return z.NEVER;
    }
  }),
  TREASURY_PRIVATE_KEY: z.preprocess(
    blankIsUnset,
    z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex key")
      .transform((v) => v as Hex)
      .nullable()
      .default(null),
  ),
  NETWORK: z.literal("hideki"),
  RPC_HTTP_URL: optional(z.url()),
  RPC_WS_URL: optional(z.string().min(1)),
  INDEXER_URL: optional(z.url()),
  GAS_TOPUP_THRESHOLD_STT: stt("0.2"),
  GAS_TOPUP_AMOUNT_STT: stt("0.5"),
  GAS_TOPUP_DAILY_CAP_STT: stt("2"),
  LOG_LEVEL: z.preprocess(blankIsUnset, z.string().default("info")),
});

/** Parses and validates the environment once, at boot. Throws a ZodError listing every bad variable. */
export function parseEnv(raw: NodeJS.ProcessEnv): WorkerEnv {
  const e = schema.parse(raw);
  return {
    DATABASE_URL: e.DATABASE_URL,
    KEY_ENCRYPTION_KEY: e.KEY_ENCRYPTION_KEY,
    TREASURY_PRIVATE_KEY: e.TREASURY_PRIVATE_KEY,
    NETWORK: e.NETWORK,
    ...(e.RPC_HTTP_URL !== undefined && { RPC_HTTP_URL: e.RPC_HTTP_URL }),
    ...(e.RPC_WS_URL !== undefined && { RPC_WS_URL: e.RPC_WS_URL }),
    ...(e.INDEXER_URL !== undefined && { INDEXER_URL: e.INDEXER_URL }),
    GAS_TOPUP_THRESHOLD_WEI: e.GAS_TOPUP_THRESHOLD_STT,
    GAS_TOPUP_AMOUNT_WEI: e.GAS_TOPUP_AMOUNT_STT,
    GAS_TOPUP_DAILY_CAP_WEI: e.GAS_TOPUP_DAILY_CAP_STT,
    LOG_LEVEL: e.LOG_LEVEL,
  };
}
