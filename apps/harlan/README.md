# Harlan

Harlan is the workspace app for portable task-specific workflow authoring and
execution. The current scaffold is intentionally browser-only and contains no
language, persistence, transport, or Specter Slice behavior yet.

```sh
pnpm --filter @specter/harlan dev
pnpm --filter @specter/harlan test
```

Development and preview both bind to `127.0.0.1:41740` with strict port
selection.

## Planned internal boundaries

- `src/language/` will own the portable syntax contract and parser.
- `src/runtime/` will own deterministic evaluation and execution limits.
- `src/host/` will own host-neutral tool and workflow registries.
- `src/features/` will own Specter Slice specifications and implementations.
- `src/transport/` will own remote envelope and subscription boundaries.
- `src/ui/` will own browser-only workflow authoring and inspection views.

The language and runtime boundaries must not import Specter, browser APIs,
filesystem APIs, shell APIs, or task-specific tools. Hosts inject capabilities;
the Specter app is one host of the portable runtime.
