export type PersistedEvent = {
  readonly id: string
  readonly order: number
  readonly recordedAt: string
  readonly type: string
  readonly payload: unknown
}

export type EventLogAdapter = {
  readonly query: (
    afterOrder: number,
    eventTypes: readonly string[],
  ) => Promise<PersistedEvent[]>
}

export type SliceStoreAdapter<TWriteState, TReadState> = {
  readonly __writeState?: TWriteState
  readonly __readState?: TReadState
}

export type ReactionDeliveryContext = {
  readonly deliveryId: string
  readonly scheduledAt: string
  readonly attemptId: string
  readonly attemptNumber: number
}

export type ReactionScheduler = (
  run: (context: ReactionDeliveryContext) => Promise<void>,
) => () => () => Promise<void>

export type SpecterAppConfig = {
  readonly eventLog: EventLogAdapter
}

export type SpecterApp<TConfig> = {
  readonly __config?: TConfig
}

export type EventDefinition<TType extends string, TPayload> = {
  readonly __type?: TType
  readonly __payload?: TPayload
}

export type CommandSlice<
  TName,
  TInput,
  TOutput,
  TWriteState,
  TReadState,
  TScenarios,
> = {
  readonly __command?: [
    TName,
    TInput,
    TOutput,
    TWriteState,
    TReadState,
    TScenarios,
  ]
}

export type ReactionSlice<
  TName,
  TInput,
  TOutput,
  TWriteState,
  TReadState,
  TScenarios,
> = {
  readonly __reaction?: [
    TName,
    TInput,
    TOutput,
    TWriteState,
    TReadState,
    TScenarios,
  ]
}

export declare function createSpecterApp<TConfig extends SpecterAppConfig>(
  config: TConfig,
): Promise<SpecterApp<TConfig>>
