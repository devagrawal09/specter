import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// What the host recorded of each call so far, keyed by assistant message and
// call: OC++ names a call at its input's start and gives its raw input at its
// end; a call it requested is settled, one it did not fails as input.
export type RecordSessionFactsState = {
  toolNames: Record<string, string>
  toolTexts: Record<string, string>
  requested: Record<string, true>
}

export const recordSessionFactsStore = Context.Service<
  SliceStoreService<RecordSessionFactsState, RecordSessionFactsState, unknown>
>('@specter/agent-runtime/RecordSessionFactsStore')

export const createRecordSessionFactsState = (): RecordSessionFactsState => ({
  toolNames: {},
  toolTexts: {},
  requested: {},
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
type Calls = Pick<
  RecordSessionFactsState,
  'toolNames' | 'toolTexts' | 'requested'
>

const translate = (fact: Fact, calls: Calls): Fact => {
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
        payload: {
          ...payload,
          name: calls.toolNames[callKey(payload)] ?? 'unknown',
        },
      }
    case 'session-tool-success':
      return {
        type: 'session-tool-settled',
        payload: { ...payload, outcome: 'succeeded' },
      }
    case 'session-tool-failed': {
      const key = callKey(payload)
      if (calls.requested[key])
        return {
          type: 'session-tool-settled',
          payload: { ...payload, outcome: 'failed' },
        }
      const text = calls.toolTexts[key]
      return {
        type: 'session-tool-input-failed',
        payload: {
          ...payload,
          name: calls.toolNames[key] ?? 'unknown',
          ...(text === undefined ? {} : { text }),
        },
      }
    }
    default:
      return fact
  }
}

const inputStarted = sessionEvent('session-tool-input-started')
const inputEnded = sessionEvent('session-tool-input-ended')
const toolRequested = sessionEvent('session-tool-requested')

export const recordSessionFacts = implementCommand(specification)
  .inputSchema(input)
  .store(recordSessionFactsStore)
  .apply(inputStarted, async (event, state) => {
    state.toolNames[callKey(event.payload)] = event.payload.name
  })
  .apply(inputEnded, async (event, state) => {
    state.toolTexts[callKey(event.payload)] = event.payload.text
  })
  .apply(toolRequested, async (event, state) => {
    state.requested[callKey(event.payload)] = true
  })
  .handle(async (command, state) => {
    // A publication can start a call's input and request the call at once.
    const calls: Calls = {
      toolNames: { ...state.toolNames },
      toolTexts: { ...state.toolTexts },
      requested: { ...state.requested },
    }
    return command.facts.map((fact) => {
      const payload = fact.payload as Payload
      const key = callKey(payload)
      if (fact.type === 'session-tool-input-started')
        calls.toolNames[key] = String(payload.name)
      if (fact.type === 'session-tool-input-ended')
        calls.toolTexts[key] = String(payload.text)
      if (fact.type === 'session-tool-called') calls.requested[key] = true
      return translate(fact, calls)
    })
  })
