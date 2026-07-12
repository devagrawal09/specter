import {
  type OpenCodeEvent,
  opencodeFileChangedEvent,
  opencodeLogAppendedEvent,
  opencodeRunCompletedEvent,
  opencodeRunFailedEvent,
  opencodeRunStartedEvent,
  opencodeRunStatusChangedEvent,
  opencodeSuggestionCreatedEvent,
  opencodeToolCompletedEvent,
} from '../opencode/events'

export const repoReconSuccessEvents: OpenCodeEvent[] = [
  opencodeRunStartedEvent.create({
    eventId: 'repo-recon-001',
    runId: 'run-repo-recon-success',
    sequence: 1,
    occurredAt: '2026-07-10T07:10:00.000Z',
    inboundName: 'opencode.run.started',
    status: 'running',
    linkedEntity: { type: 'project', id: 'project-shipyard' },
  }),
  opencodeLogAppendedEvent.create({
    eventId: 'repo-recon-002',
    runId: 'run-repo-recon-success',
    sequence: 2,
    occurredAt: '2026-07-10T07:10:02.000Z',
    inboundName: 'opencode.log.appended',
    level: 'info',
    message: 'Repository structure inspected.',
  }),
  opencodeRunCompletedEvent.create({
    eventId: 'repo-recon-003',
    runId: 'run-repo-recon-success',
    sequence: 3,
    occurredAt: '2026-07-10T07:10:10.000Z',
    inboundName: 'opencode.run.completed',
    summary: 'Found Specter app conventions.',
  }),
]

export const repoReconFailureEvents: OpenCodeEvent[] = [
  opencodeRunStartedEvent.create({
    eventId: 'repo-recon-failure-001',
    runId: 'run-repo-recon-failure',
    sequence: 1,
    occurredAt: '2026-07-10T07:11:00.000Z',
    inboundName: 'opencode.run.started',
    status: 'running',
  }),
  opencodeRunFailedEvent.create({
    eventId: 'repo-recon-failure-002',
    runId: 'run-repo-recon-failure',
    sequence: 2,
    occurredAt: '2026-07-10T07:11:05.000Z',
    inboundName: 'opencode.run.failed',
    error: 'Workspace path was unavailable.',
  }),
]

export const implementationTestsPassEvents: OpenCodeEvent[] = [
  opencodeRunStartedEvent.create({
    eventId: 'tests-pass-001',
    runId: 'run-tests-pass',
    sequence: 1,
    occurredAt: '2026-07-10T07:12:00.000Z',
    inboundName: 'opencode.run.started',
    status: 'running',
    linkedEntity: { type: 'task', id: 'task-typecheck' },
  }),
  opencodeToolCompletedEvent.create({
    eventId: 'tests-pass-002',
    runId: 'run-tests-pass',
    sequence: 2,
    occurredAt: '2026-07-10T07:12:15.000Z',
    inboundName: 'opencode.tool.completed',
    toolCallId: 'tool-pnpm-typecheck',
    toolName: 'bash',
    status: 'completed',
    summary: 'pnpm typecheck passed.',
  }),
  opencodeRunCompletedEvent.create({
    eventId: 'tests-pass-003',
    runId: 'run-tests-pass',
    sequence: 3,
    occurredAt: '2026-07-10T07:12:20.000Z',
    inboundName: 'opencode.run.completed',
    summary: 'Implementation verification passed.',
  }),
]

export const implementationTestsFailEvents: OpenCodeEvent[] = [
  opencodeRunStartedEvent.create({
    eventId: 'tests-fail-001',
    runId: 'run-tests-fail',
    sequence: 1,
    occurredAt: '2026-07-10T07:13:00.000Z',
    inboundName: 'opencode.run.started',
    status: 'running',
    linkedEntity: { type: 'task', id: 'task-typecheck' },
  }),
  opencodeToolCompletedEvent.create({
    eventId: 'tests-fail-002',
    runId: 'run-tests-fail',
    sequence: 2,
    occurredAt: '2026-07-10T07:13:15.000Z',
    inboundName: 'opencode.tool.completed',
    toolCallId: 'tool-pnpm-typecheck',
    toolName: 'bash',
    status: 'failed',
    summary: 'TypeScript reported schema mismatch.',
  }),
  opencodeRunFailedEvent.create({
    eventId: 'tests-fail-003',
    runId: 'run-tests-fail',
    sequence: 3,
    occurredAt: '2026-07-10T07:13:20.000Z',
    inboundName: 'opencode.run.failed',
    error: 'Verification failed.',
  }),
]

export const malformedSuggestionEvents: OpenCodeEvent[] = [
  opencodeSuggestionCreatedEvent.create({
    eventId: 'malformed-suggestion-001',
    runId: 'run-malformed-suggestion',
    sequence: 1,
    occurredAt: '2026-07-10T07:14:00.000Z',
    inboundName: 'opencode.suggestion.created',
    suggestionId: 'suggestion-missing-context',
    suggestionKind: 'task',
    title: 'Needs operator review',
    body: 'The source message was parseable but underspecified.',
  }),
]

export const duplicateEvents: OpenCodeEvent[] = [
  opencodeLogAppendedEvent.create({
    eventId: 'duplicate-001',
    runId: 'run-duplicate',
    sequence: 1,
    occurredAt: '2026-07-10T07:15:00.000Z',
    inboundName: 'opencode.log.appended',
    level: 'info',
    message: 'First delivery.',
  }),
  opencodeLogAppendedEvent.create({
    eventId: 'duplicate-001',
    runId: 'run-duplicate',
    sequence: 1,
    occurredAt: '2026-07-10T07:15:00.000Z',
    inboundName: 'opencode.log.appended',
    level: 'info',
    message: 'First delivery.',
  }),
]

export const reconnectReplayEvents: OpenCodeEvent[] = [
  opencodeRunStartedEvent.create({
    eventId: 'replay-001',
    runId: 'run-reconnect',
    sequence: 1,
    occurredAt: '2026-07-10T07:16:00.000Z',
    inboundName: 'opencode.run.started',
    status: 'running',
  }),
  opencodeRunStatusChangedEvent.create({
    eventId: 'replay-002',
    runId: 'run-reconnect',
    sequence: 2,
    occurredAt: '2026-07-10T07:16:04.000Z',
    inboundName: 'opencode.run.status_changed',
    status: 'waiting_for_input',
  }),
  opencodeRunStatusChangedEvent.create({
    eventId: 'replay-002',
    runId: 'run-reconnect',
    sequence: 2,
    occurredAt: '2026-07-10T07:16:04.000Z',
    inboundName: 'opencode.run.status_changed',
    status: 'waiting_for_input',
  }),
]

export const lateLogAfterCompletionEvents: OpenCodeEvent[] = [
  opencodeRunCompletedEvent.create({
    eventId: 'late-log-001',
    runId: 'run-late-log',
    sequence: 10,
    occurredAt: '2026-07-10T07:17:00.000Z',
    inboundName: 'opencode.run.completed',
    summary: 'Run finished before buffered log delivery.',
  }),
  opencodeLogAppendedEvent.create({
    eventId: 'late-log-002',
    runId: 'run-late-log',
    sequence: 9,
    occurredAt: '2026-07-10T07:16:59.000Z',
    inboundName: 'opencode.log.appended',
    level: 'info',
    message: 'Buffered log arrived after completion.',
  }),
  opencodeFileChangedEvent.create({
    eventId: 'late-log-003',
    runId: 'run-late-log',
    sequence: 8,
    occurredAt: '2026-07-10T07:16:58.000Z',
    inboundName: 'opencode.file.changed',
    path: 'apps/shipyard-benchmark/README.md',
    changeKind: 'modified',
  }),
]
