import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const events = sqliteTable(
  'events',
  {
    order: integer('order').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    type: text('type').notNull(),
    payload: text('payload').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [index('events_order_idx').on(table.order)],
)

export const sliceCursors = sqliteTable('slice_cursors', {
  sliceName: text('slice_name').primaryKey(),
  lastAppliedOrder: integer('last_applied_order').notNull(),
})

export const eventCommits = sqliteTable('specter_event_commits', {
  commitVersion: integer('commit_version').primaryKey(),
  idempotencyKey: text('idempotency_key').unique(),
  fingerprint: text('fingerprint'),
  firstEventOrder: integer('first_event_order').notNull(),
  lastEventOrder: integer('last_event_order').notNull(),
  committedAt: text('committed_at').notNull(),
})
