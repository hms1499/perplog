CREATE TYPE "public"."plan_status" AS ENUM('pending_entry', 'entered', 'partially_entered', 'entry_failed');--> statement-breakpoint
ALTER TYPE "public"."alert_type" ADD VALUE 'entry_failed';--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account" text NOT NULL,
	"pool" text NOT NULL,
	"side" "side" NOT NULL,
	"risk_raw" numeric(78, 0) NOT NULL,
	"ref_price" numeric(78, 0) NOT NULL,
	"stop_price" numeric(78, 0) NOT NULL,
	"qty_raw" numeric(78, 0) NOT NULL,
	"price_bound" numeric(78, 0) NOT NULL,
	"leverage_est_bps" numeric(78, 0),
	"liq_price_est" numeric(78, 0),
	"status" "plan_status" NOT NULL,
	"entry_execution_id" uuid,
	"stop_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_entry_execution_id_executions_id_fk" FOREIGN KEY ("entry_execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_stop_id_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."stops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_one_pending_idx" ON "plans" USING btree ("account","pool") WHERE "plans"."status" = 'pending_entry';--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;