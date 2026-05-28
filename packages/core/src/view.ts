import type {
  ViewCommandRef,
  ViewComponent,
  ViewQueryRef,
  ViewProps,
  ViewRegistration,
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
        component: (component) => {
          const registration = {
            kind: 'view' as const,
            queries,
            triggers,
            component,
          }
          const runtimeView = createRuntimeView({ name, ...registration })

          Object.defineProperty(runtimeView, 'name', {
            value: name,
            configurable: true,
          })

          return Object.assign(runtimeView, registration) as ViewRegistration<
            TName,
            typeof queries,
            typeof triggers
          >
        },
      }),
    }),
  }
}
