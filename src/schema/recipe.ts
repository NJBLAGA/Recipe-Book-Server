import { pgTable, uuid, text, timestamp, integer, numeric, jsonb, unique, pgEnum, AnyPgColumn } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { household } from './household';
import { ingredient } from './ingredient';

export const cookStatusEnum = pgEnum('cook_status', ['IN_PROGRESS', 'COMPLETED', 'CANCELLED']);

export const recipeBook = pgTable('recipe_book', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().unique().references(() => household.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const recipeCategory = pgTable('recipe_category', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipeBookId: uuid('recipe_book_id').notNull().references(() => recipeBook.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('recipe_category_name_unique').on(t.recipeBookId, t.name),
]);

export const recipe = pgTable('recipe', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipeBookId: uuid('recipe_book_id').notNull().references(() => recipeBook.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').references(() => recipeCategory.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description'),
  source: text('source'),
  baseServings: integer('base_servings').notNull(),
  steps: jsonb('steps').$type<{ text: string; subSteps: string[] }[]>().notNull().default([]),
  prepTime: integer('prep_time'),
  cookTime: integer('cook_time'),
  sharedByUserId: text('shared_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  originalRecipeId: uuid('original_recipe_id').references((): AnyPgColumn => recipe.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const recipeImage = pgTable('recipe_image', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipeId: uuid('recipe_id').notNull().references(() => recipe.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const recipeIngredient = pgTable('recipe_ingredient', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipeId: uuid('recipe_id').notNull().references(() => recipe.id, { onDelete: 'cascade' }),
  ingredientId: uuid('ingredient_id').notNull().references(() => ingredient.id),
  quantity: numeric('quantity'),
  unit: text('unit'),
  note: text('note'),
  sortOrder: integer('sort_order').notNull(),
});

export const recipeCook = pgTable('recipe_cook', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  recipeId: uuid('recipe_id').references(() => recipe.id, { onDelete: 'set null' }),
  status: cookStatusEnum('status').notNull().default('IN_PROGRESS'),
  pendingChanges: jsonb('pending_changes').$type<{
    ticked: string[];
    tickedSteps: number[];
    pantryChanges: { itemId: string; inStock: boolean }[];
    extraChanges: { itemId: string; inStock: boolean }[];
  }>(),
  note: text('note'),
  servings: integer('servings'),
  cookedAt: timestamp('cooked_at', { withTimezone: true }).notNull().defaultNow(),
});

export const recipeCookImage = pgTable('recipe_cook_image', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipeCookId: uuid('recipe_cook_id').notNull().references(() => recipeCook.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
