import type { ReactionDeliveryContext } from '../adapters'
import type {
  CommandDispatchOptions,
  CommandEnvelope,
  ReactionPlugin,
} from '../definition'
import { Effect } from 'effect'

export type RunEffect<R> = <A, E>(effect: Effect.Effect<A, E, R>) => Promise<A>

export type EffectCommandDispatch = (
  command: CommandEnvelope,
  options?: CommandDispatchOptions,
) => Effect.Effect<void, unknown>

/**
 * Creates one shared Promise boundary for Effect-based Slice handlers and
 * Reaction Plugins. Build it once from `ManagedRuntime.runPromise`; individual
 * Slices retain normal Effect service requirements and never call
 * `Effect.runPromise` themselves.
 */
export function createSpecterEffectAdapters<R>(run: RunEffect<R>) {
  return {
    adapt:
      <TArgs extends readonly unknown[], A, E>(
        handler: (...args: TArgs) => Effect.Effect<A, E, R>,
      ) =>
      (...args: TArgs) =>
        run(handler(...args)),

    reactionPlugin:
      <TOutput, E>(
        plugin: (
          dispatch: EffectCommandDispatch,
        ) => Effect.Effect<
          (
            output: TOutput,
            context: ReactionDeliveryContext,
          ) => Effect.Effect<unknown, unknown, R>,
          E,
          R
        >,
      ): ReactionPlugin<TOutput> =>
      async (dispatch) => {
        const execute = await run(
          plugin((command, options) =>
            Effect.tryPromise(() => dispatch(command, options)),
          ),
        )
        return (output, context) => run(execute(output, context))
      },
  }
}
