CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"icon" text,
	"owner_id" uuid,
	"is_shared" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "leads_stage_idx";--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "last_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "last_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "board_position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "last_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "stale_lead_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "stale_customer_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "stale_project_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_views_entity_idx" ON "saved_views" USING btree ("entity","position");--> statement-breakpoint
CREATE INDEX "customers_last_activity_idx" ON "customers" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "leads_last_activity_idx" ON "leads" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "leads_stage_idx" ON "leads" USING btree ("stage","board_position");