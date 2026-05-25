import type {
  ViewCommandRef,
  ViewComponent,
  ViewQueryRef,
  ViewProps,
  ViewRegistration,
  ViewScenario,
} from './slice'
import { createRuntimeView } from './view-runtime'

type ViewQueriesStep<TName extends string> = {
  queries: <TQueries extends Record<string, ViewQueryRef>>(
    queries: TQueries,
  ) => ViewTriggersStep<TName, TQueries>
}

type ViewTriggersStep<
  TName extends string,
  TQueries extends Record<string, ViewQueryRef>,
> = {
  triggers: <TTriggers extends Record<string, ViewCommandRef>>(
    triggers: TTriggers,
  ) => ViewScenariosStep<TName, TQueries, TTriggers>
}

type ViewScenariosStep<
  TName extends string,
  TQueries extends Record<string, ViewQueryRef>,
  TTriggers extends Record<string, ViewCommandRef>,
> = {
  scenarios: (
    scenarios: readonly ViewScenario<{
      [TKey in keyof TQueries]: TQueries[TKey] extends ViewQueryRef<
        infer TResult
      >
        ? TResult
        : never
    }>[],
  ) => ViewComponentStep<TName, TQueries, TTriggers>
}

type ViewComponentStep<
  TName extends string,
  TQueries extends Record<string, ViewQueryRef>,
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
          component: (component) => {
            const registration = {
              kind: 'view' as const,
              name,
              queries,
              triggers,
              scenarios,
              component,
            }

            return Object.assign(createRuntimeView(registration), registration)
          },
        }),
      }),
    }),
  }
}
