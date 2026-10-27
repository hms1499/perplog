CREATE TYPE "public"."alert_type" AS ENUM('unprotected_position', 'stop_done', 'stop_failed', 'bot_low_gas', 'link_revoked');--> statement-breakpoint
CREATE TYPE "public"."bot_key_status" AS ENUM('requested', 'pending', 'linked', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."execution_kind" AS ENUM('entry', 'stop_close');--> statement-breakpoint
CREATE TYPE "public"."execution_status" AS ENUM('queued', 'sending', 'sent', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."qty_mode" AS ENUM('entire', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."side" AS ENUM('long', 'short');--> statement-breakpoint
CREATE TYPE "public"."stop_source" AS ENUM('protect_now', 'plan');--> statement-breakpoint
CREATE TYPE "public"."stop_status" AS ENUM('armed', 'paused', 'triggered', 'executing', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."trigger_op" AS ENUM('lte', 'gte');--> statement-breakpoint
CREATE TYPE "public"."watch_source" AS ENUM('session', 'watch');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account" text NOT NULL,
	"type" "alert_type" NOT NULL,
	"pool" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bot_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text,
	"account" text,
	"enc_pk" text,
	"enc_iv" text,
	"enc_tag" text,
	"status" "bot_key_status" DEFAULT 'requested' NOT NULL,
	"linked_pools" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"linked_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	CONSTRAINT "bot_keys_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "execution_kind" NOT NULL,
	"status" "execution_status" NOT NULL,
	"account" text NOT NULL,
	"pool" text NOT NULL,
	"bot_key_id" uuid NOT NULL,
	"plan_id" uuid,
	"stop_id" uuid,
	"is_bid" boolean NOT NULL,
	"qty_raw" numeric(78, 0) NOT NULL,
	"price_bound" numeric(78, 0) NOT NULL,
	"tx_hash" text,
	"order_id" numeric(78, 0),
	"filled_raw" numeric(78, 0),
	"avg_price" numeric(78, 0),
	"gas_used" numeric(78, 0),
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gas_topups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bot_key_id" uuid NOT NULL,
	"amount_wei" numeric(78, 0) NOT NULL,
	"tx_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account" text,
	"bot_key_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account" text NOT NULL,
	"pool" text NOT NULL,
	"bot_key_id" uuid NOT NULL,
	"position_side" "side" NOT NULL,
	"trigger_price" numeric(78, 0) NOT NULL,
	"trigger_op" "trigger_op" NOT NULL,
	"qty_mode" "qty_mode" NOT NULL,
	"qty_raw" numeric(78, 0),
	"closed_raw" numeric(78, 0) DEFAULT 0 NOT NULL,
	"max_slip_bps" integer DEFAULT 500 NOT NULL,
	"source" "stop_source" DEFAULT 'protect_now' NOT NULL,
	"status" "stop_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"triggered_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "watched_accounts" (
	"account" text PRIMARY KEY NOT NULL,
	"source" "watch_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_bot_key_id_bot_keys_id_fk" FOREIGN KEY ("bot_key_id") REFERENCES "public"."bot_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_stop_id_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."stops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gas_topups" ADD CONSTRAINT "gas_topups_bot_key_id_bot_keys_id_fk" FOREIGN KEY ("bot_key_id") REFERENCES "public"."bot_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_bot_key_id_bot_keys_id_fk" FOREIGN KEY ("bot_key_id") REFERENCES "public"."bot_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_bot_key_id_bot_keys_id_fk" FOREIGN KEY ("bot_key_id") REFERENCES "public"."bot_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_account_created_idx" ON "alerts" USING btree ("account","created_at");--> statement-breakpoint
CREATE INDEX "stops_status_idx" ON "stops" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stops_account_pool_idx" ON "stops" USING btree ("account","pool");