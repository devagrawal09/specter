import { createEventDefinition, type EventDefinition } from '@specter-ts/core'
import { SessionError } from '@ocpp/schema/session-error'
import { ExternalSession } from '@ocpp/schema/external-session'
import { SessionEvent } from '@ocpp/schema/session-event'
import { SessionID } from '@ocpp/schema/session-id'
import { SessionMessage } from '@ocpp/schema/session-message'
import { NonNegativeInt, optional, PositiveInt } from '@ocpp/schema/schema'
import { Worktree } from '@ocpp/schema/worktree'
import { Schema } from 'effect'

// Specter's spec format requires kebab-case event types; OC++ uses dotted
// names. The mapping is mechanical and inverted by the OC++ bridge (M4).
export const toSpecterEventType = (ocppType: string) =>
  ocppType.replaceAll('.', '-')
export const toOcppEventType = (specterType: string) =>
  specterType.replaceAll('-', '.')

// Session Execution facts the runtime owns, in the consolidated catalog. A
// lifecycle has a started event and one settled event that carries its outcome.
// A fact whose shape differs from OC++'s gets a new name, so one name never
// carries two shapes in the log; OC++ receives its own events by translation.
const runtimeEventSchemas = {
  // One terminal per busy period (replaces OC++'s execution succeeded, failed
  // and interrupted).
  'session-execution-settled': Schema.Union([
    Schema.Struct({
      sessionID: SessionID,
      outcome: Schema.Literal('succeeded'),
    }),
    Schema.Struct({
      sessionID: SessionID,
      outcome: Schema.Literal('failed'),
      error: SessionError.Error,
    }),
    Schema.Struct({
      sessionID: SessionID,
      outcome: Schema.Literal('interrupted'),
      reason: Schema.Literals(['user', 'shutdown', 'superseded']),
    }),
  ]),
  // One terminal per physical attempt of a step (replaces OC++'s step ended,
  // step failed and retry scheduled). A failure that is retried carries the
  // retry: the next attempt of the same step follows.
  'session-step-settled': Schema.Union([
    Schema.Struct({
      ...SessionEvent.Step.Ended.data.fields,
      outcome: Schema.Literal('succeeded'),
      // Another step must follow (tool results to answer): the next step
      // starts at a step boundary instead of an idle one.
      continues: optional(Schema.Literal(true)),
    }),
    Schema.Struct({
      ...SessionEvent.Step.Failed.data.fields,
      outcome: Schema.Literal('failed'),
      // The next attempt of the same step, due at `at`. A fresh one runs as a
      // new step, because this attempt's output stands; it keeps the step's
      // number and retry budget.
      retry: optional(
        Schema.Struct({
          attempt: PositiveInt,
          at: NonNegativeInt,
          fresh: optional(Schema.Literal(true)),
        }),
      ),
    }),
  ]),
  // A finished content block of an attempt (replaces OC++'s text and
  // reasoning started and ended). Ordinals count per kind, as in OC++.
  'session-block-recorded': Schema.Union([
    Schema.Struct({
      ...SessionEvent.Text.Ended.data.fields,
      kind: Schema.Literal('text'),
    }),
    Schema.Struct({
      ...SessionEvent.Reasoning.Ended.data.fields,
      kind: Schema.Literal('reasoning'),
    }),
  ]),
  // A complete tool call the model requested, durable before any side effect
  // (replaces OC++'s tool input started, input ended and called). The raw
  // input text is derivable from the input, so it is not recorded.
  'session-tool-requested': Schema.Struct({
    ...SessionEvent.Tool.Called.data.fields,
    name: Schema.String,
  }),
  // A call whose input never became a call (it stopped streaming, or never
  // parsed): it fails with the raw input it had (replaces OC++'s tool input
  // started, input ended and failed for such a call).
  'session-tool-input-failed': Schema.Struct({
    ...SessionEvent.Tool.Failed.data.fields,
    name: Schema.String,
    text: optional(Schema.String),
  }),
  // The one terminal of a requested call (replaces OC++'s tool success and
  // tool failed).
  'session-tool-settled': Schema.Union([
    Schema.Struct({
      ...SessionEvent.Tool.Success.data.fields,
      outcome: Schema.Literal('succeeded'),
    }),
    Schema.Struct({
      ...SessionEvent.Tool.Failed.data.fields,
      outcome: Schema.Literal('failed'),
    }),
  ]),
  // An execution the host ran itself (an external agent's), not this
  // runtime: its own started and settled facts, so no Slice takes it for one
  // the runtime runs.
  'session-external-execution-started': Schema.Struct({ sessionID: SessionID }),
  'session-external-execution-settled': Schema.Union([
    Schema.Struct({
      sessionID: SessionID,
      outcome: Schema.Literal('succeeded'),
    }),
    Schema.Struct({
      sessionID: SessionID,
      outcome: Schema.Literal('failed'),
      error: SessionError.Error,
    }),
    Schema.Struct({
      sessionID: SessionID,
      outcome: Schema.Literal('interrupted'),
      reason: Schema.Literals(['user', 'shutdown', 'superseded']),
    }),
  ]),
  // An execution that continues a turn the user interrupted, recorded in its
  // start's commit: it takes steering input and control items, never queued
  // input.
  'session-execution-continued': Schema.Struct({ sessionID: SessionID }),
  // An admitted input that waits for the next wake instead of waking the
  // Session (OC++'s `resume: false`), recorded in its admission's commit.
  'session-inbox-held': Schema.Struct({
    sessionID: SessionID,
    inboxID: SessionMessage.ID,
  }),
} as const

// Every durable fact OC++ records: its Session events, the facts an external
// agent's Session keeps (vendor binding and checkpoints), and a directory's
// resolution to a project, which moves the Sessions it held to that project.
const durableDefinitions = [
  ...SessionEvent.DurableDefinitions,
  ...ExternalSession.Definitions,
  Worktree.Event.Resolved,
] as const

// One Specter event definition per OC++ durable session fact (mapped name,
// OC++'s payload schema as a Standard Schema), then the runtime's own facts.
export const sessionEventDefinitions = [
  ...durableDefinitions.map((definition) =>
    createEventDefinition(
      toSpecterEventType(definition.type),
      Schema.toStandardSchemaV1(definition.data),
    ),
  ),
  ...Object.entries(runtimeEventSchemas).map(([type, schema]) =>
    createEventDefinition(type, Schema.toStandardSchemaV1(schema)),
  ),
]

// Type-level twin of toSpecterEventType: keeps the event name a literal.
type Dashed<S extends string> = S extends `${infer A}.${infer B}`
  ? `${A}-${Dashed<B>}`
  : S

type Definitions = (typeof durableDefinitions)[number]

export type SessionEventPayloads = {
  [D in Definitions as Dashed<D['type']>]: Schema.Schema.Type<D['data']>
} & {
  [K in keyof typeof runtimeEventSchemas]: Schema.Schema.Type<
    (typeof runtimeEventSchemas)[K]
  >
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
