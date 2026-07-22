import type { SliceStoreService } from '@specter-ts/core'
import { Context } from 'effect'

import type { SqliteDb } from './specter-sqlite'

export const sqliteSliceStore = Context.Service<
  SliceStoreService<SqliteDb, SqliteDb, unknown>
>('@specter/reference/SqliteSliceStore')
