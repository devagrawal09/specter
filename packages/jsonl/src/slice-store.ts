import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'

import type {
  SliceStoreService,
  SliceStoreSlice,
  SliceStoreTag,
} from '@specter-ts/core'
import { Effect, Layer, Semaphore } from 'effect'

export class JsonlSliceStoreFailure extends Error {
  readonly _tag = 'JsonlSliceStoreFailure' as const

  constructor(
    readonly operation: 'read' | 'write' | 'publish-cursor',
    readonly sliceName: string,
    readonly cause: unknown,
  ) {
    super(`JSON Slice Store ${operation} failed for "${sliceName}".`, {
      cause,
    })
    this.name = 'JsonlSliceStoreFailure'
  }
}

export type JsonlSliceStoreOptions<TWriteState, TReadState> = {
  /** One `<sliceName>.json` file per Slice is kept in this directory. */
  readonly directory: string
  /** `fsync` the file and directory on every commit. Off by default. */
  readonly fsync?: boolean
  readonly read?: (state: TWriteState) => TReadState
}

export type JsonlSliceStoreService<TWriteState, TReadState> = SliceStoreService<
  TReadState,
  TWriteState,
  JsonlSliceStoreFailure
> & {
  readonly directory: string
  /** File that holds `{ cursor, version, state }` for one Slice. */
  readonly pathFor: (sliceName: string) => string
}

type SliceEntry<TState> = {
  readonly cursor: number
  /** The version of the Slice the State was folded for. */
  readonly version: string | undefined
  /** State as written to the file; transactions start from a fresh decode. */
  readonly json: string
  decoded?: TState
}

const sliceNamePattern = /^[A-Za-z0-9_-]+$/

/**
 * Creates one Slice Store service that keeps each Slice's state and cursor in
 * its own JSON file, with the version of the Slice that folded it. The first
 * access to a Slice reads its file once; later reads are served from memory.
 * A file of another version is not read: the Slice starts empty and folds
 * the log, and its first commit replaces the file. A transaction that
 * publishes a cursor writes the whole `{ cursor, version, state }` document
 * to a temporary file and renames it over the Slice file before the new
 * state becomes visible, so a crash leaves either the previous or the new
 * document. The process that uses the directory must be its only writer.
 */
export function createJsonlSliceStoreService<
  TWriteState,
  TReadState = Readonly<TWriteState>,
>(
  createState: () => TWriteState,
  options: JsonlSliceStoreOptions<TWriteState, TReadState>,
): JsonlSliceStoreService<TWriteState, TReadState> {
  const { directory } = options
  const read =
    options.read ?? ((state: TWriteState) => state as unknown as TReadState)
  const entries = new Map<string, SliceEntry<TWriteState>>()
  const semaphores = new Map<string, Semaphore.Semaphore>()
  let directoryReady = false

  function pathFor(sliceName: string) {
    if (!sliceNamePattern.test(sliceName)) {
      throw new Error(
        `Slice name "${sliceName}" cannot be used as a JSON Slice Store file name`,
      )
    }
    return join(directory, `${sliceName}.json`)
  }

  function load(slice: SliceStoreSlice): SliceEntry<TWriteState> {
    const existing = entries.get(slice.name)
    if (existing?.version === slice.version) return existing
    const path = pathFor(slice.name)
    const empty = {
      cursor: 0,
      version: slice.version,
      json: encodeState(createState()),
    }
    let entry: SliceEntry<TWriteState>
    try {
      const stored = decodeFile<TWriteState>(readFileSync(path, 'utf8'), path)
      entry = stored.version === slice.version ? stored : empty
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
      entry = empty
    }
    entries.set(slice.name, entry)
    return entry
  }

  function loadEffect(slice: SliceStoreSlice) {
    return Effect.try({
      try: () => load(slice),
      catch: (cause) => new JsonlSliceStoreFailure('read', slice.name, cause),
    })
  }

  function decoded(entry: SliceEntry<TWriteState>) {
    entry.decoded ??= JSON.parse(entry.json) as TWriteState
    return entry.decoded
  }

  function save(
    slice: SliceStoreSlice,
    cursor: number,
    state: TWriteState,
  ): SliceEntry<TWriteState> {
    const json = encodeState(state)
    const path = pathFor(slice.name)
    const temporary = `${path}.tmp`
    if (!directoryReady) {
      mkdirSync(directory, { recursive: true })
      directoryReady = true
    }
    const fd = openSync(temporary, 'w')
    try {
      writeAll(
        fd,
        Buffer.from(
          `{"cursor":${cursor},"version":${JSON.stringify(slice.version)},"state":${json}}\n`,
        ),
      )
      if (options.fsync) fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temporary, path)
    if (options.fsync) fsyncDirectory(directory)
    return { cursor, version: slice.version, json }
  }

  function semaphore(sliceName: string) {
    const existing = semaphores.get(sliceName)
    if (existing) return existing
    const created = Semaphore.makeUnsafe(1)
    semaphores.set(sliceName, created)
    return created
  }

  return {
    directory,
    pathFor,
    read: (slice, run) =>
      Effect.flatMap(loadEffect(slice), (entry) =>
        run(read(decoded(entry)), entry.cursor),
      ),
    transaction: (slice, run) =>
      Effect.suspend(() =>
        semaphore(slice.name).withPermit(
          Effect.gen(function* () {
            const current = yield* loadEffect(slice)
            const state = JSON.parse(current.json) as TWriteState
            let cursor = current.cursor
            let published = false
            const result = yield* run(
              state,
              () => read(state),
              current.cursor,
              (order) => {
                if (!Number.isSafeInteger(order) || order < cursor) {
                  return Effect.fail(
                    new JsonlSliceStoreFailure(
                      'publish-cursor',
                      slice.name,
                      `Cursor must advance from ${cursor}; received ${order}`,
                    ),
                  )
                }
                cursor = order
                published = true
                return Effect.void
              },
            )
            if (published) {
              const saved = yield* Effect.try({
                try: () => save(slice, cursor, state),
                catch: (cause) =>
                  new JsonlSliceStoreFailure('write', slice.name, cause),
              })
              entries.set(slice.name, saved)
            }
            return result
          }),
        ),
      ),
  }
}

/** Provides a Store Tag backed by one JSON file per Slice in `directory`. */
export function createJsonlSliceStoreLayer<
  TIdentifier,
  TWriteState,
  TReadState,
>(
  tag: SliceStoreTag<
    TIdentifier,
    SliceStoreService<TReadState, TWriteState, unknown>
  >,
  createState: () => TWriteState,
  options: JsonlSliceStoreOptions<TWriteState, TReadState>,
): Layer.Layer<TIdentifier> {
  return Layer.sync(tag as never, () =>
    createJsonlSliceStoreService(createState, options),
  ) as Layer.Layer<TIdentifier>
}

function encodeState(state: unknown) {
  const json = JSON.stringify(state, rejectMapsAndSets)
  if (json === undefined) {
    throw new Error('JSON Slice State must be JSON-serializable')
  }
  return json
}

/** JSON.stringify would silently write a Map or Set as `{}`. */
function rejectMapsAndSets(key: string, value: unknown) {
  if (value instanceof Map || value instanceof Set) {
    throw new Error(
      `JSON Slice State cannot contain a ${value instanceof Map ? 'Map' : 'Set'} (at key "${key}"); use plain objects or arrays`,
    )
  }
  return value
}

function decodeFile<TState>(content: string, path: string): SliceEntry<TState> {
  const document = JSON.parse(content) as {
    cursor?: unknown
    version?: unknown
    state?: unknown
  }
  if (
    typeof document !== 'object' ||
    document === null ||
    !Number.isSafeInteger(document.cursor) ||
    (document.cursor as number) < 0 ||
    (document.version !== undefined && typeof document.version !== 'string') ||
    !('state' in document)
  ) {
    throw new Error(`JSON Slice Store file ${path} is malformed`)
  }
  return {
    cursor: document.cursor as number,
    version: document.version,
    json: JSON.stringify(document.state),
    decoded: document.state as TState,
  }
}

function fsyncDirectory(directory: string) {
  const fd = openSync(directory, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function writeAll(fd: number, buffer: Buffer) {
  let offset = 0
  while (offset < buffer.length) {
    offset += writeSync(fd, buffer, offset)
  }
}
