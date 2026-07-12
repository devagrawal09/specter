# Shipyard Feature Test Plan

This Phase 1 package defines contracts, event definitions, fixture streams, and planned slice groups only. Command, query, and reaction slice specs are deferred to Phase 2 so they can be represented with complete Specter registrations instead of placeholder handlers.

## Deferred Slice Specs

- OpenCode lifecycle: request a run, record each direct inbound event, idempotently ignore duplicate `eventId` deliveries, preserve final states, and emit direct outbound operation envelopes for start, cancel, and follow-up input.
- Agent suggestions: record only typed suggestions, reject malformed or underspecified suggestions into an operator-review path, apply once, reject once, and never parse freeform summaries into records.
- GitHub integration: attach repository metadata, refresh read-only repository facts, import issues as untrusted context, and preserve last-known metadata when refresh fails.
- Opportunities and projects: capture, update, prioritize, archive, explicitly confirm conversion, create projects, move project status, and manage milestones and links.
- Nexus tasks and scoring: move tasks through `inbox`, `triaged`, `in_progress`, and `completed`; require operator confirmation for completion; keep scoring events separate from task state; cover roll-forward behavior.
- DemoLab: create demos, manage ordered stages, add expected-output steps, record rehearsal notes, and keep command steps as records rather than executed commands.
- Operator workflows: preview prompts before any OpenCode run, require confirmation, request follow-up input, and request cancellation through direct OpenCode operation names.
- Dashboard queries: derive opportunity, project, task, score, OpenCode run, GitHub-linked, and pending-suggestion counts from event history.

## Scenario Coverage Fixtures

- `repoReconSuccessEvents`: happy-path repository reconnaissance run.
- `repoReconFailureEvents`: failed reconnaissance run with no downgrade recovery assumption.
- `implementationTestsPassEvents`: implementation verification where tool completion and run completion agree.
- `implementationTestsFailEvents`: implementation verification where the tool and run fail.
- `malformedSuggestionEvents`: parseable but underspecified suggestion requiring operator review.
- `duplicateEvents`: repeated `eventId` delivery for idempotency scenarios.
- `reconnectReplayEvents`: replay after reconnect with repeated status delivery.
- `lateLogAfterCompletionEvents`: buffered log/file events delivered after completion without reopening the run.
