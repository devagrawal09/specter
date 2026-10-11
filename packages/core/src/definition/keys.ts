import type { ConsistencyKeys, SliceRegistration } from './slices'

/** A keyed Slice that applies an Event type, with the key names it uses. */
export type KeyedConsumer = {
  readonly sliceName: string
  readonly names: readonly string[]
}

/**
 * The key names a keyed Slice uses: a Command's consistency key names, or a
 * keyed Reaction's key; undefined for any other Slice.
 */
export function sliceKeyNames(
  slice: SliceRegistration,
): readonly string[] | undefined {
  if (slice.kind === 'command' && slice.consistencyKeys) {
    return Object.keys(slice.consistencyKeys)
  }
  if (slice.kind === 'reaction' && typeof slice.key === 'string') {
    return [slice.key]
  }
  return undefined
}

/**
 * Every keyed Slice applying each Event type. An Event of that type must
 * carry one of each such Slice's key names: a keyed Command could not see
 * it conflict, and a keyed Reaction could not tell which value to handle.
 */
export function keyedConsumers(
  slices: Readonly<Record<string, SliceRegistration>>,
): ReadonlyMap<string, readonly KeyedConsumer[]> {
  const consumers = new Map<string, KeyedConsumer[]>()
  for (const slice of Object.values(slices)) {
    if (slice?.stage !== 'implementation' || !Array.isArray(slice.apply)) {
      continue
    }
    const names = sliceKeyNames(slice)
    if (!names || names.length === 0) continue
    for (const registration of slice.apply) {
      const type = registration.event.type
      consumers.set(type, [
        ...(consumers.get(type) ?? []),
        { sliceName: slice.name, names },
      ])
    }
  }
  return consumers
}

/** Whether an Event's keys carry a value under one of `names`. */
export function carriesOneOf(
  keys: Readonly<Record<string, string>>,
  names: readonly string[],
) {
  return names.some((name) => Object.hasOwn(keys, name))
}

/**
 * The values of a Command's consistency keys for one decision, by name.
 * Throws when a key function returns anything but a string, an array of
 * strings, or undefined.
 */
export function consistencyKeyValues(
  keys: ConsistencyKeys,
  command: unknown,
  state: unknown,
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    Object.entries(keys).map(([name, derive]) => {
      const values: unknown = derive(command, state)
      if (values === undefined) return [name, []]
      if (typeof values === 'string') return [name, [values]]
      if (
        Array.isArray(values) &&
        values.every((value) => typeof value === 'string')
      ) {
        return [name, [...new Set<string>(values)]]
      }
      throw new TypeError(
        `Consistency key "${name}" must be a string, an array of strings, or undefined.`,
      )
    }),
  )
}

/**
 * Whether an Event carrying `carried` is one a decision with consistency
 * keys `keys` read: it carries one of their values under that name.
 */
export function carriesConsistencyKey(
  carried: Readonly<Record<string, string>>,
  keys: Readonly<Record<string, readonly string[]>>,
) {
  return Object.entries(keys).some(
    ([name, values]) =>
      Object.hasOwn(carried, name) && values.includes(carried[name] as string),
  )
}
