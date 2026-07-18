#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import type {
  SpecterCommandEnvelope,
  SpecterQueryEnvelope,
} from '@specter-ts/core'

import type { WorklogAppConfig } from './features/worklog/registry'
import { executeWorklogCli } from './worklog-cli.server'

const HELP = `Usage:
  worklog command [--json '<envelope>'] [--idempotency-key <key>] [--url <api-url> | --db <path>]
  worklog query   [--json '<envelope>'] [--url <api-url> | --db <path>]

When --json is omitted, Worklog reads one JSON envelope from stdin.
The CLI uses the running server at http://localhost:41736/api when available.
Pass --db to force direct SQLite access while the server is stopped.`

async function main() {
  const rawArgs = process.argv.slice(2)
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs
  const mode = args[0]
  if (mode === '--help' || mode === 'help' || !mode) {
    process.stdout.write(`${HELP}\n`)
    return
  }
  if (mode !== 'command' && mode !== 'query')
    throw new Error(`Unknown operation: ${mode}`)

  const raw = option(args, '--json') ?? readFileSync(0, 'utf8').trim()
  if (!raw) throw new Error('A JSON envelope is required')
  const envelope = JSON.parse(raw) as unknown
  const shared = { db: option(args, '--db'), url: option(args, '--url') }

  const result =
    mode === 'command'
      ? await executeWorklogCli({
          mode,
          envelope: envelope as SpecterCommandEnvelope<WorklogAppConfig>,
          idempotencyKey: option(args, '--idempotency-key'),
          ...shared,
        })
      : await executeWorklogCli({
          mode,
          envelope: envelope as SpecterQueryEnvelope<WorklogAppConfig>,
          ...shared,
        })
  write({ ok: true, ...result })
}

function option(args: string[], name: string) {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--'))
    throw new Error(`${name} requires a value`)
  return value
}

function write(value: unknown) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

main().catch((cause) => {
  const message = cause instanceof Error ? cause.message : String(cause)
  write({ ok: false, error: { code: 'WORKLOG_CLI_ERROR', message } })
  process.exitCode = 1
})
