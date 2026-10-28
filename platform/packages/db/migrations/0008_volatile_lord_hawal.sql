ALTER TABLE "devices" DROP CONSTRAINT "devices_token_hash_unique";--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "credential_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pairings" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "pairings" ADD CONSTRAINT "pairings_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "token_hash";