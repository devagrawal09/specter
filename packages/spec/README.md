# `@specter-ts/spec`

Portable Specter Slice specification authoring, validation, export, canonical
serialization, and digests.

Author a `spec.ts` with the dependency-free builders and default-export exactly
one specification:

```ts
import { createCommandSlice, event } from '@specter-ts/spec'

const addTodo = createCommandSlice('addTodo')
  .description('Adds a todo.')
  .scenarios({
    description: 'Adds one.',
    given: [],
    when: { todoId: 'todo-1', title: 'Ship it' },
    expect: [event('todo-added', { todoId: 'todo-1', title: 'Ship it' })],
  })

export default addTodo
```

Export an explicit file, directory, or glob. Each source is evaluated in an
isolated subprocess and produces ignored adjacent `spec.json`; no manifest is
created.

```sh
specter-spec export src/features
specter-spec export src/features/todos/add-todo/spec.ts
specter-spec export 'src/features/**/spec.ts'
```

Export requires Node.js 20.19 or newer. Each source runs in a fresh process
through Specter's bundled TypeScript loader, using the nearest `tsconfig.json`
for project path aliases and TypeScript syntax.

The v1 document has a strict, versioned portable-JSON profile: unknown fields,
unsafe integers, non-finite numbers, sparse arrays, `undefined`, bigint,
functions, symbols, class instances, and cycles are rejected. Digests are
`sha256:<lowercase hex>` over RFC 8785 JCS-compatible canonical JSON using raw
UTF-16 key ordering and ECMAScript string/number serialization.

Implementations never import or execute `spec.ts`. TypeScript loads the JSON
through the matching `implementCommand`, `implementQuery`, or
`implementReaction` function from `@specter-ts/core`; runtimes in Go, Rust, or
other languages load and validate the same JSON contract. This is an
intentional clean break from `@specter-ts/core/spec` and direct specification
imports. Use the `codemods/specter-json-specs` package when migrating repository
code.
