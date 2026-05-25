import type {
  ViewCommandRef,
  ViewComponent,
  ViewProjectionRef,
  ViewProps,
  ViewRegistration,
  ViewScenario,
} from './slice'

type ViewQueriesStep<TName extends string> = {
  queries: <TQueries extends Record<string, ViewProjectionRef>>(
    queries: TQueries,
  ) => ViewTriggersStep<TName, TQueries>
}

type ViewTriggersStep<
  TName extends string,
  TQueries extends Record<string, ViewProjectionRef>,
> = {
  triggers: <TTriggers extends Record<string, ViewCommandRef>>(
    triggers: TTriggers,
  ) => ViewScenariosStep<TName, TQueries, TTriggers>
}

type ViewScenariosStep<
  TName extends string,
  TQueries extends Record<string, ViewProjectionRef>,
  TTriggers extends Record<string, ViewCommandRef>,
> = {
  scenarios: (
    scenarios: readonly ViewScenario<{
      [TKey in keyof TQueries]: TQueries[TKey] extends ViewProjectionRef<
        infer TResult
      >
        ? TResult
        : never
    }>[],
  ) => ViewComponentStep<TName, TQueries, TTriggers>
}

type ViewComponentStep<
  TName extends string,
  TQueries extends Record<string, ViewProjectionRef>,
  TTriggers extends Record<string, ViewCommandRef>,
> = {
  component: (
    component: ViewComponent<ViewProps<TQueries, TTriggers>>,
  ) => ViewRegistration<TName, TQueries, TTriggers>
}

export function createView<const TName extends string>(
  name: TName,
): ViewQueriesStep<TName> {
  return {
    queries: (queries) => ({
      triggers: (triggers) => ({
        scenarios: (scenarios) => ({
          component: (component) => ({
            kind: 'view' as const,
            name,
            queries,
            triggers,
            scenarios,
            component,
          }),
        }),
      }),
    }),
  }
}
