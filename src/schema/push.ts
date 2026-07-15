import { pgTable, uuid, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { user } from './auth';

export const timerStatusEnum = pgEnum('timer_status', ['PENDING', 'FIRED', 'CANCELLED']);

export const pushSubscription = pgTable('push_subscription', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pushTimer = pgTable('push_timer', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  label: text('label').notNull().default('Timer'),
  fireAt: timestamp('fire_at', { withTimezone: true }).notNull(),
  status: timerStatusEnum('status').notNull().default('PENDING'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
