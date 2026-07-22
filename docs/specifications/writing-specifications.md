# Writing executable specifications

A Specter specification is executable domain structure, not prose beside the implementation. It names one Command, Query, or Reaction Slice, states its intent, and records concrete Scenarios before choosing schemas, storage, projections, or effect integrations. The implementation then completes that same value through a type-directed builder.

This keeps *what must happen* in `spec.ts` and *how it happens* in `impl.ts`.

## Specification first

Import the specification surface from `@specter-ts/spec`:

```ts
import { createCommandSlice, event } from '@specter-ts/spec'

export default createCommandSlice('addTodo')
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
```

The result is portable JSON data. `specter-spec export` executes the default
export in an isolated TypeScript process and writes an adjacent `spec.json`.
Implementations consume that generated document, never the TypeScript builder
object directly.

## Scenario shapes

All Scenario descriptions must be non-empty and unique within their Slice. Every builder requires at least one Scenario.

### Command Scenarios

```ts
type CommandScenario =
  | {
      description: string
      given: readonly ScenarioEvent[]
      when: unknown
      expect: readonly [ScenarioEvent, ...ScenarioEvent[]]
      reject?: never
    }
  | {
      description: string
      given: readonly ScenarioEvent[]
      when: unknown
      expect: readonly []
      reject: { reason: string }
    }
```

An accepted Command Scenario declares one or more Events in exact order. A rejected Scenario declares no Events and must state the exact thrown error message as `reject.reason`. At runtime, a Command must emit at least one Event, and it may emit only Event types that appear in an accepted outcome somewhere in that Command's specification.

### Query Scenarios

```ts
type QueryScenario = {
  description: string
  given: readonly ScenarioEvent[]
  when: unknown
  expect: unknown
}
```

`given` builds the Query's projection. `when` is the public input. `expect` is the public, post-output-schema value. If an output schema transforms the handler result, write the transformed value in the Scenario; Specter decodes the actual output once and compares it directly.

### Reaction Scenarios

```ts
type ReactionScenario = {
  description: string
  given: readonly ScenarioEvent[]
  expect: readonly unknown[]
}
```

A Reaction has no `when`: new Events and caught-up Slice State are its input. Use `[]` when the handler should return `undefined` and `[effect]` when it should return one effect. The expected effect is the public, post-output-schema value. A single handler run does not represent multiple effects.

## Scenario Events and Event Definitions

Create specification data with `event(type, payload)`. It returns a branded `ScenarioEvent`; an ordinary runtime `{ type, payload }` Event draft is intentionally rejected in `given` and Command `expect` arrays.

Each Scenario Event must resolve to exactly one registered Event Definition:

```ts
import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const todoAddedEvent = createEventDefinition(
  'todo-added',
  z.object({
    todoId: z.string(),
    title: z.string(),
  }),
)
```

Event types use kebab-case. Event payload schemas are validation-only contracts: they must preserve Scenario, emitted, and persisted payloads one-to-one. Do not trim, coerce, strip unknown keys, or generate defaults inside an Event schema. Make such decisions in the Command handler before calling `definition.create(payload)`.

Runtime Event metadata is separate from the domain payload. `event(...)`
provides only type and example payload. Replay supplies deterministic `id` and
`recordedAt` values to apply handlers, then advances the Slice cursor separately
to the Event's one-based position.

## Complete the implementation in order

Import the generated document and start the kind-specific implementation
builder. This keeps infrastructure choices unavailable in `spec.ts` while
dogfooding the same contract that Go, Rust, and tooling consume:

```ts
import { implementCommand } from '@specter-ts/core'
import specification from './spec.json' with { type: 'json' }

export const addTodo = implementCommand(specification)
  .inputSchema<AddTodoInput>()
  .store(TodosStore)
  .handle(handleAddTodo)
```

Complete each kind in its required order:

| Slice kind | Required implementation order |
| --- | --- |
| Command | `inputSchema(...)` → `store(...)` → zero or more `apply(...)` → `handle(...)` |
| Query | `inputSchema(...)` → `outputSchema(...)` → `store(...)` → zero or more `apply(...)` → `handle(...)` |
| Same-app Command Reaction | `outputSchema(CommandEnvelopeSchema)` → `store(...)` → zero or more `apply(...)` → `handle(...)` |
| Custom/external Reaction | `outputSchema(...)` → `plugin(...)` → `store(...)` → zero or more `apply(...)` → `handle(...)` |

Call the schema steps even when relying on type parameters instead of a runtime schema. A type-only schema choice improves TypeScript inference but performs no runtime validation.

Every Event used in a Slice's `given` data must have exactly one matching `.apply(definition, handler)` on that Slice. Conversely, every apply registration must appear in at least one Given Scenario. Use the exact Event Definition instance from the app catalog, not another object with the same type string.

Slice State is a disposable, replayable projection. Apply handlers mutate only the store's write capability; Command, Query, and Reaction handlers receive its read capability. The Event Log remains authoritative.

## Write useful Scenarios

- Choose lower-camel-case Slice names that match envelope types, such as `addTodo` and `todosQuery`.
- Describe observable behavior, not implementation mechanics: “Trims surrounding whitespace before creating a todo,” not “Calls `.trim()`.”
- Use small, literal examples with stable IDs and values. Avoid clocks, randomness, network data, and shared mutable fixtures.
- Cover the accepted path, decision boundaries, and meaningful rejections. Do not encode every schema-validation failure as a domain Scenario.
- Keep Given histories minimal but sufficient. Their order is the domain history replayed into that Slice.
- Assert exact Event payloads and exact ordered Event batches. Avoid partial-match expectations.
- Keep `spec.ts` structural. It should import specification builders and local specification data, not databases, transports, runtime app wiring, or provider clients.

## Evolve an Event safely

An Event payload change affects more than its definition. It can touch Command outcomes, Given examples, and apply consumers across many Slices. Inspect the executable registry before editing:

```ts
import {
  analyzeEventPropagation,
  formatEventPropagation,
} from '@specter-ts/core/testing'

for (const report of analyzeEventPropagation(
  { events: todoEventDefinitions, slices: todoRegistrations },
  'todo-added',
)) {
  console.log(formatEventPropagation(report))
}
```

Update the Event Definition, all reported Scenario examples, every producer, and every apply consumer as one coherent change. Then run focused Slice tests and whole-app conformance. Because persisted Events are immutable history, also decide how old payloads remain decodable before deploying a schema change.

## Related documentation

- [Core specification API](../api-reference/spec.md)
- [Testing Slice implementations](./slice-tests.md)
- [Conformance](./conformance.md)
- [Vertical Slice Architecture](../architecture/vertical-slice-architecture.md)
- [Event sourcing](../architecture/event-sourcing.md)
- [File structure](../architecture/file-structure.md)
