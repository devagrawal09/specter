import {
  parseSpecification,
  type CommandScenario,
  type QueryScenario,
} from '@specter-ts/spec'

export type FusedEventDraft<
  TType extends string = string,
  TPayload = unknown,
> = {
  readonly type: TType
  readonly payload: TPayload
}

export type FusedEventDefinition<
  TType extends string = string,
  TPayload = unknown,
> = {
  readonly type: TType
  readonly create: (payload: TPayload) => FusedEventDraft<TType, TPayload>
}

export type FusedEventType = {
  readonly type: string
}

export type FusedStore<TState> = {
  readonly createState: () => TState
}

export type FusedApplyRegistration<TState> = {
  readonly event: FusedEventType
  readonly handle: (event: FusedEventDraft, state: TState) => void
}

export type FusedCommandContext = {
  readonly emit: (event: FusedEventDraft) => void
}

export type FusedCommandSlice<
  TName extends string = string,
  TInput = unknown,
  TState = unknown,
> = {
  readonly kind: 'command'
  readonly name: TName
  readonly description: string
  readonly scenarios: readonly CommandScenario[]
  readonly store: FusedStore<TState>
  readonly apply: readonly FusedApplyRegistration<TState>[]
  readonly handle: (
    input: TInput,
    state: TState,
    context: FusedCommandContext,
  ) => void
}

export type FusedQuerySlice<
  TName extends string = string,
  TInput = unknown,
  TOutput = unknown,
  TState = unknown,
> = {
  readonly kind: 'query'
  readonly name: TName
  readonly description: string
  readonly scenarios: readonly QueryScenario[]
  readonly store: FusedStore<TState>
  readonly apply: readonly FusedApplyRegistration<TState>[]
  readonly handle: (input: TInput, state: TState) => TOutput
}

// A fused registry is an intentional existential boundary across Slice types.
// biome-ignore lint/suspicious/noExplicitAny: preserves each Slice's own input, output, and state types.
type Erased = any

export type FusedSlice =
  | FusedCommandSlice<string, Erased, Erased>
  | FusedQuerySlice<string, Erased, Erased, Erased>

type CommandApplyStep<TName extends string, TInput, TState> = {
  apply<TType extends string, TPayload>(
    event: FusedEventDefinition<TType, TPayload>,
    handle: (event: FusedEventDraft<TType, TPayload>, state: TState) => void,
  ): CommandApplyStep<TName, TInput, TState>
  handle(
    handle: (
      input: TInput,
      state: TState,
      context: FusedCommandContext,
    ) => void,
  ): FusedCommandSlice<TName, TInput, TState>
}

type QueryApplyStep<TName extends string, TInput, TOutput, TState> = {
  apply<TType extends string, TPayload>(
    event: FusedEventDefinition<TType, TPayload>,
    handle: (event: FusedEventDraft<TType, TPayload>, state: TState) => void,
  ): QueryApplyStep<TName, TInput, TOutput, TState>
  handle(
    handle: (input: TInput, state: TState) => TOutput,
  ): FusedQuerySlice<TName, TInput, TOutput, TState>
}

export function implementFusedCommand(input: unknown) {
  const specification = parseSpecification(input)
  if (specification.kind !== 'command') {
    throw new Error(
      `implementFusedCommand expected a command specification, received ${specification.kind}.`,
    )
  }

  return {
    inputSchema<TInput>() {
      return {
        store<TState>(store: FusedStore<TState>) {
          return commandApplyStep(
            specification.name,
            specification.description,
            specification.scenarios,
            store,
            [],
          ) as CommandApplyStep<string, TInput, TState>
        },
      }
    },
  }
}

function commandApplyStep<TName extends string, TInput, TState>(
  name: TName,
  description: string,
  scenarios: readonly CommandScenario[],
  store: FusedStore<TState>,
  apply: readonly FusedApplyRegistration<TState>[],
): CommandApplyStep<TName, TInput, TState> {
  return {
    apply(event, handle) {
      return commandApplyStep(name, description, scenarios, store, [
        ...apply,
        {
          event,
          handle: handle as FusedApplyRegistration<TState>['handle'],
        },
      ])
    },
    handle(handler) {
      return {
        kind: 'command',
        name,
        description,
        scenarios,
        store,
        apply,
        handle: handler,
      }
    },
  }
}

export function implementFusedQuery(input: unknown) {
  const specification = parseSpecification(input)
  if (specification.kind !== 'query') {
    throw new Error(
      `implementFusedQuery expected a query specification, received ${specification.kind}.`,
    )
  }

  return {
    inputSchema<TInput>() {
      return {
        outputSchema<TOutput>() {
          return {
            store<TState>(store: FusedStore<TState>) {
              return queryApplyStep(
                specification.name,
                specification.description,
                specification.scenarios,
                store,
                [],
              ) as QueryApplyStep<string, TInput, TOutput, TState>
            },
          }
        },
      }
    },
  }
}

function queryApplyStep<TName extends string, TInput, TOutput, TState>(
  name: TName,
  description: string,
  scenarios: readonly QueryScenario[],
  store: FusedStore<TState>,
  apply: readonly FusedApplyRegistration<TState>[],
): QueryApplyStep<TName, TInput, TOutput, TState> {
  return {
    apply(event, handle) {
      return queryApplyStep(name, description, scenarios, store, [
        ...apply,
        {
          event,
          handle: handle as FusedApplyRegistration<TState>['handle'],
        },
      ])
    },
    handle(handler) {
      return {
        kind: 'query',
        name,
        description,
        scenarios,
        store,
        apply,
        handle: handler,
      }
    },
  }
}
