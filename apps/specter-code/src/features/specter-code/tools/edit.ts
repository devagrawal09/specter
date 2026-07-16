import { readFile, writeFile } from 'node:fs/promises'

import { normalizeWorkspacePath } from '../adapters/file-index.ts'
import { createFileSnapshot, type FileSnapshot } from '../adapters/snapshots.ts'
import type { ToolDefinition } from '../adapters/tool-registry.ts'
import { resolveWritableWorkspaceFile } from './write.ts'

export type EditToolInput = {
  path: string
  oldString: string
  newString: string
}

export type EditToolOutput = {
  path: string
  replacements: number
  snapshot: FileSnapshot
}

export const editTool: ToolDefinition<EditToolInput, EditToolOutput> = {
  name: 'edit',
  description: 'Replace an exact string in a workspace file after approval',
  permission: 'file.write',
  permissionTarget: (input) => normalizeWorkspacePath(input.path),
  async execute(input, context) {
    let targetPath = input.path
    try {
      if (input.oldString.length === 0)
        throw new Error('Edit oldString is required')
      const target = await resolveWritableWorkspaceFile(
        context.workspaceRoot,
        input.path,
      )
      targetPath = target.path
      if (!target.existed)
        throw new Error('Workspace path must be an existing file')
      const content = await readFile(target.absolutePath, 'utf8')
      if (!content.includes(input.oldString)) {
        throw new Error('Edit oldString was not found in ' + target.path)
      }

      const snapshot = await createFileSnapshot(target)
      const updated = content.split(input.oldString).join(input.newString)
      const replacements = content.split(input.oldString).length - 1
      await writeFile(target.absolutePath, updated, 'utf8')

      await context.metadata({
        toolName: 'edit',
        status: 'completed',
        summary:
          'Edited ' +
          target.path +
          ' (' +
          replacements +
          ' replacement' +
          (replacements === 1 ? '' : 's') +
          ')',
      })
      return { path: target.path, replacements, snapshot }
    } catch (error) {
      await context.metadata({
        toolName: 'edit',
        status: 'failed',
        summary:
          error instanceof Error
            ? error.message
            : 'Edit failed for ' + targetPath,
      })
      throw error
    }
  },
}
