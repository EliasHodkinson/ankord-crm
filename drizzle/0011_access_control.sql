CREATE TYPE "public"."file_access" AS ENUM('read', 'write');--> statement-breakpoint
CREATE TYPE "public"."sp_grant_status" AS ENUM('applied', 'preexisting', 'failed', 'revoked', 'revoke_failed');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'restricted';--> statement-breakpoint
CREATE TABLE "customer_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"file_access" "file_access" DEFAULT 'write' NOT NULL,
	"granted_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sharepoint_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"customer_id" uuid,
	"drive_id" text NOT NULL,
	"item_id" text NOT NULL,
	"permission_id" text,
	"role" "file_access" NOT NULL,
	"status" "sp_grant_status" NOT NULL,
	"error" text,
	"applied_by_id" uuid,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by_id" uuid,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_guest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invited_by_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_grants" ADD CONSTRAINT "customer_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_grants" ADD CONSTRAINT "customer_grants_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_grants" ADD CONSTRAINT "customer_grants_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sharepoint_grants" ADD CONSTRAINT "sharepoint_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sharepoint_grants" ADD CONSTRAINT "sharepoint_grants_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sharepoint_grants" ADD CONSTRAINT "sharepoint_grants_applied_by_id_users_id_fk" FOREIGN KEY ("applied_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sharepoint_grants" ADD CONSTRAINT "sharepoint_grants_revoked_by_id_users_id_fk" FOREIGN KEY ("revoked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_grants_user_customer_idx" ON "customer_grants" USING btree ("user_id","customer_id");--> statement-breakpoint
CREATE INDEX "customer_grants_customer_idx" ON "customer_grants" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sharepoint_grants_user_idx" ON "sharepoint_grants" USING btree ("user_id","customer_id");--> statement-breakpoint
CREATE INDEX "sharepoint_grants_item_idx" ON "sharepoint_grants" USING btree ("drive_id","item_id");