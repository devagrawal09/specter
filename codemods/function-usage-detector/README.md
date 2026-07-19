# Function usage detector

Report named JavaScript and TypeScript functions that are either shorter than a
configured line threshold or have fewer than a configured number of direct call
sites. The codemod never edits source files.

By default, it reports a function when either condition is true:

- its body has fewer than 3 non-blank, non-comment code lines; or
- workspace semantic analysis resolves fewer than 3 direct call sites.

Each finding is printed as a warning and recorded in the
`function-usage-findings` metric with its file, line, function name, function
kind, line count, call-site count, and match reason.

## Supported functions

The detector covers named function declarations and identifier-bound arrow or
function expressions. Anonymous callbacks, class and object methods, and
function values stored in destructuring patterns are intentionally skipped.
The current JavaScript/TypeScript semantic provider does not reliably connect a
method definition to member-expression calls, so skipping methods avoids
reporting misleading zero-call-site counts.

Only direct calls count. Passing a function as a callback, reading it as a
value, importing or exporting it, and calling `.call` or `.apply` do not count
as direct call sites.

## Run locally

From this package directory:

```bash
pnpm dlx codemod@1.12.13 workflow run -w workflow.yaml -t /path/to/project
```

Override either threshold when needed:

```bash
pnpm dlx codemod@1.12.13 workflow run -w workflow.yaml -t /path/to/project \
  --param minimum_lines=5 \
  --param minimum_call_sites=2
```

The workflow scans JavaScript, JSX, TypeScript, and TSX source files. It excludes
dependencies, generated output, coverage, declaration files, and codemod
packages by default.

## Development

```bash
pnpm test
pnpm check-types
pnpm validate
pnpm validate-package
```

`pnpm test` proves that report-only analysis leaves every fixture unchanged and
checks the emitted metrics snapshots.

## License

MIT
