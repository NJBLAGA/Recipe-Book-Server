import { pgTable, uuid, text, timestamp, smallint, integer, jsonb, pgEnum, check, primaryKey, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';
import { recipe } from './recipe';

export const shareStatusEnum = pgEnum('share_status', ['PENDING', 'ACCEPTED', 'REJECTED', 'REQUESTED']);
export const notificationTypeEnum = pgEnum('notification_type', ['RECIPE_SHARED', 'HOUSEHOLD_INVITE', 'JOIN_REQUEST']);

export const recipeShare = pgTable('recipe_share', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipeId: uuid('recipe_id').references(() => recipe.id, { onDelete: 'set null' }),
  fromUserId: text('from_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  toUserId: text('to_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  status: shareStatusEnum('status').notNull().default('PENDING'),
  copiedRecipeId: uuid('copied_recipe_id').references(() => recipe.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const review = pgTable('review', {
  id: uuid('id').primaryKey().defaultRandom(),
  shareId: uuid('share_id').notNull().unique().references(() => recipeShare.id, { onDelete: 'cascade' }),
  rating: smallint('rating').notNull(),
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('rating_range_check', sql`${t.rating} >= 1 AND ${t.rating} <= 5`),
]);

export const follow = pgTable('follow', {
  followerId: text('follower_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  followingId: text('following_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.followerId, t.followingId] }),
  check('no_self_follow', sql`${t.followerId} <> ${t.followingId}`),
]);

export const userPinnedRecipe = pgTable('user_pinned_recipe', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  recipeId: uuid('recipe_id').references(() => recipe.id, { onDelete: 'set null' }),
  position: integer('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.position] }),
  unique('user_pinned_recipe_unique').on(t.userId, t.recipeId),
  check('position_range_check', sql`${t.position} BETWEEN 1 AND 5`),
]);

export const communityPost = pgTable('community_post', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  recipeId: uuid('recipe_id').references(() => recipe.id, { onDelete: 'set null' }),
  comment: text('comment').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notification = pgTable('notification', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  type: notificationTypeEnum('type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
