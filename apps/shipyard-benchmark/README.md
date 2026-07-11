# Shipyard Benchmark

This package is the canonical spec-only Shipyard Specter review app. It lives inside the Specter monorepo so review happens against real TypeScript Specter primitives instead of a detached note format.

The older `/home/lucifer/work/active/shipyard-specter-benchmark` YAML notes are non-canonical historical notes only. The canonical artifact for Shipyard review is this package.

Phase 1 intentionally includes no product UI, database migrations, database adapters, OpenCode transport implementation, GitHub API calls, or Markdown conversion. It only defines the OpenCode contract, event definitions, review fixtures, and the planned granular slice groups.

OpenCode mapping is direct: inbound OpenCode names map to same-shaped Specter events, and outbound operations map to same-shaped command envelopes. There is no normalized OpenCode event layer.

Slice specs and scenarios are deferred to Phase 2 so they can use complete command, query, and reaction slice registrations without placeholder handlers.
