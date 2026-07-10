export type NodeKind = 'client' | 'spec' | 'slice' | 'event' | 'log'

export type ArchNode = {
  id: string
  kind: NodeKind
  title: string
  subtitle: string
  x: number
  y: number
  w: number
  h: number
}

export type ArchEdge = {
  id: string
  from: string
  to: string
  label: string
  /** Source node whose color the flowing signal inherits. */
  color: NodeKind
  d: string
}

export type Snippet = {
  file: string
  lang: string
  caption: string
  code: string
}

export const kindColor: Record<NodeKind, string> = {
  client: '#cbd5e1',
  spec: '#b794f6',
  slice: '#67e8f9',
  event: '#fbbf24',
  log: '#34d399',
}

export const kindLabel: Record<NodeKind, string> = {
  client: 'Client / UI',
  spec: 'Specification',
  slice: 'Slice',
  event: 'Event',
  log: 'Durable log',
}

export const nodes: ArchNode[] = [
  {
    id: 'client',
    kind: 'client',
    title: 'Client / UI',
    subtitle: 'typed Specter client',
    x: 70,
    y: 96,
    w: 210,
    h: 88,
  },
  {
    id: 'spec',
    kind: 'spec',
    title: 'Specification',
    subtitle: 'source of truth',
    x: 70,
    y: 300,
    w: 210,
    h: 150,
  },
  {
    id: 'cmd',
    kind: 'slice',
    title: 'Command Slice',
    subtitle: 'decides · emits events',
    x: 400,
    y: 120,
    w: 220,
    h: 96,
  },
  {
    id: 'query',
    kind: 'slice',
    title: 'Query Slice',
    subtitle: 'derives read models',
    x: 400,
    y: 300,
    w: 220,
    h: 96,
  },
  {
    id: 'reaction',
    kind: 'slice',
    title: 'Reaction Slice',
    subtitle: 'orchestrates follow-ups',
    x: 400,
    y: 486,
    w: 220,
    h: 96,
  },
  {
    id: 'event',
    kind: 'event',
    title: 'Events',
    subtitle: 'domain facts',
    x: 730,
    y: 300,
    w: 180,
    h: 96,
  },
  {
    id: 'log',
    kind: 'log',
    title: 'Event Log',
    subtitle: 'append-only',
    x: 1010,
    y: 290,
    w: 160,
    h: 118,
  },
]

export const edges: ArchEdge[] = [
  {
    id: 'client-cmd',
    from: 'client',
    to: 'cmd',
    label: 'issues command',
    color: 'client',
    d: 'M280,140 C345,140 345,168 400,168',
  },
  {
    id: 'client-query',
    from: 'client',
    to: 'query',
    label: 'requests read',
    color: 'client',
    d: 'M280,152 C350,152 350,340 400,348',
  },
  {
    id: 'spec-cmd',
    from: 'spec',
    to: 'cmd',
    label: 'compiles',
    color: 'spec',
    d: 'M280,330 C345,330 345,168 400,168',
  },
  {
    id: 'spec-query',
    from: 'spec',
    to: 'query',
    label: 'compiles',
    color: 'spec',
    d: 'M280,375 C345,375 345,348 400,348',
  },
  {
    id: 'spec-reaction',
    from: 'spec',
    to: 'reaction',
    label: 'compiles',
    color: 'spec',
    d: 'M280,420 C345,420 345,534 400,534',
  },
  {
    id: 'cmd-event',
    from: 'cmd',
    to: 'event',
    label: 'emits event',
    color: 'slice',
    d: 'M620,168 C720,168 820,224 820,300',
  },
  {
    id: 'event-log',
    from: 'event',
    to: 'log',
    label: 'appends · durable',
    color: 'event',
    d: 'M910,349 L1010,349',
  },
  {
    id: 'log-query',
    from: 'log',
    to: 'query',
    label: 'derives read model',
    color: 'log',
    d: 'M1090,290 C1090,240 900,240 700,240 C560,240 510,246 510,300',
  },
  {
    id: 'log-reaction',
    from: 'log',
    to: 'reaction',
    label: 'drives reaction',
    color: 'log',
    d: 'M1090,408 C1090,640 900,640 760,640 C600,640 510,618 510,582',
  },
  {
    id: 'reaction-event',
    from: 'reaction',
    to: 'event',
    label: 'orchestrates',
    color: 'slice',
    d: 'M620,534 C720,534 820,468 820,396',
  },
]

export const snippets: Record<string, Snippet> = {
  spec: {
    file: 'features/todos/spec.ts',
    lang: 'ts',
    caption:
      'One vertical feature, specified once. The same declaration compiles, executes, tests, and scaffolds.',
    code: `import { createEventDefinition, createCommandSlice } from '@specter-ts/core'
import { z } from 'zod'

// A domain fact this feature can record.
export const todoAdded = createEventDefinition(
  'todoAdded',
  z.object({ todoId: z.string(), title: z.string() }),
)

// A command slice: decide, then emit the fact.
export const addTodo = createCommandSlice('addTodo', 'Adds a todo to the list.')
  .schema(z.object({ title: z.string() }))
  .handle(async (command) => [
    todoAdded.create({ todoId: crypto.randomUUID(), title: command.title.trim() }),
  ])`,
  },
  cmd: {
    file: 'features/todos/add-todo/slice.ts',
    lang: 'ts',
    caption:
      'Command slices decide and emit events. Their scenarios are executable examples that become behavior tests.',
    code: `export const addTodo = createCommandSlice('addTodo', 'Adds a todo to the list.')
  .schema(z.object({ title: z.string() }))
  .scenarios(
    {
      description: 'Creates a todo with the provided title.',
      given: [],
      when: { title: 'Ship it' },
      expect: [todoAdded.create({ todoId: 'generated', title: 'Ship it' })],
    },
    {
      description: 'Rejects a blank todo title.',
      given: [],
      when: { title: '   ' },
      expect: [], // no events emitted means the command is rejected
      reject: { reason: 'Todo title is required' },
    },
  )
  .handle(async (command) => {
    const title = command.title.trim()
    if (!title) throw new Error('Todo title is required')
    return [todoAdded.create({ todoId: crypto.randomUUID(), title })]
  })`,
  },
  query: {
    file: 'features/todos/todos-query/slice.ts',
    lang: 'ts',
    caption:
      'Query slices fold events into a private read model, then answer reads. State is derived, never shared.',
    code: `export const todosQuery = createQuerySlice(
  'todosQuery',
  'Lists visible todos by status.',
)
  .schema(z.object({ status: z.enum(['all', 'active', 'completed']).catch('all') }))
  .apply({
    [todoAdded.type]: async (event, db) => {
      const { todoId, title } = await todoAdded.decode(event.payload)
      await db.insert(todoListItems).values({ id: todoId, title }).run()
    },
  })
  .handle(async (query, db) =>
    db.select().from(todoListItems).where(visible(query.status)).all(),
  )`,
  },
  reaction: {
    file: 'features/todos/completion-cheer/slice.ts',
    lang: 'ts',
    caption:
      'Reaction slices listen to events and request follow-up commands. This is how Specter orchestrates slices.',
    code: `export const completionCheer = createReactionSlice(
  'todoCompletionCheer',
  'Requests a cheer when completion milestones are reached.',
)
  .apply({
    [todoCompletionChanged.type]: async (event, db) => {
      const { todoId, completed } = await todoCompletionChanged.decode(event.payload)
      await db.update(states).set({ completed }).where(eq(states.todoId, todoId)).run()
    },
  })
  .handle(async (db) => {
    const done = await countCompleted(db)
    if (done > 0 && done % 5 === 0) {
      return { type: 'createTodoCheer', payload: { milestone: done } }
    }
  })`,
  },
  event: {
    file: 'features/todos/events.ts',
    lang: 'ts',
    caption:
      'Events are typed domain facts. Every payload is a Zod schema, so encoding and decoding are validated.',
    code: `export const todoAdded = createEventDefinition(
  'todoAdded',
  z.object({ todoId: z.string(), title: z.string() }),
)

export const todoCompletionChanged = createEventDefinition(
  'todoCompletionChanged',
  z.object({ todoId: z.string(), completed: z.boolean() }),
)

export const todoRemoved = createEventDefinition(
  'todoRemoved',
  z.object({ todoId: z.string() }),
)`,
  },
  log: {
    file: 'event-log.jsonl',
    lang: 'jsonc',
    caption:
      'The append-only event log is the system of record. Read models and reactions are replayed from it.',
    code: `// append-only · replayable · the system of record
[
  { "seq": 1, "type": "todoAdded",             "payload": { "todoId": "t-1", "title": "Ship it" } },
  { "seq": 2, "type": "todoAdded",             "payload": { "todoId": "t-2", "title": "Review" } },
  { "seq": 3, "type": "todoCompletionChanged", "payload": { "todoId": "t-1", "completed": true } },
  { "seq": 4, "type": "todoCheerCreated",      "payload": { "milestone": 5 } }
]`,
  },
}
