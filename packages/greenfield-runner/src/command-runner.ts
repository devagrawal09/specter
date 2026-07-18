import { spawn } from 'node:child_process'

import type {
  CommandExecutionRequest,
  CommandExecutionResult,
  CommandRunner,
} from './types.js'
import { terminateProcessTree } from './process-tree.js'

export class ProcessCommandRunner implements CommandRunner {
  run(request: CommandExecutionRequest): Promise<CommandExecutionResult> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now()
      const child = spawn(request.command.file, [...request.command.args], {
        cwd: request.cwd,
        env: { ...process.env, ...request.command.env },
        detached: process.platform !== 'win32',
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      let settled = false

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })
      child.once('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(error)
      })
      child.once('close', (exitCode, signal) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve({
          exitCode,
          signal,
          stdout,
          stderr,
          timedOut,
          durationMs: Date.now() - startedAt,
        })
      })

      const timeout = setTimeout(() => {
        timedOut = true
        if (child.pid !== undefined) terminateProcessTree(child.pid, 'SIGTERM')
        setTimeout(() => {
          if (!settled) {
            if (child.pid !== undefined)
              terminateProcessTree(child.pid, 'SIGKILL')
          }
        }, 5000).unref()
      }, request.timeoutMs)
      timeout.unref()
    })
  }
}
