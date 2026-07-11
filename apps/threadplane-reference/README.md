# Threadplane Reference

Threadplane Reference is a Specter reference app for workspace-oriented chat. It demonstrates how a richer app can model workspaces, messages, deterministic agent replies, server functions, and durable SQLite-backed slice state on top of `@specter-ts/core`.

## What it demonstrates

- A multi-workspace app built from vertical Specter features.
- Command/query/reaction slices for chat and workspace behavior.
- TanStack Start + Solid UI integrated with Specter server functions.
- A durable local SQLite runtime for reference-app development.
- Scenario tests that document expected event and read-model behavior.

## Run locally

From the repo root:

```sh
pnpm install
pnpm dev:threadplane
```

The app uses fixed port `41732`. If the port is already occupied, stop the conflicting process instead of letting Vite fall back to another port.

## Validate

```sh
pnpm --filter @specter/threadplane-reference typecheck
pnpm --filter @specter/threadplane-reference test
pnpm --filter @specter/threadplane-reference build
```

End-to-end tests are separate:

```sh
pnpm --filter @specter/threadplane-reference test:e2e
```

## Public status

This app is a reference/dogfood surface for Specter patterns, not a polished end-user product. App-specific walkthrough docs will be expanded in follow-up PRs.
