import { strict as assert } from 'node:assert'

import {
  SpecterIdempotencyConflictError,
  SpecterVersionConflictError,
} from '@specter-ts/core'
import type { ReactionDeliveryContext } from '@specter-ts/core'

import { createBrownfieldProbe } from './probe.js'
import type {
  AdapterContractReport,
  AdapterContractSuiteOptions,
  AdapterHarnessDriver,
  AdapterHarnessRuntime,
  ContractCaseResult,
  ReactionDeliverySnapshot,
} from './types.js'

const probeTime = '2026-07-17T00:00:00.000Z'
const defaultCaseTimeoutMs = 5_000

export class AdapterContractTimeoutError extends Error {
  readonly timeoutMs: number

  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`)
    this.name = 'AdapterContractTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

export async function runAdapterContractSuite(
  driver: AdapterHarnessDriver,
  options: AdapterContractSuiteOptions = {},
): Promise<AdapterContractReport> {
  const caseTimeoutMs = options.caseTimeoutMs ?? defaultCaseTimeoutMs
  if (!Number.isFinite(caseTimeoutMs) || caseTimeoutMs <= 0) {
    throw new Error('caseTimeoutMs must be positive')
  }
  const startedAt = new Date().toISOString()
  const cases: ContractCaseResult[] = []
  let terminalTimeout:
    | {
        readonly caseId: string
        readonly stage: 'pre-reset' | 'case' | 'post-reset'
      }
    | undefined

  async function runCase(
    id: string,
    boundary: ContractCaseResult['boundary'],
    run: () => Promise<void>,
  ) {
    if (terminalTimeout) {
      cases.push({
        id,
        boundary,
        status: 'not-run',
        durationMs: 0,
        error: `Not run because contract case "${terminalTimeout.caseId}" timed out during ${terminalTimeout.stage}.`,
      })
      return
    }

    const start = performance.now()
    const failures: string[] = []
    const runStage = async (
      stage: 'pre-reset' | 'case' | 'post-reset',
      operation: () => Promise<void>,
    ) => {
      try {
        await withTimeout(
          operation,
          caseTimeoutMs,
          `${stage} for contract case "${id}"`,
        )
        return true
      } catch (error) {
        failures.push(`${stage}: ${formatError(error)}`)
        if (error instanceof AdapterContractTimeoutError) {
          terminalTimeout ??= { caseId: id, stage }
        }
        return false
      }
    }

    const resetPassed = await runStage('pre-reset', () => driver.reset())
    if (resetPassed && !terminalTimeout) await runStage('case', run)
    await runStage('post-reset', () => driver.reset())

    if (failures.length === 0) {
      cases.push({
        id,
        boundary,
        status: 'passed',
        durationMs: Math.round(performance.now() - start),
      })
    } else {
      cases.push({
        id,
        boundary,
        status: 'failed',
        durationMs: Math.round(performance.now() - start),
        error: failures.join('\n'),
      })
    }
  }

  await runCase('event-log.order-filter-json', 'event-log', async () => {
    await withRuntime(driver, async ({ eventLog }) => {
      const commit = await eventLog.append([
        { type: 'alpha-recorded', payload: { nested: ['value', 1, true] } },
        { type: 'beta-recorded', payload: null },
        { type: 'alpha-recorded', payload: 'top-level' },
      ])
      assert.equal(commit.duplicate, false)
      assert.equal(commit.version, 3)
      assert.deepEqual(
        commit.events.map(({ order, type, payload }) => ({
          order,
          type,
          payload,
        })),
        [
          {
            order: 1,
            type: 'alpha-recorded',
            payload: { nested: ['value', 1, true] },
          },
          { order: 2, type: 'beta-recorded', payload: null },
          { order: 3, type: 'alpha-recorded', payload: 'top-level' },
        ],
      )
      assert.deepEqual(await eventLog.query(0, ['alpha-recorded']), [
        commit.events[0],
        commit.events[2],
      ])
      assert.deepEqual(
        await eventLog.query(0, ['alpha-recorded', 'beta-recorded']),
        commit.events,
      )
      assert.deepEqual(await eventLog.query(1, ['alpha-recorded']), [
        commit.events[2],
      ])
      for (const entry of commit.events) {
        assert.ok(entry.id.length > 0)
        assert.equal(new Date(entry.recordedAt).toISOString(), entry.recordedAt)
      }
    })
  })

  await runCase('event-log.transaction-rollback', 'event-log', async () => {
    await withRuntime(driver, async ({ eventLog }) => {
      await assert.rejects(
        eventLog.transaction(async (transaction) => {
          await transaction.append([{ type: 'rolled-back', payload: {} }])
          throw new Error('verifier rollback')
        }),
        /verifier rollback/,
      )
      assert.equal(await eventLog.currentVersion(), 0)
      assert.deepEqual(await eventLog.query(0, ['rolled-back']), [])
    })
  })

  await runCase(
    'event-log.transaction-serializes-decision',
    'event-log',
    async () => {
      await withRuntime(driver, async ({ eventLog }) => {
        const firstStarted = deferred<void>()
        const releaseFirst = deferred<void>()
        const secondStarted = deferred<void>()
        let secondObservedOrders: number[] = []

        const first = eventLog.transaction(async (transaction) => {
          const observed = await transaction.query(0, ['transaction-decision'])
          firstStarted.resolve()
          await releaseFirst.promise
          return transaction.append([
            {
              type: 'transaction-decision',
              payload: {
                decision: 'first',
                observedOrders: observed.map((entry) => entry.order),
              },
            },
          ])
        })
        await firstStarted.promise

        const second = eventLog.transaction(async (transaction) => {
          secondStarted.resolve()
          const observed = await transaction.query(0, ['transaction-decision'])
          secondObservedOrders = observed.map((entry) => entry.order)
          return transaction.append([
            {
              type: 'transaction-decision',
              payload: {
                decision: 'second',
                observedOrders: secondObservedOrders,
              },
            },
          ])
        })

        // This is bounded evidence, not a mathematical proof: hold the first
        // decision open for a substantial share of the configured case limit.
        const observationWindowMs = Math.max(1, Math.floor(caseTimeoutMs * 0.4))
        const secondEnteredBeforeCommit = await Promise.race([
          secondStarted.promise.then(() => true),
          delay(observationWindowMs).then(() => false),
        ])
        releaseFirst.resolve()
        await Promise.all([first, second])

        assert.equal(
          secondEnteredBeforeCommit,
          false,
          'A second Event Log transaction callback entered before the first committed',
        )
        assert.deepEqual(secondObservedOrders, [1])
        assert.deepEqual(
          (await eventLog.query(0, ['transaction-decision'])).map(
            (entry) => entry.payload,
          ),
          [
            { decision: 'first', observedOrders: [] },
            { decision: 'second', observedOrders: [1] },
          ],
        )
      })
    },
  )

  await runCase('event-log.concurrent-version', 'event-log', async () => {
    await withRuntime(driver, async ({ eventLog }) => {
      const append = (value: string) =>
        eventLog.transaction((transaction) =>
          transaction.append([{ type: 'versioned', payload: { value } }], {
            expectedVersion: 0,
          }),
        )
      const results = await Promise.allSettled([append('one'), append('two')])
      assert.equal(
        results.filter((result) => result.status === 'fulfilled').length,
        1,
      )
      const failure = results.find((result) => result.status === 'rejected')
      if (!failure || failure.status !== 'rejected') {
        throw new Error('Expected one concurrent append to reject')
      }
      assert.ok(failure.reason instanceof SpecterVersionConflictError)
      assert.equal(await eventLog.currentVersion(), 1)
    })
  })

  await runCase('event-log.idempotency', 'event-log', async () => {
    await withRuntime(driver, async ({ eventLog }) => {
      const first = await eventLog.append(
        [{ type: 'idempotent', payload: { value: 'first' } }],
        { idempotencyKey: 'request-1', fingerprint: 'fingerprint-1' },
      )
      const duplicate = await eventLog.append(
        [{ type: 'ignored', payload: {} }],
        { idempotencyKey: 'request-1', fingerprint: 'fingerprint-1' },
      )
      assert.deepEqual(duplicate, { ...first, duplicate: true })
      assert.deepEqual(await eventLog.findCommit('request-1'), {
        events: first.events,
        version: first.version,
        idempotencyKey: first.idempotencyKey,
        fingerprint: first.fingerprint,
      })
      await assert.rejects(
        eventLog.append([{ type: 'changed', payload: {} }], {
          idempotencyKey: 'request-1',
          fingerprint: 'fingerprint-2',
        }),
        SpecterIdempotencyConflictError,
      )
    })
  })

  await runCase('event-log.restart-durability', 'event-log', async () => {
    await withRuntime(driver, async (first) => {
      await first.eventLog.append([{ type: 'durable', payload: { value: 1 } }])
    })
    await withRuntime(driver, async (second) => {
      assert.deepEqual(
        (await second.eventLog.query(0, ['durable'])).map(
          (entry) => entry.payload,
        ),
        [{ value: 1 }],
      )
    })
  })

  await runCase('slice-store.staging-rollback', 'slice-store', async () => {
    await withRuntime(driver, async ({ sliceStore }) => {
      const abandoned = await sliceStore.get('stagingProbe')
      await abandoned.write.append('abandoned')
      assert.deepEqual(await readValues(sliceStore, 'stagingProbe'), [])

      await sliceStore.transaction('stagingProbe', async (store) => {
        await store.write.append('published')
        await store.setLastAppliedOrder(1)
      })
      await assert.rejects(
        sliceStore.transaction('stagingProbe', async (store) => {
          await store.write.append('rolled-back')
          await store.setLastAppliedOrder(2)
          throw new Error('projection failed')
        }),
        /projection failed/,
      )
      assert.deepEqual(await readValues(sliceStore, 'stagingProbe'), [
        'published',
      ])
      assert.equal(
        await (await sliceStore.get('stagingProbe')).lastAppliedOrder(),
        1,
      )
    })
  })

  await runCase('slice-store.failure-replay', 'slice-store', async () => {
    await withRuntime(driver, async ({ sliceStore }) => {
      await assert.rejects(
        sliceStore.transaction('replayProbe', async (store) => {
          await store.write.append('replayed-value')
          await store.setLastAppliedOrder(1)
          throw new Error('injected projection failure')
        }),
        /injected projection failure/,
      )
      assert.deepEqual(await readValues(sliceStore, 'replayProbe'), [])
      assert.equal(
        await (await sliceStore.get('replayProbe')).lastAppliedOrder(),
        0,
      )

      await publish(sliceStore, 'replayProbe', 'replayed-value', 1)
      assert.deepEqual(await readValues(sliceStore, 'replayProbe'), [
        'replayed-value',
      ])
      assert.equal(
        await (await sliceStore.get('replayProbe')).lastAppliedOrder(),
        1,
      )
    })
  })

  await runCase('slice-store.monotonic-isolation', 'slice-store', async () => {
    await withRuntime(driver, async ({ sliceStore }) => {
      await publish(sliceStore, 'sliceA', 'a', 2)
      await publish(sliceStore, 'sliceB', 'b', 1)
      try {
        await (await sliceStore.get('sliceA')).setLastAppliedOrder(1)
      } catch {
        // Rejecting a stale cursor is valid; silently lowering it is not.
      }
      assert.equal(await (await sliceStore.get('sliceA')).lastAppliedOrder(), 2)
      assert.equal(await (await sliceStore.get('sliceB')).lastAppliedOrder(), 1)
      assert.deepEqual(await readValues(sliceStore, 'sliceA'), ['a'])
      assert.deepEqual(await readValues(sliceStore, 'sliceB'), ['b'])
    })
  })

  await runCase('slice-store.restart-durability', 'slice-store', async () => {
    await withRuntime(driver, async (first) => {
      await publish(first.sliceStore, 'restartProbe', 'before-restart', 1)
    })
    await withRuntime(driver, async (second) => {
      assert.deepEqual(await readValues(second.sliceStore, 'restartProbe'), [
        'before-restart',
      ])
      assert.equal(
        await (await second.sliceStore.get('restartProbe')).lastAppliedOrder(),
        1,
      )
    })
  })

  await runCase('scheduler.serializes-coalesces', 'scheduler', async () => {
    let active = 0
    let maximumActive = 0
    let calls = 0
    const firstStarted = deferred<void>()
    const releaseFirst = deferred<void>()
    await withRuntime(driver, async (runtime) => {
      const request = runtime.schedule(async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        calls += 1
        if (calls === 1) {
          firstStarted.resolve()
          await releaseFirst.promise
        }
        active -= 1
      })
      const firstWait = request()()
      await firstStarted.promise
      const followUpWaits = [request()(), request()()]
      releaseFirst.resolve()
      await Promise.all([firstWait, ...followUpWaits])
      assert.equal(maximumActive, 1)
      assert.equal(calls, 2)
    })
  })

  await runCase(
    'scheduler.dead-letter-preserves-active-follow-up',
    'scheduler',
    async () => {
      const contexts: ReactionDeliveryContext[] = []
      const firstStarted = deferred<void>()
      const releaseFirstAttempt = deferred<void>()
      let failingDeliveryId: string | undefined

      await withRuntime(driver, async (runtime) => {
        const request = runtime.schedule(async (context) => {
          contexts.push(context)
          if (!failingDeliveryId) {
            failingDeliveryId = context.deliveryId
            firstStarted.resolve()
          }
          if (context.deliveryId === failingDeliveryId) {
            if (context.attemptNumber === 1) {
              await releaseFirstAttempt.promise
            }
            throw new Error('active delivery dead-letter probe')
          }
        })

        const firstWait = request()()
        await firstStarted.promise
        const followUpWait = request()()
        releaseFirstAttempt.resolve()
        const waits = await Promise.allSettled([firstWait, followUpWait])
        assert.ok(waits.some((result) => result.status === 'rejected'))

        const deliveries = await driver.deliveries()
        assert.equal(deliveries.length, 2)
        const deadLetter = deliveries.find(
          (delivery) => delivery.deliveryId === failingDeliveryId,
        )
        const completed = deliveries.find(
          (delivery) => delivery.deliveryId !== failingDeliveryId,
        )
        assert.equal(deadLetter?.status, 'dead-letter')
        assert.equal(deadLetter?.attemptCount, 3)
        assert.match(
          deadLetter?.lastError ?? '',
          /active delivery dead-letter probe/,
        )
        assert.equal(completed?.status, 'completed')
        assert.equal(completed?.attemptCount, 1)
        assert.notEqual(completed?.deliveryId, deadLetter?.deliveryId)
        assertDeliveryMatchesContexts(
          deadLetter,
          contexts.filter(
            (context) => context.deliveryId === deadLetter?.deliveryId,
          ),
        )
        assertDeliveryMatchesContexts(
          completed,
          contexts.filter(
            (context) => context.deliveryId === completed?.deliveryId,
          ),
        )
      })
    },
  )

  await runCase('scheduler.retry-context', 'scheduler', async () => {
    const contexts: Array<{
      deliveryId: string
      scheduledAt: string
      attemptId: string
      attemptNumber: number
    }> = []
    await withRuntime(driver, async (runtime) => {
      const request = runtime.schedule(async (context) => {
        contexts.push(context)
        if (context.attemptNumber < 3) throw new Error('retry probe')
      })
      await request()()
      assert.deepEqual(
        contexts.map((context) => context.attemptNumber),
        [1, 2, 3],
      )
      assert.equal(
        new Set(contexts.map((context) => context.deliveryId)).size,
        1,
      )
      assert.equal(
        new Set(contexts.map((context) => context.scheduledAt)).size,
        1,
      )
      assert.equal(
        new Set(contexts.map((context) => context.attemptId)).size,
        3,
      )
      const deliveries = await driver.deliveries()
      assert.equal(deliveries.length, 1)
      const [delivery] = deliveries
      assert.equal(delivery?.status, 'completed')
      assert.equal(delivery?.attemptCount, 3)
      assertDeliveryMatchesContexts(delivery, contexts)
    })
  })

  await runCase('scheduler.dead-letter-retry', 'scheduler', async () => {
    let shouldFail = true
    const contexts: ReactionDeliveryContext[] = []
    await withRuntime(driver, async (runtime) => {
      const request = runtime.schedule(async (context) => {
        contexts.push(context)
        if (shouldFail) throw new Error('dead-letter probe')
      })
      await assert.rejects(request()())
      const deadLetters = await driver.deliveries()
      assert.equal(deadLetters.length, 1)
      const [deadLetter] = deadLetters
      assert.equal(deadLetter?.status, 'dead-letter')
      assert.equal(deadLetter?.attemptCount, 3)
      assert.match(deadLetter?.lastError ?? '', /dead-letter probe/)
      assertDeliveryMatchesContexts(deadLetter, contexts)
      shouldFail = false
      await driver.retryDeadLetter(deadLetter?.deliveryId ?? '')
      await request()()
      const retried = (await driver.deliveries()).find(
        (delivery) => delivery.deliveryId === deadLetter?.deliveryId,
      )
      assert.equal(retried?.status, 'completed')
      assert.equal(retried?.attemptCount, 4)
      assertDeliveryMatchesContexts(
        retried,
        contexts.filter(
          (context) => context.deliveryId === deadLetter?.deliveryId,
        ),
      )
    })
  })

  await runCase('scheduler.restart-recovery', 'scheduler', async () => {
    const never = new Promise<void>(() => {})
    const contexts: ReactionDeliveryContext[] = []
    let crashedDelivery: ReactionDeliverySnapshot | undefined
    await withRuntime(
      driver,
      async (first) => {
        const firstRequest = first.schedule(async (context) => {
          contexts.push(context)
          await never
        })
        void firstRequest()()
        await waitFor(async () =>
          (await driver.deliveries()).some(
            (delivery) => delivery.status === 'running',
          ),
        )
        crashedDelivery = (await driver.deliveries()).find(
          (delivery) => delivery.status === 'running',
        )
        assert.equal(crashedDelivery?.attemptCount, 1)
        assertDeliveryMatchesContexts(crashedDelivery, contexts)
      },
      { crash: true },
    )

    await delay(5)
    await withRuntime(driver, async (second) => {
      const request = second.schedule(async (context) => {
        contexts.push(context)
      })
      await request()()
      const recovered = (await driver.deliveries()).find(
        (delivery) => delivery.deliveryId === crashedDelivery?.deliveryId,
      )
      assert.equal(recovered?.status, 'completed')
      assert.ok((recovered?.attemptCount ?? 0) >= 2)
      assertDeliveryMatchesContexts(
        recovered,
        contexts.filter(
          (context) => context.deliveryId === crashedDelivery?.deliveryId,
        ),
      )
    })
  })

  await runCase('probe.command-reaction-restart', 'probe', async () => {
    const effects: Array<{
      requestId: string
      context: ReactionDeliveryContext
    }> = []
    await withRuntime(driver, async (runtime) => {
      const app = await createBrownfieldProbe({
        eventLog: runtime.eventLog,
        sliceStore: runtime.sliceStore,
        schedule: runtime.schedule,
        effect: async (effect) => {
          effects.push({
            requestId: effect.requestId,
            context: effect.context,
          })
        },
      })
      const execution = await app.command({
        type: 'requestBrownfieldProbe',
        payload: { requestId: 'probe-1', requestedAt: probeTime },
      })
      await execution.reactions
      assert.equal(effects.length, 1)
      assert.equal(effects[0]?.requestId, 'probe-1')
      assert.ok((effects[0]?.context.deliveryId.length ?? 0) > 0)
      assert.ok((effects[0]?.context.attemptId.length ?? 0) > 0)
      assert.equal(effects[0]?.context.attemptNumber, 1)
      assert.equal(
        new Date(effects[0]?.context.scheduledAt ?? '').toISOString(),
        effects[0]?.context.scheduledAt,
      )
      await assert.rejects(
        app.command({
          type: 'requestBrownfieldProbe',
          payload: {
            requestId: 'probe-1',
            requestedAt: '2026-07-17T00:00:01.000Z',
          },
        }),
        /already exists/,
      )
    })

    await withRuntime(driver, async (reopened) => {
      assert.equal(await reopened.eventLog.currentVersion(), 1)
      assert.equal(
        await (
          await reopened.sliceStore.get('requestBrownfieldProbe')
        ).lastAppliedOrder(),
        1,
      )
    })
  })

  const finishedAt = new Date().toISOString()
  return {
    schemaVersion: 1,
    driver: driver.name,
    startedAt,
    finishedAt,
    passed: cases.every((entry) => entry.status === 'passed'),
    cases,
  }
}

async function withRuntime(
  driver: AdapterHarnessDriver,
  run: (runtime: AdapterHarnessRuntime) => Promise<void>,
  closeOptions?: { readonly crash?: boolean },
) {
  const runtime = await driver.open()
  const failures: string[] = []
  try {
    await run(runtime)
  } catch (error) {
    failures.push(`runtime: ${formatError(error)}`)
  }
  try {
    await runtime.close(closeOptions)
  } catch (error) {
    failures.push(`close: ${formatError(error)}`)
  }
  if (failures.length > 0) {
    throw new Error(failures.join('\n'))
  }
}

async function publish(
  sliceStore: AdapterHarnessRuntime['sliceStore'],
  sliceName: string,
  value: string,
  order: number,
) {
  await sliceStore.transaction(sliceName, async (store) => {
    await store.write.append(value)
    await store.setLastAppliedOrder(order)
  })
}

async function readValues(
  sliceStore: AdapterHarnessRuntime['sliceStore'],
  sliceName: string,
) {
  return [...(await (await sliceStore.get(sliceName)).read.values())]
}

function formatError(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

function assertDeliveryMatchesContexts(
  delivery: ReactionDeliverySnapshot | undefined,
  contexts: readonly ReactionDeliveryContext[],
) {
  assert.ok(delivery, 'Expected a scheduler delivery snapshot')
  assert.ok(delivery.deliveryId.length > 0)
  assert.equal(
    new Date(delivery.scheduledAt).toISOString(),
    delivery.scheduledAt,
  )
  assert.ok(contexts.length > 0)
  assert.deepEqual(
    contexts.map((context) => context.deliveryId),
    Array.from({ length: contexts.length }, () => delivery.deliveryId),
  )
  assert.deepEqual(
    contexts.map((context) => context.scheduledAt),
    Array.from({ length: contexts.length }, () => delivery.scheduledAt),
  )
  for (const context of contexts) {
    assert.ok(context.attemptId.length > 0)
    assert.equal(
      new Date(context.scheduledAt).toISOString(),
      context.scheduledAt,
    )
  }
  assert.equal(
    new Set(contexts.map((context) => context.attemptId)).size,
    contexts.length,
  )
  assert.deepEqual(
    delivery.attemptIds,
    contexts.map((context) => context.attemptId),
  )
  assert.deepEqual(
    contexts.map((context) => context.attemptNumber),
    Array.from({ length: contexts.length }, (_, index) => index + 1),
  )
  assert.equal(delivery.attemptCount, contexts.length)
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  label: string,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new AdapterContractTimeoutError(label, timeoutMs))
    }, timeoutMs)
  })
  const started = Promise.resolve().then(operation)
  try {
    return await Promise.race([started, expired])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await delay(1)
  }
  throw new Error(`Timed out after ${timeoutMs}ms`)
}
