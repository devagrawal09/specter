# Storage-agnostic core

Specter core exposes storage-agnostic slice, app, scenario, and typed client APIs; concrete persistence such as Drizzle with SQLite belongs in adapters or non-default entrypoints. Slice definitions choose explicit per-slice stores with adapter-provided state parameters instead of depending on a framework-owned database type, so the same Specter App model can run against server databases, in-memory stores, local storage, or other runtimes.
