import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import specification from './spec.json' with { type: 'json' }

// Recording holds no state yet: the host's projections enforce the invariants.
export type RecordSessionFactsState = Record<string, never>

export const recordSessionFactsStore = Context.Service<
  SliceStoreService<RecordSessionFactsState, RecordSessionFactsState, unknown>
>('@specter/agent-runtime/RecordSessionFactsStore')

export const createRecordSessionFactsState = (): RecordSessionFactsState => ({})

// Each payload is decoded by its event's definition (OC++'s schema) when the
// runtime stores it, so the input only names the fact.
const input = Schema.toStandardSchemaV1(
  Schema.Struct({
    facts: Schema.NonEmptyArray(
      Schema.Struct({ type: Schema.String, payload: Schema.Unknown }),
    ),
  }),
)

// OC++'s three execution terminals are one fact in the runtime's catalog: a
// host that ran an execution itself (an external agent's) records it as the
// runtime does, so every Slice sees the execution end.
const terminals: Record<string, 'succeeded' | 'failed' | 'interrupted'> = {
  'session-execution-succeeded': 'succeeded',
  'session-execution-failed': 'failed',
  'session-execution-interrupted': 'interrupted',
}

export const recordSessionFacts = implementCommand(specification)
  .inputSchema(input)
  .store(recordSessionFactsStore)
  .handle(async (command) =>
    command.facts.map((fact) => {
      const outcome = terminals[fact.type]
      return outcome === undefined
        ? { type: fact.type, payload: fact.payload }
        : {
            type: 'session-execution-settled',
            payload: { ...(fact.payload as object), outcome },
          }
    }),
  )
