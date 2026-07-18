import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const verificationDirectory = await mkdtemp(
  path.join(tmpdir(), 'specter-worklog-verification-'),
)
const databasePath = path.join(verificationDirectory, 'worklog.db')
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

console.log(`Worklog verification database: ${databasePath}`)

const server = spawn(pnpmCommand, ['exec', 'vite', 'dev'], {
  env: { ...process.env, WORKLOG_SQLITE_PATH: databasePath },
  stdio: 'inherit',
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal))
}

let exitCode = 1
try {
  exitCode = await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.once('exit', (code, signal) => {
      if (signal) resolve(1)
      else resolve(code ?? 1)
    })
  })
} finally {
  await rm(verificationDirectory, { recursive: true, force: true })
}

process.exitCode = exitCode
