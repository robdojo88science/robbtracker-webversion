import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const accessAttempts = sqliteTable('access_attempts', {
  ipHash: text('ip_hash').primaryKey(),
  windowStartedAt: integer('window_started_at').notNull(),
  attempts: integer('attempts').notNull(),
});