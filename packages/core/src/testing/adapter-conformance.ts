import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'

import type {
  EventLogAdapter,
  ReactionScheduler,
  SliceStoreService,
} from '../adapters'

type AdapterFactory<T> = () => T | Promise<T>

export function testEventLogAdapter(
  name: string,
  createAdapter: AdapterFactory<EventLogAdapter>,
) {
  describe(`${name} Event Log adapter`, () => {
    it('atomically appends, orders, and queries Events', async () => {
      const eventLog = await createAdapter()
      const appended = await eventLog.transaction(async (transaction) => {
        expect(await transaction.currentVersion()).toBe(0)
        return transaction.append(
          [
            { type: 'first-recorded', payload: { value: 1 } },
            { type: 'second-recorded', payload: { value: 2 } },
          ],
          { expectedVersion: 0 },
        )
      })

      expect(appended).toMatchObject({ version: 2, duplicate: false })
      expect(appended.events.map(({ order }) => order)).toEqual([1, 2])
      await expect(
        eventLog.query(1, ['second-recorded']),
      ).resolves.toMatchObject([{ order: 2, type: 'second-recorded' }])
    })

    it('returns the original receipt for a repeated idempotency key', async () => {
      const eventLog = await createAdapter()
      const options = {
        idempotencyKey: 'adapter-conformance-command',
        fingerprint: 'v2:adapter-conformance',
      }
      const first = await eventLog.transaction((transaction) =>
        transaction.append([{ type: 'value-recorded', payload: 1 }], options),
      )
      const duplicate = await eventLog.transaction((transaction) =>
        transaction.append([{ type: 'value-recorded', payload: 1 }], options),
      )

      expect(duplicate).toEqual({ ...first, duplicate: true })
      await expect(
        eventLog.findCommit('adapter-conformance-command'),
      ).resolves.toEqual({
        events: first.events,
        version: first.version,
        idempotencyKey: options.idempotencyKey,
        fingerprint: options.fingerprint,
      })
    })
  })
}

export type SliceStoreConformanceOptions<TWriteState, TReadState, TValue> = {
  readonly createService: AdapterFactory<
    SliceStoreService<TReadState, TWriteState, unknown>
  >
  readonly write: (state: TWriteState, value: TValue) => void | Promise<void>
  readonly read: (state: TReadState) => TValue | Promise<TValue>
  readonly value: TValue
}

export function testSliceStoreService<TWriteState, TReadState, TValue>(
  name: string,
  options: SliceStoreConformanceOptions<TWriteState, TReadState, TValue>,
) {
  describe(`${name} Slice Store service`, () => {
    it('publishes state and cursor through the store boundary', async () => {
      const service = await options.createService()
      await Effect.runPromise(
        service.transaction(
          'adapterConformance',
          async (write, _read, cursor, publishCursor) => {
            expect(cursor).toBe(0)
            await options.write(write, options.value)
            await publishCursor(7)
          },
        ),
      )

      const published = await Effect.runPromise(
        service.read('adapterConformance', async (read, cursor) => ({
          value: await options.read(read),
          cursor,
        })),
      )
      expect(published).toEqual({ value: options.value, cursor: 7 })
    })

    it('runs grouped work through transaction', async () => {
      const service = await options.createService()
      const result = await Effect.runPromise(
        service.transaction(
          'adapterConformance',
          async (write, read, _cursor, publishCursor) => {
            await options.write(write, options.value)
            await publishCursor(9)
            return options.read(read())
          },
        ),
      )

      expect(result).toEqual(options.value)
      await expect(
        Effect.runPromise(
          service.read('adapterConformance', async (_read, cursor) => cursor),
        ),
      ).resolves.toBe(9)
    })
  })
}

export function testReactionScheduler(
  name: string,
  createScheduler: AdapterFactory<ReactionScheduler>,
) {
  describe(`${name} Reaction Scheduler adapter`, () => {
    it('runs requested work and settles its idle waiter', async () => {
      const contexts: unknown[] = []
      const schedule = await createScheduler()
      const request = schedule(async (context) => {
        contexts.push(context)
      })

      await request()()

      expect(contexts).toHaveLength(1)
      expect(contexts[0]).toMatchObject({
        deliveryId: expect.any(String),
        scheduledAt: expect.any(String),
        attemptId: expect.any(String),
        attemptNumber: expect.any(Number),
      })
      expect(
        Number.isNaN(
          Date.parse((contexts[0] as { scheduledAt: string }).scheduledAt),
        ),
      ).toBe(false)
    })
  })
}
