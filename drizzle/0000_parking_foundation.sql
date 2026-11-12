CREATE TYPE "public"."gate_operation" AS ENUM('CHECK_IN', 'CHECK_OUT');--> statement-breakpoint
CREATE TYPE "public"."payment_disposition" AS ENUM('FAILED', 'SETTLED', 'RECONCILIATION_REQUIRED');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PAID', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."session_state" AS ENUM('PARKED', 'AWAITING_PAYMENT', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."space_category" AS ENUM('RESIDENT', 'CAR', 'MOTOR');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('CAR', 'MOTOR');--> statement-breakpoint
CREATE TABLE "buildings" (
	"id" text PRIMARY KEY NOT NULL,
	"timezone" text NOT NULL,
	CONSTRAINT "building_identity_nonempty" CHECK (length("buildings"."id") > 0 and length("buildings"."timezone") > 0)
);
--> statement-breakpoint
CREATE TABLE "gate_request_outcomes" (
	"building_id" text NOT NULL,
	"operation" "gate_operation" NOT NULL,
	"request_id" uuid NOT NULL,
	"canonical_payload" jsonb NOT NULL,
	"session_id" uuid,
	"response_status" smallint NOT NULL,
	"response_body" jsonb NOT NULL,
	CONSTRAINT "gate_request_outcomes_building_id_operation_request_id_pk" PRIMARY KEY("building_id","operation","request_id"),
	CONSTRAINT "gate_payload_objects" CHECK (jsonb_typeof("gate_request_outcomes"."canonical_payload") = 'object' and jsonb_typeof("gate_request_outcomes"."response_body") = 'object'),
	CONSTRAINT "gate_terminal_outcome" CHECK (
    ("gate_request_outcomes"."operation" = 'CHECK_IN' and "gate_request_outcomes"."response_status" = 201 and "gate_request_outcomes"."session_id" is not null)
    or ("gate_request_outcomes"."operation" = 'CHECK_OUT' and "gate_request_outcomes"."response_status" = 200 and "gate_request_outcomes"."session_id" is not null)
    or ("gate_request_outcomes"."response_status" = 409 and "gate_request_outcomes"."response_body"->'error'->>'code' is not null
      and (("gate_request_outcomes"."operation" = 'CHECK_IN' and "gate_request_outcomes"."response_body"->'error'->>'code' in ('PARKING_FULL', 'VEHICLE_ALREADY_CHECKED_IN'))
        or ("gate_request_outcomes"."operation" = 'CHECK_OUT' and "gate_request_outcomes"."response_body"->'error'->>'code' = 'RESIDENT_STATUS_MISMATCH')))
  )
);
--> statement-breakpoint
CREATE TABLE "parking_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" text NOT NULL,
	"space_id" integer NOT NULL,
	"normalized_plate" varchar(16) NOT NULL,
	"vehicle_type" "vehicle_type" NOT NULL,
	"is_resident" boolean NOT NULL,
	"state" "session_state" DEFAULT 'PARKED' NOT NULL,
	"check_in_at" timestamp with time zone NOT NULL,
	"checkout_at" timestamp with time zone,
	"duration_minutes" bigint,
	"charge_cents" bigint,
	"completed_at" timestamp with time zone,
	CONSTRAINT "session_building_identity" UNIQUE("building_id","id"),
	CONSTRAINT "plate_is_normalized" CHECK ("parking_sessions"."normalized_plate" ~ '^[A-Z0-9]{1,16}$'),
	CONSTRAINT "session_lifecycle" CHECK (
    ("parking_sessions"."state" = 'PARKED' and "parking_sessions"."checkout_at" is null and "parking_sessions"."duration_minutes" is null
      and "parking_sessions"."charge_cents" is null and "parking_sessions"."completed_at" is null)
    or ("parking_sessions"."state" in ('AWAITING_PAYMENT', 'COMPLETED')
      and "parking_sessions"."checkout_at" is not null and "parking_sessions"."checkout_at" >= "parking_sessions"."check_in_at"
      and "parking_sessions"."duration_minutes" is not null and "parking_sessions"."duration_minutes" >= 0
      and "parking_sessions"."duration_minutes" = floor(extract(epoch from ("parking_sessions"."checkout_at" - "parking_sessions"."check_in_at")) / 60)
      and "parking_sessions"."charge_cents" is not null and "parking_sessions"."charge_cents" between 0 and 9007199254740991
      and (not "parking_sessions"."is_resident" or "parking_sessions"."charge_cents" = 0)
      and (("parking_sessions"."state" = 'AWAITING_PAYMENT' and "parking_sessions"."charge_cents" > 0 and "parking_sessions"."completed_at" is null)
        or ("parking_sessions"."state" = 'COMPLETED' and "parking_sessions"."completed_at" is not null and "parking_sessions"."completed_at" >= "parking_sessions"."checkout_at")))
  )
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"provider_id" text NOT NULL,
	"payment_id" varchar(128) NOT NULL,
	"building_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" "payment_status" NOT NULL,
	"disposition" "payment_disposition" NOT NULL,
	CONSTRAINT "payment_events_provider_id_payment_id_pk" PRIMARY KEY("provider_id","payment_id"),
	CONSTRAINT "payment_values" CHECK (length("payment_events"."provider_id") > 0 and length("payment_events"."payment_id") > 0
    and "payment_events"."amount_cents" between 0 and 9007199254740991 and "payment_events"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payment_disposition_matches_status" CHECK (
    ("payment_events"."status" = 'FAILED' and "payment_events"."disposition" = 'FAILED')
    or ("payment_events"."status" = 'PAID' and "payment_events"."disposition" = 'RECONCILIATION_REQUIRED')
    or ("payment_events"."status" = 'PAID' and "payment_events"."disposition" = 'SETTLED' and "payment_events"."currency" = 'EUR' and "payment_events"."amount_cents" > 0)
  )
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"building_id" text NOT NULL,
	"id" integer NOT NULL,
	"floor" integer NOT NULL,
	"category" "space_category" NOT NULL,
	CONSTRAINT "spaces_building_id_id_pk" PRIMARY KEY("building_id","id"),
	CONSTRAINT "space_positive" CHECK ("spaces"."id" > 0 and "spaces"."floor" > 0)
);
--> statement-breakpoint
ALTER TABLE "gate_request_outcomes" ADD CONSTRAINT "gate_request_outcomes_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_request_outcomes" ADD CONSTRAINT "gate_request_outcomes_building_id_session_id_parking_sessions_building_id_id_fk" FOREIGN KEY ("building_id","session_id") REFERENCES "public"."parking_sessions"("building_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_building_id_space_id_spaces_building_id_id_fk" FOREIGN KEY ("building_id","space_id") REFERENCES "public"."spaces"("building_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_building_id_session_id_parking_sessions_building_id_id_fk" FOREIGN KEY ("building_id","session_id") REFERENCES "public"."parking_sessions"("building_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_plate_per_building" ON "parking_sessions" USING btree ("building_id","normalized_plate") WHERE "parking_sessions"."state" in ('PARKED', 'AWAITING_PAYMENT');--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_allocation_per_space" ON "parking_sessions" USING btree ("building_id","space_id") WHERE "parking_sessions"."state" in ('PARKED', 'AWAITING_PAYMENT');--> statement-breakpoint
CREATE UNIQUE INDEX "one_applied_settlement_per_session" ON "payment_events" USING btree ("session_id") WHERE "payment_events"."disposition" = 'SETTLED';
