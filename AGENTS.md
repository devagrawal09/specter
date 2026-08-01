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

## Architecture Changes

- Backward compatibility is not a default constraint. Prefer coherent breaking changes over legacy shims when old APIs conflict with a simpler design.
- Start from existing durable truth before adding coordination state. Make derived indexes rebuildable whenever possible.
- Keep core semantics smaller than adapter mechanics. Put locking, leases, retries, and persistence strategy behind adapter contracts.
- Keep optional guarantees optional. For example, wrap slow Reaction plugins with an outbox instead of forcing outbox machinery into every Reaction.

## OpenSpec Scope

- The repository root and every direct `apps/*` and `packages/*` folder are independent OpenSpec roots.
- Codex sessions start at the repository root, but the starting directory is not an OpenSpec scope signal.
- Before every OpenSpec read or write, identify the smallest owning app or package, run `openspec context --json` with that directory as the command working directory, and confirm the reported root matches the owner.
- Run all later OpenSpec commands for that change with the same app or package as the command working directory. Stop rather than writing if root resolution selects a different directory.
- Use the top-level `openspec/` root only when the change is truly repository-wide and cannot be owned by one app or package, such as workspace organization, shared tooling, contribution rules, or releases.
- Keep app and package behavior in the owning workspace. A change spanning several workspaces needs a separate OpenSpec change in each affected root; use a root change only for repository-wide coordination.
- Each active change has one temporary `openspec/changes/<change-name>/spec.md`. Do not create separate proposal, design, task, delta-spec, or archive files.
- OpenSpec is only for ongoing work. Before merge, update any lasting README or docs, then delete the whole change directory. Do not keep completed or archived OpenSpec changes on `main`.
- OpenSpec records temporary change intent, scope, tasks, and checks. Exact Slice inputs, Events, outputs, and rejection behavior remain in Specter `spec.ts`/`spec.json` files and executable Scenarios.
- Run `node scripts/validate-openspec.mjs` after changing any OpenSpec artifact or configuration.

## Pull Request Workflow

- Do not use GitHub issues for work tracking in this repo.
- The GitHub CLI (`gh`) is configured in the host environment, not the sandbox. Run `gh` commands with escalated host access; a sandbox authentication or connectivity failure does not mean `gh` is unavailable.
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

<!-- codemod-skill-discovery:begin -->
## Codemod Skill Discovery
This section is managed by `codemod` CLI.

- Core skill: `.agents/skills/codemod/SKILL.md`
- Package skills: `.agents/skills/<package-skill>/SKILL.md`
- Marker note: the core Codemod skill uses `codemod-compatibility: mcs-v1`; authored package skills for workflow `install-skill` use `codemod-compatibility: skill-package-v1`.
- Codemod AI CLI tools: `npx codemod ai docs`, `npx codemod ai dump-ast`, `npx codemod ai node-types`, `npx codemod ai tools`, `npx codemod ai resources`
- Codemod MCP: optional direct tool/resource integration for the same Codemod AI capabilities exposed by `npx codemod ai ...`.
- List installed Codemod skills: `npx codemod ai list --harness codex --format json`

<!-- codemod-skill-discovery:end -->
