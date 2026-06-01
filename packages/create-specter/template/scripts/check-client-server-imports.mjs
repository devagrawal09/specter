import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const repoRoot = process.cwd()
const sourceRoot = path.join(repoRoot, 'src')
const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts']
const violations = []

for (const filePath of walk(sourceRoot)) {
  if (!isCheckedSource(filePath)) {
    continue
  }

  checkFile(filePath)
}

if (violations.length > 0) {
  console.error('Client/server import boundary violations found:')

  for (const violation of violations) {
    console.error(
      `- ${relative(violation.importer)} imports server module ` +
        `${relative(violation.target)} via ${violation.specifier}`,
    )
  }

  process.exitCode = 1
}

function checkFile(filePath) {
  const sourceText = readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    false,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue
    }

    if (
      statement.importClause?.isTypeOnly ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue
    }

    const specifier = statement.moduleSpecifier.text
    const targetPath = resolveImport(filePath, specifier)

    if (!targetPath || !isServerModule(targetPath)) {
      continue
    }

    violations.push({ importer: filePath, specifier, target: targetPath })
  }
}

function isCheckedSource(filePath) {
  if (!sourceExtensions.some((extension) => filePath.endsWith(extension))) {
    return false
  }

  if (/\.(test|spec)\.[cm]?[tj]sx?$/.test(filePath)) {
    return false
  }

  if (relative(filePath) === 'src/lib/test-db.ts') {
    return false
  }

  return !isServerModule(filePath)
}

function isServerModule(filePath) {
  const relativePath = relative(filePath)
  return (
    relativePath === 'src/server.ts' ||
    relativePath.endsWith('.server.ts') ||
    relativePath.startsWith('src/features/') ||
    relativePath.includes('/server/') ||
    relativePath.includes('/db/')
  )
}

function resolveImport(importerPath, specifier) {
  if (!specifier.startsWith('.')) {
    return null
  }

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
  return path.relative(repoRoot, filePath).split(path.sep).join('/')
}
