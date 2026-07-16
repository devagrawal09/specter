# Specter envelope API codemod

Migrates Specter 0.2 flat runtime and Proxy-client calls to Specter 0.3 typed
envelopes. The transform is AST-first and intentionally requires the caller to
classify every Command and Query Slice; it never guesses from a name suffix.

## Rewrites

Given `command_names=addTodo` and `query_names=todosQuery`:

```ts
await app.addTodo(payload)
await app.todosQuery(input)
app.subscribe.todosQuery(input, { signal })
```

becomes:

```ts
await app.command({ type: 'addTodo', payload })
await app.query({ type: 'todosQuery', payload: input })
app.subscribe({ type: 'todosQuery', payload: input }, { signal })
```

A sole `defineSpecterClient` import/factory is migrated to the canonical
project-owned browser transport:

```ts
import { createSpecterBrowserTransport } from './transport/specter-browser'

export const specterClient =
  createSpecterBrowserTransport<AppConfig>('/api')
```

The binding name is deliberately preserved so imports across files remain
valid. Rename it to the canonical `specterTransport` in a separate
binding-aware rename if desired.

## Safety boundaries

- Only member calls on `receiver_names` are eligible.
- Only names explicitly listed in `command_names` or `query_names` are changed.
- Computed properties, zero/multiple-argument flat calls, mixed legacy client
  imports, and unknown operations are preserved.
- The legacy factory rewrite is limited to its conventional module-level
  variable declaration, so shadowed functions are never renamed.
- Unknown calls on configured receivers are reported with the parameter needed
  to classify them.
- Existing `command`, `query`, and `subscribe` envelopes are idempotent no-ops.
- The generated browser transport must already exist; core is intentionally
  transport-agnostic.

## Dry-run and apply

From this package directory, substitute the complete Slice-name lists for the
target application:

```bash
npx codemod workflow run -w . -t /path/to/project --dry-run \
  --param command_names=addTodo,changeTodoCompletion,removeTodo \
  --param query_names=todosQuery,todoCheers \
  --param receiver_names=app,specterClient,specterTransport
```

Apply the same reviewed migration by removing `--dry-run`:

```bash
npx codemod workflow run -w . -t /path/to/project \
  --param command_names=addTodo,changeTodoCompletion,removeTodo \
  --param query_names=todosQuery,todoCheers \
  --param receiver_names=app,specterClient,specterTransport
```

Override `transport_module` when the legacy client module and new transport
module are not siblings.

## Development

```bash
pnpm test
pnpm check-types
npx codemod workflow validate -w workflow.yaml
npx codemod ai call validate_codemod_package --input '{"package_path":"."}'
pnpm verify
```

The repository root runs `pnpm verify:codemod` as part of its test and release
verification baseline, so positive fixtures, typechecking, workflow validation,
and package-surface validation cannot drift independently of a release.

Fixtures cover positive runtime/client calls, subscriptions, comments and
multiline payloads, idempotency, unknown methods, computed properties,
unrelated receivers, arity mismatches, and unsupported mixed client imports.

## License

MIT
