import { pgTable, uuid, text, timestamp, smallint, integer, unique, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { household } from './household';
import { ingredient } from './ingredient';

export const pantry = pgTable('pantry', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().unique().references(() => household.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pantryCategory = pgTable('pantry_category', {
  id: uuid('id').primaryKey().defaultRandom(),
  pantryId: uuid('pantry_id').notNull().references(() => pantry.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('pantry_category_name_unique').on(t.pantryId, t.name),
]);

export const pantryItem = pgTable('pantry_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  pantryId: uuid('pantry_id').notNull().references(() => pantry.id, { onDelete: 'cascade' }),
  ingredientId: uuid('ingredient_id').notNull().references(() => ingredient.id),
  categoryId: uuid('category_id').references(() => pantryCategory.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('pantry_item_ingredient_unique').on(t.pantryId, t.ingredientId),
]);

export const pantryBatch = pgTable('pantry_batch', {
  id: uuid('id').primaryKey().defaultRandom(),
  pantryItemId: uuid('pantry_item_id').notNull().references(() => pantryItem.id, { onDelete: 'cascade' }),
  fillLevel: smallint('fill_level').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('fill_level_check', sql`${t.fillLevel} IN (0, 25, 50, 75, 100)`),
]);

export const pantryItemImage = pgTable('pantry_item_image', {
  id: uuid('id').primaryKey().defaultRandom(),
  pantryItemId: uuid('pantry_item_id').notNull().references(() => pantryItem.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
