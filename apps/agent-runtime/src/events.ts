import { createEventDefinition, type EventDefinition } from '@specter-ts/core'
import { SessionEvent } from '@ocpp/schema/session-event'
import { Schema } from 'effect'

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
      Schema.toStandardSchemaV1(definition.data),
    ),
)

// Type-level twin of toSpecterEventType: keeps the event name a literal.
type Dashed<S extends string> = S extends `${infer A}.${infer B}`
  ? `${A}-${Dashed<B>}`
  : S

type Definitions = (typeof SessionEvent.DurableDefinitions)[number]

export type SessionEventPayloads = {
  [D in Definitions as Dashed<D['type']>]: Schema.Schema.Type<D['data']>
}

export const sessionEvent = <K extends keyof SessionEventPayloads>(
  specterType: K,
): EventDefinition<K, SessionEventPayloads[K]> => {
  const definition = sessionEventDefinitions.find(
    (candidate) => candidate.type === specterType,
  )
  if (!definition) throw new Error(`Unknown session event: ${specterType}`)
  // Single cast (via unknown: create() is contravariant in the payload, so TS
  // sees no overlap between the wide and the narrowed definition). The runtime array is built from the same DurableDefinitions (names mapped
  // by toSpecterEventType) that SessionEventPayloads is derived from at the
  // type level, so K and the payload type always correspond.
  return definition as unknown as EventDefinition<K, SessionEventPayloads[K]>
}
