import { createServerFn } from '@tanstack/start-client-core'
import { z } from 'zod'

import { db } from '../db/client.server'
import { projectionRegistrations } from './registry'

type SerializableProjectionResult =
  | null
  | string
  | number
  | boolean
  | SerializableProjectionResult[]
  | { [key: string]: SerializableProjectionResult }

export const queryProjection = createServerFn()
  .inputValidator(
    z.object({
      projectionName: z.string(),
      input: z.unknown(),
    }),
  )
  .handler(async ({ data }): Promise<SerializableProjectionResult> => {
    const registration = projectionRegistrations.find(
      (projection) => projection.name === data.projectionName,
    )

    if (!registration) {
      throw new Error(`Unknown todo projection: ${data.projectionName}`)
    }

    const input = registration.schema.parse(data.input)

    return registration.query(db, input) as SerializableProjectionResult
  })
