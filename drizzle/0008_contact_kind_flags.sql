DROP INDEX "customers_kind_idx";--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "is_customer" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "is_supplier" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "is_media" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "customers_customer_idx" ON "customers" USING btree ("is_customer");--> statement-breakpoint
CREATE INDEX "customers_supplier_idx" ON "customers" USING btree ("is_supplier");--> statement-breakpoint
CREATE INDEX "customers_media_idx" ON "customers" USING btree ("is_media");
--> statement-breakpoint
-- Carry the old single kind across before it is dropped in the next migration.
-- "both" meant customer AND supplier, so it sets each flag.
UPDATE "customers" SET
  "is_customer" = ("kind" IN ('customer', 'both')),
  "is_supplier" = ("kind" IN ('supplier', 'both'));
