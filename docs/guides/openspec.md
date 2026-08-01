# OpenSpec workflow

Specter uses independent OpenSpec roots so each app and package owns its own
requirements and change history.

```text
openspec/                    repository-wide organization only
apps/<name>/openspec/        one independent root per app
packages/<name>/openspec/    one independent root per package
```

OpenSpec resolves the nearest `openspec/` directory by walking up from the
current working directory. Always run its commands from the app or package that
owns the behavior.

Codex itself may remain open at the repository root. Its shell command working
directory must still be set to the owning app or package for every OpenSpec
command. Starting Codex at the repository root does not make a change
repository-wide.

## Choose the owning root

- Use `apps/<name>/openspec/` for behavior owned by that application.
- Use `packages/<name>/openspec/` for behavior owned by that package.
- Use the top-level `openspec/` only for workspace organization, shared tooling,
  contribution rules, releases, and other repository-wide behavior.
- For work spanning several owners, create one change in each affected root.
  Add a root change only when repository-wide coordination is itself part of the
  work.

Check the selected root before every new change:

```sh
cd apps/reference
openspec context --json
```

The output must name `apps/reference` as the OpenSpec root. Substitute the
intended app or package path.

## Work with Codex

Install the CLI on the machine so generated Codex skills can call `openspec`
directly:

```sh
npm install -g @fission-ai/openspec@1.7.0
```

The repository-level `.codex/skills/` directory contains the OpenSpec skills.
After cloning or updating the repository, restart Codex so it discovers them.

Tell Codex both the change and its owner, for example:

```text
$openspec-propose Add bulk todo completion in apps/reference.
```

The agent must run OpenSpec commands with `apps/reference` as its working
directory. The resulting proposal, delta specs, design, tasks, and archive stay
inside `apps/reference/openspec/`.

Use the normal cycle:

```text
$openspec-explore
$openspec-propose
$openspec-apply-change
$openspec-sync-specs
$openspec-archive-change
```

## Keep OpenSpec and Specter distinct

OpenSpec owns change intent, scope, capability requirements, design decisions,
tasks, and planning history. Specter `spec.ts` and exported `spec.json` files own
exact Slice examples, Event payloads, outputs, and rejection behavior.

Do not copy exact Specter Scenarios into OpenSpec Markdown. State the observable
capability in OpenSpec, then point implementation tasks at the relevant Specter
Slice specifications and tests.

## Validation and maintenance

Validate every root from the repository root:

```sh
node scripts/validate-openspec.mjs
```

`pnpm openspec:validate` is an equivalent package-script alias.

Validate only the current owner from inside its directory:

```sh
openspec validate --all --strict --no-interactive
```

When adding a direct app or package, initialize its independent root without
duplicating the repository-level Codex skills:

```sh
openspec init apps/new-app --tools none --profile core --no-animation
```

Then replace the generated generic context with the same ownership rules used
by neighboring roots. Run `openspec update` at the repository root after
upgrading OpenSpec so the shared Codex skills stay current.

Do not backfill specifications for untouched code. Add them when real changes
need them.
