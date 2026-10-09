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

export const recordSessionFacts = implementCommand(specification)
  .inputSchema(input)
  .store(recordSessionFactsStore)
  .handle(async (command) =>
    command.facts.map((fact) => ({ type: fact.type, payload: fact.payload })),
  )
