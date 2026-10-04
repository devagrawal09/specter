import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const repoRoot = process.cwd()
const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts', '.json']
const featureRoots = findFeatureRoots()
const files = featureRoots.flatMap(walk)
const violations = []
const sliceDirectories = new Map()

for (const filePath of files) {
  const slice = getSliceCandidate(filePath)
  if (slice) {
    const filenames = sliceDirectories.get(slice.directory) ?? new Set()
    filenames.add(path.basename(filePath))
    sliceDirectories.set(slice.directory, filenames)
  }
}

const sliceContractDirectories = new Set(
  [...sliceDirectories]
    .filter(([, filenames]) => hasSliceContractFile(filenames))
    .map(([directory]) => directory),
)

for (const filePath of files) {
  if (isTypeScriptSource(filePath)) checkFile(filePath)
}

for (const [directory, filenames] of sliceDirectories) {
  if (!hasSliceContractFile(filenames)) continue

  if (filenames.has('slice.ts')) {
    addViolation(
      path.join(directory, 'slice.ts'),
      'legacy slice.ts must be split into spec.ts and impl.ts',
    )
  }
  if (
    !filenames.has('spec.ts') &&
    !(isWorklogSlice(directory) && filenames.has('spec.json'))
  ) {
    addViolation(
      directory,
      isWorklogSlice(directory)
        ? 'Worklog Slice directory is missing spec.json'
        : 'Slice directory is missing spec.ts',
    )
  }
  if (!filenames.has('impl.ts')) {
    addViolation(directory, 'Slice directory is missing impl.ts')
  }
}

function isWorklogSlice(directory) {
  const worklogFeatures = path.join(
    repoRoot,
    'apps',
    'worklog',
    'src',
    'features',
  )
  const pathFromWorklog = path.relative(worklogFeatures, directory)
  return (
    pathFromWorklog !== '' &&
    pathFromWorklog !== '..' &&
    !pathFromWorklog.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(pathFromWorklog)
  )
}

if (violations.length > 0) {
  console.error('Slice import boundary violations found:')
  for (const violation of violations) {
    console.error(`- ${relative(violation.filePath)}: ${violation.message}`)
  }
  process.exitCode = 1
}

function checkFile(filePath) {
  const importerSlice = getSliceInfo(filePath)
  const sourceFile = parse(filePath)
  const imports = getImports(sourceFile)
  const basename = path.basename(filePath)

  for (const imported of imports) {
    const targetPath = imported.specifier.startsWith('.')
      ? resolveRelativeImport(filePath, imported.specifier)
      : undefined
    const targetSlice = targetPath ? getSliceInfo(targetPath) : undefined

    if (
      importerSlice &&
      targetSlice &&
      targetSlice.featureRoot === importerSlice.featureRoot &&
      targetSlice.name !== importerSlice.name
    ) {
      addViolation(
        filePath,
        `imports sibling Slice "${targetSlice.name}" via ${imported.specifier}`,
      )
    }

    if (basename === 'spec.ts') {
      checkSpecificationImport(filePath, imported.specifier, targetPath)
    }

    if (
      basename === 'registry.ts' &&
      targetPath &&
      path.basename(targetPath) === 'spec.ts'
    ) {
      addViolation(
        filePath,
        `registries must import completed implementations, not ${imported.specifier}`,
      )
    }
  }

  if (basename === 'impl.ts') {
    if (
      imports.some(({ specifier }) => {
        if (!specifier.startsWith('.')) return false
        const target = resolveRelativeImport(filePath, specifier)
        return target && path.basename(target) === 'spec.ts'
      })
    ) {
      addViolation(filePath, 'impl.ts must not import executable spec.ts')
    }

    if (
      !imports.some(({ specifier }) =>
        /(?:^|\/)spec\.json$/.test(specifier),
      )
    ) {
      addViolation(filePath, 'impl.ts must import its adjacent spec.json')
    }
  }
}

function checkSpecificationImport(filePath, specifier, targetPath) {
  if (!specifier.startsWith('.')) {
    if (specifier !== '@specter-ts/spec') {
      addViolation(
        filePath,
        `spec.ts may only use @specter-ts/spec as an external value import; found ${specifier}`,
      )
    }
    return
  }

  if (!targetPath) return

  const forbiddenName = /(?:^|[-.])(impl|slice|events?|schemas?|stores?|plugins?|server|registry)(?:[-.]|$)/
  const targetName = path.basename(targetPath).toLowerCase()
  const targetParts = relative(targetPath).split(path.sep)

  if (
    forbiddenName.test(targetName) ||
    targetParts.some((part) => part === 'db' || part === 'server')
  ) {
    addViolation(
      filePath,
      `spec.ts imports implementation detail ${specifier}`,
    )
  }
}

function parse(filePath) {
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    false,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

function getImports(sourceFile) {
  const imports = []

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push({ specifier: node.moduleSpecifier.text })
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push({ specifier: node.arguments[0].text })
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return imports
}

function resolveRelativeImport(importerPath, specifier) {
  const basePath = path.resolve(path.dirname(importerPath), specifier)
  const candidates = [
    basePath,
    ...sourceExtensions.map((extension) => `${basePath}${extension}`),
    ...sourceExtensions.map((extension) =>
      path.join(basePath, `index${extension}`),
    ),
  ]

  return candidates.find((candidate) => {
    try {
      return statSync(candidate).isFile()
    } catch {
      return false
    }
  })
}

function getSliceInfo(filePath) {
  const slice = getSliceCandidate(filePath)
  return slice && sliceContractDirectories.has(slice.directory)
    ? slice
    : undefined
}

function getSliceCandidate(filePath) {
  const parts = path.relative(repoRoot, filePath).split(path.sep)
  const featuresIndex = parts.lastIndexOf('features')

  if (
    featuresIndex < 1 ||
    parts[featuresIndex - 1] !== 'src' ||
    !parts[featuresIndex + 1] ||
    !parts[featuresIndex + 2] ||
    !parts[featuresIndex + 3]
  ) {
    return undefined
  }

  return {
    name: parts[featuresIndex + 2],
    directory: path.join(
      repoRoot,
      ...parts.slice(0, featuresIndex + 3),
    ),
    featureRoot: parts.slice(0, featuresIndex + 2).join('/'),
  }
}

function findFeatureRoots() {
  const roots = []
  const appsRoot = path.join(repoRoot, 'apps')

  if (existsSync(appsRoot)) {
    for (const app of readdirSync(appsRoot)) {
      const candidate = path.join(appsRoot, app, 'src', 'features')
      if (existsSync(candidate)) roots.push(candidate)
    }
  }

  const templateRoot = path.join(
    repoRoot,
    'packages',
    'create-specter',
    'template',
    'src',
    'features',
  )
  if (existsSync(templateRoot)) roots.push(templateRoot)

  return roots
}

function walk(directory) {
  if (!existsSync(directory)) return []

  return readdirSync(directory).flatMap((entry) => {
    const entryPath = path.join(directory, entry)
    const stats = statSync(entryPath)
    return stats.isDirectory() ? walk(entryPath) : stats.isFile() ? [entryPath] : []
  })
}

function hasSliceContractFile(filenames) {
  return (
    filenames.has('slice.ts') ||
    filenames.has('spec.ts') ||
    filenames.has('impl.ts')
  )
}

function isTypeScriptSource(filePath) {
  return sourceExtensions.some((extension) => filePath.endsWith(extension))
}

function addViolation(filePath, message) {
  violations.push({ filePath, message })
}

function relative(filePath) {
  return path.relative(repoRoot, filePath)
}
