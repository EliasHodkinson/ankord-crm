ALTER TABLE "leads" ADD COLUMN "sp_drive_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "sp_item_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "sp_web_url" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "sp_lead_folder" text DEFAULT 'Leads';