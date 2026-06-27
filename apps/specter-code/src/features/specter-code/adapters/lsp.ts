import * as ts from 'typescript'

import {
  listWorkspaceFiles,
  normalizeWorkspacePath,
  resolveWorkspaceFile,
} from './file-index.ts'

export type LspDiagnosticCategory = 'warning' | 'error' | 'suggestion' | 'message'

export type LspDiagnostic = {
  path: string
  lineNumber: number
  column: number
  category: LspDiagnosticCategory
  code: number
  message: string
}

export type LspSymbolKind =
  | 'class'
  | 'enum'
  | 'function'
  | 'interface'
  | 'type'
  | 'variable'

export type LspSymbol = {
  path: string
  lineNumber: number
  name: string
  kind: LspSymbolKind
}

export type TypeScriptDiagnosticsInput = {
  workspaceRoot: string
  include?: string[]
}

export type WorkspaceSymbolsInput = TypeScriptDiagnosticsInput & {
  query: string
}

const SOURCE_FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])

function isSourceFilePath(input: string) {
  return SOURCE_FILE_EXTENSIONS.has(input.slice(input.lastIndexOf('.')))
}

async function resolveIncludedSourceFiles(input: TypeScriptDiagnosticsInput) {
  if (input.include?.length) {
    const files = await Promise.all(
      input.include.map(async (filePath) => {
        const resolved = await resolveWorkspaceFile(input.workspaceRoot, filePath)
        return { path: resolved.path, absolutePath: resolved.absolutePath }
      }),
    )
    return files.filter((file) => isSourceFilePath(file.path))
  }

  const files = await listWorkspaceFiles(input.workspaceRoot)
  return files
    .filter((file) => isSourceFilePath(file.path))
    .map((file) => ({ path: file.path, absolutePath: file.absolutePath }))
}

function diagnosticCategory(category: ts.DiagnosticCategory): LspDiagnosticCategory {
  switch (category) {
    case ts.DiagnosticCategory.Warning:
      return 'warning'
    case ts.DiagnosticCategory.Error:
      return 'error'
    case ts.DiagnosticCategory.Suggestion:
      return 'suggestion'
    case ts.DiagnosticCategory.Message:
      return 'message'
  }
}

export async function collectTypeScriptDiagnostics(
  input: TypeScriptDiagnosticsInput,
): Promise<LspDiagnostic[]> {
  const files = await resolveIncludedSourceFiles(input)
  const pathByAbsolutePath = new Map(files.map((file) => [file.absolutePath, file.path]))
  const program = ts.createProgram(
    files.map((file) => file.absolutePath),
    {
      allowJs: true,
      checkJs: false,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
    },
  )

  return ts
    .getPreEmitDiagnostics(program)
    .flatMap((diagnostic): LspDiagnostic[] => {
      const file = diagnostic.file
      if (!file) return []
      const relativePath = pathByAbsolutePath.get(file.fileName)
      if (!relativePath) return []
      const position = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
      return [
        {
          path: relativePath,
          lineNumber: position.line + 1,
          column: position.character + 1,
          category: diagnosticCategory(diagnostic.category),
          code: diagnostic.code,
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        },
      ]
    })
    .sort((left, right) =>
      left.path.localeCompare(right.path) ||
      left.lineNumber - right.lineNumber ||
      left.column - right.column ||
      left.code - right.code,
    )
}

function normalizeQuery(query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) throw new Error('LSP symbol query is required')
  return normalized
}

function positionForNode(sourceFile: ts.SourceFile, node: ts.Node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function pushNamedSymbol(
  symbols: LspSymbol[],
  input: { path: string; sourceFile: ts.SourceFile; name: ts.Identifier; kind: LspSymbolKind },
) {
  symbols.push({
    path: input.path,
    lineNumber: positionForNode(input.sourceFile, input.name),
    name: input.name.text,
    kind: input.kind,
  })
}

function collectSymbolsFromSourceFile(path: string, sourceFile: ts.SourceFile) {
  const symbols: LspSymbol[] = []

  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      pushNamedSymbol(symbols, { path, sourceFile, name: node.name, kind: 'function' })
    } else if (ts.isClassDeclaration(node) && node.name) {
      pushNamedSymbol(symbols, { path, sourceFile, name: node.name, kind: 'class' })
    } else if (ts.isInterfaceDeclaration(node)) {
      pushNamedSymbol(symbols, { path, sourceFile, name: node.name, kind: 'interface' })
    } else if (ts.isTypeAliasDeclaration(node)) {
      pushNamedSymbol(symbols, { path, sourceFile, name: node.name, kind: 'type' })
    } else if (ts.isEnumDeclaration(node)) {
      pushNamedSymbol(symbols, { path, sourceFile, name: node.name, kind: 'enum' })
    } else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          pushNamedSymbol(symbols, {
            path,
            sourceFile,
            name: declaration.name,
            kind: 'variable',
          })
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return symbols
}

export async function findWorkspaceSymbols(input: WorkspaceSymbolsInput): Promise<LspSymbol[]> {
  const query = normalizeQuery(input.query)
  const files = await resolveIncludedSourceFiles(input)
  const symbols: LspSymbol[] = []

  for (const file of files) {
    normalizeWorkspacePath(file.path)
    const program = ts.createProgram([file.absolutePath], {
      allowJs: true,
      checkJs: false,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
    })
    const sourceFile = program.getSourceFile(file.absolutePath)
    if (!sourceFile) continue
    symbols.push(...collectSymbolsFromSourceFile(file.path, sourceFile))
  }

  return symbols
    .filter((symbol) => symbol.name.toLocaleLowerCase().includes(query))
    .sort((left, right) =>
      left.path.localeCompare(right.path) || left.lineNumber - right.lineNumber || left.name.localeCompare(right.name),
    )
}
