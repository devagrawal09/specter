import {
  digestSpecification,
  parseSpecification,
  serializeSpecification,
  type SliceSpecification,
  type SpecificationDigest,
} from '@specter-ts/spec'
import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  link,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path'

export type SpecificationFile = {
  readonly path: string
  readonly revision: string
  readonly digest: SpecificationDigest
  readonly readOnly: boolean
  readonly document: SliceSpecification
}

export class SpecEditorRepositoryError extends Error {
  constructor(
    readonly code:
      | 'INVALID_PATH'
      | 'NOT_FOUND'
      | 'ALREADY_EXISTS'
      | 'READ_ONLY'
      | 'REVISION_CONFLICT'
      | 'INVALID_SPECIFICATION',
    message: string,
  ) {
    super(message)
  }
}

export type SpecificationRepository = {
  readonly projectRoot: string
  readonly featuresRoot: string
  list(): Promise<readonly SpecificationFile[]>
  create(path: string, document: unknown): Promise<SpecificationFile>
  save(
    path: string,
    expectedRevision: string,
    document: unknown,
  ): Promise<SpecificationFile>
  remove(path: string, expectedRevision: string): Promise<void>
}

export async function createSpecificationRepository(
  projectRootInput: string,
): Promise<SpecificationRepository> {
  const projectRoot = await realpath(resolve(projectRootInput)).catch(() => {
    throw new SpecEditorRepositoryError(
      'INVALID_PATH',
      `Project root does not exist: ${resolve(projectRootInput)}`,
    )
  })
  const featuresInput = resolve(projectRoot, 'src/features')
  const featuresRoot = await realpath(featuresInput).catch(() => {
    throw new SpecEditorRepositoryError(
      'INVALID_PATH',
      `Project has no src/features directory: ${projectRoot}`,
    )
  })
  assertInside(projectRoot, featuresRoot)
  const mutationQueues = new Map<string, Promise<void>>()

  async function serializeMutation<T>(
    normalized: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = mutationQueues.get(normalized) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((accept) => {
      release = accept
    })
    const queued = previous.then(() => current)
    mutationQueues.set(normalized, queued)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (mutationQueues.get(normalized) === queued)
        mutationQueues.delete(normalized)
    }
  }

  async function resolveSpecPath(input: string, allowMissing: boolean) {
    const normalized = normalizeSpecPath(input)
    const target = resolve(featuresRoot, ...normalized.split('/'))
    assertInside(featuresRoot, target)
    await assertNoSymlinkTraversal(featuresRoot, normalized, allowMissing)
    return { normalized, target }
  }

  async function readSpecification(
    normalized: string,
    target: string,
  ): Promise<SpecificationFile> {
    let source: string
    try {
      source = await readFile(target, 'utf8')
    } catch (cause) {
      if (isMissing(cause))
        throw new SpecEditorRepositoryError(
          'NOT_FOUND',
          `Specification does not exist: ${normalized}`,
        )
      throw cause
    }
    let document: SliceSpecification
    try {
      document = parseSpecification(JSON.parse(source))
    } catch (cause) {
      throw new SpecEditorRepositoryError(
        'INVALID_SPECIFICATION',
        `${normalized}: ${errorMessage(cause)}`,
      )
    }
    const adjacentSource = resolve(dirname(target), 'spec.ts')
    return {
      path: normalized,
      revision: revision(source),
      digest: digestSpecification(document),
      readOnly: await exists(adjacentSource),
      document,
    }
  }

  async function list() {
    const paths: string[] = []
    await walk(featuresRoot, featuresRoot, paths)
    const files = await Promise.all(
      paths.sort().map(async (path) => {
        const { normalized, target } = await resolveSpecPath(path, false)
        return readSpecification(normalized, target)
      }),
    )
    return files
  }

  async function create(path: string, input: unknown) {
    const normalized = normalizeSpecPath(path)
    return await serializeMutation(normalized, async () => {
      const { target } = await resolveSpecPath(normalized, true)
      if (await exists(target))
        throw new SpecEditorRepositoryError(
          'ALREADY_EXISTS',
          `Specification already exists: ${normalized}`,
        )
      const document = validate(input)
      await mkdir(dirname(target), { recursive: true })
      assertInside(featuresRoot, await realpath(dirname(target)))
      await atomicCreate(target, serializeSpecification(document), normalized)
      return readSpecification(normalized, target)
    })
  }

  async function save(path: string, expectedRevision: string, input: unknown) {
    const normalized = normalizeSpecPath(path)
    return await serializeMutation(normalized, async () => {
      const { target } = await resolveSpecPath(normalized, false)
      const current = await readSpecification(normalized, target)
      if (current.readOnly)
        throw new SpecEditorRepositoryError(
          'READ_ONLY',
          `${normalized} is generated from adjacent spec.ts.`,
        )
      if (current.revision !== expectedRevision)
        throw new SpecEditorRepositoryError(
          'REVISION_CONFLICT',
          `${normalized} changed on disk. Reload before saving.`,
        )
      const document = validate(input)
      await atomicWrite(target, serializeSpecification(document))
      return readSpecification(normalized, target)
    })
  }

  async function remove(path: string, expectedRevision: string) {
    const normalized = normalizeSpecPath(path)
    return await serializeMutation(normalized, async () => {
      const { target } = await resolveSpecPath(normalized, false)
      const current = await readSpecification(normalized, target)
      if (current.readOnly)
        throw new SpecEditorRepositoryError(
          'READ_ONLY',
          `${normalized} is generated from adjacent spec.ts.`,
        )
      if (current.revision !== expectedRevision)
        throw new SpecEditorRepositoryError(
          'REVISION_CONFLICT',
          `${normalized} changed on disk. Reload before removing.`,
        )
      await unlink(target)
      let directory = dirname(target)
      while (directory !== featuresRoot) {
        try {
          await rmdir(directory)
        } catch {
          break
        }
        directory = dirname(directory)
      }
    })
  }

  return { projectRoot, featuresRoot, list, create, save, remove }
}

function normalizeSpecPath(input: string) {
  if (!input || isAbsolute(input) || input.includes('\\'))
    throw new SpecEditorRepositoryError(
      'INVALID_PATH',
      'Specification path must be relative to src/features.',
    )
  const segments = input.split('/')
  if (
    segments.some(
      (segment) => !segment || segment === '.' || segment === '..',
    ) ||
    segments.at(-1) !== 'spec.json'
  )
    throw new SpecEditorRepositoryError(
      'INVALID_PATH',
      'Specification path must end in spec.json and contain no empty, dot, or parent segments.',
    )
  return segments.join('/')
}

async function assertNoSymlinkTraversal(
  root: string,
  normalized: string,
  allowMissing: boolean,
) {
  let current = root
  for (const segment of normalized.split('/')) {
    current = resolve(current, segment)
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink())
        throw new SpecEditorRepositoryError(
          'INVALID_PATH',
          `Symbolic links are not allowed in specification paths: ${normalized}`,
        )
    } catch (cause) {
      if (allowMissing && isMissing(cause)) return
      throw cause
    }
  }
}

function assertInside(root: string, target: string) {
  const path = relative(root, target)
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path))
    throw new SpecEditorRepositoryError(
      'INVALID_PATH',
      `Path escapes the allowed root: ${target}`,
    )
}

async function walk(root: string, directory: string, paths: string[]) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = resolve(directory, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) await walk(root, target, paths)
    else if (entry.isFile() && entry.name === 'spec.json')
      paths.push(relative(root, target).split(sep).join('/'))
  }
}

function validate(input: unknown) {
  try {
    return parseSpecification(input)
  } catch (cause) {
    throw new SpecEditorRepositoryError(
      'INVALID_SPECIFICATION',
      errorMessage(cause),
    )
  }
}

async function atomicWrite(target: string, source: string) {
  const temporary = resolve(
    dirname(target),
    `.${basename(target)}.${randomUUID()}.tmp`,
  )
  try {
    await writeFile(temporary, source, { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, target)
  } catch (cause) {
    await unlink(temporary).catch(() => undefined)
    throw cause
  }
}

async function atomicCreate(
  target: string,
  source: string,
  normalized: string,
) {
  const temporary = resolve(
    dirname(target),
    `.${basename(target)}.${randomUUID()}.tmp`,
  )
  try {
    await writeFile(temporary, source, { encoding: 'utf8', flag: 'wx' })
    await link(temporary, target)
  } catch (cause) {
    if (
      cause instanceof Error &&
      'code' in cause &&
      (cause as NodeJS.ErrnoException).code === 'EEXIST'
    )
      throw new SpecEditorRepositoryError(
        'ALREADY_EXISTS',
        `Specification already exists: ${normalized}`,
      )
    throw cause
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

function revision(source: string) {
  return `sha256:${createHash('sha256').update(source).digest('hex')}`
}

async function exists(path: string) {
  try {
    await lstat(path)
    return true
  } catch (cause) {
    if (isMissing(cause)) return false
    throw cause
  }
}

function isMissing(cause: unknown): cause is NodeJS.ErrnoException {
  return (
    cause instanceof Error &&
    'code' in cause &&
    (cause as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}
