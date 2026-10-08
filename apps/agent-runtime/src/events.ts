import { createEventDefinition } from '@specter-ts/core'
import { SessionEvent } from '@ocpp/schema/session-event'
import { Schema } from 'effect'

// @ocpp/schema is built against effect 4.0.0-rc.112, Specter against 4.0.1, so
// the two Schema types do not unify. Runtime behavior is identical for
// Standard Schema; the cast only bridges the type skew (revisit at M2).
type SpecterSchema = Parameters<typeof Schema.toStandardSchemaV1>[0]

// Specter's spec format requires kebab-case event types; OC++ uses dotted
// names. The mapping is mechanical and inverted by the OC++ bridge (M4).
export const toSpecterEventType = (ocppType: string) =>
  ocppType.replaceAll('.', '-')
export const toOcppEventType = (specterType: string) =>
  specterType.replaceAll('-', '.')

// One Specter event definition per OC++ durable session event: mapped name,
// payload schema passed through as a Standard Schema (no hand-copying).
export const sessionEventDefinitions = SessionEvent.DurableDefinitions.map(
  (definition) =>
    createEventDefinition(
      toSpecterEventType(definition.type),
      Schema.toStandardSchemaV1(definition.data as unknown as SpecterSchema),
    ),
)

export const sessionEvent = (specterType: string) => {
  const definition = sessionEventDefinitions.find(
    (candidate) => candidate.type === specterType,
  )
  if (!definition) throw new Error(`Unknown session event: ${specterType}`)
  return definition
}
