import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import * as schema from './schema'

const sqlitePath = './data/app.db'

mkdirSync(dirname(sqlitePath), { recursive: true })

const sqlite = new Database(sqlitePath)

export const db = drizzle(sqlite, { schema })
