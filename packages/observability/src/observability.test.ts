import { describe, expect, it } from 'vitest'
import type { EventLogService } from '@specter-ts/core'
import { Effect } from 'effect'

import {
  createSpecterDevelopmentPanel,
  createInMemorySpecterObservability,
  createOutboxObservabilityListener,
  reportProjectionActivity,
  reportReactionRun,
  reportSliceCursor,
  reportSubscriptionInvalidated,
  instrumentEventLog,
} from './index'

describe('Specter operational observability', () => {
  it('records cursor lag, invalidations, Reaction failures, and projection work', async () => {
    const observedAt = new Date('2026-07-16T12:00:00.000Z')
    const recorder = createInMemorySpecterObservability({
      now: () => observedAt,
    })
    const received: string[] = []
    const unsubscribe = recorder.subscribe((signal) => {
      received.push(signal.type)
    })

    await reportSliceCursor(recorder, {
      sliceName: 'todosQuery',
      lastAppliedOrder: 7,
      eventLogVersion: 10,
    })
    await reportSubscriptionInvalidated(recorder, {
      queryType: 'todosQuery',
      subscriberId: 'subscriber-1',
      reason: 'command committed',
    })
    await reportReactionRun(recorder, {
      reactionName: 'sendEmail',
      outcome: 'failed',
      durationMs: 12,
      cause: new Error('SMTP unavailable'),
    })
    await reportProjectionActivity(recorder, {
      sliceName: 'todosQuery',
      activity: 'catch-up',
      outcome: 'completed',
      fromOrder: 7,
      toOrder: 10,
      eventCount: 3,
    })
    unsubscribe()

    expect(received).toEqual([
      'slice.cursor',
      'subscription.invalidated',
      'reaction.run',
      'projection.activity',
    ])
    expect(recorder.snapshot()).toMatchObject([
      {
        type: 'slice.cursor',
        sequence: 1,
        observedAt,
        lag: 3,
      },
      { type: 'subscription.invalidated', sequence: 2 },
      { type: 'reaction.run', sequence: 3, error: 'SMTP unavailable' },
      { type: 'projection.activity', sequence: 4, eventCount: 3 },
    ])
  })

  it('maps outbox attempts into the shared signal stream', async () => {
    const recorder = createInMemorySpecterObservability()
    const observe = createOutboxObservabilityListener(recorder)
    const claim = {
      id: 'job-1',
      idempotencyKey: 'email-1',
      payload: {},
      status: 'running' as const,
      requestedAt: new Date(0),
      availableAt: new Date(0),
      attemptCount: 2,
      activeAttemptId: 'job-1:attempt:2',
      leaseExpiresAt: new Date(100),
    }

    await observe({
      type: 'attempt-retrying',
      claim,
      availableAt: new Date(200),
      error: 'temporary failure',
    })

    expect(recorder.snapshot()[0]).toMatchObject({
      type: 'outbox.attempt',
      jobId: 'job-1',
      attemptId: 'job-1:attempt:2',
      attemptNumber: 2,
      outcome: 'retrying',
      error: 'temporary failure',
    })
  })

  it('captures persisted Events through the Event Log wrapper once per commit', async () => {
    const recorder = createInMemorySpecterObservability()
    const commit = {
      duplicate: false,
      events: [
        {
          id: 'event-1',
          order: 1,
          type: 'todo-added',
          payload: { todoId: 'todo-1' },
          recordedAt: new Date(0).toISOString(),
        },
      ],
      version: 1,
      idempotencyKey: 'request-1',
      fingerprint: 'fingerprint-1',
    }
    const eventLog: EventLogService = {
      query: () => Effect.succeed([]),
      currentVersion: Effect.succeed(0),
      findCommit: () => Effect.succeed(undefined),
      append: () => Effect.succeed(commit),
    }

    const observed = instrumentEventLog(eventLog, recorder)
    await Effect.runPromise(
      observed.append(commit.events, {
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-1',
      }),
    )

    expect(recorder.snapshot()).toMatchObject([
      {
        type: 'events.persisted',
        version: 1,
        idempotencyKey: 'request-1',
        events: [{ id: 'event-1', type: 'todo-added' }],
      },
    ])
  })

  it('renders a development panel for Events, cursor lag, subscriptions, Reactions, projections, and outbox attempts', async () => {
    const recorder = createInMemorySpecterObservability({
      now: () => new Date('2026-07-16T12:00:00.000Z'),
    })
    await recorder.record({
      type: 'events.persisted',
      version: 4,
      events: [
        {
          id: 'event-4',
          order: 4,
          type: 'todo-added',
          payload: { title: '<ship it>' },
          recordedAt: '2026-07-16T11:59:00.000Z',
        },
      ],
    })
    await reportSubscriptionInvalidated(recorder, {
      queryType: 'todosQuery',
      reason: 'todo-added',
    })
    await reportReactionRun(recorder, {
      reactionName: 'todoCheer',
      outcome: 'failed',
      cause: new Error('offline'),
    })
    await reportProjectionActivity(recorder, {
      sliceName: 'todosQuery',
      activity: 'replay',
      outcome: 'completed',
      fromOrder: 0,
      toOrder: 2,
    })
    const observeOutbox = createOutboxObservabilityListener(recorder)
    await observeOutbox({
      type: 'attempt-started',
      claim: {
        id: 'job-1',
        idempotencyKey: 'todo-4',
        payload: {},
        status: 'running',
        requestedAt: new Date(0),
        availableAt: new Date(0),
        attemptCount: 1,
        activeAttemptId: 'job-1:attempt:1',
        leaseExpiresAt: new Date(100),
      },
    })

    const panel = createSpecterDevelopmentPanel(recorder)
    expect(panel.snapshot()).toMatchObject({
      eventLogVersion: 4,
      events: [{ type: 'todo-added' }],
      sliceCursors: [{ sliceName: 'todosQuery', lag: 2 }],
      subscriptions: [{ queryType: 'todosQuery', invalidationCount: 1 }],
      reactions: [{ reactionName: 'todoCheer', outcome: 'failed' }],
      projections: [{ sliceName: 'todosQuery', activity: 'replay' }],
      outbox: [{ jobId: 'job-1', outcome: 'started' }],
    })
    expect(panel.renderHtml()).toContain('Specter development panel')
    expect(panel.renderHtml()).toContain('&lt;ship it&gt;')
    expect(panel.renderHtml()).not.toContain('<ship it>')
    expect(JSON.parse(panel.renderJson())).toMatchObject({
      eventLogVersion: 4,
      reactions: [{ reactionName: 'todoCheer', outcome: 'failed' }],
    })
    expect(panel.renderText()).toContain('todosQuery: cursor=2 version=4 lag=2')
    expect(panel.renderText()).toContain('job-1 attempt=1: started')
  })
})
