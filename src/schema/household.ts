import { pgTable, text, uuid, timestamp, pgEnum, uniqueIndex, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';

export const householdRoleEnum = pgEnum('household_role', ['OWNER', 'USER']);
export const joinTypeEnum = pgEnum('join_type', ['INVITE', 'REQUEST']);
export const requestStatusEnum = pgEnum('request_status', ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED']);

export const household = pgTable('household', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const householdUser = pgTable('household_user', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => household.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  role: householdRoleEnum('role').notNull(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('one_owner_per_household').on(t.householdId).where(sql`${t.role} = 'OWNER'`),
]);

export const householdJoinRequest = pgTable('household_join_request', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => household.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  initiatedByUserId: text('initiated_by_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  type: joinTypeEnum('type').notNull(),
  status: requestStatusEnum('status').notNull().default('PENDING'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
