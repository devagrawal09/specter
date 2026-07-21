# `@specter-ts/core/spec`

**Status:** Specter 0.4 main-branch preview. This entrypoint is not the stable
npm 0.2.1 API.

```ts
import {
  createCommandSlice,
  createQuerySlice,
  createReactionSlice,
  event,
} from '@specter-ts/core/spec'
```

This entrypoint defines Slice Specifications without importing runtime,
persistence, or implementation details. It has four runtime exports and ten
type exports.

## Runtime exports

| Export | Purpose |
| --- | --- |
| `createCommandSlice(name)` | Starts a staged Command Slice Specification. |
| `createQuerySlice(name)` | Starts a staged Query Slice Specification. |
| `createReactionSlice(name)` | Starts a staged Reaction Slice Specification. |
| `event(type, payload)` | Creates an exact Scenario Event example for `given` or a Command `expect`. |

## Type exports

| Export | Purpose |
| --- | --- |
| `AcceptedCommandScenario<TWhen>` | A Command Scenario with one or more expected Scenario Events and no rejection. |
| `RejectedCommandScenario<TWhen>` | A Command Scenario with no expected Events and an optional exact rejection reason. |
| `CommandScenario<TWhen>` | Union of accepted and rejected Command Scenarios. |
| `QueryScenario<TWhen, TExpect>` | A Query Scenario with Given Events, Query input, and final public output. |
| `ReactionScenario<TPayload>` | A Reaction Scenario with Given Events and zero or one expected Plugin effect for one handler run. The current array type is broader than the executable cardinality. |
| `ScenarioEvent<TType, TPayload>` | Branded exact Event example returned by `event(...)`. |
| `NonEmptyScenarios<TScenario>` | Tuple requiring at least one Scenario. |
| `CommandSliceSpec<TName, TScenarios>` | Immutable Command specification and its `inputSchema(...)` completion stage. |
| `QuerySliceSpec<TName, TScenarios>` | Immutable Query specification and its `inputSchema(...)` completion stage. |
| `ReactionSliceSpec<TName, TScenarios>` | Immutable Reaction specification and its `outputSchema(...)` completion stage. |

These are all public exports from `@specter-ts/core/spec`. Implementation types
such as `CommandSlice`, Event Definitions, adapters, and the Specter App are
exported from `@specter-ts/core` instead.

## Specification lifecycle

All builders begin with the same structural stages:

```text
create...Slice(name) -> description(text) -> scenarios(first, ...rest)
```

The result is an immutable Slice Specification with `stage`, `kind`, `name`,
`description`, and `scenarios`. Calling the next method begins the separate
Slice Implementation stages:

```text
Command:  inputSchema -> store -> apply* -> handle
Query:    inputSchema -> outputSchema -> store -> apply* -> handle
Reaction: outputSchema -> plugin -> store -> apply* -> handle
```

An omitted schema argument or a type argument such as
`.inputSchema<MyInput>()` supplies static typing only. Passing a Standard Schema
enables runtime validation and transformation. Use runtime schemas for
untrusted transport input and public output.

## Command specification

```ts
import { createCommandSlice, event } from '@specter-ts/core/spec'

export const addTodoSpec = createCommandSlice('addTodo')
  .description('Adds a todo to the list.')
  .scenarios(
    {
      description: 'Creates a todo with the provided title.',
      given: [],
      when: { todoId: 'todo-1', title: 'Ship it' },
      expect: [event('todo-added', { todoId: 'todo-1', title: 'Ship it' })],
    },
    {
      description: 'Rejects a blank title.',
      given: [],
      when: { todoId: 'todo-1', title: '   ' },
      expect: [],
      reject: { reason: 'Todo title is required' },
    },
  )
```

An accepted Command Scenario must expect at least one Event. A rejected
Command Scenario must expect no Events. `reject.reason`, when present, is
matched exactly by the Scenario runner. Invalid schema input is transport
validation, not a rejected domain Scenario.

## Query specification

```ts
import { createQuerySlice, event } from '@specter-ts/core/spec'

export const todosQuerySpec = createQuerySlice('todosQuery')
  .description('Lists visible todos by status.')
  .scenarios({
    description: 'Returns active todos.',
    given: [
      event('todo-added', { todoId: 'todo-1', title: 'Ship it' }),
      event('todo-added', { todoId: 'todo-2', title: 'Review it' }),
      event('todo-completion-changed', {
        todoId: 'todo-2',
        completed: true,
      }),
    ],
    when: { status: 'active' },
    expect: [
      { id: 'todo-1', title: 'Ship it', completed: false, removed: false },
    ],
  })
```

`expect` is the final public value after output-schema transformation, not the
private Slice State or a raw database row.

## Reaction specification

```ts
import { createReactionSlice, event } from '@specter-ts/core/spec'

function completedTodoEvents(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const todoId = `todo-${index + 1}`
    return [
      event('todo-added', { todoId, title: todoId }),
      event('todo-completion-changed', { todoId, completed: true }),
    ]
  }).flat()
}

export const todoCompletionCheerSpec = createReactionSlice(
  'todoCompletionCheer',
)
  .description('Requests a cheer when a completion milestone is reached.')
  .scenarios({
    description: 'Requests a cheer when five todos are completed.',
    given: [
      ...completedTodoEvents(4),
      event('todo-added', { todoId: 'todo-5', title: 'todo-5' }),
      event('todo-completion-changed', { todoId: 'todo-5', completed: true }),
    ],
    expect: [{ type: 'createTodoCheer', payload: { milestone: 5 } }],
  })
```

Reaction `expect` values are the final values passed to the Reaction Plugin
after output transformation. An empty array means no effect is requested.

## Constraints

- Use a unique, human-readable `description` for every Scenario.
- Use lower-camel-case Slice names and kebab-case Event types.
- Use `event(type, payload)` in specifications; do not import or call Event
  Definitions from `spec.ts`.
- Include every domain ID and timestamp in exact Scenario payloads. Event Log
  IDs, global order, and recorded timestamps are metadata and do not belong in
  the payload.
- Across one Slice's Scenarios, `given` Event types must exactly equal its
  implementation's `.apply(...)` Event types.
- A Command handler may emit only Event types represented by accepted outcomes.
- Keep `spec.ts` independent of schemas, stores, plugins, databases, servers,
  implementations, and sibling Slices.
- Specification wrappers and arrays are frozen structurally. Caller-owned
  payload objects are not cloned or deep-frozen.

## Related documentation

- [Writing specifications](../specifications/writing-specifications.md)
- [Slice tests](../specifications/slice-tests.md)
- [Conformance](../specifications/conformance.md)
- [Vertical Slice Architecture](../architecture/vertical-slice-architecture.md)
- [Core runtime API](core-runtime.md)
