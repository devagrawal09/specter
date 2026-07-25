import type { FusedEventDefinition } from '../../runtime/fused-slices'
import type { ReactiveValue } from './model'

type NodeEvent = {
  readonly graphId: string
  readonly batchId: string
  readonly nodeId: string
}

type CallbackNodeEvent = NodeEvent & {
  readonly callbackId: string
}

function defineEvent<const TType extends string, TPayload>(
  type: TType,
): FusedEventDefinition<TType, TPayload> {
  return {
    type,
    create: (payload) => ({ type, payload }),
  }
}

export const reactiveSignalCreatedEvent = defineEvent<
  'reactive-signal-created',
  NodeEvent & { readonly value: ReactiveValue }
>('reactive-signal-created')

export const reactiveComputationCreatedEvent = defineEvent<
  'reactive-computation-created',
  CallbackNodeEvent
>('reactive-computation-created')

export const reactiveEffectCreatedEvent = defineEvent<
  'reactive-effect-created',
  CallbackNodeEvent
>('reactive-effect-created')

export const reactiveSignalWrittenEvent = defineEvent<
  'reactive-signal-written',
  NodeEvent & {
    readonly previousValue: ReactiveValue
    readonly value: ReactiveValue
    readonly changed: boolean
  }
>('reactive-signal-written')

export const reactiveComputationEvaluatedEvent = defineEvent<
  'reactive-computation-evaluated',
  NodeEvent & {
    readonly value: ReactiveValue
    readonly dependencyNodeIds: readonly string[]
    readonly changed: boolean
  }
>('reactive-computation-evaluated')

export const reactiveEffectExecutedEvent = defineEvent<
  'reactive-effect-executed',
  NodeEvent & {
    readonly dependencyNodeIds: readonly string[]
  }
>('reactive-effect-executed')

export const reactiveBatchSettledEvent = defineEvent<
  'reactive-batch-settled',
  {
    readonly graphId: string
    readonly batchId: string
    readonly evaluatedComputationCount: number
    readonly executedEffectCount: number
  }
>('reactive-batch-settled')

export const reactiveGraphDisposedEvent = defineEvent<
  'reactive-graph-disposed',
  { readonly graphId: string }
>('reactive-graph-disposed')

export const reactiveEventDefinitions = [
  reactiveSignalCreatedEvent,
  reactiveComputationCreatedEvent,
  reactiveEffectCreatedEvent,
  reactiveSignalWrittenEvent,
  reactiveComputationEvaluatedEvent,
  reactiveEffectExecutedEvent,
  reactiveBatchSettledEvent,
  reactiveGraphDisposedEvent,
] as const

export type ReactiveEvent = ReturnType<
  (typeof reactiveEventDefinitions)[number]['create']
>
