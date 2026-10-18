CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'scheduled', 'sending', 'testing', 'paused', 'sent', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."recipient_status" AS ENUM('queued', 'held', 'sending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "audience_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"rule" jsonb NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"link_id" uuid,
	"user_agent" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid,
	"lead_id" uuid,
	"customer_id" uuid,
	"email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"company" text,
	"job_title" text,
	"token" text NOT NULL,
	"variant" text,
	"status" "recipient_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"first_opened_at" timestamp with time zone,
	"open_count" integer DEFAULT 0 NOT NULL,
	"first_clicked_at" timestamp with time zone,
	"click_count" integer DEFAULT 0 NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"bounced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"preheader" text DEFAULT '' NOT NULL,
	"from_mode" text DEFAULT 'marketing' NOT NULL,
	"from_address" text,
	"reply_to" text,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"theme" jsonb,
	"audience" jsonb,
	"ab_test" jsonb,
	"ab_winner" text,
	"ab_decide_at" timestamp with time zone,
	"track_opens" boolean DEFAULT true NOT NULL,
	"track_clicks" boolean DEFAULT true NOT NULL,
	"template_id" uuid,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"send_session_id" uuid,
	"sender_id" uuid,
	"last_error" text,
	"test_sent_at" timestamp with time zone,
	"bounces_checked_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"data" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"campaign_id" uuid,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"subject" text DEFAULT '' NOT NULL,
	"preheader" text DEFAULT '' NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"theme" jsonb,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "marketing_consent" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "marketing_mailbox" text DEFAULT 'marketing@ankord.com.au';--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "marketing_footer" text DEFAULT 'Ankor''d Pty Ltd · Regional NSW, Australia
You''re receiving this because you work with, or have asked to hear from, Ankor''d.';--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "marketing_logo_url" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "marketing_social" jsonb;--> statement-breakpoint
ALTER TABLE "audience_segments" ADD CONSTRAINT "audience_segments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_events" ADD CONSTRAINT "campaign_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_events" ADD CONSTRAINT "campaign_events_recipient_id_campaign_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."campaign_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_events" ADD CONSTRAINT "campaign_events_link_id_campaign_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."campaign_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_links" ADD CONSTRAINT "campaign_links_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_send_session_id_sessions_id_fk" FOREIGN KEY ("send_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_assets" ADD CONSTRAINT "email_assets_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_events_campaign_idx" ON "campaign_events" USING btree ("campaign_id","kind","at");--> statement-breakpoint
CREATE INDEX "campaign_events_recipient_idx" ON "campaign_events" USING btree ("recipient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_links_url_idx" ON "campaign_links" USING btree ("campaign_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_token_idx" ON "campaign_recipients" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_email_idx" ON "campaign_recipients" USING btree ("campaign_id","email");--> statement-breakpoint
CREATE INDEX "campaign_recipients_status_idx" ON "campaign_recipients" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "campaign_recipients_contact_idx" ON "campaign_recipients" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_sent_idx" ON "campaign_recipients" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "campaigns_created_idx" ON "campaigns" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_templates_name_idx" ON "email_templates" USING btree ("name");