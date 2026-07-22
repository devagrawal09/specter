import type { EventLogService } from '@specter-ts/core'
import { Effect } from 'effect'

import type { SpecterObservabilitySink } from './recorder'

function safelyRecord(
  sink: SpecterObservabilitySink,
  signal: Parameters<SpecterObservabilitySink['record']>[0],
) {
  try {
    const result = sink.record(signal)
    void Promise.resolve(result).catch(() => {})
  } catch {
    // Telemetry never changes Event Log semantics.
  }
}

export function instrumentEventLog(
  eventLog: EventLogService,
  sink: SpecterObservabilitySink,
): EventLogService {
  return {
    query: eventLog.query,
    currentVersion: eventLog.currentVersion,
    findCommit: eventLog.findCommit,
    append: (events, options) =>
      eventLog.append(events, options).pipe(
        Effect.tap((commit) =>
          Effect.sync(() => {
            if (!commit.duplicate) {
              safelyRecord(sink, {
                type: 'events.persisted',
                events: commit.events,
                version: commit.version,
                idempotencyKey: commit.idempotencyKey,
              })
            }
          }),
        ),
      ),
  }
}
