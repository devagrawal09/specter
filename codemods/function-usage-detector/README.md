# Function usage detector

Report named JavaScript and TypeScript functions that are either shorter than a
configured line threshold or have fewer than a configured number of direct call
sites. The codemod never edits source files.

By default, it reports a function when either condition is true:

- its body has fewer than 3 non-blank, non-comment code lines; or
- workspace semantic analysis resolves fewer than 3 direct call sites.

Each finding is printed as a warning, recorded in the
`function-usage-findings` metric, and returned in two report artifacts:

- `.codemod-reports/function-usage/function-usage-report.json` is the canonical,
  versioned machine-readable report.
- `.codemod-reports/function-usage/function-usage-report.html` is a
  self-contained interactive report with summary cards, search, reason filters,
  sorting, and expandable direct-call evidence.

The workflow only writes those report artifacts. It never edits analyzed source
files.

## JSON report

The JSON document includes:

- the schema version, generation time, thresholds, target, detector semantics,
  and explicit limitations;
- aggregate counts for findings, affected files, reasons, and function kinds;
- stable finding ids and exact definition locations;
- body code-line counts;
- resolved-reference, non-call-reference, direct-call-site, and distinct
  direct-caller counts; and
- every resolved direct call site with its file, line, column, and enclosing
  caller context.

The report's `usageMetric` is `resolved-direct-call-sites`. The detector still
applies its threshold to call sites rather than unique callers; the distinct
caller count is supporting evidence so downstream tools can evaluate either
interpretation.

## Supported functions

The detector covers named function and generator declarations plus
identifier-bound arrow, function, and generator expressions. Anonymous
callbacks, class and object methods, and function values stored in destructuring
patterns are intentionally skipped.
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

Choose a different target-relative output directory with:

```bash
pnpm dlx codemod@1.12.13 workflow run -w workflow.yaml -t /path/to/project \
  --param report_directory=.reports/function-usage
```

Override either threshold when needed:

```bash
pnpm dlx codemod@1.12.13 workflow run -w workflow.yaml -t /path/to/project \
  --param minimum_lines=5 \
  --param minimum_call_sites=2
```

The workflow scans JavaScript, JSX, TypeScript, and TSX source files. It excludes
dependencies, declaration files, codemod packages, coverage, and common
generated trees such as `build`, `dist`, `generated`, `out`, `target`, `.next`,
`.nuxt`, `.svelte-kit`, and `.turbo` by default.

Codemod dry-run mode performs the analysis and emits warnings/metrics, but the
runtime does not persist cross-step state or filesystem artifacts in dry-runs.
The report step therefore prints an explicit skip message. Run without
`--dry-run` to write the JSON and HTML files; analyzed source files still remain
unchanged.

## Development

```bash
pnpm test
pnpm check-types
pnpm validate
```

`pnpm test` proves that report-only analysis leaves every fixture unchanged,
checks emitted metrics snapshots, validates the JSON summary, tests output-path
containment and HTML escaping, verifies the self-contained report shell, and
runs a cross-file workflow smoke test over the generated artifacts.

The optional `pnpm validate-package:ai` command invokes an external AI validator
that may transmit package source. It is intentionally excluded from `pnpm
verify` and the root test baseline; run it only with explicit authorization.

## License

MIT
