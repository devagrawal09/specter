import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  credentialFor,
  isExpired,
  OcppCredentials,
  OcppCredentialsLive,
  readCredentials,
} from './ocpp-credentials.js'

let dir: string
let previous: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ocpp-credentials-'))
  previous = process.env.OCPP_DATA_DIR
  process.env.OCPP_DATA_DIR = dir
})

afterEach(() => {
  if (previous === undefined) delete process.env.OCPP_DATA_DIR
  else process.env.OCPP_DATA_DIR = previous
  rmSync(dir, { recursive: true, force: true })
})

const seed = () => {
  const db = new DatabaseSync(join(dir, 'ocpp-local.db'))
  db.exec('pragma journal_mode = wal')
  db.exec(`create table credential (
    id text primary key, integration_id text, label text not null, value text not null,
    connector_id text, method_id text, active integer, time_created integer not null, time_updated integer not null)`)
  const insert = db.prepare(
    'insert into credential values (?, ?, ?, ?, null, null, ?, ?, ?)',
  )
  insert.run(
    'cred_1',
    'anthropic',
    'work',
    JSON.stringify({ type: 'key', key: 'sk-test' }),
    1,
    1,
    1,
  )
  insert.run(
    'cred_2',
    'openai',
    'oauth',
    JSON.stringify({
      type: 'oauth',
      methodID: 'device',
      refresh: 'r-secret',
      access: 'a-token',
      expires: 1000,
    }),
    1,
    2,
    2,
  )
  insert.run(
    'cred_3',
    'anthropic',
    'inactive',
    JSON.stringify({ type: 'key', key: 'sk-old' }),
    0,
    0,
    0,
  )
  // Keep the writer open: -wal/-shm stay present while the reader opens read-only.
  return db
}

describe('ocpp credentials', () => {
  it('decodes active rows read-only while a WAL writer is open', () => {
    const writer = seed()
    const outcome = readCredentials(join(dir, 'ocpp-local.db'))
    writer.close()
    expect(outcome._tag).toBe('found')
    if (outcome._tag !== 'found') return
    expect(outcome.credentials).toEqual([
      {
        integrationID: 'anthropic',
        label: 'work',
        type: 'key',
        key: 'sk-test',
      },
      {
        integrationID: 'openai',
        label: 'oauth',
        type: 'oauth',
        access: 'a-token',
        expires: 1000,
        methodID: 'device',
      },
    ])
    expect(JSON.stringify(outcome)).not.toContain('r-secret')
    expect(credentialFor(outcome, 'anthropic')).toMatchObject({
      key: 'sk-test',
    })
    expect(credentialFor(outcome, 'missing')).toBeUndefined()
    const oauth = credentialFor(outcome, 'openai')
    if (!oauth) throw new Error('expected openai credential')
    expect(isExpired(oauth, 1000)).toBe(true)
    expect(isExpired(oauth, 999)).toBe(false)
  })

  it('serves the service from the env-selected file', async () => {
    seed().close()
    const key = await Effect.runPromise(
      Effect.gen(function* () {
        const credentials = yield* OcppCredentials
        return yield* credentials.find('anthropic')
      }).pipe(Effect.provide(OcppCredentialsLive)),
    )
    expect(key).toMatchObject({ type: 'key', key: 'sk-test' })
  })

  it('reports not-found for a missing file', async () => {
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* OcppCredentials).load
      }).pipe(Effect.provide(OcppCredentialsLive)),
    )
    expect(outcome).toMatchObject({ _tag: 'not-found', reason: 'no-database' })
    expect(credentialFor(outcome, 'anthropic')).toBeUndefined()
  })
})
