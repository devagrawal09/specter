# Todos Reference Application

This feature is Specter's executable reference application. It demonstrates the current two-file Slice API with Event Definitions, Event Drafts, Command Slices, Query Slices, and a Reaction Slice.

The slices use explicit SQLite-backed Slice State. Command handlers emit Event Drafts for accepted commands and reject expected domain failures by throwing instead of emitting error events.

Each Slice directory contains a dependency-free `spec.ts` and a runtime `impl.ts`. Specs import only `create*Slice` and `event` from `@specter-ts/spec`; implementations add schemas, stores, apply handlers, plugins, and handlers. Event types are kebab-case, scenario payloads are exact, and generated domain IDs are supplied in command inputs.

Each Slice has a stable name plus a human-readable description, and each scenario has its own description. Scenario tests use those descriptions directly as suite and test names through `testSliceImplementations`.
