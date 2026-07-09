# Agent Guidance

This file is public project guidance for coding agents and agent-assisted contributors. Adapt the instructions to your agent's toolset; if a named tool is unavailable, use the closest equivalent and explain the difference in the PR.

## Project Runtime

- Dev and preview servers use fixed five-digit ports.
- The Todo and Booking reference apps use port `41731`; Threadplane Reference uses port `41732`.
- `vite.config.ts` sets `server.strictPort` and `preview.strictPort` to `true`, so Vite must fail instead of falling back to another port if its fixed port is occupied.
- If a fixed port is already in use, treat that as a conflict to investigate. Do not choose a replacement port unless the user explicitly asks for one.

## Code Style

- Avoid hasty abstractions. Prefer duplicating nearby domain schemas and logic until a real shared boundary appears.
- Do not reuse Zod schemas unless there is a clear necessity; ask first before introducing shared schemas.
- Keep Specter examples small, explicit, and scenario-tested.
- Prefer changes that are easy for app developers and coding agents to inspect feature-by-feature.

## Pull Request Workflow

- Do not use GitHub issues for work tracking in this repo.
- Start each public-facing improvement on its own branch and open a draft PR before implementation changes.
- Keep one coherent public-facing improvement per PR.
- Create stacked PRs only after maintainer approval.
- Update the PR body with what changed, validation commands, and known risks.

## Validation

Run the narrowest relevant checks while working, then run the full baseline before marking a PR ready:

```sh
pnpm check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
