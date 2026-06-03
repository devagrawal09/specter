export type MaybePromise<T> = T | Promise<T>

export function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
  if (value === null || value === undefined) return false
  if (typeof value !== 'object' && typeof value !== 'function') return false

  return typeof (value as { then?: unknown }).then === 'function'
}

export function flatMapMaybePromise<T, TResult>(
  value: MaybePromise<T>,
  map: (value: T) => MaybePromise<TResult>,
): MaybePromise<TResult> {
  return isPromiseLike(value) ? value.then(map) : map(value)
}

export function mapMaybePromise<T, TResult>(
  value: MaybePromise<T>,
  map: (value: T) => TResult,
): MaybePromise<TResult> {
  return isPromiseLike(value) ? value.then(map) : map(value)
}

export function allMaybePromises<T>(
  values: readonly MaybePromise<T>[],
): MaybePromise<T[]> {
  const results: T[] = []

  for (const value of values) {
    if (isPromiseLike(value)) return Promise.all(values) as Promise<T[]>
    results.push(value)
  }

  return results
}

export function forEachMaybePromise<T>(
  values: readonly T[],
  run: (value: T) => MaybePromise<void>,
): MaybePromise<void> {
  let previous: MaybePromise<void> = undefined

  for (const value of values) {
    previous = flatMapMaybePromise(previous, () => run(value))
  }

  return previous
}
