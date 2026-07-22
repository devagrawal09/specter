import { Context, type Effect } from 'effect'

import type {
  EventLogService,
  EventLogFailure,
  ReactionSchedulerService,
  ReactionSchedulerFailure,
  SliceStoreService,
} from '../adapters'
import {
  type AdapterConformanceFailure,
  eventLogConformance,
  reactionSchedulerConformance,
  sliceStoreConformance,
} from './adapter-conformance'

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false
type Expect<TValue extends true> = TValue

class ConformanceDependency extends Context.Service<
  ConformanceDependency,
  true
>()('specter-type-test/ConformanceDependency') {}

class CreateFailure {
  readonly _tag = 'CreateFailure'
}

class StoreFailure {
  readonly _tag = 'StoreFailure'
}

declare const eventLog: Effect.Effect<
  EventLogService,
  CreateFailure,
  ConformanceDependency
>
const eventLogProgram = eventLogConformance(eventLog)

export type EventLogConformanceErrors = Expect<
  Equal<
    Effect.Error<typeof eventLogProgram>,
    AdapterConformanceFailure | CreateFailure | EventLogFailure
  >
>
export type EventLogConformanceRequirements = Expect<
  Equal<Effect.Services<typeof eventLogProgram>, ConformanceDependency>
>

declare const store: Effect.Effect<
  SliceStoreService<
    Readonly<{ value: number }>,
    { value: number },
    StoreFailure
  >,
  CreateFailure,
  ConformanceDependency
>
const storeProgram = sliceStoreConformance({
  createService: store,
  write: async (state, value: number) => {
    state.value = value
  },
  read: async (state) => state.value,
  value: 1,
})

export type SliceStoreConformanceErrors = Expect<
  Equal<
    Effect.Error<typeof storeProgram>,
    AdapterConformanceFailure | CreateFailure | StoreFailure
  >
>
export type SliceStoreConformanceRequirements = Expect<
  Equal<Effect.Services<typeof storeProgram>, ConformanceDependency>
>

declare const scheduler: Effect.Effect<
  ReactionSchedulerService,
  CreateFailure,
  ConformanceDependency
>
const schedulerProgram = reactionSchedulerConformance(scheduler)

export type ReactionSchedulerConformanceErrors = Expect<
  Equal<
    Effect.Error<typeof schedulerProgram>,
    AdapterConformanceFailure | CreateFailure | ReactionSchedulerFailure
  >
>
export type ReactionSchedulerConformanceRequirements = Expect<
  Equal<Effect.Services<typeof schedulerProgram>, ConformanceDependency>
>
