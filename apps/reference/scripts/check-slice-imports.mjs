import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const repoRoot = process.cwd()
const sourceRoot = path.join(repoRoot, 'src', 'features')
const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts']

const violations = []

for (const filePath of walk(sourceRoot)) {
  if (!isCheckedSliceSource(filePath)) {
    continue
  }

  checkFile(filePath)
}

if (violations.length > 0) {
  console.error('Slice import boundary violations found:')

  for (const violation of violations) {
    console.error(
      `- ${relative(violation.importer)} imports sibling slice ` +
        `${violation.targetSlice} via ${violation.specifier}`,
    )
  }

  process.exitCode = 1
}

function checkFile(filePath) {
  const importerSlice = getSliceInfo(filePath)

  if (!importerSlice) {
    return
  }

  const sourceText = readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    false,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  for (const specifier of getImportSpecifiers(sourceFile)) {
    if (!specifier.startsWith('.')) {
      continue
    }

    const targetPath = resolveRelativeImport(filePath, specifier)

    if (!targetPath) {
      continue
    }

    const targetSlice = getSliceInfo(targetPath)

    if (
      targetSlice &&
      targetSlice.slicesRoot === importerSlice.slicesRoot &&
      targetSlice.name !== importerSlice.name
    ) {
      violations.push({
        importer: filePath,
        specifier,
        targetSlice: targetSlice.name,
      })
    }
  }
}

function getImportSpecifiers(sourceFile) {
  const specifiers = []

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1
    ) {
      const [argument] = node.arguments

      if (ts.isStringLiteral(argument)) {
        specifiers.push(argument.text)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return specifiers
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

function isCheckedSliceSource(filePath) {
  if (!sourceExtensions.some((extension) => filePath.endsWith(extension))) {
    return false
  }

  if (filePath.includes(`${path.sep}node_modules${path.sep}`)) {
    return false
  }

  if (/\.(test|spec)\.[cm]?[tj]sx?$/.test(filePath)) {
    return false
  }

  return getSliceInfo(filePath) !== null
}

function getSliceInfo(filePath) {
  const relativePath = path.relative(repoRoot, filePath)
  const parts = relativePath.split(path.sep)
  const slicesIndex = parts.indexOf('slices')

  if (slicesIndex === -1 || !parts[slicesIndex + 1]) {
    return null
  }

  return {
    name: parts[slicesIndex + 1],
    slicesRoot: parts.slice(0, slicesIndex + 1).join('/'),
  }
}

function walk(directory) {
  if (!existsSync(directory)) {
    return []
  }

  const filePaths = []

  for (const entry of readdirSync(directory)) {
    const entryPath = path.join(directory, entry)
    const stats = statSync(entryPath)

    if (stats.isDirectory()) {
      filePaths.push(...walk(entryPath))
    } else if (stats.isFile()) {
      filePaths.push(entryPath)
    }
  }

  return filePaths
}

function relative(filePath) {
  return path.relative(repoRoot, filePath)
}
