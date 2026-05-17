import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import * as schema from '../../../db/schema'
import type { TodoEvent } from '.'

export function createTestDb() {
  const sqlite = new Database(':memory:')

  sqlite.exec(`
    CREATE TABLE todo_events (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      type text NOT NULL,
      payload text NOT NULL,
      created_at integer NOT NULL
    );

    CREATE TABLE todo_completion_states (
      todo_id text PRIMARY KEY NOT NULL,
      completed integer DEFAULT false NOT NULL,
      removed_at integer,
      last_applied_event_id integer NOT NULL
    );

    CREATE TABLE todo_removal_states (
      todo_id text PRIMARY KEY NOT NULL,
      removed_at integer,
      last_applied_event_id integer NOT NULL
    );

    CREATE TABLE todo_list_items (
      id text PRIMARY KEY NOT NULL,
      title text NOT NULL,
      completed integer DEFAULT false NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      removed_at integer,
      last_applied_event_id integer NOT NULL
    );
  `)

  return { db: drizzle(sqlite, { schema }), sqlite }
}

export function storedEvent<T extends TodoEvent>(
  event: T,
  id: number,
): T & {
  id: number
} {
  return { ...event, id }
}
