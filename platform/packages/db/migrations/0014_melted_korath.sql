CREATE TABLE "tool_vectors" (
	"owner_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"tool_id" text NOT NULL,
	"definition_hash" text NOT NULL,
	"vector" double precision[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_vectors_owner_id_profile_id_scope_tool_id_pk" PRIMARY KEY("owner_id","profile_id","scope","tool_id")
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "discovery_mode" text DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "pinned_tools" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "embedding" jsonb;--> statement-breakpoint
ALTER TABLE "tool_vectors" ADD CONSTRAINT "tool_vectors_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_vectors" ADD CONSTRAINT "tool_vectors_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tool_vectors_scope" ON "tool_vectors" USING btree ("owner_id","profile_id","scope");