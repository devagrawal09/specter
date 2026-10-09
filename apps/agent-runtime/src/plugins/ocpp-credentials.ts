import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Credential } from '@ocpp/schema/credential'
import { Context, Effect, Layer, Schema } from 'effect'

// Core-free, provider-agnostic reader for the credentials OC++ already stored.
// It opens OC++'s SQLite file read-only, decodes `credential.value` through
// @ocpp/schema, and never refreshes tokens. `refresh` is dropped at decode and
// never leaves this module. Error text carries no secret values.

export type OcppCredential =
  | {
      readonly integrationID: string
      readonly label: string
      readonly type: 'key'
      readonly key: string
    }
  | {
      readonly integrationID: string
      readonly label: string
      readonly type: 'oauth'
      readonly access: string
      // Epoch milliseconds, as OC++ core compares it (integration.ts: `expires > now + 5min`).
      readonly expires: number
      readonly methodID: string
      // From the access token's JWT claims, else metadata.accountID.
      readonly accountID?: string
    }

export type CredentialsOutcome =
  | {
      readonly _tag: 'found'
      readonly path: string
      readonly credentials: readonly OcppCredential[]
    }
  | {
      readonly _tag: 'not-found'
      readonly path: string
      readonly reason: 'no-database' | 'unreadable'
    }

// Same roots as @ocpp/util global-roots.ts: XDG_DATA_HOME or ~/.local/share,
// then `ocpp`. OCPP_DATA_DIR overrides the directory.
export const ocppDatabasePath = (
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const dir =
    env.OCPP_DATA_DIR ||
    join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'ocpp')
  return join(dir, 'ocpp-local.db')
}

export const isExpired = (credential: OcppCredential, now: number): boolean =>
  credential.type === 'oauth' && credential.expires <= now

const decodeValue = Schema.decodeUnknownSync(Credential.Value)

const asObject = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

// ChatGPT account id from the access token's JWT payload, as OC++'s claim()
// derives it: chatgpt_account_id, then the "https://api.openai.com/auth"
// namespace's chatgpt_account_id, then organizations[0].id. The token is
// decoded, not verified (the backend verifies it). Neither the token nor the
// payload is logged or returned; only the id leaves.
export const accountIDFromToken = (access: string): string | undefined => {
  const part = access.split('.')[1]
  if (!part) return undefined
  try {
    const claims = asObject(
      JSON.parse(Buffer.from(part, 'base64url').toString('utf8')),
    )
    if (!claims) return undefined
    const organizations = claims.organizations
    return (
      nonEmptyString(claims.chatgpt_account_id) ??
      nonEmptyString(
        asObject(claims['https://api.openai.com/auth'])?.chatgpt_account_id,
      ) ??
      nonEmptyString(
        asObject(Array.isArray(organizations) ? organizations[0] : undefined)
          ?.id,
      )
    )
  } catch {
    return undefined
  }
}

type Row = { integration_id: string | null; label: string; value: string }

export const readCredentials = (path: string): CredentialsOutcome => {
  if (!existsSync(path))
    return { _tag: 'not-found', path, reason: 'no-database' }
  try {
    // readOnly keeps this reader from ever writing OC++'s database. WAL is fine:
    // the -wal/-shm files are read in place and committed frames are visible.
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      const rows = db
        .prepare(
          'select integration_id, label, value from credential where active = 1 order by time_created',
        )
        .all() as Row[]
      const credentials: OcppCredential[] = []
      for (const row of rows) {
        if (!row.integration_id) continue
        let value: Credential.Value
        try {
          value = decodeValue(JSON.parse(row.value))
        } catch {
          // Skip an undecodable row without echoing its contents.
          continue
        }
        const accountID =
          value.type === 'oauth'
            ? (accountIDFromToken(value.access) ??
              (typeof value.metadata?.accountID === 'string'
                ? value.metadata.accountID
                : undefined))
            : undefined
        credentials.push(
          value.type === 'key'
            ? {
                integrationID: row.integration_id,
                label: row.label,
                type: 'key',
                key: value.key,
              }
            : {
                integrationID: row.integration_id,
                label: row.label,
                type: 'oauth',
                access: value.access,
                expires: value.expires,
                methodID: value.methodID,
                ...(accountID === undefined ? {} : { accountID }),
              },
        )
      }
      return { _tag: 'found', path, credentials }
    } finally {
      db.close()
    }
  } catch {
    return { _tag: 'not-found', path, reason: 'unreadable' }
  }
}

// First active credential for an integration (oldest first, as queried).
export const credentialFor = (
  outcome: CredentialsOutcome,
  integrationID: string,
): OcppCredential | undefined =>
  outcome._tag === 'found'
    ? outcome.credentials.find(
        (credential) => credential.integrationID === integrationID,
      )
    : undefined

export class OcppCredentials extends Context.Service<
  OcppCredentials,
  {
    // Lazy: the database is read on first use and cached for the process.
    readonly load: Effect.Effect<CredentialsOutcome>
    readonly find: (
      integrationID: string,
    ) => Effect.Effect<OcppCredential | undefined>
  }
>()('@specter/agent-runtime/OcppCredentials') {}

export const OcppCredentialsLive = Layer.sync(OcppCredentials, () => {
  let cached: CredentialsOutcome | undefined
  const load = Effect.sync(
    () => (cached ??= readCredentials(ocppDatabasePath())),
  )
  return {
    load,
    find: (integrationID) =>
      Effect.map(load, (outcome) => credentialFor(outcome, integrationID)),
  }
})
