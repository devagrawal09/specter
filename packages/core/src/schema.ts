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
