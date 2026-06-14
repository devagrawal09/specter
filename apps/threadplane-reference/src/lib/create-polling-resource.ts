import { createEffect, createResource, onCleanup } from 'solid-js'

type ResourceSource<T> = () => T | null | undefined | false

type Fetcher<TSource, TValue> = (
  source: TSource,
  info: unknown,
) => TValue | Promise<TValue>

type PollingOptions<TValue> = {
  enabled?: boolean
  intervalMs?: number
  initialValue?: TValue
}

export function createPollingResource<TSource, TValue>(
  source: ResourceSource<TSource>,
  fetcher: Fetcher<TSource, TValue>,
  options?: PollingOptions<TValue>,
) {
  const [resource, actions] = createResource(
    source,
    (value, info) => fetcher(value, info),
    { initialValue: options?.initialValue },
  )

  createEffect(() => {
    const enabled = options?.enabled ?? true
    const value = source()

    if (!enabled || value == null || value === false) return

    const intervalMs = options?.intervalMs ?? 5000
    const timer = setInterval(() => {
      if (!resource.loading) void actions.refetch()
    }, intervalMs)

    onCleanup(() => clearInterval(timer))
  })

  return [resource, actions] as const
}
