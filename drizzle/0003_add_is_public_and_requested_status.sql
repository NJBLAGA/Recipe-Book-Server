ALTER TYPE "public"."share_status" ADD VALUE 'REQUESTED';--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_public" boolean DEFAULT true NOT NULL;