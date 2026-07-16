import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

export type SliceKind = 'command' | 'query' | 'reaction'

export type GenerateSliceOptions = {
  readonly cwd: string
  readonly feature: string
  readonly force?: boolean
  readonly kind: SliceKind
  readonly name: string
  readonly rootDirectory?: string
  readonly dryRun?: boolean
}

export type GeneratePersistentHarnessOptions = {
  readonly cwd: string
  readonly directory?: string
  readonly dryRun?: boolean
  readonly force?: boolean
}

export type GenerationResult = {
  readonly files: readonly string[]
  readonly dryRun: boolean
  readonly nextSteps: readonly string[]
}

type PlannedFile = {
  readonly path: string
  readonly content: string
}

const sliceNamePattern = /^[a-z][A-Za-z0-9]*$/
const kebabNamePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

export function generateSlice(options: GenerateSliceOptions): GenerationResult {
  assertSliceName(options.name)
  assertKebabName(options.feature, 'feature')

  const rootDirectory = safeRelativeDirectory(
    options.rootDirectory ?? 'src/features',
    'root directory',
  )
  const sliceDirectory = resolve(
    options.cwd,
    rootDirectory,
    options.feature,
    toKebabCase(options.name),
  )
  const dbDirectory = resolve(options.cwd, 'src/db')
  const dbModule = relativeModuleSpecifier(sliceDirectory, dbDirectory)
  const schemaModule = relativeModuleSpecifier(
    dbDirectory,
    join(sliceDirectory, 'db-schema'),
  )
  const names = sliceTemplateNames(options.name)
  const files = sliceFiles({
    dbModule,
    directory: sliceDirectory,
    kind: options.kind,
    names,
    schemaModule,
  })

  writePlannedFiles(files, {
    cwd: options.cwd,
    dryRun: options.dryRun ?? false,
    force: options.force ?? false,
  })

  const centralSchemaExport = `export { ${names.projectionName} } from '${schemaModule}'`
  return {
    files: files.map((file) => relative(options.cwd, file.path)),
    dryRun: options.dryRun ?? false,
    nextSteps: [
      `Add ${names.registrationName} and ${names.eventDefinitionsName} from the generated registry to the ${options.feature} app registry.`,
      `Add this line to src/db/schema.ts: ${centralSchemaExport}`,
      'Run npm run db:generate, inspect the SQL migration, then run the focused scenario test.',
    ],
  }
}

export function generatePersistentHarness(
  options: GeneratePersistentHarnessOptions,
): GenerationResult {
  const directory = safeRelativeDirectory(
    options.directory ?? 'src/testing/persistence',
    'harness directory',
  )
  const targetDirectory = resolve(options.cwd, directory)
  const dbModule = relativeModuleSpecifier(
    targetDirectory,
    resolve(options.cwd, 'src/db'),
  )
  const files: PlannedFile[] = [
    {
      path: join(targetDirectory, 'persistent-harness.server.ts'),
      content: persistentHarnessTemplate(dbModule),
    },
    {
      path: join(targetDirectory, 'failure-injection.ts'),
      content: failureInjectionTemplate(),
    },
    {
      path: join(targetDirectory, 'persistent-harness.test.ts'),
      content: persistentHarnessTestTemplate(),
    },
    {
      path: join(targetDirectory, 'README.md'),
      content: persistentHarnessReadme(),
    },
  ]

  writePlannedFiles(files, {
    cwd: options.cwd,
    dryRun: options.dryRun ?? false,
    force: options.force ?? false,
  })

  return {
    files: files.map((file) => relative(options.cwd, file.path)),
    dryRun: options.dryRun ?? false,
    nextSteps: [
      'Run the generated executable recovery tests against a temporary on-disk SQLite database.',
      'Pass createApp(runtime) into the harness from project-specific tests to exercise the real app registry.',
      'Add resetProjectProjections when app-owned projection rows must be cleared before replay.',
    ],
  }
}

export function runGenerateCli(
  args: readonly string[],
  options: {
    readonly cwd?: string
    readonly write?: (message: string) => void
  } = {},
) {
  if (args[0] !== 'generate') return false

  const cwd = options.cwd ?? process.cwd()
  const write = options.write ?? ((message: string) => console.log(message))
  const subject = args[1]
  const parsed = parseFlags(args.slice(2))

  if (subject === 'help' || subject === '--help' || subject === undefined) {
    write(generateHelp())
    return true
  }

  if (subject === 'slice') {
    if (args[2] === '--help') {
      write(generateHelp())
      return true
    }
    const name = parsed.positionals[0]
    if (!name) throw new Error('Slice name is required')
    if (parsed.positionals.length > 1) {
      throw new Error(`Unexpected argument: ${parsed.positionals[1]}`)
    }

    const kind = requiredEnum(parsed.values.kind, 'kind', [
      'command',
      'query',
      'reaction',
    ])
    const feature = requiredValue(parsed.values.feature, 'feature')
    assertKnownFlags(parsed, ['dry-run', 'feature', 'force', 'kind', 'root'])

    const result = generateSlice({
      cwd,
      feature,
      force: parsed.booleans.has('force'),
      kind,
      name,
      rootDirectory: parsed.values.root,
      dryRun: parsed.booleans.has('dry-run'),
    })
    printResult(write, result)
    return true
  }

  if (subject === 'persistent-harness') {
    if (args[2] === '--help') {
      write(generateHelp())
      return true
    }
    if (parsed.positionals.length > 0) {
      throw new Error(`Unexpected argument: ${parsed.positionals[0]}`)
    }
    assertKnownFlags(parsed, ['directory', 'dry-run', 'force'])
    const result = generatePersistentHarness({
      cwd,
      directory: parsed.values.directory,
      dryRun: parsed.booleans.has('dry-run'),
      force: parsed.booleans.has('force'),
    })
    printResult(write, result)
    return true
  }

  throw new Error(`Unknown generator: ${subject}`)
}

export function generateHelp() {
  return `Specter authoring generators

Usage:
  create-specter generate slice <lowerCamelName> --kind <command|query|reaction> --feature <kebab-name> [--root <directory>] [--dry-run] [--force]
  create-specter generate persistent-harness [--directory <directory>] [--dry-run] [--force]

Examples:
  create-specter generate slice requestInvite --kind command --feature invitations --dry-run
  create-specter generate slice invitationList --kind query --feature invitations
  create-specter generate persistent-harness --directory src/testing/persistence
`
}

function sliceFiles(options: {
  dbModule: string
  directory: string
  kind: SliceKind
  names: ReturnType<typeof sliceTemplateNames>
  schemaModule: string
}): PlannedFile[] {
  const { dbModule, directory, kind, names } = options
  return [
    {
      path: join(directory, 'events.ts'),
      content: eventTemplate(names),
    },
    {
      path: join(directory, 'spec.ts'),
      content: specTemplate(kind, names),
    },
    {
      path: join(directory, 'projection.ts'),
      content: projectionTemplate(names),
    },
    {
      path: join(directory, 'impl.ts'),
      content: implementationTemplate(kind, dbModule, names),
    },
    {
      path: join(directory, 'registry.ts'),
      content: registryTemplate(names),
    },
    {
      path: join(directory, 'scenarios.test.ts'),
      content: scenarioTestTemplate(names, dbModule),
    },
    {
      path: join(directory, 'db-schema.ts'),
      content: dbSchemaTemplate(names),
    },
    {
      path: join(directory, 'MIGRATION.md'),
      content: migrationTemplate(names, options.schemaModule),
    },
  ]
}

function eventTemplate(names: ReturnType<typeof sliceTemplateNames>) {
  const catalogOneLine = `export const ${names.eventDefinitionsName} = [${names.eventName}] as const`
  const catalog =
    catalogOneLine.length <= 80
      ? catalogOneLine
      : `export const ${names.eventDefinitionsName} = [
  ${names.eventName},
] as const`
  const eventAssignmentStart = `export const ${names.eventName} = _createEventDefinition(`
  const eventAssignment =
    eventAssignmentStart.length <= 80
      ? `${eventAssignmentStart}
  '${names.eventType}',
  _schema.object({
    requestId: _schema.string().min(1),
    value: _schema.string(),
  }),
)`
      : `export const ${names.eventName} =
  _createEventDefinition(
    '${names.eventType}',
    _schema.object({
      requestId: _schema.string().min(1),
      value: _schema.string(),
    }),
  )`
  return `import { createEventDefinition as _createEventDefinition } from '@specter-ts/core'
import { z as _schema } from 'zod'

${eventAssignment}

${catalog}
`
}

function specTemplate(
  kind: SliceKind,
  names: ReturnType<typeof sliceTemplateNames>,
) {
  const factory =
    kind === 'command'
      ? '_createCommandSlice'
      : kind === 'query'
        ? '_createQuerySlice'
        : '_createReactionSlice'
  const when =
    kind === 'reaction' ? '' : "\n    when: { requestId: 'request-1' },"
  const eventExample = `_event('${names.eventType}', {
        requestId: 'request-1',
        value: 'example',
      })`
  const expectation =
    kind === 'command'
      ? `[
      ${eventExample},
    ]`
      : `[{ requestId: 'request-1', value: 'example' }]`
  const givenEventExample =
    kind === 'command'
      ? `_event('${names.eventType}', {
        requestId: 'request-0',
        value: 'existing',
      })`
      : eventExample
  const given = `[
      ${givenEventExample},
    ]`
  const declarationOneLine = `export const ${names.sliceName}Spec = ${factory}('${names.sliceName}')`
  const declaration =
    declarationOneLine.length <= 80
      ? declarationOneLine
      : `export const ${names.sliceName}Spec = ${factory}(
  '${names.sliceName}',
)`
  const descriptionOneLine = `  .description('TODO: describe ${names.sliceName} in domain language.')`
  const description =
    descriptionOneLine.length <= 80
      ? descriptionOneLine
      : `  .description(
    'TODO: describe ${names.sliceName} in domain language.',
  )`

  return `import {
  ${factory.slice(1)} as ${factory},
  event as _event,
} from '@specter-ts/core/spec'

${declaration}
${description}
  .scenarios({
    description: 'TODO: replace this tracer scenario with a domain example.',
    given: ${given},${when}
    expect: ${expectation},
  })
`
}

function projectionTemplate(names: ReturnType<typeof sliceTemplateNames>) {
  const declarationStart = `export const ${names.projectionName} = _sqliteTable('${names.tableName}', {`
  const declaration =
    declarationStart.length <= 80
      ? `${declarationStart}
  requestId: _text('request_id').primaryKey(),
  value: _text('value').notNull(),
})`
      : `export const ${names.projectionName} = _sqliteTable(
  '${names.tableName}',
  {
    requestId: _text('request_id').primaryKey(),
    value: _text('value').notNull(),
  },
)`
  return `import {
  sqliteTable as _sqliteTable,
  text as _text,
} from 'drizzle-orm/sqlite-core'

// Private Slice projection. Other Slices should consume Events, never this table.
${declaration}
`
}

function implementationTemplate(
  kind: SliceKind,
  dbModule: string,
  names: ReturnType<typeof sliceTemplateNames>,
) {
  const storeImport = `import { sqliteSliceStore as _sqliteSliceStore } from '${dbModule}/specter-sqlite'`
  const store = '_sqliteSliceStore'

  if (kind === 'command') {
    return `import { z as _schema } from 'zod'

${storeImport}
import { ${names.eventName} as _recordedEvent } from './events'
import { ${names.projectionName} as _projection } from './projection'
import { ${names.sliceName}Spec as _spec } from './spec'

export const ${names.sliceName} = _spec
  .inputSchema(_schema.object({ requestId: _schema.string().min(1) }))
  .store(${store})
  .apply(_recordedEvent, async (event, db) => {
    await db
      .insert(_projection)
      .values(event.payload)
      .onConflictDoUpdate({
        target: _projection.requestId,
        set: { value: event.payload.value },
      })
      .run()
  })
  .handle(async (command, db) => {
    // TODO: query the private projection when the decision depends on history.
    void db
    return [
      _recordedEvent.create({
        requestId: command.requestId,
        value: 'example', // TODO: derive the domain value deterministically.
      }),
    ]
  })
`
  }

  const applyBody = `await db
      .insert(_projection)
      .values(event.payload)
      .onConflictDoUpdate({
        target: _projection.requestId,
        set: { value: event.payload.value },
      })
      .run()`
  const queryBody = `const rows = await db
      .select()
      .from(_projection)
      .where(_equals(_projection.requestId, query.requestId))
      .all()
    return rows`

  if (kind === 'query') {
    return `import { eq as _equals } from 'drizzle-orm'
import { z as _schema } from 'zod'

${storeImport}
import { ${names.eventName} as _recordedEvent } from './events'
import { ${names.projectionName} as _projection } from './projection'
import { ${names.sliceName}Spec as _spec } from './spec'

export const ${names.sliceName} = _spec
  .inputSchema(_schema.object({ requestId: _schema.string().min(1) }))
  .outputSchema(
    _schema.array(
      _schema.object({ requestId: _schema.string(), value: _schema.string() }),
    ),
  )
  .store(${store})
  .apply(_recordedEvent, async (event, db) => {
    ${applyBody}
  })
  .handle(async (query, db) => {
    ${queryBody}
  })
`
  }

  const reactionQueryOneLine = `const rows = await db.select().from(_projection).limit(1).all()`
  const reactionQuery =
    reactionQueryOneLine.length + 4 <= 80
      ? reactionQueryOneLine
      : `const rows = await db
      .select()
      .from(_projection)
      .limit(1)
      .all()`
  const reactionBody = `${reactionQuery}
    return rows[0]`

  return `import { z as _schema } from 'zod'

${storeImport}
import { ${names.eventName} as _recordedEvent } from './events'
import { ${names.projectionName} as _projection } from './projection'
import { ${names.sliceName}Spec as _spec } from './spec'

export const ${names.sliceName} = _spec
  .outputSchema(
    _schema.object({ requestId: _schema.string(), value: _schema.string() }),
  )
  .plugin(async (_dispatch) => async (_effect, context) => {
    void context
    // TODO: invoke the external adapter. Reaction Plugins may return any effect type.
    // Same-app follow-ups must call _dispatch(effect, {
    //   idempotencyKey: context.deliveryId,
    // }) so an at-least-once retry cannot duplicate follow-up Events.
    // Use context.scheduledAt for retry-stable domain time; never new Date().
  })
  .store(${store})
  .apply(_recordedEvent, async (event, db) => {
    ${applyBody}
  })
  .handle(async (db) => {
    ${reactionBody}
  })
`
}

function registryTemplate(names: ReturnType<typeof sliceTemplateNames>) {
  const registrationsOneLine = `export const ${names.registrationName} = [${names.sliceName}] as const`
  const registrations =
    registrationsOneLine.length <= 80
      ? registrationsOneLine
      : `export const ${names.registrationName} = [
  ${names.sliceName},
] as const`
  return `import { ${names.sliceName} } from './impl'
import { ${names.eventDefinitionsName} } from './events'

// Merge these explicit arrays into the feature-level app registry.
${registrations}
export { ${names.eventDefinitionsName} }
`
}

function scenarioTestTemplate(
  names: ReturnType<typeof sliceTemplateNames>,
  dbModule: string,
) {
  const wrapperImport = `import { sqliteScenario } from '${dbModule}/scenario-tests'`
  const runScenario = ',\n  runScenario: sqliteScenario({})'
  const registryImportOneLine = `import { ${names.eventDefinitionsName}, ${names.registrationName} } from './registry'`
  const registryImport =
    registryImportOneLine.length <= 80
      ? registryImportOneLine
      : `import {
  ${names.eventDefinitionsName},
  ${names.registrationName},
} from './registry'`
  return `import { eventsFor, testSliceImplementations } from '@specter-ts/core/testing'

${wrapperImport}
${registryImport}

const registrations = ${names.registrationName}

testSliceImplementations(registrations, {
  events: eventsFor(registrations[0], ${names.eventDefinitionsName})${runScenario},
})
`
}

function dbSchemaTemplate(names: ReturnType<typeof sliceTemplateNames>) {
  return `// Re-export this from src/db/schema.ts so Drizzle sees the private projection.
export { ${names.projectionName} } from './projection'
`
}

function migrationTemplate(
  names: ReturnType<typeof sliceTemplateNames>,
  schemaModule: string,
) {
  return `# ${names.pascalName} persistence wiring

1. Add this export to \`src/db/schema.ts\`:

   \`export { ${names.projectionName} } from '${schemaModule}'\`

2. Run \`npm run db:generate\`.
3. Inspect the generated SQL. Do not hand-edit an already-applied migration.
4. Run \`npm test -- ${names.directoryName}/scenarios.test.ts\`.
5. Register \`${names.registrationName}\` and \`${names.eventDefinitionsName}\` in the feature app config.

The projection is private to this Slice. Add another Event consumer instead of
querying this table from a different Slice.
`
}

function persistentHarnessTemplate(dbModule: string) {
  return `import type {
  EventLogAdapter,
  EventLogAppendOptions,
  EventLogTransaction,
  ReactionScheduler,
  SliceStore,
  SliceStoreAdapter,
} from '@specter-ts/core'
import {
  createReactionOutboxWorker,
  type ReactionOutboxJob,
  type ReactionOutboxStatus,
  type ReactionOutboxWorker,
} from '@specter-ts/reaction-outbox'
import {
  createSpecterSqlitePersistence,
  prepareSpecterSqlite,
} from '@specter-ts/sqlite'
import { createClient } from '@libsql/client/sqlite3'
import { drizzle } from 'drizzle-orm/libsql/sqlite3'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as schema from '${dbModule}/schema'
import { runWithSqliteDb } from '${dbModule}/specter-sqlite'
import {
  createFailureInjector,
  type FailureInjector,
} from './failure-injection'

type ReactionPass = { readonly kind: 'reaction-pass' }

export type PersistentHarnessRuntime = {
  readonly eventLog: EventLogAdapter
  readonly failure: FailureInjector
  readonly schedule: ReactionScheduler
  createSliceStore<TWriteState, TReadState = Readonly<TWriteState>>(
    createState: () => TWriteState,
  ): SliceStoreAdapter<TWriteState, TReadState>
}

export type PersistentHarnessOptions<TApp> = {
  readonly createApp: (runtime: PersistentHarnessRuntime) => Promise<TApp>
  readonly failure?: FailureInjector
  readonly maxReactionAttempts?: number
  readonly migrationsFolder?: string
  readonly resetProjectProjections?: () => Promise<void>
}

export async function createPersistentHarness<TApp>(
  options: PersistentHarnessOptions<TApp>,
) {
  const directory = mkdtempSync(join(tmpdir(), 'specter-persistence-'))
  const databasePath = join(directory, 'app.db')
  const failure = options.failure ?? createFailureInjector()
  const backgroundErrors: unknown[] = []

  async function open() {
    const client = createClient({ url: \`file:\${databasePath}\` })
    await prepareSpecterSqlite(client)
    const db = drizzle(client, { schema })
    await migrate(db, {
      migrationsFolder:
        options.migrationsFolder ?? join(process.cwd(), 'drizzle'),
    })
    const persistence = createSpecterSqlitePersistence(client)
    const reactionStore = persistence.createReactionOutboxStore<ReactionPass>()
    let worker: ReactionOutboxWorker<ReactionPass> | undefined

    const schedule: ReactionScheduler = (run) => {
      worker = createReactionOutboxWorker({
        store: reactionStore,
        maxAttempts: options.maxReactionAttempts ?? 3,
        backoffMs: () => 0,
        handle: async (_pass, context) => {
          await run({
            deliveryId: context.jobId,
            scheduledAt: context.requestedAt.toISOString(),
            attemptId: context.attemptId,
            attemptNumber: context.attemptNumber,
          })
          failure.hit('after-reaction-attempt')
        },
      })

      void worker.drain().catch((cause) => backgroundErrors.push(cause))

      return () => {
        const completion = worker
          ?.enqueue({ kind: 'reaction-pass' })
          .then(() => worker?.drain())
        return () => completion ?? Promise.resolve()
      }
    }

    const eventLog = withInjectedEventLog(persistence.eventLog, failure)
    const runtime: PersistentHarnessRuntime = {
      eventLog,
      failure,
      schedule,
      createSliceStore: <TWriteState, TReadState = Readonly<TWriteState>>(
        createState: () => TWriteState,
      ) =>
        withInjectedSliceStore(
          persistence.createSliceStore<TWriteState, TReadState>(createState),
          failure,
        ),
    }
    const app = await runWithSqliteDb(db, () => options.createApp(runtime))
    return {
      app,
      client,
      db,
      eventLog,
      reactionStore,
      get worker() {
        return worker
      },
    }
  }

  let active = await open()

  async function restart() {
    active.client.close()
    active = await open()
    return active.app
  }

  async function clearProjectionState() {
    await deleteTableRowsIfPresent(active.client, 'specter_slice_states')
    await deleteTableRowsIfPresent(active.client, 'slice_cursors')
    if (options.resetProjectProjections) {
      await runWithSqliteDb(active.db, options.resetProjectProjections)
    }
  }

  return {
    get app() {
      return active.app
    },
    get backgroundErrors() {
      return [...backgroundErrors]
    },
    databasePath,
    failure,
    eventLogVersion: () => active.eventLog.currentVersion(),
    run: <T>(effect: () => Promise<T>) => runWithSqliteDb(active.db, effect),
    restart,
    replay: async () => {
      await clearProjectionState()
      return restart()
    },
    reset: async () => {
      active.client.close()
      for (const suffix of ['', '-shm', '-wal']) {
        rmSync(\`\${databasePath}\${suffix}\`, { force: true })
      }
      active = await open()
      return active.app
    },
    drainReactions: () => active.worker?.drain() ?? Promise.resolve(),
    reactionJobs: (status?: ReactionOutboxStatus) =>
      active.reactionStore.list(status) as Promise<
        readonly ReactionOutboxJob<ReactionPass>[]
      >,
    retryReaction: async (jobId: string) => {
      const worker = active.worker
      if (!worker)
        throw new Error('The app did not install the harness scheduler')
      await worker.retryDeadLetter(jobId)
      await worker.drain()
    },
    close: () => {
      active.client.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

function withInjectedEventLog(
  eventLog: EventLogAdapter,
  failure: FailureInjector,
): EventLogAdapter {
  const wrap = (target: EventLogTransaction): EventLogTransaction => ({
    query: (afterOrder, eventTypes) => target.query(afterOrder, eventTypes),
    currentVersion: () => target.currentVersion(),
    findCommit: (idempotencyKey) => target.findCommit(idempotencyKey),
    append: async (events, appendOptions?: EventLogAppendOptions) => {
      failure.hit('before-event-append')
      const commit = await target.append(events, appendOptions)
      failure.hit('after-event-append')
      return commit
    },
  })

  return {
    ...wrap(eventLog),
    transaction: <T>(run: (transaction: EventLogTransaction) => Promise<T>) =>
      eventLog.transaction((transaction) => run(wrap(transaction))),
  }
}

function withInjectedSliceStore<TWriteState, TReadState>(
  store: SliceStoreAdapter<TWriteState, TReadState>,
  failure: FailureInjector,
): SliceStoreAdapter<TWriteState, TReadState> {
  const wrap = (
    entry: SliceStore<TWriteState, TReadState>,
  ): SliceStore<TWriteState, TReadState> => {
    let projectionStarted = false
    return {
      get write() {
        if (!projectionStarted) {
          failure.hit('before-projection-apply')
          projectionStarted = true
        }
        return entry.write
      },
      get read() {
        return entry.read
      },
      lastAppliedOrder: () => entry.lastAppliedOrder(),
      setLastAppliedOrder: async (order) => {
        if (projectionStarted) failure.hit('after-projection-apply')
        failure.hit('before-cursor-advance')
        await entry.setLastAppliedOrder(order)
        failure.hit('after-cursor-advance')
      },
    }
  }

  return {
    get: async (sliceName) => wrap(await store.get(sliceName)),
    transaction: (sliceName, run) =>
      store.transaction(sliceName, (entry) => run(wrap(entry))),
  }
}

async function deleteTableRowsIfPresent(
  client: ReturnType<typeof createClient>,
  table: 'slice_cursors' | 'specter_slice_states',
) {
  const tableResult = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [table],
  })
  if (tableResult.rows.length > 0) await client.execute(\`DELETE FROM \${table}\`)
}
`
}

function failureInjectionTemplate() {
  return `export type PersistenceCrashPoint =
  | 'before-event-append'
  | 'after-event-append'
  | 'before-projection-apply'
  | 'after-projection-apply'
  | 'before-cursor-advance'
  | 'after-cursor-advance'
  | 'after-reaction-attempt'

export type FailureInjector = {
  readonly armedPoint: () => PersistenceCrashPoint | undefined
  readonly arm: (point: PersistenceCrashPoint) => void
  readonly clear: () => void
  readonly hit: (point: PersistenceCrashPoint) => void
}

export function createFailureInjector(): FailureInjector {
  let armed: PersistenceCrashPoint | undefined

  return {
    armedPoint: () => armed,
    arm: (point) => {
      armed = point
    },
    clear: () => {
      armed = undefined
    },
    hit: (point) => {
      if (point !== armed) return
      armed = undefined
      throw new Error(\`Injected persistence failure at \${point}\`)
    },
  }
}

export function failOnceAt(expected: PersistenceCrashPoint) {
  const failure = createFailureInjector()
  failure.arm(expected)

  return (actual: PersistenceCrashPoint) => failure.hit(actual)
}
`
}

function persistentHarnessTestTemplate() {
  return `import { createEventDefinition, createSpecterApp } from '@specter-ts/core'
import {
  createCommandSlice,
  createQuerySlice,
  createReactionSlice,
  event,
} from '@specter-ts/core/spec'
import { z } from 'zod'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createPersistentHarness,
  type PersistentHarnessRuntime,
} from './persistent-harness.server'

const counterIncremented = createEventDefinition(
  'recovery-counter-incremented',
  z.object({ commandId: z.string(), amount: z.number().int().positive() }),
)

const incrementRecoveryCounterSpec = createCommandSlice(
  'incrementRecoveryCounter',
)
  .description('Increments the persistent recovery-test counter.')
  .scenarios({
    description: 'Records a deterministic increment.',
    given: [
      event('recovery-counter-incremented', {
        commandId: 'command-0',
        amount: 1,
      }),
    ],
    when: { commandId: 'command-1', amount: 2 },
    expect: [
      event('recovery-counter-incremented', {
        commandId: 'command-1',
        amount: 2,
      }),
    ],
  })

const recoveryCounterSpec = createQuerySlice('recoveryCounter')
  .description('Reads the persistent recovery-test counter.')
  .scenarios({
    description: 'Sums committed increments.',
    given: [
      event('recovery-counter-incremented', {
        commandId: 'command-1',
        amount: 2,
      }),
    ],
    when: {},
    expect: 2,
  })

const recordRecoveryAuditSpec = createReactionSlice('recordRecoveryAudit')
  .description('Records one effect for each committed recovery increment.')
  .scenarios({
    description: 'Returns an audit effect for the latest increment.',
    given: [
      event('recovery-counter-incremented', {
        commandId: 'command-1',
        amount: 2,
      }),
    ],
    expect: [{ commandId: 'command-1' }],
  })

const openHarnesses: Array<{ close(): void }> = []

afterEach(() => {
  for (const harness of openHarnesses.splice(0)) harness.close()
})

describe('persistent Specter recovery', () => {
  it('survives restart and rebuilds disposable projections by replay', async () => {
    const { harness } = await setup()
    const execution = await harness.run(() =>
      harness.app.command({
        type: 'incrementRecoveryCounter',
        payload: { commandId: 'command-1', amount: 2 },
      }),
    )
    await execution.reactions

    await harness.restart()
    await expect(readCounter(harness)).resolves.toBe(2)

    await harness.replay()
    await expect(readCounter(harness)).resolves.toBe(2)
  })

  it('recovers a durable Event whose caller crashed after append', async () => {
    const { harness } = await setup()
    harness.failure.arm('after-event-append')

    await expect(
      harness.run(() =>
        harness.app.command({
          type: 'incrementRecoveryCounter',
          payload: { commandId: 'command-crash', amount: 3 },
        }),
      ),
    ).rejects.toThrow('failed in its Event Log transaction')

    expect(await harness.eventLogVersion()).toBe(1)
    await harness.restart()
    await expect(readCounter(harness)).resolves.toBe(3)
  })

  it('does not publish a projection cursor after an injected apply failure', async () => {
    const { harness } = await setup()
    const execution = await harness.run(() =>
      harness.app.command({
        type: 'incrementRecoveryCounter',
        payload: { commandId: 'command-projection', amount: 4 },
      }),
    )
    await execution.reactions
    harness.failure.arm('before-cursor-advance')

    await expect(readCounter(harness)).rejects.toThrow(
      'failed while reading its Slice State',
    )
    await expect(readCounter(harness)).resolves.toBe(4)
  })

  it('retries a durable Reaction pass without duplicating its effect', async () => {
    const { effects, harness } = await setup()
    harness.failure.arm('after-reaction-attempt')
    const execution = await harness.run(() =>
      harness.app.command({
        type: 'incrementRecoveryCounter',
        payload: { commandId: 'command-retry', amount: 5 },
      }),
    )
    await execution.reactions

    expect(effects).toEqual(['command-retry'])
    await expect(harness.reactionJobs('completed')).resolves.toMatchObject([
      { status: 'completed', attemptCount: 2 },
    ])
  })
})

async function setup() {
  const effects: string[] = []
  const harness = await createPersistentHarness({
    createApp: (runtime) => createRecoveryApp(runtime, effects),
  })
  openHarnesses.push(harness)
  return { effects, harness }
}

function createRecoveryApp(
  runtime: PersistentHarnessRuntime,
  effects: string[],
) {
  const incrementRecoveryCounter = incrementRecoveryCounterSpec
    .inputSchema(
      z.object({ commandId: z.string(), amount: z.number().int().positive() }),
    )
    .store(runtime.createSliceStore(() => ({ count: 0 })))
    .apply(counterIncremented, async (applied, state) => {
      state.count += applied.payload.amount
    })
    .handle(async (command) => [counterIncremented.create(command)])

  const recoveryCounter = recoveryCounterSpec
    .inputSchema(z.object({}))
    .outputSchema(z.number().int().nonnegative())
    .store(runtime.createSliceStore(() => ({ count: 0 })))
    .apply(counterIncremented, async (applied, state) => {
      state.count += applied.payload.amount
    })
    .handle(async (_query, state) => state.count)

  const recordRecoveryAudit = recordRecoveryAuditSpec
    .outputSchema(z.object({ commandId: z.string() }))
    .plugin(async (_dispatch) => async (effect) => {
      effects.push(effect.commandId)
    })
    .store(runtime.createSliceStore(() => ({ latestCommandId: '' })))
    .apply(counterIncremented, async (applied, state) => {
      state.latestCommandId = applied.payload.commandId
    })
    .handle(async (state) =>
      state.latestCommandId ? { commandId: state.latestCommandId } : undefined,
    )

  return createSpecterApp({
    events: [counterIncremented],
    eventLog: runtime.eventLog,
    schedule: runtime.schedule,
    slices: [incrementRecoveryCounter, recoveryCounter, recordRecoveryAudit],
  })
}

function readCounter(harness: Awaited<ReturnType<typeof setup>>['harness']) {
  return harness.run(() =>
    harness.app.query({ type: 'recoveryCounter', payload: {} }),
  )
}
`
}

function persistentHarnessReadme() {
  return `# Persistent Specter harness

This executable harness keeps a temporary SQLite database across app restarts.
It uses the first-party SQLite Event Log/Slice Store and durable Reaction
outbox, and includes one-shot failure injection at real adapter boundaries.
Its tests prove behavior that the in-memory Scenario runner cannot:

- an Event Log append survives process restart;
- disposable Slice projections catch up from the Event Log;
- a projection crash cannot advance its cursor past unapplied Events;
- Reaction attempts are idempotent across scheduler restarts.

Run the generated test unchanged first. For application-specific recovery
coverage, create a second harness with \`createApp(runtime)\` returning the real
registry. Use \`runtime.eventLog\`, \`runtime.schedule\`, and (for JSON-backed
test projections) \`runtime.createSliceStore\`. Calls into app-owned Drizzle
Slice Stores must run through \`harness.run(...)\`.

\`restart()\` reopens the same database. \`replay()\` clears Specter cursors and
JSON Slice State before reopening so idempotent app-owned projections catch up
from the Event Log. Supply \`resetProjectProjections\` when projection rows must
also be deleted. \`reset()\` removes the complete database and starts empty.
`
}

function sliceTemplateNames(sliceName: string) {
  const directoryName = toKebabCase(sliceName)
  const pascalName = sliceName.charAt(0).toUpperCase() + sliceName.slice(1)
  return {
    directoryName,
    eventDefinitionsName: `${sliceName}EventDefinitions`,
    eventName: `${sliceName}RecordedEvent`,
    eventType: `${directoryName}-recorded`,
    pascalName,
    projectionName: `${sliceName}Projection`,
    registrationName: `${sliceName}Registrations`,
    sliceName,
    tableName: `${directoryName.replaceAll('-', '_')}_projection`,
  }
}

function writePlannedFiles(
  files: readonly PlannedFile[],
  options: { cwd: string; dryRun: boolean; force: boolean },
) {
  const cwd = resolve(options.cwd)
  for (const file of files) {
    assertInside(cwd, file.path)
    if (existsSync(file.path) && !options.force) {
      throw new Error(
        `Refusing to overwrite ${relative(cwd, file.path)}. Pass --force to replace generated files.`,
      )
    }
  }

  if (options.dryRun) return

  for (const file of files) {
    mkdirSync(dirname(file.path), { recursive: true })
    atomicWrite(file.path, file.content)
  }
}

function atomicWrite(path: string, content: string) {
  const temporaryPath = `${path}.create-specter-${process.pid}.tmp`
  try {
    writeFileSync(temporaryPath, content)
    renameSync(temporaryPath, path)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

function assertInside(cwd: string, path: string) {
  const pathFromCwd = relative(cwd, path)
  if (pathFromCwd.startsWith('..') || pathFromCwd === '') {
    throw new Error(`Generated path must stay inside the project: ${path}`)
  }
}

function safeRelativeDirectory(value: string, label: string) {
  if (!value || value.startsWith('/') || value.startsWith('\\')) {
    throw new Error(`${label} must be a non-empty relative path`)
  }
  const normalized = value.replaceAll('\\', '/')
  if (normalized.split('/').some((segment) => segment === '..')) {
    throw new Error(`${label} cannot traverse outside the project`)
  }
  return normalized
}

function assertSliceName(value: string) {
  if (!sliceNamePattern.test(value)) {
    throw new Error(
      `Slice name must be lower camel case (for example, requestInvite): ${value}`,
    )
  }
}

function assertKebabName(value: string, label: string) {
  if (!kebabNamePattern.test(value)) {
    throw new Error(`${label} must be kebab-case: ${value}`)
  }
}

function toKebabCase(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

function relativeModuleSpecifier(fromDirectory: string, targetPath: string) {
  const modulePath = relative(fromDirectory, targetPath).replaceAll('\\', '/')
  return modulePath.startsWith('.') ? modulePath : `./${modulePath}`
}

type ParsedFlags = {
  readonly booleans: Set<string>
  readonly positionals: string[]
  readonly seen: Set<string>
  readonly values: Record<string, string | undefined>
}

function parseFlags(args: readonly string[]): ParsedFlags {
  const booleans = new Set<string>()
  const positionals: string[] = []
  const seen = new Set<string>()
  const values: Record<string, string | undefined> = {}

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument?.startsWith('--')) {
      if (argument) positionals.push(argument)
      continue
    }

    const name = argument.slice(2)
    if (!name) throw new Error('Invalid empty option')
    if (seen.has(name)) throw new Error(`Option --${name} was provided twice`)
    seen.add(name)

    if (name === 'force' || name === 'dry-run') {
      booleans.add(name)
      continue
    }

    const value = args[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Option --${name} requires a value`)
    }
    values[name] = value
    index += 1
  }

  return { booleans, positionals, seen, values }
}

function assertKnownFlags(parsed: ParsedFlags, known: readonly string[]) {
  const knownSet = new Set(known)
  for (const name of parsed.seen) {
    if (!knownSet.has(name)) throw new Error(`Unknown option: --${name}`)
  }
}

function requiredValue(value: string | undefined, name: string) {
  if (!value) throw new Error(`Option --${name} is required`)
  return value
}

function requiredEnum<const T extends string>(
  value: string | undefined,
  name: string,
  allowed: readonly T[],
) {
  const required = requiredValue(value, name)
  if (!allowed.includes(required as T)) {
    throw new Error(`Option --${name} must be one of: ${allowed.join(', ')}`)
  }
  return required as T
}

function printResult(
  write: (message: string) => void,
  result: GenerationResult,
) {
  write(result.dryRun ? 'Would generate:' : 'Generated:')
  for (const file of result.files) write(`  ${file}`)
  write('Next steps:')
  for (const step of result.nextSteps) write(`  - ${step}`)
}
