import { createEventDefinition, createSpecterApp } from '@specter-ts/core'
import type {
  ReactionDeliveryContext,
  ReactionScheduler,
} from '@specter-ts/core'
import {
  createCommandSlice,
  createReactionSlice,
  event,
} from '@specter-ts/core/spec'
import { z } from 'zod'

import type { ProbeSliceStore } from './types.js'

const probeRequestedEvent = createEventDefinition(
  'brownfield-probe-requested',
  z.object({
    requestId: z.string().min(1),
    requestedAt: z.string().datetime(),
  }),
)

const requestProbeSpec = createCommandSlice('requestBrownfieldProbe')
  .description('Commits one deterministic verifier probe request.')
  .scenarios(
    {
      description: 'Commits a new probe request.',
      given: [],
      when: {
        requestId: 'probe-1',
        requestedAt: '2026-07-17T00:00:00.000Z',
      },
      expect: [
        event('brownfield-probe-requested', {
          requestId: 'probe-1',
          requestedAt: '2026-07-17T00:00:00.000Z',
        }),
      ],
    },
    {
      description: 'Rejects a probe request that was already committed.',
      given: [
        event('brownfield-probe-requested', {
          requestId: 'probe-1',
          requestedAt: '2026-07-17T00:00:00.000Z',
        }),
      ],
      when: {
        requestId: 'probe-1',
        requestedAt: '2026-07-17T00:00:01.000Z',
      },
      expect: [],
    },
  )

const observeProbeSpec = createReactionSlice('observeBrownfieldProbe')
  .description(
    'Produces an observable effect for each committed probe request.',
  )
  .scenarios({
    description: 'Observes the newest committed probe request.',
    given: [
      event('brownfield-probe-requested', {
        requestId: 'probe-1',
        requestedAt: '2026-07-17T00:00:00.000Z',
      }),
    ],
    expect: [
      {
        requestId: 'probe-1',
        requestedAt: '2026-07-17T00:00:00.000Z',
      },
    ],
  })

export type ProbeEffect = {
  readonly requestId: string
  readonly requestedAt: string
  readonly context: ReactionDeliveryContext
}

export function createBrownfieldProbe(options: {
  readonly eventLog: Parameters<typeof createSpecterApp>[0]['eventLog']
  readonly sliceStore: ProbeSliceStore
  readonly schedule: ReactionScheduler
  readonly effect: (effect: ProbeEffect) => Promise<void>
}) {
  const requestProbe = requestProbeSpec
    .inputSchema(
      z.object({
        requestId: z.string().min(1),
        requestedAt: z.string().datetime(),
      }),
    )
    .store(options.sliceStore)
    .apply(probeRequestedEvent, async (persistedEvent, state) => {
      await state.append(persistedEvent.payload.requestId)
    })
    .handle(async (command, state) => {
      const requestIds = await state.values()
      if (requestIds.includes(command.requestId)) {
        throw new Error(`Probe request already exists: ${command.requestId}`)
      }
      return [probeRequestedEvent.create(command)]
    })

  const observeProbe = observeProbeSpec
    .outputSchema(
      z.object({
        requestId: z.string().min(1),
        requestedAt: z.string().datetime(),
      }),
    )
    .plugin(
      async () => async (output, context) =>
        options.effect({ ...output, context }),
    )
    .store(options.sliceStore)
    .apply(probeRequestedEvent, async (persistedEvent, state) => {
      await state.append(
        JSON.stringify({
          requestId: persistedEvent.payload.requestId,
          requestedAt: persistedEvent.payload.requestedAt,
        }),
      )
    })
    .handle(async (state) => {
      const values = await state.values()
      const newest = values.at(-1)
      if (!newest) return
      return z
        .object({ requestId: z.string(), requestedAt: z.string().datetime() })
        .parse(JSON.parse(newest))
    })

  return createSpecterApp({
    events: [probeRequestedEvent],
    eventLog: options.eventLog,
    schedule: options.schedule,
    slices: [requestProbe, observeProbe],
  })
}
