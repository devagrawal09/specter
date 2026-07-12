export type NodeKind =
  | 'client'
  | 'spec'
  | 'runtime'
  | 'implementation'
  | 'event'
  | 'log'
  | 'plugin'

export type NodeId =
  | 'client'
  | 'spec'
  | 'app'
  | 'cmd'
  | 'query'
  | 'reaction'
  | 'event'
  | 'log'
  | 'plugin'

export type ArchNode = {
  id: NodeId
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
  from: NodeId
  to: NodeId
  label: string
  /** Source node kind whose color the flowing signal inherits. */
  color: NodeKind
  d: string
  labelX: number
  labelY: number
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
  runtime: '#60a5fa',
  implementation: '#67e8f9',
  event: '#fbbf24',
  log: '#34d399',
  plugin: '#fb7185',
}

export const kindLabel: Record<NodeKind, string> = {
  client: 'Client / UI',
  spec: 'Slice specification',
  runtime: 'Specter runtime',
  implementation: 'Slice implementation',
  event: 'Event definition',
  log: 'Event log',
  plugin: 'Reaction plugin',
}

export const nodes: readonly ArchNode[] = [
  {
    id: 'client',
    kind: 'client',
    title: 'Client / UI',
    subtitle: 'typed command · query calls',
    x: 50,
    y: 70,
    w: 220,
    h: 92,
  },
  {
    id: 'spec',
    kind: 'spec',
    title: 'Slice Specs',
    subtitle: 'immutable what · scenarios',
    x: 50,
    y: 310,
    w: 240,
    h: 132,
  },
  {
    id: 'app',
    kind: 'runtime',
    title: 'Specter App',
    subtitle: 'validates · owns one log',
    x: 370,
    y: 250,
    w: 240,
    h: 150,
  },
  {
    id: 'cmd',
    kind: 'implementation',
    title: 'Command Impl',
    subtitle: 'decides · emits drafts',
    x: 700,
    y: 55,
    w: 230,
    h: 100,
  },
  {
    id: 'query',
    kind: 'implementation',
    title: 'Query Impl',
    subtitle: 'private read state',
    x: 700,
    y: 245,
    w: 230,
    h: 100,
  },
  {
    id: 'reaction',
    kind: 'implementation',
    title: 'Reaction Impl',
    subtitle: 'produces an effect',
    x: 700,
    y: 455,
    w: 230,
    h: 100,
  },
  {
    id: 'event',
    kind: 'event',
    title: 'Event Definitions',
    subtitle: 'validate · create drafts',
    x: 1030,
    y: 55,
    w: 220,
    h: 100,
  },
  {
    id: 'log',
    kind: 'log',
    title: 'Event Log',
    subtitle: 'ordered · adapter-backed',
    x: 1030,
    y: 250,
    w: 220,
    h: 115,
  },
  {
    id: 'plugin',
    kind: 'plugin',
    title: 'Reaction Plugin',
    subtitle: 'interprets the effect',
    x: 1030,
    y: 480,
    w: 220,
    h: 100,
  },
]

export const edges: readonly ArchEdge[] = [
  {
    id: 'client-app',
    from: 'client',
    to: 'app',
    label: 'typed calls',
    color: 'client',
    d: 'M270,116 C340,116 330,300 370,300',
    labelX: 330,
    labelY: 182,
  },
  {
    id: 'spec-cmd',
    from: 'spec',
    to: 'cmd',
    label: 'completed by',
    color: 'spec',
    d: 'M290,330 C500,330 510,105 700,105',
    labelX: 510,
    labelY: 188,
  },
  {
    id: 'spec-query',
    from: 'spec',
    to: 'query',
    label: 'completed by',
    color: 'spec',
    d: 'M290,376 C500,376 510,295 700,295',
    labelX: 505,
    labelY: 346,
  },
  {
    id: 'spec-reaction',
    from: 'spec',
    to: 'reaction',
    label: 'completed by',
    color: 'spec',
    d: 'M290,420 C500,420 510,505 700,505',
    labelX: 505,
    labelY: 465,
  },
  {
    id: 'app-cmd',
    from: 'app',
    to: 'cmd',
    label: 'runs command',
    color: 'runtime',
    d: 'M610,280 C660,280 650,105 700,105',
    labelX: 655,
    labelY: 212,
  },
  {
    id: 'app-query',
    from: 'app',
    to: 'query',
    label: 'serves query',
    color: 'runtime',
    d: 'M610,325 C650,325 660,295 700,295',
    labelX: 655,
    labelY: 310,
  },
  {
    id: 'app-reaction',
    from: 'app',
    to: 'reaction',
    label: 'runs reaction',
    color: 'runtime',
    d: 'M610,370 C660,370 650,505 700,505',
    labelX: 655,
    labelY: 438,
  },
  {
    id: 'cmd-event',
    from: 'cmd',
    to: 'event',
    label: 'creates Event Draft',
    color: 'implementation',
    d: 'M930,105 L1030,105',
    labelX: 980,
    labelY: 90,
  },
  {
    id: 'event-log',
    from: 'event',
    to: 'log',
    label: 'validates · appends',
    color: 'event',
    d: 'M1140,155 L1140,250',
    labelX: 1192,
    labelY: 208,
  },
  {
    id: 'log-cmd',
    from: 'log',
    to: 'cmd',
    label: 'catches up state',
    color: 'log',
    d: 'M1080,250 C1080,190 815,190 815,155',
    labelX: 945,
    labelY: 178,
  },
  {
    id: 'log-query',
    from: 'log',
    to: 'query',
    label: 'catches up state',
    color: 'log',
    d: 'M1030,292 L930,295',
    labelX: 980,
    labelY: 278,
  },
  {
    id: 'log-reaction',
    from: 'log',
    to: 'reaction',
    label: 'catches up state',
    color: 'log',
    d: 'M1030,330 C970,330 980,505 930,505',
    labelX: 982,
    labelY: 415,
  },
  {
    id: 'reaction-plugin',
    from: 'reaction',
    to: 'plugin',
    label: 'returns effect',
    color: 'implementation',
    d: 'M930,505 C970,505 990,530 1030,530',
    labelX: 980,
    labelY: 492,
  },
  {
    id: 'plugin-app',
    from: 'plugin',
    to: 'app',
    label: 'may dispatch a command',
    color: 'plugin',
    d: 'M1030,555 C900,700 500,700 490,400',
    labelX: 755,
    labelY: 682,
  },
]

export const snippets: Record<NodeId, Snippet> = {
  client: {
    file: 'src/specter-client.ts',
    lang: 'ts',
    caption:
      'UI code calls an app-inferred client. It does not import stores, Event Definitions, or server modules.',
    code: `import { defineSpecterClient } from '@specter-ts/core/client'
import type { todoSpecterAppConfig } from './features/todos/registry'

type TodoAppConfig = typeof todoSpecterAppConfig

export const specterClient =
  defineSpecterClient<TodoAppConfig>('/api')

await specterClient.addTodo({
  todoId: 'todo-1',
  title: 'Ship it',
})`,
  },
  spec: {
    file: 'features/todos/add-todo/spec.ts',
    lang: 'ts',
    caption:
      'The immutable specification contains only the Slice name, description, and exact behavior scenarios.',
    code: `import { createCommandSlice, event } from '@specter-ts/core/spec'

const addTodoSpec = createCommandSlice('addTodo')
  .description('Adds a todo to the list.')
  .scenarios(
    {
      description: 'Creates a todo with the provided title.',
      given: [],
      when: { todoId: 'todo-1', title: 'Ship it' },
      expect: [
        event('todo-added', { todoId: 'todo-1', title: 'Ship it' }),
      ],
    },
    {
      description: 'Rejects a blank title.',
      given: [],
      when: { todoId: 'todo-1', title: '   ' },
      expect: [],
      reject: { reason: 'Todo title is required' },
    },
  )

export default addTodoSpec`,
  },
  app: {
    file: 'src/server.ts',
    lang: 'ts',
    caption:
      'App construction validates Event Definitions and one completed implementation for every Slice specification before exposing methods.',
    code: `import { createSpecterApp } from '@specter-ts/core'
import { todoSpecterAppConfig } from './features/todos/registry'

// Construction is async because conformance is validated first.
const todoApp = await createSpecterApp(todoSpecterAppConfig)

await todoApp.addTodo({
  todoId: 'todo-1',
  title: 'Ship it',
})`,
  },
  cmd: {
    file: 'features/todos/add-todo/impl.ts',
    lang: 'ts',
    caption:
      'The implementation completes the imported specification. Domain IDs enter through command input, keeping the handler deterministic.',
    code: `const addTodo = addTodoSpec
  .inputSchema(
    z.object({
      todoId: z.string().min(1),
      title: z.string(),
    }),
  )
  .store(sqliteSliceStore)
  .handle(async (command) => {
    const title = command.title.trim()

    if (!title) throw new Error('Todo title is required')

    return [
      todoAddedEvent.create({
        todoId: command.todoId,
        title,
      }),
    ]
  })`,
  },
  query: {
    file: 'features/todos/todos-query/impl.ts',
    lang: 'ts',
    caption:
      'A Query implementation catches relevant Events into private Slice State, then answers from its read-only view.',
    code: `const todosQuery = todosQuerySpec
  .inputSchema(
    z.object({
      status: z.enum(['all', 'active', 'completed']).catch('all'),
    }),
  )
  .outputSchema(todoOutputSchema)
  .store(sqliteSliceStore)
  .apply(todoAddedEvent, async (event, db) => {
    await db.insert(todoListItems).values({
      id: event.payload.todoId,
      title: event.payload.title,
    }).run()
  })
  .handle(async (query, db) =>
    db.select().from(todoListItems).where(visible(query.status)).all(),
  )`,
  },
  reaction: {
    file: 'features/todos/todo-completion-cheer-reaction/impl.ts',
    lang: 'ts',
    caption:
      'A Reaction implementation returns at most one typed effect after catch-up. Its plugin interprets that effect outside the state transaction.',
    code: `const todoCompletionCheer = todoCompletionCheerSpec
  .outputSchema(
    z.object({
      type: z.literal('createTodoCheer'),
      payload: z.object({ milestone: z.number().int().positive() }),
    }),
  )
  .plugin(async (command) => async (effect) => command(effect))
  .store(sqliteSliceStore)
  .apply(todoCompletionChangedEvent, async (event, db) => {
    await recordCompletion(db, event.payload)
  })
  .handle(async (db) => {
    const milestone = await nextMilestone(db)
    if (!milestone) return

    return { type: 'createTodoCheer', payload: { milestone } }
  })`,
  },
  event: {
    file: 'features/todos/events.ts',
    lang: 'ts',
    caption:
      'Implementation-owned Event Definitions pair kebab-case fact types with Standard Schema-compatible payload validation and draft factories.',
    code: `import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const todoAddedEvent = createEventDefinition(
  'todo-added',
  z.object({
    todoId: z.string(),
    title: z.string(),
  }),
)

export const todoEventDefinitions = [
  todoAddedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
] as const`,
  },
  log: {
    file: 'event-log.json',
    lang: 'jsonc',
    caption:
      'The app-level adapter persists ordered Events. IDs, order, and recorded timestamps are log metadata, not domain payload fields.',
    code: `[
  {
    "id": "event-1",
    "order": 1,
    "recordedAt": "2026-07-11T15:04:00.000Z",
    "type": "todo-added",
    "payload": {
      "todoId": "todo-1",
      "title": "Ship it"
    }
  },
  {
    "id": "event-2",
    "order": 2,
    "recordedAt": "2026-07-11T15:05:00.000Z",
    "type": "todo-completion-changed",
    "payload": { "todoId": "todo-1", "completed": true }
  }
]`,
  },
  plugin: {
    file: 'features/todos/todo-completion-cheer-reaction/impl.ts',
    lang: 'ts',
    caption:
      'The explicit plugin is the side-effect boundary. This one interprets an effect by dispatching a same-app command.',
    code: `const todoCompletionCheer = todoCompletionCheerSpec
  .outputSchema(completionCheerEffectSchema)
  .plugin(
    async (command) => async (effect) => {
      await command(effect)
    },
  )
  .store(sqliteSliceStore)
  .apply(todoCompletionChangedEvent, applyCompletion)
  .handle(decideCompletionCheer)`,
  },
}
