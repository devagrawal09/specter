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

  throw new Error(`Unknown generator: ${subject}`)
}

export function generateHelp() {
  return `Specter authoring generators

Usage:
  create-specter generate slice <lowerCamelName> --kind <command|query|reaction> --feature <kebab-name> [--root <directory>] [--dry-run] [--force]

Examples:
  create-specter generate slice requestInvite --kind command --feature invitations --dry-run
  create-specter generate slice invitationList --kind query --feature invitations
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
import { Effect as _Effect } from 'effect'

${storeImport}
import { ${names.eventName} as _recordedEvent } from './events'
import { ${names.projectionName} as _projection } from './projection'
import { ${names.sliceName}Spec as _spec } from './spec'

export const ${names.sliceName} = _spec
  .outputSchema(
    _schema.object({ requestId: _schema.string(), value: _schema.string() }),
  )
  .plugin((_dispatch) =>
    _Effect.succeed((_effect, context) =>
      _Effect.sync(() => {
        void context
        // TODO: invoke the external adapter inside this Effect.
        // Same-app follow-ups must call _dispatch(effect, {
        //   idempotencyKey: context.deliveryId,
        // }) so an at-least-once retry cannot duplicate follow-up Events.
        // Use context.scheduledAt for retry-stable domain time; never new Date().
      }),
    ),
  )
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
