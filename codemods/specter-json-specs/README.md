# specter-json-specs

Migrates Specter Slice authoring from `@specter-ts/core/spec` to `@specter-ts/spec` and makes implementations consume generated `spec.json` through the kind-specific `implementCommand`, `implementQuery`, or `implementReaction` API.

The transform targets only `spec.ts` and adjacent `impl.ts` pairs. It adds a default export to named specifications, preserves existing unrelated exports, replaces the direct TypeScript implementation import, and carries the literal Slice name as an explicit generic so application command/query registry types do not widen to `string`. Files without a recognized Specter builder or direct adjacent spec import are unchanged.

Run a dry run before applying:

```bash
pnpm dlx codemod@latest workflow run -w . --target /path/to/project --dry-run
pnpm dlx codemod@latest workflow run -w . --target /path/to/project
```

Afterward run `specter-spec export` before typecheck, tests, or build so adjacent ignored `spec.json` files exist.

## Development

```bash
pnpm test
pnpm check-types
pnpm dlx codemod@latest workflow validate -w workflow.yaml
```

## License

MIT
