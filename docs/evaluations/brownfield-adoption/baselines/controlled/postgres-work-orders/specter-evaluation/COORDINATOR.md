# Coordinator handoff

This directory is an overlay on builder commit `a131c2e1ea9d80fc0c1affdd72f9983712c35e0b`. It records the legacy snapshot and the selected `close-work-order` operation without changing application behavior.

## Acceptance gate

1. Confirm the overlay commit has this builder commit as its sole parent.
2. Confirm `legacy-snapshot.json` still matches `src/seed.ts` and `test/live/postgres.test.ts`; record its SHA-256 before issuing an assignment.
3. Review and accept `selected-operation.json`, including its rejection matrix, atomic transaction, durable notification, and legacy-reader requirements.
4. Reuse the existing baseline commands: `pnpm typecheck`, `pnpm test`, and `pnpm build`.
5. In an isolated coordinator-owned environment, reuse the existing live flow from the project README: start PostgreSQL on its fixed port, then run migration, seed, and `pnpm test:live` commands. Do not weaken or replace those tests.

## Assignment/config handoff

- Do not add `specter-assignment.json` until the coordinator has accepted both JSON contracts and recorded the snapshot hash.
- Keep tool installation and generated configuration out of this prep commit.
- When an assignment is accepted, point it at the two JSON contracts, the verifier entrypoint `verifier/runner.ts`, and the existing validation commands above.
- Implement the two verifier TODO stubs only in the assignment/implementation phase. The verifier must use an isolated database, reset through the existing seed, exercise the selected HTTP operation, and preserve all legacy tests.
- Any proposed event payload must carry coordinator-supplied IDs and ISO timestamps; handlers must not invent domain identity or time.
