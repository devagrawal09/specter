# OpenSpec workflow

Specter uses OpenSpec only as a temporary plan for ongoing work. Each change has
one `spec.md`. Completed specs are not project documentation and are not kept on
`main`.

Each app and package has its own independent OpenSpec root:

```text
openspec/                    repository-wide changes only
apps/<name>/openspec/        changes owned by one app
packages/<name>/openspec/    changes owned by one package
```

Codex may stay open at the repository root, but every OpenSpec command must use
the owning app or package as its working directory. Starting Codex at the root
does not make a change repository-wide.

## Choose the owner

- Use `apps/<name>/openspec/` for a change owned by that app.
- Use `packages/<name>/openspec/` for a change owned by that package.
- Use the top-level `openspec/` only when no single app or package can own the
  change, such as workspace organization, shared tooling, contribution rules,
  or releases.
- If several workspaces have independent changes, give each one its own change
  and local `spec.md`.

Confirm the selected root before creating or reading a change:

```sh
cd apps/reference
openspec context --json
```

The output must name `apps/reference` as the OpenSpec root. Substitute the real
owner path.

## One-file lifecycle

Install the CLI if needed:

```sh
npm install -g @fission-ai/openspec@1.7.0
```

The repository-level `.codex/skills/` directory contains the OpenSpec Codex
skills. Restart Codex after cloning or updating the repository so it discovers
them.

Start a change by naming its owner:

```text
$openspec-propose Add bulk todo completion in apps/reference.
```

This creates only:

```text
apps/reference/openspec/changes/<change-name>/
├── .openspec.yaml
└── spec.md
```

The `spec.md` holds the goal, scope, required behavior, tasks, validation, and
documentation work. Use `$openspec-apply-change` to implement it and keep its
checkboxes current. `$openspec-explore` is optional before proposing a change.

Before merging the PR:

1. Finish the implementation and checks.
2. Update the relevant README or durable docs with anything that must remain
   true after the change. If nothing needs documenting, record that decision in
   the spec while the work is active.
3. Delete the whole `openspec/changes/<change-name>/` directory.

Do not archive or sync the spec. The Git history and PR retain its working
record; `main` retains the code, tests, and durable documentation.

## Keep OpenSpec and Specter distinct

The temporary OpenSpec file owns change intent, scope, tasks, and checks.
Specter `spec.ts` and exported `spec.json` files own exact Slice examples, Event
payloads, outputs, and rejection behavior.

Do not copy exact Specter Scenarios into the OpenSpec file. State the intended
result, then point tasks at the relevant Specter specifications and tests.

## Validation and new workspaces

Validate every configured root from the repository root:

```sh
pnpm openspec:validate
```

When adding a direct app or package, copy a neighboring `openspec/config.yaml`
and its `openspec/schemas` link, then change the planning scope to the new path.
The shared schema remains in the top-level `openspec/schemas/` directory.

Do not write specs for untouched code. Create one only when real work begins,
and remove it before that work merges.
