export type PipelineStage = {
  id: string
  step: string
  title: string
  summary: string
}

export const pipeline: PipelineStage[] = [
  {
    id: 'specification',
    step: '01',
    title: 'specification',
    summary:
      'The immutable what: a named Slice, its description, and exact scenarios.',
  },
  {
    id: 'portable-contract',
    step: '02',
    title: 'portable JSON',
    summary:
      'The language-neutral contract: strict JSON for every runtime and tool.',
  },
  {
    id: 'implementation',
    step: '03',
    title: 'implementation',
    summary:
      'The executable how: schemas, private state, apply handlers, and a handler.',
  },
  {
    id: 'scenario-tests',
    step: '04',
    title: 'scenario tests',
    summary:
      'The selected implementation runs against every scenario in its specification.',
  },
  {
    id: 'event-log',
    step: '05',
    title: 'event log',
    summary:
      "Accepted commands append domain facts to the app's ordered Event Log.",
  },
  {
    id: 'typed-envelope',
    step: '06',
    title: 'typed envelope',
    summary:
      'Completed Slices expose typed command, query, and subscription envelopes.',
  },
]

export const specSource = `import { createCommandSlice, event } from '@specter-ts/spec'

export const addTodoSpec = createCommandSlice('addTodo')
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
      description: 'Rejects a blank todo title.',
      given: [],
      when: { todoId: 'todo-1', title: '   ' },
      expect: [],
      reject: { reason: 'Todo title is required' },
    },
  )

export default addTodoSpec`

export const portableSpecSource = `{
  "$schema": "https://specter.dev/specification/v1/slice.schema.json",
  "formatVersion": 1,
  "kind": "command",
  "name": "addTodo",
  "description": "Adds a todo to the list.",
  "scenarios": [
    {
      "description": "Creates a todo with the provided title.",
      "given": [],
      "when": { "todoId": "todo-1", "title": "Ship it" },
      "expect": [
        {
          "kind": "scenario-event",
          "eventType": "todo-added",
          "examplePayload": { "todoId": "todo-1", "title": "Ship it" }
        }
      ]
    }
  ]
}`

export const implementationSource = `import { implementCommand } from '@specter-ts/core'
import { z } from 'zod'

import { sqliteSliceStore } from '../../../db/specter-store'
import { todoAddedEvent } from '../events'
import specification from './spec.json' with { type: 'json' }

export const addTodo = implementCommand(specification)
  .inputSchema(
    z.object({ todoId: z.string().min(1), title: z.string() }),
  )
  .store(sqliteSliceStore)
  .handle(async (command) => {
    const title = command.title.trim()
    if (!title) throw new Error('Todo title is required')

    return [todoAddedEvent.create({ todoId: command.todoId, title })]
  })`

export const scenarioTestSource = `import { testSliceImplementations } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import { todoEventDefinitions } from './events'
import { todoRegistrations } from './registry'

testSliceImplementations(todoRegistrations, {
  events: todoEventDefinitions,
  runScenario: sqliteScenario({}),
})`

export const eventLog = `order  recorded              type                     payload
─────  ────────────────────  ────────────────────────  ─────────────────────────────
   13  2026-07-09T18:04:11Z  todo-added                { todoId: "todo-5", … }
   14  2026-07-09T18:07:52Z  todo-completion-changed   { todoId: "todo-5", … }
   15  2026-07-09T18:09:30Z  todo-cheer-created        { milestone: 5, … }

IDs, order, and recorded timestamps are Event Log metadata outside the payload.`

export const reactionSource = `import { implementReaction } from '@specter-ts/core'
import specification from './spec.json' with { type: 'json' }

export const todoCompletionCheer = implementReaction(specification)
  .outputSchema(
    z.object({
      type: z.literal('createTodoCheer'),
      payload: z.object({ milestone: z.number().int().positive() }),
    }),
  )
  .store(sqliteSliceStore)
  .apply(todoAddedEvent, recordTodo)
  .apply(todoCompletionChangedEvent, async (event, db) => {
    await updateCompletion(db, event.payload)
  })
  .apply(todoRemovedEvent, removeTodo)
  .apply(todoCheerCreatedEvent, recordMilestone)
  .handle(async (db) => {
    const milestone = await nextMilestone(db)
    if (!milestone) return

    return { type: 'createTodoCheer', payload: { milestone } }
  })`

export const externalApiSource = `import type { ReactionPlugin } from '@specter-ts/core'
import { Effect } from 'effect'

type WelcomeEmail = { to: string; template: 'welcome' }

export const emailPlugin: ReactionPlugin<WelcomeEmail> =
  () => Effect.succeed((message, context) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise(() =>
        fetch('https://email.example/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': context.deliveryId,
          },
          body: JSON.stringify(message),
        }),
      )

      if (!response.ok) {
        return yield* Effect.fail(
          new Error('Email provider rejected the message'),
        )
      }
    }),
  )

// Complete a Reaction implementation with .plugin(emailPlugin).`

export type Adapter = {
  slot: string
  detail: string
  swap: string
}

export const adapters: Adapter[] = [
  {
    slot: 'Event Log',
    detail: 'The ordered source of accepted domain facts for one Specter App.',
    swap: '@specter-ts/sqlite · @specter-ts/postgres · custom adapter',
  },
  {
    slot: 'Slice Store',
    detail: 'Private state that each Slice catches up from relevant Events.',
    swap: '@specter-ts/sqlite · @specter-ts/postgres · custom adapter',
  },
  {
    slot: 'Client boundary',
    detail: 'How UI or server code reaches the completed app.',
    swap: 'typed JSON-over-HTTP envelopes · direct in-process envelopes',
  },
  {
    slot: 'Reaction scheduler',
    detail:
      'A rebuildable coordination index that wakes and serializes Reaction work.',
    swap: 'process-local default · @specter-ts/sqlite · custom adapter',
  },
]

export const observabilityOutput = `todo-reference / addTodo
specification  sha256:4c6675c9d9e5…
scenarios      2 exact Given / When / Then paths

runtime
  command.completed       12
  reaction.run.completed   4
  failures                 0

dashboard
  whole-Slice map · GWT lanes · activity · causal trace`

export type AgentBenefit = {
  title: string
  body: string
}

export const agentBenefits: AgentBenefit[] = [
  {
    title: 'Minimal context per task',
    body: 'A Slice keeps its specification and implementation together in one feature folder, so an agent can focus on one behavior boundary.',
  },
  {
    title: 'Guardrails from scenarios',
    body: 'Scenarios state exact examples. The scenario runner checks the selected implementation against that contract.',
  },
  {
    title: 'Construction-time conformance',
    body: 'App construction validates registered Events, scenarios, and implementations before exposing the runtime.',
  },
  {
    title: 'Typed envelope contract',
    body: 'Command and Query names stay typed inside explicit envelopes across in-process and project-owned transport boundaries.',
  },
]
