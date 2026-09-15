CREATE TYPE "public"."customer_kind" AS ENUM('customer', 'supplier', 'both');--> statement-breakpoint
CREATE TABLE "xero_connection" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"tenant_id" text,
	"tenant_name" text,
	"access_token_enc" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_enc" text,
	"refreshed_at" timestamp with time zone,
	"connected_by_id" uuid,
	"connected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "kind" "customer_kind" DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "xero_contact_id" text;--> statement-breakpoint
ALTER TABLE "xero_connection" ADD CONSTRAINT "xero_connection_connected_by_id_users_id_fk" FOREIGN KEY ("connected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_kind_idx" ON "customers" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "customers_xero_idx" ON "customers" USING btree ("xero_contact_id");