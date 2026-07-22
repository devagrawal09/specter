# create-specter

Creates a Specter starter and provides deterministic authoring generators for
existing projects.

## Create a project

```bash
npx create-specter my-app --install
```

## Generate a vertical Slice

Run the command from the project root. Slice names must be lower camel case and
feature names must be kebab-case.

```bash
npx create-specter generate slice requestInvite \
  --kind command \
  --feature invitations \
  --dry-run
```

Remove `--dry-run` after reviewing the file list. The generator creates:

- required `spec.ts` and `impl.ts` files with named exports;
- optional Slice-owned `events.ts` and `projection.ts` support files;
- optional local `registry.ts` and focused `scenarios.test.ts` wiring;
- optional `db-schema.ts` re-export and `MIGRATION.md` checklist.

The support files are concrete starter choices, not additional framework
requirements. Keep `spec.ts` and `impl.ts` even if the Event catalog,
projection, registry, or tests are organized differently in an existing app.

Supported kinds are `command`, `query`, and `reaction`. Existing files are
never replaced unless `--force` is supplied. The generated registry is local on
purpose: merge its explicit registration and Event arrays into the app registry
after reviewing the domain boundary.

## Verify the generator

```bash
pnpm --filter create-specter typecheck
pnpm --filter create-specter test
pnpm --filter create-specter build
```
