CREATE TABLE "planner_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"local_id" uuid NOT NULL,
	"planner_id" text NOT NULL,
	"etag" text,
	"details_etag" text,
	"base" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planner_plans" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"group_id" text,
	"title" text,
	"etag" text,
	"base" jsonb,
	"last_synced_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"locked_at" timestamp with time zone,
	"linked_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_steps" ADD COLUMN "checklist" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "planner_group_id" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "planner_group_name" text;--> statement-breakpoint
ALTER TABLE "planner_items" ADD CONSTRAINT "planner_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planner_plans" ADD CONSTRAINT "planner_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planner_plans" ADD CONSTRAINT "planner_plans_linked_by_id_users_id_fk" FOREIGN KEY ("linked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planner_items_project_idx" ON "planner_items" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "planner_items_planner_idx" ON "planner_items" USING btree ("kind","planner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "planner_items_local_idx" ON "planner_items" USING btree ("kind","local_id");--> statement-breakpoint
CREATE UNIQUE INDEX "planner_plans_plan_idx" ON "planner_plans" USING btree ("plan_id");