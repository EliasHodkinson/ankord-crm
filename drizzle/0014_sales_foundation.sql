CREATE TYPE "public"."amounts_are" AS ENUM('exclusive', 'inclusive', 'no_tax');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('draft', 'open', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('quote', 'sales_order', 'invoice', 'delivery', 'purchase_order', 'goods_receipt', 'bill');--> statement-breakpoint
CREATE TYPE "public"."quote_outcome" AS ENUM('accepted', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."row_type" AS ENUM('item', 'alternative', 'text', 'subtotal');--> statement-breakpoint
CREATE TYPE "public"."xero_sync_state" AS ENUM('local_only', 'pending', 'pushing', 'synced', 'stale', 'failed', 'blocked');--> statement-breakpoint
CREATE TABLE "document_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"row_type" "row_type" DEFAULT 'item' NOT NULL,
	"item_id" uuid,
	"item_code" text,
	"unit" text,
	"tracks_stock" boolean DEFAULT false NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"note" text,
	"quantity" numeric(14, 4) DEFAULT '0' NOT NULL,
	"unit_price" numeric(14, 4) DEFAULT '0' NOT NULL,
	"discount_percent" numeric(7, 4) DEFAULT '0' NOT NULL,
	"account_code" text,
	"tax_type" text,
	"tax_rate" numeric(7, 4) DEFAULT '0' NOT NULL,
	"line_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"base_line_id" uuid,
	"source_line_id" uuid,
	"qty_converted" numeric(14, 4) DEFAULT '0' NOT NULL,
	"qty_ordered" numeric(14, 4) DEFAULT '0' NOT NULL,
	"qty_allocated" numeric(14, 4) DEFAULT '0' NOT NULL,
	"qty_invoiced" numeric(14, 4) DEFAULT '0' NOT NULL,
	"qty_delivered" numeric(14, 4) DEFAULT '0' NOT NULL,
	"qty_received" numeric(14, 4) DEFAULT '0' NOT NULL,
	"qty_billed" numeric(14, 4) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "document_type" NOT NULL,
	"number" text,
	"status" "document_status" DEFAULT 'draft' NOT NULL,
	"is_reserve" boolean DEFAULT false NOT NULL,
	"quote_outcome" "quote_outcome",
	"partner_id" uuid NOT NULL,
	"partner_name" text NOT NULL,
	"contact_id" uuid,
	"contact_name" text,
	"contact_email" text,
	"reference" text,
	"supplier_invoice_number" text,
	"doc_date" date NOT NULL,
	"due_date" date,
	"terms_days" integer,
	"ship_to_text" text,
	"owner_id" uuid,
	"project_id" uuid,
	"sales_order_id" uuid,
	"amounts_are" "amounts_are" DEFAULT 'exclusive' NOT NULL,
	"title" text,
	"summary" text,
	"terms" text,
	"remarks" text,
	"internal_notes" text,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(14, 2) DEFAULT '0' NOT NULL,
	"amount_due" numeric(14, 2) DEFAULT '0' NOT NULL,
	"fulfilment" text,
	"version" integer DEFAULT 1 NOT NULL,
	"issued_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" uuid,
	"cancel_reason" text,
	"xero_id" text,
	"xero_status" text,
	"xero_sync_state" "xero_sync_state" NOT NULL,
	"xero_pushed_version" integer,
	"xero_error" text,
	"xero_attempts" integer DEFAULT 0 NOT NULL,
	"xero_last_attempt_at" timestamp with time zone,
	"xero_synced_at" timestamp with time zone,
	"xero_updated_at" timestamp with time zone,
	"xero_total" numeric(14, 2),
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"purchase_description" text,
	"tracks_stock" boolean DEFAULT false NOT NULL,
	"unit" text,
	"is_sold" boolean DEFAULT true NOT NULL,
	"is_purchased" boolean DEFAULT false NOT NULL,
	"sale_price" numeric(14, 4),
	"purchase_price" numeric(14, 4),
	"sales_account_code" text,
	"purchase_account_code" text,
	"sales_tax_type" text,
	"purchase_tax_type" text,
	"preferred_supplier_id" uuid,
	"xero_item_id" text,
	"xero_sync_state" "xero_sync_state" DEFAULT 'pending' NOT NULL,
	"xero_error" text,
	"xero_synced_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "number_series" (
	"key" text PRIMARY KEY NOT NULL,
	"prefix" text NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"pad_to" integer DEFAULT 5 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"reason" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_order_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"receipt_line_id" uuid,
	"released_at" timestamp with time zone,
	"released_by_id" uuid,
	"consumed" numeric(14, 4) DEFAULT '0' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xero_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xero_history_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"details" text NOT NULL,
	"written_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xero_sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"http_status" integer,
	"xero_id" text,
	"message" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "terms_days" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "supplier_terms_days" integer;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "default_sales_account" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "default_purchase_account" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "default_sales_tax_type" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "default_purchase_tax_type" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "quote_branding_theme_id" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "invoice_branding_theme_id" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "po_branding_theme_id" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "delivery_address" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "customer_terms_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "supplier_terms_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "quote_validity_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "allow_bill_approval" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "xero_last_pull_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "xero_connection" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_base_line_id_document_lines_id_fk" FOREIGN KEY ("base_line_id") REFERENCES "public"."document_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_source_line_id_document_lines_id_fk" FOREIGN KEY ("source_line_id") REFERENCES "public"."document_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_partner_id_customers_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_sales_order_id_documents_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_cancelled_by_id_users_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_preferred_supplier_id_customers_id_fk" FOREIGN KEY ("preferred_supplier_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD CONSTRAINT "stock_allocations_sales_order_line_id_document_lines_id_fk" FOREIGN KEY ("sales_order_line_id") REFERENCES "public"."document_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD CONSTRAINT "stock_allocations_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD CONSTRAINT "stock_allocations_receipt_line_id_document_lines_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."document_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD CONSTRAINT "stock_allocations_released_by_id_users_id_fk" FOREIGN KEY ("released_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD CONSTRAINT "stock_allocations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xero_history_notes" ADD CONSTRAINT "xero_history_notes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_lines_document_idx" ON "document_lines" USING btree ("document_id","position");--> statement-breakpoint
CREATE INDEX "document_lines_base_idx" ON "document_lines" USING btree ("base_line_id");--> statement-breakpoint
CREATE INDEX "document_lines_source_idx" ON "document_lines" USING btree ("source_line_id");--> statement-breakpoint
CREATE INDEX "document_lines_item_idx" ON "document_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "documents_type_status_idx" ON "documents" USING btree ("type","status","doc_date");--> statement-breakpoint
CREATE INDEX "documents_partner_idx" ON "documents" USING btree ("partner_id","type");--> statement-breakpoint
CREATE INDEX "documents_sales_order_idx" ON "documents" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX "documents_project_idx" ON "documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "documents_sync_idx" ON "documents" USING btree ("type","xero_sync_state");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_number_idx" ON "documents" USING btree ("type","number") WHERE "documents"."number" is not null and "documents"."type" <> 'bill';--> statement-breakpoint
CREATE UNIQUE INDEX "documents_xero_idx" ON "documents" USING btree ("xero_id") WHERE "documents"."xero_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_bill_number_idx" ON "documents" USING btree ("partner_id","supplier_invoice_number") WHERE "documents"."type" = 'bill' and "documents"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "items_code_idx" ON "items" USING btree ("code");--> statement-breakpoint
CREATE INDEX "items_name_idx" ON "items" USING btree ("name");--> statement-breakpoint
CREATE INDEX "items_sync_idx" ON "items" USING btree ("xero_sync_state");--> statement-breakpoint
CREATE INDEX "stock_adjustments_item_idx" ON "stock_adjustments" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "stock_allocations_line_idx" ON "stock_allocations" USING btree ("sales_order_line_id");--> statement-breakpoint
CREATE INDEX "stock_allocations_item_idx" ON "stock_allocations" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "xero_history_notes_pending_idx" ON "xero_history_notes" USING btree ("written_at","created_at");--> statement-breakpoint
CREATE INDEX "xero_sync_log_entity_idx" ON "xero_sync_log" USING btree ("entity_id","created_at");--> statement-breakpoint
CREATE INDEX "xero_sync_log_created_idx" ON "xero_sync_log" USING btree ("created_at");--> statement-breakpoint
INSERT INTO "number_series" ("key", "prefix") VALUES ('sales_order', 'SO-'), ('goods_receipt', 'GR-'), ('delivery', 'DN-') ON CONFLICT DO NOTHING;
