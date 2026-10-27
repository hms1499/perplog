import type { Address, QtyMode, Side, StopStatus } from "@perplog/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** Raw on-chain amounts: numeric(78,0) <-> bigint. */
const raw = (name: string) => numeric(name, { precision: 78, scale: 0, mode: "bigint" });
const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const botKeyStatus = pgEnum("bot_key_status", ["requested", "pending", "linked", "revoked"]);
export const watchSource = pgEnum("watch_source", ["session", "watch"]);
export const sideEnum = pgEnum("side", ["long", "short"]);
export const triggerOp = pgEnum("trigger_op", ["lte", "gte"]);
export const qtyMode = pgEnum("qty_mode", ["entire", "fixed"]);
export const stopSource = pgEnum("stop_source", ["protect_now", "plan"]);
export const stopStatus = pgEnum("stop_status", [
  "armed",
  "paused",
  "triggered",
  "executing",
  "done",
  "failed",
  "cancelled",
]);
export const executionKind = pgEnum("execution_kind", ["entry", "stop_close"]);
export const executionStatus = pgEnum("execution_status", [
  "queued",
  "sending",
  "sent",
  "confirmed",
  "failed",
]);
export const alertType = pgEnum("alert_type", [
  "unprotected_position",
  "stop_done",
  "stop_failed",
  "bot_low_gas",
  "link_revoked",
]);

// The enums must hold exactly the values of the core types.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _enumsMatchCore: [
  Equals<(typeof stopStatus.enumValues)[number], StopStatus>,
  Equals<(typeof sideEnum.enumValues)[number], Side>,
  Equals<(typeof qtyMode.enumValues)[number], QtyMode>,
] = [true, true, true];
void _enumsMatchCore;

export const botKeys = pgTable("bot_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  address: text("address").$type<Address>().unique(),
  account: text("account").$type<Address>(),
  encPk: text("enc_pk"),
  encIv: text("enc_iv"),
  encTag: text("enc_tag"),
  status: botKeyStatus("status").notNull().default("requested"),
  linkedPools: text("linked_pools").array().$type<Address[]>().notNull().default(sql`'{}'::text[]`),
  createdAt: tstz("created_at").notNull().defaultNow(),
  linkedAt: tstz("linked_at"),
  checkedAt: tstz("checked_at"),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  account: text("account").$type<Address>(),
  botKeyId: uuid("bot_key_id").references(() => botKeys.id),
  createdAt: tstz("created_at").notNull().defaultNow(),
  lastSeenAt: tstz("last_seen_at").notNull().defaultNow(),
});

export const watchedAccounts = pgTable("watched_accounts", {
  account: text("account").$type<Address>().primaryKey(),
  source: watchSource("source").notNull(),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

export const stops = pgTable(
  "stops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    account: text("account").$type<Address>().notNull(),
    pool: text("pool").$type<Address>().notNull(),
    botKeyId: uuid("bot_key_id")
      .notNull()
      .references(() => botKeys.id),
    positionSide: sideEnum("position_side").notNull(),
    triggerPrice: raw("trigger_price").notNull(),
    triggerOp: triggerOp("trigger_op").notNull(),
    qtyMode: qtyMode("qty_mode").notNull(),
    qtyRaw: raw("qty_raw"),
    closedRaw: raw("closed_raw").notNull().default(sql`0`),
    maxSlipBps: integer("max_slip_bps").notNull().default(500),
    source: stopSource("source").notNull().default("protect_now"),
    status: stopStatus("status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    triggeredAt: tstz("triggered_at"),
    finishedAt: tstz("finished_at"),
  },
  (t) => [index("stops_status_idx").on(t.status), index("stops_account_pool_idx").on(t.account, t.pool)],
);

export const executions = pgTable("executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: executionKind("kind").notNull(),
  status: executionStatus("status").notNull(),
  account: text("account").$type<Address>().notNull(),
  pool: text("pool").$type<Address>().notNull(),
  botKeyId: uuid("bot_key_id")
    .notNull()
    .references(() => botKeys.id),
  planId: uuid("plan_id"), // FK added in Plan 3
  stopId: uuid("stop_id").references(() => stops.id),
  isBid: boolean("is_bid").notNull(),
  qtyRaw: raw("qty_raw").notNull(),
  priceBound: raw("price_bound").notNull(),
  txHash: text("tx_hash"),
  orderId: raw("order_id"),
  filledRaw: raw("filled_raw"),
  avgPrice: raw("avg_price"),
  gasUsed: raw("gas_used"),
  error: text("error"),
  createdAt: tstz("created_at").notNull().defaultNow(),
  updatedAt: tstz("updated_at").notNull().defaultNow(),
});

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    account: text("account").$type<Address>().notNull(),
    type: alertType("type").notNull(),
    pool: text("pool").$type<Address>(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
    readAt: tstz("read_at"),
  },
  (t) => [index("alerts_account_created_idx").on(t.account, t.createdAt)],
);

export const gasTopups = pgTable("gas_topups", {
  id: uuid("id").primaryKey().defaultRandom(),
  botKeyId: uuid("bot_key_id")
    .notNull()
    .references(() => botKeys.id),
  amountWei: raw("amount_wei").notNull(),
  txHash: text("tx_hash").notNull(),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: tstz("window_start").notNull(),
    count: integer("count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

export type BotKeyRow = typeof botKeys.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type StopRow = typeof stops.$inferSelect;
export type NewStop = typeof stops.$inferInsert;
export type ExecutionRow = typeof executions.$inferSelect;
export type NewExecution = typeof executions.$inferInsert;
export type AlertRow = typeof alerts.$inferSelect;
export type AlertType = (typeof alertType.enumValues)[number];
