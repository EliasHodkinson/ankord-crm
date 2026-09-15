CREATE TYPE "public"."role_source" AS ENUM('entra', 'manual');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role_source" "role_source" DEFAULT 'manual' NOT NULL;