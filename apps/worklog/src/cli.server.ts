#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import type {
  SpecterCommandEnvelope,
  SpecterQueryEnvelope,
} from '@specter-ts/core'

import type { WorklogAppConfig } from './features/worklog/registry'
import { createWorklogRuntime } from './worklog-runtime.server'

const HELP = `Usage:
  worklog command [--json '<envelope>'] [--idempotency-key <key>] [--db <path>]
  worklog query   [--json '<envelope>'] [--db <path>]

When --json is omitted, Worklog reads one JSON envelope from stdin.`

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
  const runtime = await createWorklogRuntime(option(args, '--db'))

  try {
    if (mode === 'command') {
      const execution = await runtime.app.command(
        envelope as SpecterCommandEnvelope<WorklogAppConfig>,
        { idempotencyKey: option(args, '--idempotency-key') },
      )
      await execution.reactions
      write({
        ok: true,
        events: execution.events,
        version: execution.version,
        duplicate: execution.duplicate,
      })
      return
    }

    const result = await runtime.app.query(
      envelope as SpecterQueryEnvelope<WorklogAppConfig>,
    )
    write({ ok: true, result })
  } finally {
    runtime.close()
  }
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
