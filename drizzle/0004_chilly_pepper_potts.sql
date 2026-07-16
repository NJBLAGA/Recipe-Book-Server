CREATE TABLE "community_post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"recipe_id" uuid,
	"comment" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_post" ADD CONSTRAINT "community_post_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_post" ADD CONSTRAINT "community_post_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE set null ON UPDATE no action;