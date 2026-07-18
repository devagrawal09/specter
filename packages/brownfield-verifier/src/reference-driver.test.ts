import type {
  EventLogAdapter,
  ReactionScheduler,
  SliceStore,
  SliceStoreAdapter,
} from '@specter-ts/core'
import {
  createMemoryEventLog,
  createMemorySliceStore,
} from '../../memory/src/index'
import {
  createDurableReactionScheduler,
  createMemoryReactionOutboxStore,
  type ReactionOutboxTransition,
} from '../../reaction-outbox/src/index'
import { describe, expect, it } from 'vitest'

import { runAdapterContractSuite } from './run.js'
import type {
  AdapterContractReport,
  AdapterHarnessDriver,
  AdapterHarnessRuntime,
  ProbeReadState,
  ProbeSliceStore,
  ProbeWriteState,
  ReactionDeliverySnapshot,
} from './types.js'

const contractCaseIds = [
  'event-log.order-filter-json',
  'event-log.transaction-rollback',
  'event-log.transaction-serializes-decision',
  'event-log.concurrent-version',
  'event-log.idempotency',
  'event-log.restart-durability',
  'slice-store.staging-rollback',
  'slice-store.failure-replay',
  'slice-store.monotonic-isolation',
  'slice-store.restart-durability',
  'scheduler.serializes-coalesces',
  'scheduler.dead-letter-preserves-active-follow-up',
  'scheduler.retry-context',
  'scheduler.dead-letter-retry',
  'scheduler.restart-recovery',
  'probe.command-reaction-restart',
] as const

function createReferenceDriver(): AdapterHarnessDriver {
  const eventLog = createMemoryEventLog()
  const state = createMemorySliceStore(() => [] as string[])
  const sliceStore = wrapMemoryState(state)
  const outbox = createMemoryReactionOutboxStore<{ kind: 'reaction-pass' }>()
  const attemptIds = new Map<string, string[]>()
  let sequence = 0

  const onTransition = (
    transition: ReactionOutboxTransition<{ kind: 'reaction-pass' }>,
  ) => {
    if (transition.type !== 'attempt-started') return
    const attempts = attemptIds.get(transition.claim.id) ?? []
    attempts.push(transition.claim.activeAttemptId)
    attemptIds.set(transition.claim.id, attempts)
  }

  return {
    name: 'maintained-memory-reference',
    async reset() {
      eventLog.reset()
      state.reset()
      outbox.reset()
      attemptIds.clear()
      sequence = 0
    },
    async open() {
      const controller = new AbortController()
      return {
        eventLog,
        sliceStore,
        schedule: coalesce(
          createDurableReactionScheduler(outbox, {
            maxAttempts: 3,
            backoffMs: () => 0,
            leaseMs: 1,
            signal: controller.signal,
            idFactory: () => {
              sequence += 1
              return `reference-pass-${sequence}`
            },
            onTransition,
          }),
        ),
        close: async () => {
          controller.abort()
        },
      }
    },
    async deliveries(): Promise<readonly ReactionDeliverySnapshot[]> {
      return (await outbox.list()).map((job) => ({
        deliveryId: job.id,
        status: job.status,
        scheduledAt: job.requestedAt.toISOString(),
        attemptIds: attemptIds.get(job.id) ?? [],
        attemptCount: job.attemptCount,
        lastError: job.lastError,
      }))
    },
    async retryDeadLetter(deliveryId) {
      await outbox.retryDeadLetter(deliveryId, new Date())
    },
  }
}

function coalesce(schedule: ReactionScheduler): ReactionScheduler {
  return (run) => {
    const requestPass = schedule(run)
    let active: Promise<void> | undefined
    let queued = false

    const drain = async () => {
      const failures: unknown[] = []
      do {
        queued = false
        try {
          await requestPass()()
        } catch (error) {
          failures.push(error)
        }
      } while (queued)
      if (failures.length > 0) throw failures[0]
    }

    return () => {
      if (active) {
        queued = true
      } else {
        active = drain().finally(() => {
          active = undefined
        })
      }
      const completion = active
      return () => completion
    }
  }
}

function dropQueuedPassAfterFailure(
  schedule: ReactionScheduler,
): ReactionScheduler {
  return (run) => {
    const requestPass = schedule(run)
    let active: Promise<void> | undefined
    let queued = false

    const drain = async () => {
      do {
        queued = false
        await requestPass()()
      } while (queued)
    }

    return () => {
      if (active) {
        queued = true
      } else {
        active = drain().finally(() => {
          active = undefined
        })
      }
      const completion = active
      return () => completion
    }
  }
}

function wrapMemoryState(
  adapter: SliceStoreAdapter<string[]>,
): ProbeSliceStore {
  return {
    async get(sliceName) {
      return wrapStore(await adapter.get(sliceName))
    },
    transaction(sliceName, run) {
      return adapter.transaction(sliceName, (store) => run(wrapStore(store)))
    },
  }
}

function wrapStore(
  store: SliceStore<string[]>,
): SliceStore<ProbeWriteState, ProbeReadState> {
  return {
    write: {
      append: async (value) => {
        store.write.push(value)
      },
    },
    read: {
      values: async () => [...store.read],
    },
    lastAppliedOrder: store.lastAppliedOrder,
    setLastAppliedOrder: store.setLastAppliedOrder,
  }
}

function mutateDriver(
  name: string,
  mutate: (runtime: AdapterHarnessRuntime) => AdapterHarnessRuntime,
): AdapterHarnessDriver {
  const reference = createReferenceDriver()
  return {
    ...reference,
    name,
    async open() {
      return mutate(await reference.open())
    },
  }
}

function replaceEventLog(
  runtime: AdapterHarnessRuntime,
  eventLog: EventLogAdapter,
): AdapterHarnessRuntime {
  return { ...runtime, eventLog }
}

function expectFailedCase(report: AdapterContractReport, caseId: string) {
  expect(report.cases.find((entry) => entry.id === caseId)).toMatchObject({
    status: 'failed',
  })
  expect(report.passed).toBe(false)
}

function expectTerminalTimeoutReport(
  report: AdapterContractReport,
  caseId: string,
  stage: 'pre-reset' | 'case' | 'post-reset',
) {
  expect(report.cases.map((entry) => entry.id)).toEqual(contractCaseIds)
  const timedOutIndex = report.cases.findIndex((entry) => entry.id === caseId)
  expect(timedOutIndex).toBeGreaterThanOrEqual(0)
  expect(report.cases[timedOutIndex]).toMatchObject({ status: 'failed' })
  for (const entry of report.cases.slice(timedOutIndex + 1)) {
    expect(entry).toMatchObject({
      status: 'not-run',
      durationMs: 0,
      error: `Not run because contract case "${caseId}" timed out during ${stage}.`,
    })
  }
  expect(report.passed).toBe(false)
}

describe('brownfield adapter contract verifier', () => {
  it('passes against the maintained reference adapters', async () => {
    const report = await runAdapterContractSuite(createReferenceDriver())

    expect(report.cases).toHaveLength(16)
    expect(report.cases.map((entry) => entry.id)).toEqual(contractCaseIds)
    expect(report.cases.filter((entry) => entry.status === 'failed')).toEqual(
      [],
    )
    expect(report.passed).toBe(true)
  })

  it('rejects an Event Log that truncates matching query results', async () => {
    const driver = mutateDriver('truncated-query-mutant', (runtime) => {
      const eventLog = runtime.eventLog
      return replaceEventLog(runtime, {
        ...eventLog,
        async query(afterOrder, eventTypes) {
          return (await eventLog.query(afterOrder, eventTypes)).slice(-1)
        },
      })
    })

    const report = await runAdapterContractSuite(driver, {
      caseTimeoutMs: 250,
    })

    expectFailedCase(report, 'event-log.order-filter-json')
  })

  it('rejects an Event Log that does not lock the transaction callback', async () => {
    const driver = mutateDriver('unlocked-transaction-mutant', (runtime) => {
      const eventLog = runtime.eventLog
      return replaceEventLog(runtime, {
        ...eventLog,
        transaction: (run) => run(eventLog),
      })
    })

    const report = await runAdapterContractSuite(driver, {
      caseTimeoutMs: 250,
    })

    expectFailedCase(report, 'event-log.transaction-serializes-decision')
  })

  it('rejects an unlocked Event Log whose callback entry is delayed', async () => {
    const driver = mutateDriver(
      'delayed-unlocked-transaction-mutant',
      (runtime) => {
        const eventLog = runtime.eventLog
        return replaceEventLog(runtime, {
          ...eventLog,
          transaction: async (run) => {
            await delay(75)
            return run(eventLog)
          },
        })
      },
    )

    const report = await runAdapterContractSuite(driver, {
      caseTimeoutMs: 250,
    })

    expectFailedCase(report, 'event-log.transaction-serializes-decision')
  })

  it('rejects a scheduler that drops requests made during an active pass', async () => {
    const driver = mutateDriver('dropped-follow-up-mutant', (runtime) => ({
      ...runtime,
      schedule: (run) => {
        const request = runtime.schedule(run)
        let active: Promise<void> | undefined
        return () => {
          if (!active) {
            active = request()().finally(() => {
              active = undefined
            })
          }
          const completion = active
          return () => completion
        }
      },
    }))

    const report = await runAdapterContractSuite(driver, {
      caseTimeoutMs: 250,
    })

    expectFailedCase(report, 'scheduler.serializes-coalesces')
  })

  it('rejects a scheduler that loses an active-pass request after dead-letter', async () => {
    const driver = mutateDriver(
      'dead-letter-dropped-follow-up-mutant',
      (runtime) => ({
        ...runtime,
        schedule: dropQueuedPassAfterFailure(runtime.schedule),
      }),
    )

    const report = await runAdapterContractSuite(driver, {
      caseTimeoutMs: 250,
    })

    expectFailedCase(report, 'scheduler.dead-letter-preserves-active-follow-up')
  })

  it('rejects scheduler callback metadata that disagrees with snapshots', async () => {
    const driver = mutateDriver('bogus-metadata-mutant', (runtime) => ({
      ...runtime,
      schedule: (run) =>
        runtime.schedule((context) =>
          run({
            ...context,
            deliveryId: `bogus-${context.deliveryId}`,
            scheduledAt: new Date(
              Date.parse(context.scheduledAt) + 1_000,
            ).toISOString(),
            attemptId: `bogus-${context.attemptId}`,
          }),
        ),
    }))

    const report = await runAdapterContractSuite(driver, {
      caseTimeoutMs: 250,
    })

    expectFailedCase(report, 'scheduler.retry-context')
  })

  it('stops later case bodies after a never-settling call times out and mutates late', async () => {
    let hangNextAppend = true
    let openCount = 0
    let resetCount = 0
    let lateMutation = false
    const never = new Promise<never>(() => {})
    const reference = createReferenceDriver()
    const driver: AdapterHarnessDriver = {
      ...reference,
      name: 'hanging-late-mutation-mutant',
      async reset() {
        resetCount += 1
        await reference.reset()
      },
      async open() {
        openCount += 1
        const runtime = await reference.open()
        const eventLog = runtime.eventLog
        return replaceEventLog(runtime, {
          ...eventLog,
          append(events, options) {
            if (!hangNextAppend) return eventLog.append(events, options)
            hangNextAppend = false
            setTimeout(() => {
              lateMutation = true
            }, 75)
            return never
          },
        })
      },
    }

    const report = await runAdapterContractSuite(driver, {
      caseTimeoutMs: 50,
    })

    expectFailedCase(report, 'event-log.order-filter-json')
    expect(
      report.cases.find((entry) => entry.id === 'event-log.order-filter-json')
        ?.error,
    ).toMatch(/AdapterContractTimeoutError: .*timed out after 50ms/)
    expectTerminalTimeoutReport(report, 'event-log.order-filter-json', 'case')

    await delay(100)
    expect(lateMutation).toBe(true)
    expect(resetCount).toBe(2)
    expect(openCount).toBe(1)
  })

  it('makes a pre-reset timeout terminal but still attempts post-reset', async () => {
    const reference = createReferenceDriver()
    const never = new Promise<never>(() => {})
    let resetCount = 0
    let openCount = 0
    const driver: AdapterHarnessDriver = {
      ...reference,
      name: 'hanging-pre-reset-mutant',
      reset() {
        resetCount += 1
        if (resetCount === 1) return never
        return reference.reset()
      },
      async open() {
        openCount += 1
        return reference.open()
      },
    }

    const report = await runAdapterContractSuite(driver, {
      caseTimeoutMs: 25,
    })

    expectTerminalTimeoutReport(
      report,
      'event-log.order-filter-json',
      'pre-reset',
    )
    expect(resetCount).toBe(2)
    expect(openCount).toBe(0)
  })

  it('makes a post-reset timeout terminal without entering later bodies', async () => {
    const reference = createReferenceDriver()
    const never = new Promise<never>(() => {})
    let resetCount = 0
    let openCount = 0
    const driver: AdapterHarnessDriver = {
      ...reference,
      name: 'hanging-post-reset-mutant',
      reset() {
        resetCount += 1
        if (resetCount === 2) return never
        return reference.reset()
      },
      async open() {
        openCount += 1
        return reference.open()
      },
    }

    const report = await runAdapterContractSuite(driver, {
      caseTimeoutMs: 25,
    })

    expectTerminalTimeoutReport(
      report,
      'event-log.order-filter-json',
      'post-reset',
    )
    expect(resetCount).toBe(2)
    expect(openCount).toBe(1)
  })

  it('runs a post-case reset after a late open failure', async () => {
    const reference = createReferenceDriver()
    const actions: string[] = []
    let openCount = 0
    let dirty = false
    let openedWhileDirty = false
    const driver: AdapterHarnessDriver = {
      ...reference,
      name: 'late-open-failure-mutant',
      async reset() {
        actions.push('reset')
        dirty = false
        await reference.reset()
      },
      async open() {
        openCount += 1
        if (openCount === 6) {
          actions.push('open-failed')
          dirty = true
          throw new Error('late open failure')
        }
        actions.push('open')
        if (dirty) openedWhileDirty = true
        return reference.open()
      },
    }

    const report = await runAdapterContractSuite(driver, {
      caseTimeoutMs: 250,
    })

    expectFailedCase(report, 'event-log.restart-durability')
    expect(
      report.cases.find((entry) => entry.id === 'slice-store.staging-rollback'),
    ).toMatchObject({ status: 'passed' })
    const failedOpen = actions.indexOf('open-failed')
    expect(actions.slice(failedOpen, failedOpen + 4)).toEqual([
      'open-failed',
      'reset',
      'reset',
      'open',
    ])
    expect(dirty).toBe(false)
    expect(openedWhileDirty).toBe(false)
  })
})

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
