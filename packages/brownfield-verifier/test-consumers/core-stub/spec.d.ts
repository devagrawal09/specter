export type ScenarioEvent<TType extends string, TPayload> = {
  readonly type: TType
  readonly payload: TPayload
}
