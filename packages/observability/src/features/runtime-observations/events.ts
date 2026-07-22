import { createEventDefinition } from '@specter-ts/core'
import {
  observationKinds,
  type JsonValue,
  type RuntimeObservation,
} from '@specter-ts/protocol'
import { z } from 'zod'

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
)

const sourceSchema = z
  .object({
    application: z.string().min(1),
    environment: z.string().min(1),
    runtimeLanguage: z.string().min(1),
    runtimeVersion: z.string().min(1),
    instanceId: z.string().min(1),
    eventLogId: z.string().min(1),
  })
  .passthrough()

export const runtimeObservationSchema: z.ZodType<RuntimeObservation> = z
  .object({
    kind: z.enum(observationKinds),
    observationId: z.string().min(1),
    sequence: z.number().int().nonnegative(),
    observedAt: z.iso.datetime(),
    source: sourceSchema,
    operationId: z.string().min(1),
    correlationId: z.string().min(1).optional(),
    parentOperationIds: z.array(z.string().min(1)).optional(),
    triggeringEventIds: z.array(z.string().min(1)).optional(),
    triggeringEventOrder: z
      .object({
        from: z.number().int().nonnegative(),
        to: z.number().int().nonnegative(),
      })
      .optional(),
    attributes: z.record(z.string(), jsonValueSchema).optional(),
  })
  .passthrough()

export const runtimeObservationRecordedEvent = createEventDefinition(
  'runtime-observation-recorded',
  z.object({ observation: runtimeObservationSchema }),
)

export const observabilityEventDefinitions = [
  runtimeObservationRecordedEvent,
] as const
