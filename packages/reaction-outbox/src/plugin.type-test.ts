import type {
  CommandReceipt,
  ReactionPluginRequirements,
  SpecterEffectError,
} from '@specter-ts/core'
import { Context, Effect } from 'effect'

import { createMemoryReactionOutboxStore } from './memory-store'
import { type OutboxedReaction, withReactionOutbox } from './plugin'

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false
type Expect<TValue extends true> = TValue

class Mailer extends Context.Service<
  Mailer,
  { send(message: string): Effect.Effect<void> }
>()('reaction-outbox-type-test/Mailer') {}

const outboxed = withReactionOutbox(
  ({ command }) =>
    Effect.gen(function* () {
      const mailer = yield* Mailer
      return (message: string) =>
        Effect.gen(function* () {
          const receipt = command({ type: 'recordMail', payload: message })
          type _Receipt = Expect<
            Equal<
              typeof receipt,
              Effect.Effect<CommandReceipt, SpecterEffectError>
            >
          >
          const receiptType: _Receipt = true
          void receiptType
          yield* mailer.send(message)
        })
    }),
  { store: createMemoryReactionOutboxStore<OutboxedReaction<string>>() },
)

export type OutboxInferredRequirement = Expect<
  Equal<
    ReactionPluginRequirements<{
      readonly kind: 'reaction'
      readonly plugin?: typeof outboxed
    }>,
    Mailer
  >
>
