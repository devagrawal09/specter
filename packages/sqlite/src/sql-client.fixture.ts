import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

import { Effect, Semaphore, Stream } from 'effect'
import { Reactivity } from 'effect/reactivity'
import { SqlClient, Statement } from 'effect/sql'
import type { Connection } from 'effect/sql/SqlConnection'
import { SqlError, UnknownError } from 'effect/sql/SqlError'

/**
 * An Effect `SqlClient` over one `node:sqlite` connection, as a host builds
 * one over its own driver (Bun's sqlite, a Durable Object's storage): one
 * connection shared through a semaphore, whose transactions the client
 * tracks, so statements inside one run on it.
 */
export function makeNodeSqlClient(filename: string) {
  return Effect.gen(function* () {
    const database = new DatabaseSync(filename)
    yield* Effect.addFinalizer(() => Effect.sync(() => database.close()))
    database.exec('PRAGMA busy_timeout = 5000')
    const failure = (cause: unknown) =>
      new SqlError({
        reason: new UnknownError({
          cause,
          message: 'Failed to execute statement',
          operation: 'execute',
        }),
      })
    const run = (sql: string, params: ReadonlyArray<unknown> = []) =>
      Effect.try({
        try: () =>
          database.prepare(sql).all(...(params as SQLInputValue[])) as Record<
            string,
            unknown
          >[],
        catch: failure,
      })
    const values = (sql: string, params: ReadonlyArray<unknown> = []) =>
      Effect.map(run(sql, params), (rows) => rows.map(Object.values))
    const connection: Connection = {
      execute: (sql, params, transformRows) =>
        transformRows
          ? Effect.map(run(sql, params), transformRows)
          : run(sql, params),
      executeRaw: run,
      executeValues: values,
      executeValuesUnprepared: values,
      executeUnprepared: (sql, params, transformRows) =>
        transformRows
          ? Effect.map(run(sql, params), transformRows)
          : run(sql, params),
      executeStream: () => Stream.die('executeStream is not implemented'),
    }
    const semaphore = yield* Semaphore.make(1)
    const acquirers = SqlClient.makeSqliteAcquirers({
      connection: Effect.succeed(connection),
      semaphore,
    })
    return yield* SqlClient.make({
      acquirer: acquirers.acquirer,
      transactionAcquirer: acquirers.transactionAcquirer,
      onCommitFailure: acquirers.onCommitFailure,
      compiler: Statement.makeCompilerSqlite(),
      spanAttributes: [['db.system.name', 'sqlite']],
    }).pipe(Effect.provide(Reactivity.layer))
  })
}
