ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "is_demo_user" boolean NOT NULL DEFAULT false;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "onboarding_complete" boolean NOT NULL DEFAULT false;
ALTER TABLE "recipe" ADD COLUMN IF NOT EXISTS "prep_time" integer;
ALTER TABLE "recipe" ADD COLUMN IF NOT EXISTS "cook_time" integer;
ALTER TABLE "recipe_cook" ADD COLUMN IF NOT EXISTS "servings" integer;
