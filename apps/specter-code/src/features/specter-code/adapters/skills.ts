import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { loadSpecterCodeConfig, type SpecterCodeConfig } from './config-loader'

export type SpecterCodeSkillInfo = {
  name: string
  description?: string
  location: string
  content: string
}

export type ListSpecterCodeSkillsOptions = {
  workspaceRoot: string
  config?: SpecterCodeConfig
}

type JsonRecord = Record<string, unknown>

type SkillFrontmatter = {
  name?: string
  description?: string
}

const DEFAULT_SKILL_DIRS = [
  path.join('.opencode', 'skill'),
  path.join('.opencode', 'skills'),
]

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

async function scanSkillFiles(root: string): Promise<string[]> {
  if (!(await isDirectory(root))) return []

  const matches: string[] = []
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      matches.push(...await scanSkillFiles(absolutePath))
      continue
    }
    if (entry.isFile() && entry.name === 'SKILL.md') {
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

function parseFrontmatter(frontmatter: string): SkillFrontmatter {
  const parsed: SkillFrontmatter = {}
  for (const line of frontmatter.split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const value = stripWrappingQuotes(line.slice(separator + 1))
    if (key === 'name') parsed.name = value
    if (key === 'description') parsed.description = value
  }
  return parsed
}

function parseSkillMarkdown(markdown: string) {
  const normalized = markdown.replace(/^\uFEFF/, '')
  if (!normalized.startsWith('---')) return undefined

  const lineBreak = normalized.indexOf('\n')
  if (lineBreak < 0) return undefined
  const closeMarker = normalized.indexOf('\n---', lineBreak)
  if (closeMarker < 0) return undefined

  const frontmatter = parseFrontmatter(normalized.slice(lineBreak + 1, closeMarker))
  if (!frontmatter.name) return undefined

  const afterMarker = normalized.indexOf('\n', closeMarker + 1)
  const content = (afterMarker < 0 ? '' : normalized.slice(afterMarker + 1)).replace(/^\r?\n/, '')
  return {
    name: frontmatter.name,
    ...(frontmatter.description ? { description: frontmatter.description } : {}),
    content,
  }
}

function normalizeConfiguredPath(workspaceRoot: string, configuredPath: string) {
  const expanded = configuredPath.startsWith('~/')
    ? path.join(process.env.HOME ?? workspaceRoot, configuredPath.slice(2))
    : configuredPath
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(workspaceRoot, expanded)
}

function configuredSkillRoots(workspaceRoot: string, config: SpecterCodeConfig) {
  const roots = new Set<string>()
  for (const configuredPath of config.skills ?? []) {
    roots.add(normalizeConfiguredPath(workspaceRoot, configuredPath))
  }

  const rawSkills = config.raw.skills
  if (isRecord(rawSkills) && Array.isArray(rawSkills.paths)) {
    for (const configuredPath of rawSkills.paths) {
      if (typeof configuredPath === 'string') {
        roots.add(normalizeConfiguredPath(workspaceRoot, configuredPath))
      }
    }
  }

  return [...roots]
}

async function loadSkillFile(filePath: string): Promise<SpecterCodeSkillInfo | undefined> {
  const parsed = parseSkillMarkdown(await readFile(filePath, 'utf8'))
  if (!parsed) return undefined
  return {
    ...parsed,
    location: filePath,
  }
}

export async function listSpecterCodeSkills(options: ListSpecterCodeSkillsOptions): Promise<SpecterCodeSkillInfo[]> {
  const workspaceRoot = path.resolve(options.workspaceRoot)
  const config = options.config ?? await loadSpecterCodeConfig({ workspaceRoot })
  const roots = [
    ...DEFAULT_SKILL_DIRS.map((directory) => path.join(workspaceRoot, directory)),
    ...configuredSkillRoots(workspaceRoot, config),
  ]

  const skillFiles = new Set<string>()
  for (const root of roots) {
    for (const filePath of await scanSkillFiles(root)) {
      skillFiles.add(filePath)
    }
  }

  const byName = new Map<string, SpecterCodeSkillInfo>()
  for (const filePath of skillFiles) {
    const skill = await loadSkillFile(filePath)
    if (skill) byName.set(skill.name, skill)
  }

  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name))
}
