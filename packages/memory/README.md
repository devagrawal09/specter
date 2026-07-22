# `@specter-ts/memory`

Deterministic in-memory adapters for Specter tests, examples, and entirely
in-process applications.

```ts
import {
  createImmediateReactionSchedulerLayer,
  createMemoryEventLogLayer,
  createMemorySliceStoreLayer,
} from '@specter-ts/memory'
import { Layer } from 'effect'

const dependencies = Layer.mergeAll(
  createMemoryEventLogLayer(),
  createImmediateReactionSchedulerLayer(),
  createMemorySliceStoreLayer(TodosStore, () => ({ todos: [] })),
)
```

The Event Log serializes transactions, atomically enforces expected versions,
persists idempotency receipts, and assigns deterministic Event metadata. The
Slice Store commits projection state and its cursor together and rolls both
back when an apply transaction fails. Supply a custom `clone` function for
Slice State that cannot be cloned with `structuredClone`.

The memory Event Log does not impose JSON serialization. Remote transports and
SQL adapters have their own serialization boundaries.
