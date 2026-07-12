import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { loadSpecterCodeConfig, type SpecterCodeConfig } from './config-loader.ts'
import { listSpecterCodeSkills } from './skills.ts'

export type SpecterCodeCommandSource = 'command' | 'mcp' | 'skill'

export type SpecterCodeCommandInfo = {
  name: string
  description?: string
  agent?: string
  model?: string
  source: SpecterCodeCommandSource
  template: string
  subtask?: boolean
  hints: string[]
}

export type ListSpecterCodeCommandsOptions = {
  workspaceRoot: string
  config?: SpecterCodeConfig
}

type JsonRecord = Record<string, unknown>

type CommandFrontmatter = {
  description?: string
  agent?: string
  model?: string
  subtask?: boolean
}

const DEFAULT_COMMAND_DIRS = [
  path.join('.opencode', 'command'),
  path.join('.opencode', 'commands'),
  'command',
  'commands',
]

const BUILTIN_TEMPLATES = {
  init: 'Initialize OpenCode project instructions for ${path}.',
  review: 'Review the current changes in ${path} and report risks.',
} as const

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function isDirectory(directory: string) {
  try {
    return (await stat(directory)).isDirectory()
  } catch {
    return false
  }
}

async function scanMarkdownFiles(root: string): Promise<string[]> {
  if (!(await isDirectory(root))) return []

  const matches: string[] = []
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      matches.push(...await scanMarkdownFiles(absolutePath))
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      matches.push(absolutePath)
    }
  }
  return matches
}

function stripWrappingQuotes(value: string) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseBoolean(value: string) {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return undefined
}

function parseFrontmatter(frontmatter: string): CommandFrontmatter {
  const parsed: CommandFrontmatter = {}
  for (const line of frontmatter.split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const value = stripWrappingQuotes(line.slice(separator + 1))
    if (key === 'description') parsed.description = value
    if (key === 'agent') parsed.agent = value
    if (key === 'model') parsed.model = value
    if (key === 'subtask') parsed.subtask = parseBoolean(value)
  }
  return parsed
}

function parseCommandMarkdown(markdown: string) {
  const normalized = markdown.replace(/^\uFEFF/, '')
  if (!normalized.startsWith('---')) {
    return { frontmatter: {}, content: normalized.trim() }
  }

  const lineBreak = normalized.indexOf('\n')
  if (lineBreak < 0) return { frontmatter: {}, content: normalized.trim() }
  const closeMarker = normalized.indexOf('\n---', lineBreak)
  if (closeMarker < 0) return { frontmatter: {}, content: normalized.trim() }

  const frontmatter = parseFrontmatter(normalized.slice(lineBreak + 1, closeMarker))
  const afterMarker = normalized.indexOf('\n', closeMarker + 1)
  const content = (afterMarker < 0 ? '' : normalized.slice(afterMarker + 1)).trim()
  return { frontmatter, content }
}

function commandNameFromPath(filePath: string, root: string) {
  const relative = path.relative(root, filePath).replaceAll(path.sep, '/')
  return relative.replace(/\.md$/i, '')
}

function configuredCommand(commandName: string, value: unknown): SpecterCodeCommandInfo | undefined {
  if (!isRecord(value) || typeof value.template !== 'string') return undefined
  return {
    name: commandName,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(typeof value.agent === 'string' ? { agent: value.agent } : {}),
    ...(typeof value.model === 'string' ? { model: value.model } : {}),
    source: 'command',
    template: value.template,
    ...(typeof value.subtask === 'boolean' ? { subtask: value.subtask } : {}),
    hints: extractSpecterCodeCommandHints(value.template),
  }
}

export function extractSpecterCodeCommandHints(template: string) {
  const result: string[] = []
  const numbered = template.match(/\$\d+/g)
  if (numbered) {
    result.push(...[...new Set(numbered)].sort())
  }
  if (template.includes('$ARGUMENTS')) result.push('$ARGUMENTS')
  return result
}

export function renderSpecterCodeCommandPrompt(command: SpecterCodeCommandInfo, argumentText: string) {
  const args = argumentText.trim()
  const positional = args ? args.split(/\s+/) : []
  return command.template
    .replace(/\$(\d+)/g, (_match, index: string) => positional[Number(index) - 1] ?? '')
    .replaceAll('$ARGUMENTS', args)
}

export async function listSpecterCodeCommands(options: ListSpecterCodeCommandsOptions): Promise<SpecterCodeCommandInfo[]> {
  const workspaceRoot = path.resolve(options.workspaceRoot)
  const config = options.config ?? await loadSpecterCodeConfig({ workspaceRoot })
  const commands = new Map<string, SpecterCodeCommandInfo>()

  commands.set('init', {
    name: 'init',
    description: 'guided AGENTS.md setup',
    source: 'command',
    template: BUILTIN_TEMPLATES.init.replace('${path}', workspaceRoot),
    hints: extractSpecterCodeCommandHints(BUILTIN_TEMPLATES.init),
  })
  commands.set('review', {
    name: 'review',
    description: 'review changes [commit|branch|pr], defaults to uncommitted',
    source: 'command',
    template: BUILTIN_TEMPLATES.review.replace('${path}', workspaceRoot),
    subtask: true,
    hints: extractSpecterCodeCommandHints(BUILTIN_TEMPLATES.review),
  })

  if (isRecord(config.raw.command)) {
    for (const [name, value] of Object.entries(config.raw.command)) {
      const command = configuredCommand(name, value)
      if (command) commands.set(name, command)
    }
  }

  for (const root of DEFAULT_COMMAND_DIRS.map((directory) => path.join(workspaceRoot, directory))) {
    for (const filePath of await scanMarkdownFiles(root)) {
      const parsed = parseCommandMarkdown(await readFile(filePath, 'utf8'))
      if (!parsed.content) continue
      const name = commandNameFromPath(filePath, root)
      commands.set(name, {
        name,
        ...parsed.frontmatter,
        source: 'command',
        template: parsed.content,
        hints: extractSpecterCodeCommandHints(parsed.content),
      })
    }
  }

  for (const skill of await listSpecterCodeSkills({ workspaceRoot, config })) {
    if (commands.has(skill.name)) continue
    commands.set(skill.name, {
      name: skill.name,
      ...(skill.description ? { description: skill.description } : {}),
      source: 'skill',
      template: skill.content.trim(),
      hints: [],
    })
  }

  return [...commands.values()].sort((left, right) => left.name.localeCompare(right.name))
}
