# Todos Reference Application

This feature is Specter's executable reference application. It demonstrates the
current portable Slice pipeline with Event Definitions, Event Drafts, Command
Slices, Query Slices, and a Reaction Slice.

The slices use explicit SQLite-backed Slice State. Command handlers emit Event Drafts for accepted commands and reject expected domain failures by throwing instead of emitting error events.

Each Slice directory contains a dependency-free `spec.ts`, generated portable
`spec.json`, and runtime `impl.ts`. Specs import only `create*Slice` and `event`
from `@specter-ts/spec` and default-export exactly one specification. Project
scripts regenerate the ignored JSON before development and checks;
implementations consume only that document, then add schemas, stores, apply
handlers, plugins, and handlers. Event types are kebab-case, scenario payloads
are exact, and generated domain IDs are supplied in command inputs.

Each Slice has a stable name plus a human-readable description, and each scenario has its own description. Scenario tests use those descriptions directly as suite and test names through `testSliceImplementations`.
