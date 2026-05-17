import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import * as schema from '../../../db/schema'
import type { Event } from '.'

export function createTestDb() {
  const sqlite = new Database(':memory:')

  sqlite.exec(`
    CREATE TABLE events (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      type text NOT NULL,
      payload text NOT NULL,
      created_at integer NOT NULL
    );

    CREATE TABLE todo_completion_states (
      todo_id text PRIMARY KEY NOT NULL,
      completed integer DEFAULT false NOT NULL,
      removed integer DEFAULT false NOT NULL,
      last_applied_event_id integer NOT NULL
    );

    CREATE TABLE todo_removal_states (
      todo_id text PRIMARY KEY NOT NULL,
      removed integer DEFAULT false NOT NULL,
      last_applied_event_id integer NOT NULL
    );

    CREATE TABLE todo_list_items (
      id text PRIMARY KEY NOT NULL,
      title text NOT NULL,
      completed integer DEFAULT false NOT NULL,
      removed integer DEFAULT false,
      last_applied_event_id integer NOT NULL
    );

    CREATE TABLE todo_cheer_milestone_states (
      milestone integer PRIMARY KEY NOT NULL,
      last_applied_event_id integer NOT NULL
    );

    CREATE TABLE todo_cheers (
      milestone integer PRIMARY KEY NOT NULL,
      message text NOT NULL,
      last_applied_event_id integer NOT NULL
    );
  `)

  return { db: drizzle(sqlite, { schema }), sqlite }
}

export function storedEvent<T extends Event>(
  event: T,
  id: number,
): T & {
  id: number
} {
  return { ...event, id }
}
