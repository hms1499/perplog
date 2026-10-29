import { parseEnv } from "../src/env";
import { b64 } from "./fakes";

const ok = { DATABASE_URL: "postgres://x", KEY_ENCRYPTION_KEY: b64(32), NETWORK: "hideki" };

test("parseEnv converts STT decimals to wei and requires a 32-byte KEK", () => {
  const env = parseEnv(ok);
  expect(env.GAS_TOPUP_THRESHOLD_WEI).toBe(2n * 10n ** 17n);
  expect(env.GAS_TOPUP_AMOUNT_WEI).toBe(5n * 10n ** 17n);
  expect(env.GAS_TOPUP_DAILY_CAP_WEI).toBe(2n * 10n ** 18n);
  expect(env.TREASURY_PRIVATE_KEY).toBeNull();
  expect(env.KEY_ENCRYPTION_KEY).toHaveLength(32);
  expect(env.LOG_LEVEL).toBe("info");
  expect(() => parseEnv({ ...ok, KEY_ENCRYPTION_KEY: b64(16) })).toThrow();
});

test("parseEnv reads decimal overrides, the treasury key and endpoint overrides", () => {
  const pk = `0x${"ab".repeat(32)}`;
  const env = parseEnv({
    ...ok,
    GAS_TOPUP_THRESHOLD_STT: "0.25",
    GAS_TOPUP_AMOUNT_STT: "1",
    GAS_TOPUP_DAILY_CAP_STT: "3.5",
    TREASURY_PRIVATE_KEY: pk,
    RPC_HTTP_URL: "https://rpc.example",
    RPC_WS_URL: "",
  });
  expect(env.GAS_TOPUP_THRESHOLD_WEI).toBe(25n * 10n ** 16n);
  expect(env.GAS_TOPUP_AMOUNT_WEI).toBe(10n ** 18n);
  expect(env.GAS_TOPUP_DAILY_CAP_WEI).toBe(35n * 10n ** 17n);
  expect(env.TREASURY_PRIVATE_KEY).toBe(pk);
  expect(env.RPC_HTTP_URL).toBe("https://rpc.example");
  expect(env.RPC_WS_URL).toBeUndefined();
});

test("parseEnv rejects a missing DATABASE_URL, an unknown network, a bad treasury key and a bad decimal", () => {
  expect(() => parseEnv({ ...ok, DATABASE_URL: undefined })).toThrow();
  expect(() => parseEnv({ ...ok, NETWORK: "mainnet" })).toThrow();
  expect(() => parseEnv({ ...ok, TREASURY_PRIVATE_KEY: "0x1234" })).toThrow();
  expect(() => parseEnv({ ...ok, GAS_TOPUP_AMOUNT_STT: "lots" })).toThrow();
});

test("a parse failure never echoes the key material", () => {
  const secret = "not-base64-secret-value";
  try {
    parseEnv({ ...ok, KEY_ENCRYPTION_KEY: secret });
    expect.unreachable();
  } catch (err) {
    expect(String(err)).not.toContain(secret);
  }
});

test("parseEnv rejects a Neon pooled DATABASE_URL without echoing it, and accepts the direct one", () => {
  const host = "ep-weathered-moon-atjha43u.c-9.us-east-1.aws.neon.tech";
  const pooled = `postgresql://owner:s3cret-pw@${host.replace(".", "-pooler.")}/neondb?sslmode=require`;
  try {
    parseEnv({ ...ok, DATABASE_URL: pooled });
    expect.unreachable();
  } catch (err) {
    expect(String(err)).toContain("direct");
    expect(String(err)).not.toContain("s3cret-pw");
  }
  const direct = `postgresql://owner:s3cret-pw@${host}/neondb?sslmode=require`;
  expect(parseEnv({ ...ok, DATABASE_URL: direct }).DATABASE_URL).toBe(direct);
  // Only the first host label marks Neon's pooler; "pooler" elsewhere is not a match.
  expect(() => parseEnv({ ...ok, DATABASE_URL: "postgres://u:p@db.pooler-free.example/x" })).not.toThrow();
});

test("parseEnv reads an optional PORT for the health server and rejects a bad one", () => {
  expect(parseEnv(ok).PORT).toBeUndefined();
  expect(parseEnv({ ...ok, PORT: "" }).PORT).toBeUndefined();
  expect(parseEnv({ ...ok, PORT: "10000" }).PORT).toBe(10000);
  expect(() => parseEnv({ ...ok, PORT: "http" })).toThrow();
  expect(() => parseEnv({ ...ok, PORT: "70000" })).toThrow();
});
