# Shipyard Benchmark

This package is the canonical spec-only Shipyard Specter review app. It lives inside the Specter monorepo so review happens against real TypeScript Specter primitives instead of a detached note format.

The older `/home/lucifer/work/active/shipyard-specter-benchmark` YAML notes are non-canonical historical notes only. The canonical artifact for Shipyard review is this package.

Phase 1 intentionally includes no product UI, database migrations, database adapters, OpenCode transport implementation, GitHub API calls, or Markdown conversion. It only defines the OpenCode contract, kebab-case Event Definitions, review fixtures, and planned granular Slice groups.

OpenCode mapping is direct: inbound OpenCode names map to same-shaped Specter events, and outbound operations map to same-shaped command envelopes. There is no normalized OpenCode event layer.

Executable Slice work is deferred to Phase 2. Each Slice will first define its immutable name, description, and scenarios in `spec.ts`, then complete schemas, private Store, apply handlers, plugin when applicable, and handler in one or more `impl.ts` implementations. Phase 1 intentionally does not invent unfinished runtime Slices or placeholder implementations.
