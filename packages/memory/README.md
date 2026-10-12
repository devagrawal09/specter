# `@specter-ts/memory`

Deterministic in-memory adapters for Specter tests, examples, and entirely
in-process applications.

```ts
import {
  createMemoryEventLogLayer,
  createMemorySliceStoreLayer,
} from '@specter-ts/memory'
import { Layer } from 'effect'

const dependencies = Layer.mergeAll(
  createMemoryEventLogLayer(),
  createMemorySliceStoreLayer(TodosStore, () => ({ todos: [] })),
)
```

`persistSliceSnapshots(snapshotStore, { slices })` gives memory Slice Stores
that start each Slice from its saved snapshot of the same version and save
theirs back every minute and when the scope closes, so a process folds only
the log's tail at startup. A Slice whose specification or `stateVersion`
changed folds the log instead of reading a snapshot of the old shape, keeping
the highest cursor its name reached, so a Reaction does not deliver again what
it delivered. With `slices`, the names the runtime serves, the snapshots of
Slices it no longer registers are removed.

The Event Log purges a key's Events but the types the purge keeps
(`purge({ name, value }, { keep })`), never reusing an order.

The Event Log serializes transactions, atomically enforces expected versions,
persists every commit boundary and idempotency receipt, and assigns deterministic Event metadata. The
Slice Store commits projection state and its cursor together and rolls both
back when an apply transaction fails. Supply a custom `clone` function for
Slice State that cannot be cloned with `structuredClone`.

The memory Event Log does not impose JSON serialization. Remote transports and
SQL adapters have their own serialization boundaries.
