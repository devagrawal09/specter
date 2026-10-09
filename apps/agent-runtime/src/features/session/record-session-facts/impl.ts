import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// The names of the calls whose input the host has started recording, keyed
// by assistant message and call: OC++ names a call at its input's start, the
// runtime's requested call carries the name.
export type RecordSessionFactsState = { toolNames: Record<string, string> }

export const recordSessionFactsStore = Context.Service<
  SliceStoreService<RecordSessionFactsState, RecordSessionFactsState, unknown>
>('@specter/agent-runtime/RecordSessionFactsStore')

export const createRecordSessionFactsState = (): RecordSessionFactsState => ({
  toolNames: {},
})

// Each payload is decoded by its event's definition (OC++'s schema) when the
// runtime stores it, so the input only names the fact.
const input = Schema.toStandardSchemaV1(
  Schema.Struct({
    facts: Schema.NonEmptyArray(
      Schema.Struct({ type: Schema.String, payload: Schema.Unknown }),
    ),
  }),
)

type Fact = { readonly type: string; readonly payload: unknown }
type Payload = Record<string, unknown>
const callKey = (payload: Payload) =>
  `${String(payload.assistantMessageID)}:${String(payload.id)}`

// A host's own executions (an external agent's) are not the runtime's to run:
// they get their own facts, so no Slice mistakes them for one it started.
const external: Record<string, string> = {
  'session-execution-succeeded': 'succeeded',
  'session-execution-failed': 'failed',
  'session-execution-interrupted': 'interrupted',
}

// The steps a host runs are recorded in the runtime's consolidated catalog,
// one fact for one fact, so every Slice sees them as it sees its own: a step
// settled, a finished block, a requested call and its settlement. The rest of
// a step (its start, block and input starts) keeps OC++'s name.
const translate = (fact: Fact, names: Record<string, string>): Fact => {
  const payload = fact.payload as Payload
  if (fact.type === 'session-execution-started')
    return { type: 'session-external-execution-started', payload }
  const outcome = external[fact.type]
  if (outcome !== undefined)
    return {
      type: 'session-external-execution-settled',
      payload: { ...payload, outcome },
    }
  switch (fact.type) {
    case 'session-step-ended':
      return {
        type: 'session-step-settled',
        payload: { ...payload, outcome: 'succeeded' },
      }
    case 'session-step-failed':
      return {
        type: 'session-step-settled',
        payload: { ...payload, outcome: 'failed' },
      }
    case 'session-text-ended':
      return {
        type: 'session-block-recorded',
        payload: { ...payload, kind: 'text' },
      }
    case 'session-reasoning-ended':
      return {
        type: 'session-block-recorded',
        payload: { ...payload, kind: 'reasoning' },
      }
    case 'session-tool-called':
      return {
        type: 'session-tool-requested',
        payload: { ...payload, name: names[callKey(payload)] ?? 'unknown' },
      }
    case 'session-tool-success':
      return {
        type: 'session-tool-settled',
        payload: { ...payload, outcome: 'succeeded' },
      }
    case 'session-tool-failed':
      return {
        type: 'session-tool-settled',
        payload: { ...payload, outcome: 'failed' },
      }
    default:
      return fact
  }
}

const inputStarted = sessionEvent('session-tool-input-started')

export const recordSessionFacts = implementCommand(specification)
  .inputSchema(input)
  .store(recordSessionFactsStore)
  .apply(inputStarted, async (event, state) => {
    state.toolNames[callKey(event.payload)] = event.payload.name
  })
  .handle(async (command, state) => {
    // A publication can start a call's input and request the call at once.
    const names = { ...state.toolNames }
    return command.facts.map((fact) => {
      if (fact.type === 'session-tool-input-started') {
        const payload = fact.payload as Payload
        names[callKey(payload)] = String(payload.name)
      }
      return translate(fact, names)
    })
  })
