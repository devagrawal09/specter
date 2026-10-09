import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  accountIDFromToken,
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

// Synthetic, unsigned JWT: header.payload.signature with a fake payload.
const jwt = (payload: unknown) =>
  [
    Buffer.from('{"alg":"none"}').toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'sig',
  ].join('.')

describe('accountIDFromToken (OC++ claim())', () => {
  it('reads the top-level chatgpt_account_id first', () => {
    expect(
      accountIDFromToken(
        jwt({
          chatgpt_account_id: 'acct_top',
          'https://api.openai.com/auth': { chatgpt_account_id: 'acct_ns' },
          organizations: [{ id: 'org_1' }],
        }),
      ),
    ).toBe('acct_top')
  })
  it('falls back to the https://api.openai.com/auth namespace', () => {
    expect(
      accountIDFromToken(
        jwt({
          'https://api.openai.com/auth': {
            chatgpt_account_id: 'acct_ns',
            chatgpt_plan_type: 'prolite',
          },
          organizations: [{ id: 'org_1' }],
        }),
      ),
    ).toBe('acct_ns')
  })
  it('falls back to organizations[0].id', () => {
    expect(
      accountIDFromToken(
        jwt({ organizations: [{ id: 'org_1' }, { id: 'o2' }] }),
      ),
    ).toBe('org_1')
  })
  it('is undefined with no claim or an undecodable token', () => {
    expect(accountIDFromToken(jwt({ sub: 'user' }))).toBeUndefined()
    expect(accountIDFromToken(jwt({ organizations: [] }))).toBeUndefined()
    expect(accountIDFromToken(jwt('text'))).toBeUndefined()
    expect(accountIDFromToken('opaque-token')).toBeUndefined()
    expect(accountIDFromToken('a.%%%.c')).toBeUndefined()
  })

  it('prefers the token claim over metadata and falls back to metadata', () => {
    const writer = seed()
    const insert = writer.prepare(
      'insert into credential values (?, ?, ?, ?, null, null, ?, ?, ?)',
    )
    const oauth = (access: string, metadata: unknown) =>
      JSON.stringify({
        type: 'oauth',
        methodID: 'chatgpt-browser',
        refresh: 'r',
        access,
        expires: 5000,
        metadata,
      })
    insert.run(
      'cred_4',
      'jwt',
      'a',
      oauth(jwt({ chatgpt_account_id: 'acct_jwt' }), {
        accountID: 'acct_meta',
      }),
      1,
      4,
      4,
    )
    insert.run(
      'cred_5',
      'meta',
      'b',
      oauth('opaque', { accountID: 'acct_meta' }),
      1,
      5,
      5,
    )
    const outcome = readCredentials(join(dir, 'ocpp-local.db'))
    writer.close()
    expect(credentialFor(outcome, 'jwt')).toMatchObject({
      accountID: 'acct_jwt',
    })
    expect(credentialFor(outcome, 'meta')).toMatchObject({
      accountID: 'acct_meta',
    })
  })
})
