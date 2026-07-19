import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import { networkInterfaces, tmpdir } from 'node:os'
import path from 'node:path'

const verificationDirectory = await mkdtemp(
  path.join(tmpdir(), 'specter-worklog-production-listener-'),
)
const databasePath = path.join(verificationDirectory, 'worklog.db')
const verificationPort = 41737
const verificationBaseUrl = `http://127.0.0.1:${verificationPort}`
const child = spawn(process.execPath, ['dist/index.js'], {
  env: {
    ...process.env,
    WORKLOG_PORT: String(verificationPort),
    WORKLOG_SQLITE_PATH: databasePath,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
let subscriptionReader
child.stdout.on('data', (chunk) => {
  output += chunk
})
child.stderr.on('data', (chunk) => {
  output += chunk
})

try {
  await waitForListener()

  const health = await fetch(`${verificationBaseUrl}/api/health`)
  if (!health.ok) throw new Error(`Loopback health check returned ${health.status}`)

  const subscription = await fetch(`${verificationBaseUrl}/api/subscribe`, {
    method: 'POST',
    headers: {
      accept: 'text/event-stream',
      'content-type': 'application/json',
      'x-worklog-specter-client': 'worklog-v1',
    },
    body: JSON.stringify({
      envelope: {
        type: 'tasksQuery',
        payload: { status: 'all', topicId: null },
      },
    }),
  })
  if (!subscription.ok || !subscription.body) {
    throw new Error(`Subscription returned ${subscription.status}`)
  }
  subscriptionReader = subscription.body.getReader()
  const firstSubscriptionChunk = await subscriptionReader.read()
  if (firstSubscriptionChunk.done) {
    throw new Error('Subscription completed before graceful shutdown test.')
  }

  const externalAddress = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .find((entry) => entry.family === 'IPv4' && !entry.internal)?.address
  if (externalAddress) {
    try {
      await fetch(`http://${externalAddress}:${verificationPort}/api/health`, {
        signal: AbortSignal.timeout(750),
      })
      throw new Error(`Production server accepted a non-loopback connection at ${externalAddress}`)
    } catch (cause) {
      if (
        cause instanceof Error &&
        cause.message.startsWith('Production server accepted')
      ) {
        throw cause
      }
    }
  }

  const delayedCommand = beginDelayedCommand()
  await delayedCommand.accepted
  child.kill('SIGTERM')
  await waitForOutput('WORKLOG_SHUTDOWN_DRAINING', 2_000)

  const delayedCommandResponse = await delayedCommand.complete()
  if (delayedCommandResponse.status !== 200) {
    throw new Error(
      `In-flight command returned ${delayedCommandResponse.status} during shutdown: ${delayedCommandResponse.body}`,
    )
  }
  const delayedCommandResult = JSON.parse(delayedCommandResponse.body)
  if (delayedCommandResult.duplicate !== false) {
    throw new Error(
      `In-flight command did not complete normally during shutdown: ${delayedCommandResponse.body}`,
    )
  }

  const exit = await waitForExit(6_000)
  if (exit.code !== 0 || exit.signal !== null) {
    throw new Error(
      `Production server did not shut down cleanly with an active subscription and accepted command (${JSON.stringify(exit)}):\n${output}`,
    )
  }
} catch (cause) {
  if (child.exitCode === null) {
    child.kill('SIGKILL')
    await waitForExit(2_000).catch(() => undefined)
  }
  throw cause
} finally {
  await subscriptionReader?.cancel().catch(() => undefined)
  await rm(verificationDirectory, { recursive: true, force: true })
}

function beginDelayedCommand() {
  const commandBody = Buffer.from(
    JSON.stringify({
      envelope: {
        type: 'addTask',
        payload: {
          taskId: 'shutdown-in-flight-task',
          title: 'Finish accepted requests before closing SQLite',
          notes: null,
          dueAt: null,
          createdAt: '2026-07-18T22:00:00.000Z',
        },
      },
      options: { idempotencyKey: 'shutdown-in-flight-command' },
    }),
  )
  const finalByte = commandBody.subarray(commandBody.length - 1)

  let accept
  let rejectAccept
  const accepted = new Promise((resolve, reject) => {
    accept = resolve
    rejectAccept = reject
  })
  let resolveResponse
  let rejectResponse
  const response = new Promise((resolve, reject) => {
    resolveResponse = resolve
    rejectResponse = reject
  })
  void response.catch(() => undefined)

  const request = http.request(
    {
      hostname: '127.0.0.1',
      port: verificationPort,
      path: '/api/command',
      method: 'POST',
      headers: {
        'content-length': commandBody.length,
        'content-type': 'application/json',
        expect: '100-continue',
        'x-worklog-specter-client': 'worklog-v1',
      },
    },
    (incoming) => {
      const chunks = []
      incoming.on('data', (chunk) => chunks.push(chunk))
      incoming.on('end', () => {
        resolveResponse({
          status: incoming.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    },
  )
  request.once('continue', () => {
    request.write(commandBody.subarray(0, commandBody.length - 1))
    accept()
  })
  request.once('error', (cause) => {
    rejectAccept(cause)
    rejectResponse(cause)
  })
  request.flushHeaders()

  return {
    accepted,
    async complete() {
      request.end(finalByte)
      return response
    },
  }
}

function waitForExit(timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.removeListener('exit', exited)
      reject(new Error(`Timed out waiting ${timeoutMs}ms for production shutdown.\n${output}`))
    }, timeoutMs)
    const exited = (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal })
    }
    child.once('exit', exited)
  })
}

async function waitForListener() {
  await waitForOutput(
    `WORKLOG_LISTENING 127.0.0.1:${verificationPort}`,
    15_000,
  )
}

async function waitForOutput(message, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (!output.includes(message)) {
    if (child.exitCode !== null) {
      throw new Error(
        `Production server exited before emitting ${JSON.stringify(message)}:\n${output}`,
      )
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for ${JSON.stringify(message)}:\n${output}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
