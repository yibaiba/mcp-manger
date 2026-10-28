ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_subject_idx" ON "account" USING btree ("provider_id","account_id");