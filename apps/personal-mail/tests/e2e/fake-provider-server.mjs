import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createClient } from '@libsql/client/sqlite3'

const directory = mkdtempSync(join(tmpdir(), 'personal-mail-e2e-'))
const databasePath = join(directory, 'personal-mail.db')
const environment = {
  ...process.env,
  NODE_ENV: 'development',
  SPECTER_MAIL_SQLITE_PATH: databasePath,
  SPECTER_MAIL_ACCESS_MODE: 'local',
  SPECTER_MAIL_TEST_PROVIDERS: '1',
  GMAIL_API_BASE_URL: 'http://127.0.0.1:41740/gmail/v1',
  AI_LOCAL_BASE_URL: 'http://127.0.0.1:41740/ai/v1',
  AI_LOCAL_MODEL: 'fake-local-model',
}

run('pnpm', ['spec:build'], environment)
run('pnpm', ['db:migrate'], environment)

const client = createClient({ url: `file:${databasePath}` })
await client.execute({
  sql: `INSERT INTO gmail_credentials (
    account, access_token, refresh_token, expires_at, email
  ) VALUES (?, ?, ?, ?, ?)`,
  args: [
    'me',
    'e2e-access-token',
    'e2e-refresh-token',
    Date.now() + 3_600_000,
    'owner@example.com',
  ],
})
client.close()

let labels = ['INBOX', 'UNREAD']
let historyId = '101'
const provider = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1:41740')
  if (url.pathname === '/gmail/v1/users/me/profile') {
    return json(response, {
      emailAddress: 'owner@example.com',
      historyId,
    })
  }
  if (url.pathname === '/gmail/v1/users/me/threads') {
    return json(response, { threads: [{ id: 'thread-1' }] })
  }
  if (
    url.pathname === '/gmail/v1/users/me/threads/thread-1' &&
    request.method === 'GET'
  ) {
    return json(response, gmailThread())
  }
  if (
    url.pathname === '/gmail/v1/users/me/threads/thread-1/modify' &&
    request.method === 'POST'
  ) {
    const body = JSON.parse(await readBody(request))
    labels = labels.filter(
      (label) => !(body.removeLabelIds ?? []).includes(label),
    )
    for (const label of body.addLabelIds ?? []) {
      if (!labels.includes(label)) labels.push(label)
    }
    historyId = String(Number(historyId) + 1)
    return json(response, gmailThread())
  }
  if (
    url.pathname === '/ai/v1/chat/completions' &&
    request.method === 'POST'
  ) {
    return json(response, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: 'Fake provider marked this message for review.',
              priority: 'high',
              suggestedAction: 'reply',
            }),
          },
        },
      ],
    })
  }
  response.writeHead(404)
  response.end()
})
await new Promise((resolve) =>
  provider.listen(41740, '127.0.0.1', resolve),
)

const application = spawn('pnpm', ['exec', 'vite', 'dev'], {
  cwd: process.cwd(),
  env: environment,
  stdio: 'inherit',
})

let closing = false
async function close() {
  if (closing) return
  closing = true
  application.kill('SIGTERM')
  provider.close()
  rmSync(directory, { recursive: true, force: true })
}

process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())
application.once('exit', (code) => {
  void close().finally(() => process.exit(code ?? 0))
})

function gmailThread() {
  return {
    id: 'thread-1',
    historyId,
    messages: [
      {
        id: 'message-1',
        threadId: 'thread-1',
        historyId,
        internalDate: '1784998800000',
        labelIds: labels,
        snippet: 'Please review the fake provider build.',
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'From', value: 'Ada <ada@example.com>' },
            { name: 'Subject', value: 'Provider integration review' },
          ],
          body: {
            data: Buffer.from(
              'Please review the fake provider build.',
            ).toString('base64url'),
          },
        },
      },
    ],
  }
}

function json(response, value) {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`)
  }
}
