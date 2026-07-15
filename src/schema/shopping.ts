import { pgTable, uuid, text, timestamp, numeric, boolean, pgEnum, unique } from 'drizzle-orm/pg-core';
import { household } from './household';
import { ingredient } from './ingredient';

export const itemSourceEnum = pgEnum('item_source', ['RECIPE', 'PANTRY', 'DIRECT']);

export const shoppingList = pgTable('shopping_list', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().unique().references(() => household.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const shoppingListCategory = pgTable('shopping_list_category', {
  id: uuid('id').primaryKey().defaultRandom(),
  shoppingListId: uuid('shopping_list_id').notNull().references(() => shoppingList.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('shopping_list_category_name_unique').on(t.shoppingListId, t.name),
]);

export const shoppingListItem = pgTable('shopping_list_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  shoppingListId: uuid('shopping_list_id').notNull().references(() => shoppingList.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').references(() => shoppingListCategory.id, { onDelete: 'set null' }),
  ingredientId: uuid('ingredient_id').references(() => ingredient.id),
  name: text('name').notNull(),
  quantity: numeric('quantity'),
  unit: text('unit'),
  isChecked: boolean('is_checked').notNull().default(false),
  source: itemSourceEnum('source'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
