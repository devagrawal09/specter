import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { createClient } from '@libsql/client/sqlite3'
import { drizzle } from 'drizzle-orm/libsql'

import * as schema from './schema'

const sqlitePath = './data/app.db'

mkdirSync(dirname(sqlitePath), { recursive: true })

const sqlite = createClient({ url: `file:${sqlitePath}` })

export const db = drizzle(sqlite, { schema })
