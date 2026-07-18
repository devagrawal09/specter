# Coordinator handoff

This directory is an overlay on builder commit `a4b21a424f43c6fc2f25f1074217be8ea44d97db`. It records the legacy snapshot and the selected `approve-refund` operation without changing application behavior.

## Acceptance gate

1. Confirm the overlay commit has this builder commit as its sole parent.
2. Confirm `legacy-snapshot.json` still matches `scripts/seed.ts` and `tests/live/replica-set.test.ts`; record its SHA-256 before issuing an assignment.
3. Review and accept `selected-operation.json`, including its rejection matrix, transaction, durable Agenda work, and legacy-reader requirements.
4. Reuse the existing baseline commands: `pnpm typecheck`, `pnpm test`, and `pnpm build`.
5. In an isolated coordinator-owned environment, reuse the README setup and run `RUN_LIVE_TESTS=1 pnpm test:live`. That suite owns its fixtures, performs a real MongoDB stop/restart, proves Agenda readiness, and must not be weakened or replaced.

## Assignment/config handoff

- Do not add `specter-assignment.json` until the coordinator has accepted both JSON contracts and recorded the snapshot hash.
- Keep tool installation and generated configuration out of this prep commit.
- When an assignment is accepted, point it at the two JSON contracts, the verifier entrypoint `verifier/runner.ts`, and the existing validation commands above.
- Implement the two verifier TODO stubs only in the assignment/implementation phase. The verifier must use an isolated replica set, reset through the existing seed, exercise the selected HTTP operation, and preserve exact fixture cleanup.
- Any proposed event payload must carry coordinator-supplied IDs and ISO timestamps; handlers must not invent domain identity or time.
