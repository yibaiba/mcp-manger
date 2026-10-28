CREATE TABLE "system_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" text NOT NULL,
	"event" text NOT NULL,
	"owner_id" text,
	"code" text,
	"method" text,
	"route" text,
	"status" integer,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE INDEX "system_logs_time" ON "system_logs" USING btree ("at","id");--> statement-breakpoint
CREATE INDEX "system_logs_level_time" ON "system_logs" USING btree ("level","at","id");--> statement-breakpoint
CREATE INDEX "calls_owner_time" ON "calls" USING btree ("owner_id","created_at","id");--> statement-breakpoint
CREATE INDEX "calls_owner_tool_time" ON "calls" USING btree ("owner_id","tool_id","created_at","id");--> statement-breakpoint
CREATE INDEX "calls_owner_connection_time" ON "calls" USING btree ("owner_id","connection_id","created_at","id");--> statement-breakpoint
CREATE INDEX "calls_owner_device_time" ON "calls" USING btree ("owner_id","device_id","created_at","id");--> statement-breakpoint
CREATE INDEX "calls_owner_profile_time" ON "calls" USING btree ("owner_id","profile_id","created_at","id");--> statement-breakpoint
CREATE INDEX "calls_owner_status_time" ON "calls" USING btree ("owner_id","status","created_at","id");