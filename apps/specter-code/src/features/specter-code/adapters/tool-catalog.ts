import { createTaskRunner } from './task-runner'
import {
  createToolRegistry,
  type ToolDefinition,
  type ToolSummary,
} from './tool-registry'
import { applyPatchTool } from '../tools/apply-patch'
import { editTool } from '../tools/edit'
import { globTool } from '../tools/glob'
import { grepTool } from '../tools/grep'
import { lspTool } from '../tools/lsp'
import { questionTool } from '../tools/question'
import { readTool } from '../tools/read'
import { shellTool } from '../tools/shell'
import { createTaskStatusTool } from '../tools/task-status'
import { createTaskTool } from '../tools/task'
import { todoTool } from '../tools/todo'
import { webfetchTool } from '../tools/webfetch'
import { websearchTool } from '../tools/websearch'
import { writeTool } from '../tools/write'

export type OpenCodeToolListItem = {
  id: string
  description: string
  parameters: Record<string, unknown>
}

const DEFAULT_PARAMETERS = {
  type: 'object',
  properties: {},
} satisfies Record<string, unknown>

export function createSpecterCodeBuiltInToolRegistry() {
  const registry = createToolRegistry()
  for (const tool of createSpecterCodeBuiltInTools()) {
    registry.register(tool)
  }
  return registry
}

export function listSpecterCodeToolIds() {
  return createSpecterCodeBuiltInToolRegistry()
    .list()
    .map((tool) => tool.name)
    .sort((left, right) => left.localeCompare(right))
}

export function listSpecterCodeTools(): OpenCodeToolListItem[] {
  return createSpecterCodeBuiltInToolRegistry()
    .list()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(toOpenCodeToolListItem)
}

function createSpecterCodeBuiltInTools(): ToolDefinition<any, unknown>[] {
  const taskRunner = createTaskRunner({
    execute(input) {
      return {
        summary: `Queued ${input.agent} task ${input.taskId}`,
      }
    },
  })

  return [
    applyPatchTool,
    editTool,
    globTool,
    grepTool,
    lspTool,
    questionTool,
    readTool,
    shellTool,
    createTaskTool(taskRunner),
    createTaskStatusTool(taskRunner),
    todoTool,
    webfetchTool,
    websearchTool,
    writeTool,
  ]
}

function toOpenCodeToolListItem(tool: ToolSummary): OpenCodeToolListItem {
  return {
    id: tool.name,
    description: tool.description ?? tool.name,
    parameters: DEFAULT_PARAMETERS,
  }
}
