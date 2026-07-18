# Coordinator handoff

This directory is an overlay on builder commit `057fa263d32cd79f3827f071a06639a15e2f6667`. It records the stable legacy snapshot and the selected `dispatch-shipment` operation without changing application behavior. Queue-managed outbox fields are deliberately excluded because reconciliation and worker progress may advance them while all frozen public records and deterministic identifiers remain unchanged.

## Acceptance gate

1. Confirm the overlay commit has this builder commit as its sole parent.
2. Confirm `legacy-snapshot.json` still matches `src/seed.ts` and `tests/live-http.test.ts`; record its SHA-256 before issuing an assignment.
3. Review and accept `selected-operation.json`, including its guard matrix, atomic MySQL transaction, outbox/dead-letter recovery, and legacy-reader requirements.
4. Reuse the existing baseline commands: `pnpm typecheck`, `pnpm test`, and `pnpm build`.
5. In an isolated coordinator-owned environment, reuse the README setup and run `RUN_LIVE_TESTS=1 pnpm test:live`. The suite owns its live fixtures and proves real queue execution, Redis failure, exhaustion, durable dead letter, retry generation, and exactly-once persistence; do not weaken or replace it.

## Assignment/config handoff

- Do not add `specter-assignment.json` until the coordinator has accepted both JSON contracts and recorded the snapshot hash.
- Keep tool installation and generated configuration out of this prep commit.
- When an assignment is accepted, point it at the two JSON contracts, the verifier entrypoint `verifier/runner.ts`, and the existing validation commands above.
- Implement the two verifier TODO stubs only in the assignment/implementation phase. The verifier must use isolated MySQL/Redis services, reset through the existing seed, exercise the selected HTTP operation, and preserve the legacy tests.
- Any proposed event payload must carry coordinator-supplied IDs and ISO timestamps; handlers must not invent domain identity or time.
