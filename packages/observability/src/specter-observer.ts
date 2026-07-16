import type {
  EventLogAdapter,
  EventLogAppendOptions,
  EventLogTransaction,
  SpecterObserver,
} from '@specter-ts/core'

import type { SpecterObservabilitySink } from './recorder'

function safelyRecord(
  sink: SpecterObservabilitySink,
  signal: Parameters<SpecterObservabilitySink['record']>[0],
) {
  try {
    const result = sink.record(signal)
    void Promise.resolve(result).catch(() => {})
  } catch {
    // Observability must never change application semantics.
  }
}

export function createSpecterObserver(
  sink: SpecterObservabilitySink,
): SpecterObserver {
  return (observation) => {
    switch (observation.type) {
      case 'slice-caught-up':
        safelyRecord(sink, {
          type: 'projection.activity',
          sliceName: observation.sliceName,
          activity: 'catch-up',
          outcome: 'completed',
          fromOrder: observation.fromOrder,
          toOrder: observation.toOrder,
          eventCount: observation.eventCount,
        })
        break
      case 'command-committed':
        safelyRecord(sink, {
          type: 'command.committed',
          commandType: observation.commandType,
          version: observation.version,
          eventCount: observation.eventCount,
          duplicate: observation.duplicate,
        })
        break
      case 'subscriptions-invalidated':
        safelyRecord(sink, {
          type: 'subscription.invalidated',
          queryType: observation.queryName,
          reason: `${observation.subscriberCount} subscriber(s) invalidated`,
        })
        break
      case 'reaction-run-started':
        safelyRecord(sink, {
          type: 'reaction.run',
          reactionName: observation.reactionName,
          outcome: 'started',
        })
        break
      case 'reaction-run-completed':
        safelyRecord(sink, {
          type: 'reaction.run',
          reactionName: observation.reactionName,
          outcome: 'completed',
          durationMs: observation.durationMs,
        })
        break
      case 'reaction-run-failed':
        safelyRecord(sink, {
          type: 'reaction.run',
          reactionName: observation.reactionName,
          outcome: 'failed',
          durationMs: observation.durationMs,
          error:
            observation.cause instanceof Error
              ? observation.cause.message
              : String(observation.cause),
        })
        break
      case 'reaction-pass-completed':
        break
    }
  }
}

function instrumentTransaction(
  eventLog: EventLogTransaction,
  sink: SpecterObservabilitySink,
): EventLogTransaction {
  return {
    query: (afterOrder, eventTypes) => eventLog.query(afterOrder, eventTypes),
    currentVersion: () => eventLog.currentVersion(),
    findCommit: (idempotencyKey) => eventLog.findCommit(idempotencyKey),
    async append(events, options: EventLogAppendOptions = {}) {
      const commit = await eventLog.append(events, options)
      if (!commit.duplicate) {
        safelyRecord(sink, {
          type: 'events.persisted',
          events: commit.events,
          version: commit.version,
          idempotencyKey: commit.idempotencyKey,
        })
      }
      return commit
    },
  }
}

export function instrumentEventLog(
  eventLog: EventLogAdapter,
  sink: SpecterObservabilitySink,
): EventLogAdapter {
  return {
    query: (afterOrder, eventTypes) => eventLog.query(afterOrder, eventTypes),
    currentVersion: () => eventLog.currentVersion(),
    findCommit: (idempotencyKey) => eventLog.findCommit(idempotencyKey),
    append: (events, options) =>
      eventLog.transaction((transaction) =>
        instrumentTransaction(transaction, sink).append(events, options),
      ),
    transaction: (run) =>
      eventLog.transaction((transaction) =>
        run(instrumentTransaction(transaction, sink)),
      ),
  }
}
