import {
  resolveShellWorkingDirectory,
  runShellCommand,
  type ShellRunResult,
} from '../adapters/shell'
import type { ToolDefinition } from '../adapters/tool-registry'

export type ShellToolInput = {
  command: string
  cwd?: string
  shell?: string
  timeoutMs?: number
  maxOutputBytes?: number
}

export type ShellToolOutput = ShellRunResult & {
  command: string
  cwd: string
}

export const shellTool: ToolDefinition<ShellToolInput, ShellToolOutput> = {
  name: 'shell',
  description: 'Run a bounded shell command inside the current workspace after approval',
  permission: 'shell.execute',
  async execute(input, context) {
    const command = input.command.trim()
    try {
      const cwd = await resolveShellWorkingDirectory(context.workspaceRoot, input.cwd)
      const decision = await context.ask({ permission: 'shell.execute', target: command })
      if (decision !== 'allow') throw new Error('Shell denied for ' + command)

      await context.metadata({
        toolName: 'shell',
        status: 'started',
        summary: 'Running ' + command,
      })

      const result = await runShellCommand(
        {
          command,
          cwd: cwd.absolutePath,
          shell: input.shell,
          timeoutMs: input.timeoutMs,
          maxOutputBytes: input.maxOutputBytes,
        },
        {
          abortSignal: context.abortSignal,
          onOutput: (chunk) => {
            void context.metadata({
              toolName: 'shell',
              status: 'output',
              stream: chunk.stream,
              summary: chunk.chunk,
            })
          },
        },
      )

      await context.metadata({
        toolName: 'shell',
        status: result.timedOut || result.exitCode !== 0 ? 'failed' : 'completed',
        summary: result.timedOut
          ? 'Shell timed out'
          : 'Shell exited ' + (result.exitCode ?? result.signal ?? 'unknown'),
      })

      return {
        command,
        cwd: cwd.path,
        ...result,
      }
    } catch (error) {
      await context.metadata({
        toolName: 'shell',
        status: 'failed',
        summary: error instanceof Error ? error.message : 'Shell failed for ' + command,
      })
      throw error
    }
  },
}
