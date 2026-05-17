import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import type * as schema from '../../../db/schema'
import type { TodoEvent } from './todo-events'

export type StoredTodoEvent = TodoEvent & {
  id: number
}

export type TodoStore = Pick<
  BetterSQLite3Database<typeof schema>,
  'insert' | 'select' | 'update'
>
