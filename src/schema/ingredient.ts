import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

export const ingredient = pgTable('ingredient', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
