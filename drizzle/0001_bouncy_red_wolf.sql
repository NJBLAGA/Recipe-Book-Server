CREATE TYPE "public"."cook_status" AS ENUM('IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "recipe_cook" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"recipe_id" uuid,
	"status" "cook_status" DEFAULT 'IN_PROGRESS' NOT NULL,
	"pending_changes" jsonb,
	"note" text,
	"cooked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_cook_image" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_cook_id" uuid NOT NULL,
	"url" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "theme" text;--> statement-breakpoint
ALTER TABLE "recipe_cook" ADD CONSTRAINT "recipe_cook_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_cook" ADD CONSTRAINT "recipe_cook_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_cook_image" ADD CONSTRAINT "recipe_cook_image_recipe_cook_id_recipe_cook_id_fk" FOREIGN KEY ("recipe_cook_id") REFERENCES "public"."recipe_cook"("id") ON DELETE cascade ON UPDATE no action;