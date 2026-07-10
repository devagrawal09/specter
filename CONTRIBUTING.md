# Contributing

Specter uses a PR-first workflow. Please do not open GitHub issues for work tracking.

## Workflow

1. Create a branch for one coherent public-facing improvement.
2. Open a draft PR before implementation changes.
3. Describe the goal, scope, intended build plan, validation plan, and risks in the PR body.
4. Make small, frequent commits.
5. Update the PR body as the work changes.
6. Run validation before marking the PR ready.

Stacked PRs are welcome only after maintainer approval at a logical stack point.

## Development setup

```sh
corepack enable
corepack prepare pnpm@11.1.3 --activate
pnpm install
```

## Validation baseline

```sh
pnpm check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

If a command cannot run in your environment, include the exact command and failure output in the PR.

## Public-safety expectations

- Do not commit real `.env` files, secrets, database files, local runtime data, or generated build outputs.
- Add or update safe `.env.example` files when introducing configuration.
- Keep app/package metadata MIT-consistent.
