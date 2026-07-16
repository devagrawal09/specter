import type {
  RecordedSpecterOperationalSignal,
  SpecterOperationalSignal,
} from './signals'

export type SpecterObservabilitySink = {
  record(signal: SpecterOperationalSignal): Promise<void> | void
}

export type SpecterObservabilityListener = (
  signal: RecordedSpecterOperationalSignal,
) => void

export type InMemorySpecterObservability = SpecterObservabilitySink & {
  snapshot(): readonly RecordedSpecterOperationalSignal[]
  subscribe(listener: SpecterObservabilityListener): () => void
  clear(): void
}

export const noopSpecterObservability: SpecterObservabilitySink = {
  record() {},
}

export function createCompositeSpecterObservability(
  ...sinks: readonly SpecterObservabilitySink[]
): SpecterObservabilitySink {
  return {
    async record(signal) {
      await Promise.all(sinks.map((sink) => sink.record(signal)))
    },
  }
}

export function createInMemorySpecterObservability(
  options: { readonly now?: () => Date } = {},
): InMemorySpecterObservability {
  const now = options.now ?? (() => new Date())
  const signals: RecordedSpecterOperationalSignal[] = []
  const listeners = new Set<SpecterObservabilityListener>()
  let sequence = 0

  function copySignal(
    signal: RecordedSpecterOperationalSignal,
  ): RecordedSpecterOperationalSignal {
    if (signal.type === 'events.persisted') {
      return {
        ...signal,
        events: signal.events.map((event) => ({ ...event })),
      }
    }
    return { ...signal }
  }

  return {
    record(signal) {
      sequence += 1
      const recorded = {
        ...signal,
        sequence,
        observedAt: now(),
      } as RecordedSpecterOperationalSignal
      signals.push(copySignal(recorded))
      for (const listener of listeners) listener(recorded)
    },
    snapshot() {
      return signals.map(copySignal)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    clear() {
      signals.length = 0
      sequence = 0
    },
  }
}
