import {
  createEffect,
  createResource,
  onCleanup,
  startTransition,
} from 'solid-js'

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

  const refetch = ((info?: unknown) => {
    let result: ReturnType<typeof actions.refetch> | undefined

    const transition = startTransition(() => {
      result = actions.refetch(info as never)
    })

    return (
      result ??
      (transition.then(() => result) as ReturnType<typeof actions.refetch>)
    )
  }) as typeof actions.refetch

  createEffect(() => {
    const enabled = options?.enabled ?? true
    const value = source()

    if (!enabled || value == null || value === false) return

    const intervalMs = options?.intervalMs ?? 5000
    const timer = setInterval(() => {
      if (!resource.loading) void refetch()
    }, intervalMs)

    onCleanup(() => clearInterval(timer))
  })

  return [resource, { ...actions, refetch }] as const
}
