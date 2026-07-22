import type { RuntimeObservation } from '@specter-ts/protocol'
import { z } from 'zod'

import { CollectorStore } from '../../collector-store'
import {
  runtimeObservationIdentity,
} from '../../collector-model'
import {
  runtimeObservationRecordedEvent,
  runtimeObservationSchema,
} from './events'
import { recordRuntimeObservationsSpec } from './spec'

export const recordRuntimeObservations = recordRuntimeObservationsSpec
    .inputSchema(
      z.object({
        requestId: z.string().min(1),
        observations: z.array(runtimeObservationSchema).min(1).max(100),
      }),
    )
    .store(CollectorStore)
    .apply(runtimeObservationRecordedEvent, async (event, state) => {
      const observation = event.payload.observation as RuntimeObservation
      const identity = runtimeObservationIdentity(observation)
      if (state.observationIds[identity]) return
      state.observationIds[identity] = true
      state.observations.push({
        ...observation,
        collectorOrder: (event as typeof event & { readonly order: number })
          .order,
      })
    })
    .handle(async (command, state) => {
      const seen = new Set(Object.keys(state.observationIds))
      return command.observations.flatMap((observation) => {
        const identity = runtimeObservationIdentity(observation)
        if (seen.has(identity)) return []
        seen.add(identity)
        return [runtimeObservationRecordedEvent.create({ observation })]
      })
    })
