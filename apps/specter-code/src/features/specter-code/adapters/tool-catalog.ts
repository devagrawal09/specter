import { createTaskRunner } from './task-runner.ts'
import {
  createToolRegistry,
  type ToolDefinition,
  type ToolSummary,
} from './tool-registry.ts'
import { applyPatchTool } from '../tools/apply-patch.ts'
import { editTool } from '../tools/edit.ts'
import { globTool } from '../tools/glob.ts'
import { grepTool } from '../tools/grep.ts'
import { lspTool } from '../tools/lsp.ts'
import { questionTool } from '../tools/question.ts'
import { readTool } from '../tools/read.ts'
import { shellTool } from '../tools/shell.ts'
import { createTaskStatusTool } from '../tools/task-status.ts'
import { createTaskTool } from '../tools/task.ts'
import { todoTool } from '../tools/todo.ts'
import { webfetchTool } from '../tools/webfetch.ts'
import { websearchTool } from '../tools/websearch.ts'
import { writeTool } from '../tools/write.ts'

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
