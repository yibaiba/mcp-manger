CREATE TABLE "connection_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"credential_mode" text DEFAULT 'independent' NOT NULL,
	"tool_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"receiver_config" text,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"error" text,
	"version" integer DEFAULT 1 NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "share_id" uuid;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "share_version" integer;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "resource_owner_id" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "credential_owner_id" text;--> statement-breakpoint
ALTER TABLE "connection_shares" ADD CONSTRAINT "connection_shares_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_shares" ADD CONSTRAINT "connection_shares_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_shares" ADD CONSTRAINT "connection_shares_recipient_id_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connection_share_recipient" ON "connection_shares" USING btree ("connection_id","recipient_id");--> statement-breakpoint
CREATE INDEX "connection_shares_recipient" ON "connection_shares" USING btree ("recipient_id","revoked");