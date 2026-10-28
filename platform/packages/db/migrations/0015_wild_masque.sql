CREATE TABLE "rest_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"credential_id" uuid NOT NULL,
	"tool_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"idempotency_hash" text,
	"status" text DEFAULT 'running' NOT NULL,
	"interaction_id" uuid,
	"result_digest" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "rest_calls" ADD CONSTRAINT "rest_calls_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rest_calls" ADD CONSTRAINT "rest_calls_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rest_calls_idempotency" ON "rest_calls" USING btree ("owner_id","profile_id","credential_id","idempotency_hash");--> statement-breakpoint
CREATE INDEX "rest_calls_owner_status" ON "rest_calls" USING btree ("owner_id","status");