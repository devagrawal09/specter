import { createClient } from '@libsql/client'
import {
  CommandRejection,
  createEventDefinition,
  EventLog,
  implementCommand,
  implementQuery,
  implementReaction,
  type SliceStoreService,
} from '@specter-ts/core'
import { makeSpecterRuntime } from '@specter-ts/core/effect'
import {
  createCommandSlice,
  createQuerySlice,
  createReactionSlice,
  event,
} from '@specter-ts/spec'
import { Context, Effect, Layer, type Scope } from 'effect'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createSqliteDatabaseContext } from './database'
import { createSqliteEventLogService } from './event-log'
import { prepareSpecterSqlite } from './persistence'
import { createSqliteSliceStoreService } from './slice-store'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function database() {
  const directory = mkdtempSync(join(tmpdir(), 'specter-sqlite-purge-'))
  directories.push(directory)
  return Effect.gen(function* () {
    const client = createClient({ url: `file:${join(directory, 'app.db')}` })
    yield* Effect.addFinalizer(() => Effect.sync(() => client.close()))
    const context = createSqliteDatabaseContext(client)
    yield* prepareSpecterSqlite(context)
    return context
  })
}

function schema<T>() {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'specter-sqlite-purge-test',
      validate: (value: unknown) => ({ value: value as T }),
    },
  }
}

type Account = { readonly account: string }
type Note = Account & { readonly note: string }

const byAccount = { keys: { account: (payload: Account) => payload.account } }
const accountOpened = createEventDefinition(
  'account-opened',
  schema<Account>(),
  byAccount,
)
const accountNoted = createEventDefinition(
  'account-noted',
  schema<Note>(),
  byAccount,
)
// The tombstone: a closed account's ID is never opened again.
const accountClosed = createEventDefinition(
  'account-closed',
  schema<Account>(),
  byAccount,
)

type Accounts = { accounts: Record<string, 'open' | 'closed'> }
class AccountsStore extends Context.Service<
  AccountsStore,
  SliceStoreService<Readonly<Accounts>, Accounts>
>()('specter-sqlite-purge-test/AccountsStore') {}

const applyOpened = async (
  opened: { readonly payload: Account },
  state: Accounts,
) => {
  state.accounts[opened.payload.account] = 'open'
}
// A closed account is forgotten but for its tombstone.
const applyClosed = async (
  closed: { readonly payload: Account },
  state: Accounts,
) => {
  state.accounts[closed.payload.account] = 'closed'
}

const requireOpen = (state: Readonly<Accounts>, account: string) => {
  const status = state.accounts[account]
  if (status === 'closed')
    throw new CommandRejection('account-closed', 'Account closed')
  if (!status) throw new CommandRejection('account-unknown', 'Account unknown')
}

const openAccount = implementCommand(
  createCommandSlice('openAccount')
    .description('Opens an account, never one that was closed.')
    .scenarios(
      {
        description: 'Opens a new account.',
        given: [],
        when: { account: 'a' },
        expect: [event('account-opened', { account: 'a' })],
      },
      {
        description:
          'Refuses a closed account, whose tombstone is all that is left.',
        given: [event('account-closed', { account: 'a' })],
        when: { account: 'a' },
        expect: [],
        reject: { code: 'account-closed' },
      },
      {
        description: 'Refuses an open account.',
        given: [event('account-opened', { account: 'a' })],
        when: { account: 'a' },
        expect: [],
        reject: { code: 'account-open' },
      },
    ),
)
  .inputSchema<Account>()
  .store(AccountsStore)
  .consistencyKeys({ account: (command) => command.account })
  .apply(accountOpened, applyOpened)
  .apply(accountClosed, applyClosed)
  .handle(async (command, state) => {
    if (state.accounts[command.account] === 'closed')
      throw new CommandRejection('account-closed', 'Account closed')
    if (state.accounts[command.account])
      throw new CommandRejection('account-open', 'Account open')
    return [accountOpened.create(command)]
  })

const noteAccount = implementCommand(
  createCommandSlice('noteAccount')
    .description('Notes something about an open account.')
    .scenarios(
      {
        description: 'Notes an open account.',
        given: [event('account-opened', { account: 'a' })],
        when: { account: 'a', note: 'n' },
        expect: [event('account-noted', { account: 'a', note: 'n' })],
      },
      {
        description: 'Refuses a closed account.',
        given: [event('account-closed', { account: 'a' })],
        when: { account: 'a', note: 'n' },
        expect: [],
        reject: { code: 'account-closed' },
      },
      {
        description: 'Refuses an unknown account.',
        given: [],
        when: { account: 'a', note: 'n' },
        expect: [],
        reject: { code: 'account-unknown' },
      },
    ),
)
  .inputSchema<Note>()
  .store(AccountsStore)
  .consistencyKeys({ account: (command) => command.account })
  .apply(accountOpened, applyOpened)
  .apply(accountClosed, applyClosed)
  .handle(async (command, state) => {
    requireOpen(state, command.account)
    return [accountNoted.create(command)]
  })

const closeAccount = implementCommand(
  createCommandSlice('closeAccount')
    .description('Closes an open account.')
    .scenarios(
      {
        description: 'Closes an open account.',
        given: [event('account-opened', { account: 'a' })],
        when: { account: 'a' },
        expect: [event('account-closed', { account: 'a' })],
      },
      {
        description: 'Refuses a closed account.',
        given: [event('account-closed', { account: 'a' })],
        when: { account: 'a' },
        expect: [],
        reject: { code: 'account-closed' },
      },
      {
        description: 'Refuses an unknown account.',
        given: [],
        when: { account: 'a' },
        expect: [],
        reject: { code: 'account-unknown' },
      },
    ),
)
  .inputSchema<Account>()
  .store(AccountsStore)
  .consistencyKeys({ account: (command) => command.account })
  .apply(accountOpened, applyOpened)
  .apply(accountClosed, applyClosed)
  .handle(async (command, state) => {
    requireOpen(state, command.account)
    return [accountClosed.create(command)]
  })

type Notes = {
  notes: Record<string, string[]>
  closed: Record<string, true>
}
class NotesStore extends Context.Service<
  NotesStore,
  SliceStoreService<Readonly<Notes>, Notes>
>()('specter-sqlite-purge-test/NotesStore') {}

const accountNotes = implementQuery(
  createQuerySlice('accountNotes')
    .description("Lists each open account's notes and the closed accounts.")
    .scenarios(
      {
        description: 'Lists the notes of an open account.',
        given: [
          event('account-opened', { account: 'a' }),
          event('account-noted', { account: 'a', note: 'n' }),
        ],
        when: {},
        expect: { notes: { a: ['n'] }, closed: [] },
      },
      {
        description: 'Forgets a closed account but its tombstone.',
        given: [
          event('account-opened', { account: 'a' }),
          event('account-noted', { account: 'a', note: 'n' }),
          event('account-closed', { account: 'a' }),
        ],
        when: {},
        expect: { notes: {}, closed: ['a'] },
      },
    ),
)
  .inputSchema<Record<string, never>>()
  .outputSchema<{
    readonly notes: Readonly<Record<string, readonly string[]>>
    readonly closed: readonly string[]
  }>()
  .store(NotesStore)
  .apply(accountOpened, async (opened, state) => {
    state.notes[opened.payload.account] = []
  })
  .apply(accountNoted, async (noted, state) => {
    state.notes[noted.payload.account]?.push(noted.payload.note)
  })
  .apply(accountClosed, async (closed, state) => {
    delete state.notes[closed.payload.account]
    state.closed[closed.payload.account] = true
  })
  .handle(async (_query, state) => ({
    notes: state.notes,
    closed: Object.keys(state.closed).sort(),
  }))

type Latest = { latest: Record<string, string> }
class LatestStore extends Context.Service<
  LatestStore,
  SliceStoreService<Readonly<Latest>, Latest>
>()('specter-sqlite-purge-test/LatestStore') {}

const announced: string[] = []
const announceNote = implementReaction(
  createReactionSlice('announceNote')
    .description("Announces each account's latest note.")
    .scenarios({
      description: 'Announces a note.',
      given: [event('account-noted', { account: 'a', note: 'n' })],
      expect: ['a:n'],
    }),
)
  .outputSchema<string>()
  .plugin(() =>
    Effect.succeed((note: string, context) =>
      Effect.sync(() => {
        announced.push(`${context.deliveryId} ${note}`)
      }),
    ),
  )
  .store(LatestStore)
  .apply(accountNoted, async (noted, state) => {
    state.latest[noted.payload.account] = noted.payload.note
  })
  .handleEachKey('account', async (state, account) =>
    state.latest[account] === undefined
      ? undefined
      : `${account}:${state.latest[account]}`,
  )

const config = {
  events: [accountOpened, accountNoted, accountClosed],
  slices: {
    openAccount,
    noteAccount,
    closeAccount,
    accountNotes,
    announceNote,
  },
}

const run = <A, E>(program: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(program))

describe('A purge, as the runtime sees it', () => {
  it('leaves every key but the purged one as it was, and the purged one as its tombstones give it', () =>
    run(
      Effect.gen(function* () {
        announced.length = 0
        const log = yield* database()
        const states = yield* database()
        const eventLog = createSqliteEventLogService(log)
        const stores = (context: typeof states) =>
          Layer.mergeAll(
            Layer.succeed(EventLog, eventLog),
            Layer.succeed(
              AccountsStore,
              createSqliteSliceStoreService(context, () => ({ accounts: {} })),
            ),
            Layer.succeed(
              NotesStore,
              createSqliteSliceStoreService(context, () => ({
                notes: {},
                closed: {},
              })),
            ),
            Layer.succeed(
              LatestStore,
              createSqliteSliceStoreService(context, () => ({ latest: {} })),
            ),
          )
        const app = yield* makeSpecterRuntime(config, {
          requires: { purge: true },
        }).pipe(Effect.provide(stores(states)))
        const command = (
          envelope: Parameters<typeof app.command>[0],
        ): Effect.Effect<unknown, unknown> =>
          app
            .command(envelope)
            .pipe(Effect.flatMap((execution) => execution.reactions))
        for (const account of ['a', 'b'])
          yield* command({ type: 'openAccount', payload: { account } })
        yield* command({
          type: 'noteAccount',
          payload: { account: 'a', note: 'a1' },
        })
        yield* command({
          type: 'noteAccount',
          payload: { account: 'b', note: 'b1' },
        })
        yield* command({
          type: 'noteAccount',
          payload: { account: 'a', note: 'a2' },
        })
        yield* command({ type: 'closeAccount', payload: { account: 'a' } })
        const before = yield* app.query({ type: 'accountNotes', payload: {} })
        const version = yield* eventLog.currentVersion

        const purged = yield* eventLog.purge(
          { name: 'account', value: 'a' },
          { keep: ['account-closed'] },
        )
        expect(purged).toEqual({ purged: 3 })
        expect(yield* eventLog.currentVersion).toBe(version)
        expect(
          (yield* eventLog.readKey({ name: 'account', value: 'a' })).map(
            (event) => event.type,
          ),
        ).toEqual(['account-closed'])

        // What the Reaction delivered before the purge.
        expect(announced).toEqual([
          'announceNote:3:a a:a1',
          'announceNote:4:b b:b1',
          'announceNote:5:a a:a2',
        ])

        // The State folded before the purge is the State a fold of what it
        // left reaches: a fresh runtime's, whose Reaction delivers only what
        // the purge left.
        const fresh = yield* makeSpecterRuntime(config).pipe(
          Effect.provide(stores(yield* database())),
        )
        const refolded = yield* fresh.query({
          type: 'accountNotes',
          payload: {},
        })
        expect(before).toEqual({ notes: { b: ['b1'] }, closed: ['a'] })
        expect(yield* app.query({ type: 'accountNotes', payload: {} })).toEqual(
          before,
        )
        expect(refolded).toEqual(before)
        expect(announced.slice(3)).toEqual(['announceNote:4:b b:b1'])
        // The tombstone still refuses the closed account's ID.
        for (const runtime of [app, fresh]) {
          const reopened = yield* Effect.flip(
            runtime.command({ type: 'openAccount', payload: { account: 'a' } }),
          )
          expect(reopened).toMatchObject({
            rejection: { code: 'account-closed' },
          })
        }

        // The Reaction's cursor stays: nothing it delivered is delivered
        // again, and what comes after takes an order above every order the
        // log assigned and is delivered once.
        yield* command({
          type: 'noteAccount',
          payload: { account: 'b', note: 'b2' },
        })
        expect(announced.slice(4)).toEqual([
          `announceNote:${version + 1}:b b:b2`,
        ])
      }),
    ))
})
