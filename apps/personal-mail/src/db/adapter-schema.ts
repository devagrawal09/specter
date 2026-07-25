import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const gmailCredentials = sqliteTable('gmail_credentials', {
  account: text('account').primaryKey(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  expiresAt: integer('expires_at').notNull(),
  email: text('email'),
})

export const gmailSyncState = sqliteTable('gmail_sync_state', {
  account: text('account').primaryKey(),
  historyId: text('history_id'),
  lastSyncedAt: text('last_synced_at'),
})

export const gmailOauthStates = sqliteTable('gmail_oauth_states', {
  state: text('state').primaryKey(),
  expiresAt: integer('expires_at').notNull(),
})

export const gmailActionAttempts = sqliteTable('gmail_action_attempts', {
  deliveryId: text('delivery_id').primaryKey(),
  actionId: text('action_id').notNull(),
  threadId: text('thread_id').notNull(),
  action: text('action').notNull(),
  status: text('status').notNull(),
  error: text('error'),
  updatedAt: text('updated_at').notNull(),
})
