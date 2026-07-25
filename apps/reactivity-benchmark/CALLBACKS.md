# Portable callback fixtures

Every implementation Scenario harness installs these synchronous fixtures in
the graph-local callback registry before replaying Given Events.

## Settlement fixtures

| Callback ID | Required behavior |
| --- | --- |
| `double-signal-1` | Reads `signal-1` once and returns twice its number value. |
| `sum-left-right` | Reads `left`, then `right`, and returns their sum. |
| `head-plus-one` | Reads `head` and returns its number value plus one. |
| `head-times-two` | Reads `head` and returns twice its number value. |
| `constant-zero-from-head` | Reads `head` and returns zero. |
| `expensive-constant-plus-one` | Reads `constant` and returns its value plus one. |
| `select-left-or-right` | Reads `selector`, then reads and returns `right` when true or `left` when false. |
| `read-head-three-times` | Reads `head` three times and returns the sum. |
| `double-head` | Reads `head` once and returns twice its number value. |
| `fresh-parity-record` | Reads `head` and returns a new `{ "parity": head % 2 }` record on every call. |
| `observe-computed-1` | Reads `computed-1` once and returns no value. |
| `observe-sum` | Reads `sum` once and returns no value. |
| `observe-downstream` | Reads `downstream` once and returns no value. |
| `observe-left-right` | Reads `left`, then `right`, and returns no value. |
| `throws-on-evaluation` | Throws an `Error` every time it is called. |

## Ownership-only fixtures

`double`, `triple`, `observe-value`, `observe-other-value`,
`observe-signal-1`, and `shared-callback` are registered deterministic
callbacks in scenarios that only test creation, identity, disposal, or Query
projection. They are not executed in those scenarios.

`missing-callback` is deliberately absent from every registry.
