import { readFile, writeFile } from 'node:fs/promises'

import { createFileSnapshot, type FileSnapshot } from '../adapters/snapshots'
import type { ToolDefinition } from '../adapters/tool-registry'
import { resolveWritableWorkspaceFile } from './write'

export type ApplyPatchToolInput = {
  patch: string
}

export type AppliedPatchFile = {
  path: string
  additions: number
  removals: number
  snapshot: FileSnapshot
}

export type ApplyPatchToolOutput = {
  files: AppliedPatchFile[]
}

type ParsedPatchFile = {
  path: string
  hunkLines: string[]
}

const stripPatchPathPrefix = (value: string) => value.replace(/^[ab]\//, '')

function parseUnifiedPatch(patch: string): ParsedPatchFile[] {
  const lines = patch.replaceAll('\r\n', '\n').split('\n')
  const files: ParsedPatchFile[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.startsWith('--- ')) {
      index += 1
      continue
    }

    const next = lines[index + 1]
    if (!next?.startsWith('+++ ')) throw new Error('Patch file header is missing +++ path')
    const filePath = stripPatchPathPrefix(next.slice(4).trim())
    index += 2

    const hunkLines: string[] = []
    while (index < lines.length && !lines[index].startsWith('--- ')) {
      if (lines[index].startsWith('@@')) {
        index += 1
        while (index < lines.length && !lines[index].startsWith('@@') && !lines[index].startsWith('--- ')) {
          if (lines[index] !== '\\ No newline at end of file') hunkLines.push(lines[index])
          index += 1
        }
        continue
      }
      index += 1
    }

    if (hunkLines.length === 0) throw new Error('Patch file has no hunks for ' + filePath)
    files.push({ path: filePath, hunkLines })
  }

  if (files.length === 0) throw new Error('Patch must contain at least one file')
  return files
}

function applyLinePatch(originalContent: string, hunkLines: string[]) {
  const hadTrailingNewline = originalContent.endsWith('\n')
  const originalLines = hadTrailingNewline
    ? originalContent.slice(0, -1).split('\n')
    : originalContent.split('\n')
  const output: string[] = []
  let originalIndex = 0
  let additions = 0
  let removals = 0

  for (const hunkLine of hunkLines) {
    if (hunkLine.length === 0) continue
    const marker = hunkLine[0]
    const value = hunkLine.slice(1)

    if (marker === ' ') {
      if (originalLines[originalIndex] !== value) {
        throw new Error('Patch context did not match original file')
      }
      output.push(value)
      originalIndex += 1
      continue
    }

    if (marker === '-') {
      if (originalLines[originalIndex] !== value) {
        throw new Error('Patch removal did not match original file')
      }
      originalIndex += 1
      removals += 1
      continue
    }

    if (marker === '+') {
      output.push(value)
      additions += 1
      continue
    }

    throw new Error('Unsupported patch hunk line: ' + hunkLine)
  }

  output.push(...originalLines.slice(originalIndex))
  return { content: output.join('\n') + (hadTrailingNewline ? '\n' : ''), additions, removals }
}

export const applyPatchTool: ToolDefinition<ApplyPatchToolInput, ApplyPatchToolOutput> = {
  name: 'apply_patch',
  description: 'Apply a unified patch inside the current workspace after approval',
  permission: 'file.write',
  permissionTargets: (input) => parseUnifiedPatch(input.patch).map((file) => file.path),
  async execute(input, context) {
    try {
      const parsedFiles = parseUnifiedPatch(input.patch)
      const files: AppliedPatchFile[] = []

      for (const parsedFile of parsedFiles) {
        const target = await resolveWritableWorkspaceFile(context.workspaceRoot, parsedFile.path)
        if (!target.existed) throw new Error('Patch target must be an existing file: ' + target.path)
        const originalContent = await readFile(target.absolutePath, 'utf8')
        const snapshot = await createFileSnapshot(target)
        const applied = applyLinePatch(originalContent, parsedFile.hunkLines)
        await writeFile(target.absolutePath, applied.content, 'utf8')
        files.push({
          path: target.path,
          additions: applied.additions,
          removals: applied.removals,
          snapshot,
        })
      }

      await context.metadata({
        toolName: 'apply_patch',
        status: 'completed',
        summary: 'Applied patch to ' + files.length + ' file' + (files.length === 1 ? '' : 's'),
      })
      return { files }
    } catch (error) {
      await context.metadata({
        toolName: 'apply_patch',
        status: 'failed',
        summary: error instanceof Error ? error.message : 'Apply patch failed',
      })
      throw error
    }
  },
}
