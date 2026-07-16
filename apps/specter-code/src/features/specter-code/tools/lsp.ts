import {
  collectTypeScriptDiagnostics,
  findWorkspaceSymbols,
  type LspDiagnostic,
  type LspSymbol,
} from '../adapters/lsp.ts'
import type { ToolDefinition } from '../adapters/tool-registry.ts'

export type LspToolInput =
  | {
      action: 'diagnostics'
      include?: string[]
      limit?: number
    }
  | {
      action: 'symbols'
      query: string
      include?: string[]
      limit?: number
    }

export type LspDiagnosticsToolOutput = {
  action: 'diagnostics'
  diagnostics: LspDiagnostic[]
  truncated: boolean
}

export type LspSymbolsToolOutput = {
  action: 'symbols'
  query: string
  symbols: LspSymbol[]
  truncated: boolean
}

export type LspToolOutput = LspDiagnosticsToolOutput | LspSymbolsToolOutput

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

function normalizeLimit(limit: number | undefined) {
  if (limit === undefined) return DEFAULT_LIMIT
  if (!Number.isFinite(limit) || limit < 1)
    throw new Error('LSP limit must be positive')
  return Math.min(Math.floor(limit), MAX_LIMIT)
}

function plural(count: number, singular: string, pluralName = singular + 's') {
  return count + ' ' + (count === 1 ? singular : pluralName)
}

function truncateItems<T>(items: T[], limit: number) {
  return {
    items: items.slice(0, limit),
    truncated: items.length > limit,
  }
}

export const lspTool: ToolDefinition<LspToolInput, LspToolOutput> = {
  name: 'lsp',
  description: 'Inspect TypeScript diagnostics and workspace symbols',
  permission: 'lsp',
  async execute(input, context) {
    const limit = normalizeLimit(input.limit)

    try {
      if (input.action === 'diagnostics') {
        const diagnostics = await collectTypeScriptDiagnostics({
          workspaceRoot: context.workspaceRoot,
          include: input.include,
        })
        const truncated = truncateItems(diagnostics, limit)
        await context.metadata({
          toolName: 'lsp',
          status: 'completed',
          summary:
            'Found ' +
            plural(truncated.items.length, 'TypeScript diagnostic') +
            (truncated.truncated ? ' (truncated)' : ''),
        })
        return {
          action: 'diagnostics',
          diagnostics: truncated.items,
          truncated: truncated.truncated,
        }
      }

      const symbols = await findWorkspaceSymbols({
        workspaceRoot: context.workspaceRoot,
        include: input.include,
        query: input.query,
      })
      const truncated = truncateItems(symbols, limit)
      await context.metadata({
        toolName: 'lsp',
        status: 'completed',
        summary:
          'Found ' +
          plural(truncated.items.length, 'symbol') +
          ' for ' +
          input.query.trim() +
          (truncated.truncated ? ' (truncated)' : ''),
      })
      return {
        action: 'symbols',
        query: input.query.trim(),
        symbols: truncated.items,
        truncated: truncated.truncated,
      }
    } catch (error) {
      await context.metadata({
        toolName: 'lsp',
        status: 'failed',
        summary:
          error instanceof Error ? error.message : 'LSP inspection failed',
      })
      throw error
    }
  },
}
