import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ProcessCommandRunner,
  type CommandExecutionRequest,
} from '../dist/index.js'

describe('process command runner', () => {
  it(
    'terminates the complete descendant process group on timeout',
    { skip: process.platform === 'win32' },
    async () => {
      const childProgram = [
        "const { spawn } = require('node:child_process')",
        "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
        'console.log(child.pid)',
        'setInterval(() => {}, 1000)',
      ].join(';')
      const request: CommandExecutionRequest = {
        command: {
          id: 'timeout-tree',
          file: process.execPath,
          args: ['-e', childProgram],
          cwd: '.',
          timeoutMs: 100,
        },
        cwd: process.cwd(),
        timeoutMs: 100,
      }

      const result = await new ProcessCommandRunner().run(request)
      assert.equal(result.timedOut, true)
      const descendantPid = Number(result.stdout.trim())
      assert.equal(Number.isInteger(descendantPid), true)
      await assertProcessGone(descendantPid)
    },
  )
})

async function assertProcessGone(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (cause) {
      if (
        cause instanceof Error &&
        'code' in cause &&
        cause.code === 'ESRCH'
      ) {
        return
      }
      throw cause
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail(`descendant process ${pid} survived timeout cleanup`)
}
