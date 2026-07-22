# `@specter-ts/sqlite-node`

Native `node:sqlite` persistence bundle for Specter 0.4.

```ts
import {
  createSpecterNodeSqliteLayer,
  SpecterNodeSqlite,
} from '@specter-ts/sqlite-node'
import { Effect } from 'effect'

const PersistenceLive = createSpecterNodeSqliteLayer({
  filename: './data/app.db',
})

const program = Effect.gen(function* () {
  const persistence = yield* SpecterNodeSqlite
  return persistence.eventLog.currentVersion()
}).pipe(Effect.provide(PersistenceLive), Effect.scoped)
```

Bundle owns `DatabaseSync`, Event Log, durable Slice Stores, schema preparation,
WAL/busy timeout, and shutdown. Core runs Reactions from Event Log commits.
Use `openSpecterNodeSqlite` for Promise-based applications and pass its
`close` method as `SpecterAppConfig.dispose`.
