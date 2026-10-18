CREATE TABLE "xero_import_skips" (
	"kind" text NOT NULL,
	"xero_id" text NOT NULL,
	"name" text,
	"skipped_by_id" uuid,
	"skipped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xero_import_skips_kind_xero_id_pk" PRIMARY KEY("kind","xero_id")
);
--> statement-breakpoint
CREATE TABLE "xero_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"xero_payment_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"date" date,
	"amount" numeric(14, 2) NOT NULL,
	"reference" text,
	"account_code" text,
	"status" text,
	"pulled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "xero_import_skips" ADD CONSTRAINT "xero_import_skips_skipped_by_id_users_id_fk" FOREIGN KEY ("skipped_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xero_payments" ADD CONSTRAINT "xero_payments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "xero_payments_xero_idx" ON "xero_payments" USING btree ("xero_payment_id");--> statement-breakpoint
CREATE INDEX "xero_payments_document_idx" ON "xero_payments" USING btree ("document_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "items_xero_idx" ON "items" USING btree ("xero_item_id") WHERE "items"."xero_item_id" is not null;