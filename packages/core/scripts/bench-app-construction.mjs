// Micro-bench for per-session Specter app construction. Not a test.
//
// Usage (from packages/core, after `pnpm --filter @specter-ts/core build`):
//   node scripts/bench-app-construction.mjs [count]
// Set SPECTER_CORE_ENTRY to a file URL of another build to compare versions.
//
// Every app shares one config object and gets its own Event Log and Store.
// "first-call-ready" is createSpecterApp plus the first Query resolving.
import { Context, Effect, Layer } from 'effect'
import { createCommandSlice, createQuerySlice, event } from '@specter-ts/spec'

const core = await import(
  process.env.SPECTER_CORE_ENTRY ?? new URL('../dist/index.js', import.meta.url)
)

const { EventLog, createEventDefinition, implementCommand, implementQuery } =
  core
const count = Number(process.argv[2] ?? 500)
const extraQueryCount = Number(process.env.BENCH_EXTRA_QUERIES ?? 12)
const rounds = Number(process.env.BENCH_ROUNDS ?? 5)

class BenchStore extends Context.Service()('specter-bench/BenchStore') {}

const stringSchema = {
  '~standard': {
    version: 1,
    vendor: 'specter-bench',
    validate: (value) =>
      typeof value === 'string'
        ? { value }
        : { issues: [{ message: 'Expected string' }] },
  },
}
const itemSchema = {
  '~standard': {
    version: 1,
    vendor: 'specter-bench',
    validate: (value) =>
      typeof value === 'object' &&
      value !== null &&
      typeof value.id === 'string' &&
      typeof value.title === 'string'
        ? { value }
        : { issues: [{ message: 'Expected item' }] },
  },
}

const itemAdded = createEventDefinition('item-added', itemSchema)
const itemRenamed = createEventDefinition('item-renamed', itemSchema)
const itemRemoved = createEventDefinition('item-removed', stringSchema)
const item = { id: 'item-1', title: 'First' }

const addItem = implementCommand(
  createCommandSlice('addItem')
    .description('Adds an item.')
    .scenarios(
      {
        description: 'Adds an item.',
        given: [],
        when: item,
        expect: [event('item-added', item)],
      },
      {
        description: 'Rejects a duplicate item.',
        given: [event('item-added', item)],
        when: item,
        expect: [],
        reject: { reason: 'Item exists' },
      },
    ),
)
  .inputSchema(itemSchema)
  .store(BenchStore)
  .apply(itemAdded, async (applied, state) => {
    state.items[applied.payload.id] = applied.payload.title
  })
  .handle(async (input) => [itemAdded.create(input)])

const renameItem = implementCommand(
  createCommandSlice('renameItem')
    .description('Renames an item.')
    .scenarios({
      description: 'Renames an item.',
      given: [event('item-added', item)],
      when: { id: 'item-1', title: 'Renamed' },
      expect: [event('item-renamed', { id: 'item-1', title: 'Renamed' })],
    }),
)
  .inputSchema(itemSchema)
  .store(BenchStore)
  .apply(itemAdded, async (applied, state) => {
    state.items[applied.payload.id] = applied.payload.title
  })
  .handle(async (input) => [itemRenamed.create(input)])

const removeItem = implementCommand(
  createCommandSlice('removeItem')
    .description('Removes an item.')
    .scenarios({
      description: 'Removes an item.',
      given: [event('item-added', item)],
      when: 'item-1',
      expect: [event('item-removed', 'item-1')],
    }),
)
  .inputSchema(stringSchema)
  .store(BenchStore)
  .apply(itemAdded, async (applied, state) => {
    state.items[applied.payload.id] = applied.payload.title
  })
  .handle(async (id) => [itemRemoved.create(id)])

const items = implementQuery(
  createQuerySlice('items')
    .description('Lists items.')
    .scenarios({
      description: 'Lists renamed items without removed ones.',
      given: [
        event('item-added', item),
        event('item-renamed', { id: 'item-1', title: 'Renamed' }),
        event('item-added', { id: 'item-2', title: 'Second' }),
        event('item-removed', 'item-2'),
      ],
      when: {},
      expect: [{ id: 'item-1', title: 'Renamed' }],
    }),
)
  .inputSchema()
  .outputSchema()
  .store(BenchStore)
  .apply(itemAdded, async (applied, state) => {
    state.items[applied.payload.id] = applied.payload.title
  })
  .apply(itemRenamed, async (applied, state) => {
    state.items[applied.payload.id] = applied.payload.title
  })
  .apply(itemRemoved, async (applied, state) => {
    delete state.items[applied.payload]
  })
  .handle(async (_input, state) =>
    Object.entries(state.items).map(([id, title]) => ({ id, title })),
  )

// Extra read models make the conformance pass closer to a real session config.
const extraQueries = Object.fromEntries(
  Array.from({ length: extraQueryCount }, (_, index) => {
    const name = `itemTitles${index + 1}`
    const slice = implementQuery(
      createQuerySlice(name)
        .description(`Lists item titles (${index + 1}).`)
        .scenarios(
          {
            description: 'Lists renamed titles.',
            given: [
              event('item-added', item),
              event('item-renamed', { id: 'item-1', title: 'Renamed' }),
            ],
            when: {},
            expect: ['Renamed'],
          },
          {
            description: 'Skips removed items.',
            given: [event('item-added', item), event('item-removed', 'item-1')],
            when: {},
            expect: [],
          },
        ),
    )
      .inputSchema()
      .outputSchema()
      .store(BenchStore)
      .apply(itemAdded, async (applied, state) => {
        state.items[applied.payload.id] = applied.payload.title
      })
      .apply(itemRenamed, async (applied, state) => {
        state.items[applied.payload.id] = applied.payload.title
      })
      .apply(itemRemoved, async (applied, state) => {
        delete state.items[applied.payload]
      })
      .handle(async (_input, state) => Object.values(state.items))
    return [name, slice]
  }),
)

const config = {
  events: [itemAdded, itemRenamed, itemRemoved],
  slices: { addItem, renameItem, removeItem, items, ...extraQueries },
}

function dependencies() {
  return Layer.mergeAll(
    Layer.succeed(EventLog, makeEventLog()),
    Layer.succeed(BenchStore, makeStore()),
  )
}

async function openAndQuery(input) {
  const started = performance.now()
  const app = await core.createSpecterApp(input, dependencies())
  const constructed = performance.now()
  await app.query({ type: 'items', payload: {} })
  const ready = performance.now()
  return {
    app,
    construct: constructed - started,
    ready: ready - started,
  }
}

async function sequential(makeInput) {
  const construct = []
  const ready = []
  const started = performance.now()
  for (let index = 0; index < count; index += 1) {
    const result = await openAndQuery(makeInput())
    construct.push(result.construct)
    ready.push(result.ready)
    await result.app.close()
  }
  return { wall: performance.now() - started, construct, ready }
}

async function concurrent(makeInput) {
  const started = performance.now()
  const results = await Promise.all(
    Array.from({ length: count }, () => openAndQuery(makeInput())),
  )
  const wall = performance.now() - started
  await Promise.all(results.map((result) => result.app.close()))
  return {
    wall,
    construct: results.map((result) => result.construct),
    ready: results.map((result) => result.ready),
  }
}

/** Runs a scenario several times and reports the median round per metric. */
async function measure(label, run, makeInput) {
  const samples = []
  for (let round = 0; round < rounds; round += 1) {
    const { wall, construct, ready } = await run(makeInput)
    samples.push({
      wall,
      constructP50: percentile(construct, 0.5),
      readyP50: percentile(ready, 0.5),
      readyP95: percentile(ready, 0.95),
    })
  }
  const median = (key) =>
    percentile(
      samples.map((sample) => sample[key]),
      0.5,
    ).toFixed(3)
  console.log(
    `${label.padEnd(32)} wall ${median('wall').padStart(9)} ms | construct p50 ${median('constructP50')} ms | first-call-ready p50 ${median('readyP50')} ms p95 ${median('readyP95')} ms`,
  )
}

function percentile(values, rank) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(rank * sorted.length))]
}

function makeStore() {
  const entries = new Map()
  const entry = (name) => {
    let current = entries.get(name)
    if (!current) {
      current = { state: { items: {} }, cursor: 0 }
      entries.set(name, current)
    }
    return current
  }
  return {
    read: (name, run) => {
      const current = entry(name)
      return run(current.state, current.cursor)
    },
    transaction: (name, run) =>
      Effect.gen(function* () {
        const working = structuredClone(entry(name))
        let publish = false
        const result = yield* run(
          working.state,
          () => working.state,
          working.cursor,
          (order) =>
            Effect.sync(() => {
              working.cursor = order
              publish = true
            }),
        )
        if (publish) entries.set(name, working)
        return result
      }),
  }
}

function makeEventLog() {
  const events = []
  const commits = []
  return {
    query: (after, types) =>
      Effect.sync(() =>
        events.filter((item) => item.order > after && types.includes(item.type)),
      ),
    currentVersion: Effect.sync(() => events.length),
    commitsAfter: (version) =>
      Effect.sync(() => commits.filter((commit) => commit.version > version)),
    findCommit: () => Effect.succeed(undefined),
    append: (drafts, options = {}) =>
      Effect.sync(() => {
        const persisted = drafts.map((draft, index) => ({
          ...draft,
          id: `event-${events.length + index + 1}`,
          order: events.length + index + 1,
          recordedAt: new Date(0).toISOString(),
        }))
        events.push(...persisted)
        const commit = {
          events: persisted,
          version: events.length,
          committedAt: new Date(0).toISOString(),
          idempotencyKey: options.idempotencyKey,
          fingerprint: options.fingerprint,
        }
        commits.push(commit)
        return { ...commit, duplicate: false }
      }),
  }
}

// Warm up module code paths and the JIT without touching the measured config.
for (let index = 0; index < 1000; index += 1) {
  const warm = await openAndQuery({ ...config, slices: { ...config.slices } })
  await warm.app.close()
}

console.log(
  `createSpecterApp x${count}, ${Object.keys(config.slices).length} Slices, median of ${rounds} rounds`,
)
await measure('sequential, shared config', sequential, () => config)
await measure('concurrent, shared config', concurrent, () => config)
// Rebuilding the outer object keeps the cache hit; rebuilding `slices` misses.
await measure('sequential, new outer object', sequential, () => ({
  ...config,
}))
await measure('sequential, new slices object', sequential, () => ({
  events: config.events,
  slices: { ...config.slices },
}))
await measure('concurrent, new slices object', concurrent, () => ({
  events: config.events,
  slices: { ...config.slices },
}))
if (typeof core.prepareSpecterApp === 'function') {
  const prepared = await core.prepareSpecterApp(config)
  await measure('sequential, prepared', sequential, () => prepared)
  await measure('concurrent, prepared', concurrent, () => prepared)
}
