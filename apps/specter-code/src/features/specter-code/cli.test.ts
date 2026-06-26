import { createClient } from '@libsql/client/sqlite3'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { prepareSpecterSqlite } from '../../db/specter-sqlite'
import { buildSpecterCodeCli } from './cli/index'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'specterCode-cli-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('Specter Code CLI', () => {
  it('prints OpenCode-compatible top-level help', async () => {
    const cli = buildSpecterCodeCli({ cwd: '/tmp/project', env: {} })

    const result = await cli.run(['--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage: specter-code [command]')
    expect(result.stdout).toContain('run [message]')
    expect(result.stdout).toContain('serve')
    expect(result.stdout).toContain('session list')
    expect(result.stdout).toContain('import <file>')
    expect(result.stdout).toContain('export --session <id> --output <file>')
    expect(result.stdout).toContain('providers')
    expect(result.stdout).toContain('models')
    expect(result.stderr).toBe('')
  })

  it('lists persisted active sessions from the configured CLI database', async () => {
    const dbPath = join(tempDir, 'sessions.db')
    const db = createClient({ url: `file:${dbPath}` })

    try {
      await prepareSpecterSqlite(db)
      await db.batch(
        [
          {
            sql: `
              INSERT INTO specter_code_sessions (
                id,
                workspace_id,
                title,
                directory,
                agent_id,
                provider_id,
                model_id,
                status,
                created_at,
                updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
              'session-main',
              'workspace-main',
              'Fix tests',
              '/tmp/project',
              'build',
              'localai',
              'qwen-code',
              'active',
              '2026-06-25T10:00:00.000Z',
              '2026-06-25T10:05:00.000Z',
            ],
          },
          {
            sql: `
              INSERT INTO specter_code_sessions (
                id,
                workspace_id,
                title,
                directory,
                agent_id,
                provider_id,
                model_id,
                status,
                created_at,
                updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
              'session-deleted',
              'workspace-main',
              'Deleted session',
              '/tmp/project',
              'build',
              'localai',
              'qwen-code',
              'deleted',
              '2026-06-25T09:00:00.000Z',
              '2026-06-25T10:10:00.000Z',
            ],
          },
        ],
        'write',
      )
    } finally {
      db.close()
    }

    const cli = buildSpecterCodeCli({
      cwd: '/tmp/project',
      env: { SPECTER_CODE_DB_PATH: dbPath },
    })

    const result = await cli.run(['session', 'list'])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('session-main\tFix tests\tbuild\tlocalai/qwen-code\t/tmp/project')
    expect(result.stdout).not.toContain('session-deleted')
    expect(result.stdout).not.toContain('No persisted session CLI adapter is configured yet')
  })

  it('validates import and export session command arguments before touching persistence', async () => {
    const cli = buildSpecterCodeCli({ cwd: '/tmp/project', env: {} })

    await expect(cli.run(['export', '--session', 'session-main'])).resolves.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining('Usage: specter-code export --session <id> --output <file>'),
    })
    await expect(cli.run(['import'])).resolves.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining('Usage: specter-code import <file>'),
    })
  })

  it('ignores a package-manager argument separator before the real command', async () => {
    const cli = buildSpecterCodeCli({ cwd: '/tmp/project', env: {} })

    await expect(cli.run(['--', 'import'])).resolves.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining('Usage: specter-code import <file>'),
    })
  })

  it('lists providers from OpenCode config and redacts secret values', async () => {
    const cli = buildSpecterCodeCli({
      cwd: '/tmp/project',
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          provider: {
            localai: {
              name: 'Local AI',
              type: 'openai-compatible',
              baseURL: 'http://127.0.0.1:11434/v1',
              env: 'LOCALAI_TOKEN',
              models: {
                'qwen-code': { name: 'Qwen Code' },
              },
            },
          },
        }),
        LOCALAI_TOKEN: 'super-secret-token',
      },
    })

    const result = await cli.run(['providers'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('localai')
    expect(result.stdout).toContain('Local AI')
    expect(result.stdout).toContain('configured')
    expect(result.stdout).toContain('LOCALAI_TOKEN')
    expect(result.stdout).not.toContain('super-secret-token')
  })

  it('lists models and marks the configured default model', async () => {
    const cli = buildSpecterCodeCli({
      cwd: '/tmp/project',
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          model: 'localai/qwen-code',
          provider: {
            localai: {
              name: 'Local AI',
              env: 'LOCALAI_TOKEN',
              models: {
                'qwen-code': { name: 'Qwen Code' },
              },
            },
          },
        }),
      },
    })

    const result = await cli.run(['models'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('* localai/qwen-code')
    expect(result.stdout).toContain('Qwen Code')
  })

  it('runs a non-interactive prompt as JSON events with the mocked local runner', async () => {
    const cli = buildSpecterCodeCli({
      cwd: '/tmp/project',
      env: createConfiguredCliEnv(),
    })

    const result = await cli.run(['run', '--format', 'json', 'say', 'hi'])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).not.toContain('super-secret-token')

    const events = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; [key: string]: unknown })

    expect(events.map((event) => event.type)).toEqual([
      'session.created',
      'message.created',
      'run.started',
      'tool.started',
      'tool.completed',
      'assistant.delta',
      'assistant.delta',
      'assistant.message',
      'run.completed',
    ])
    expect(events[0]).toMatchObject({
      type: 'session.created',
      title: 'say hi',
      directory: '/tmp/project',
    })
    expect(events[1]).toMatchObject({
      type: 'message.created',
      role: 'user',
      content: 'say hi',
    })
    expect(events[2]).toMatchObject({
      type: 'run.started',
      agentId: 'build',
      model: 'localai/qwen-code',
    })
    expect(events[5]).toMatchObject({ type: 'assistant.delta', delta: 'I found ' })
    expect(events[7]).toMatchObject({
      type: 'assistant.message',
      role: 'assistant',
      content: 'I found the issue.',
    })
  })

  it('executes grep prompts through the real built-in tool registry', async () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true })
    writeFileSync(join(tempDir, 'src', 'app.ts'), 'export const needle = true\n')
    writeFileSync(join(tempDir, 'README.md'), 'nothing to see here\n')
    const cli = buildSpecterCodeCli({
      cwd: tempDir,
      env: createConfiguredCliEnv(),
    })

    const result = await cli.run(['run', '--format', 'json', 'grep', 'needle'])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const events = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; [key: string]: unknown })
    expect(events[3]).toMatchObject({
      type: 'tool.started',
      toolName: 'grep',
      inputSummary: 'grep needle in **/*',
    })
    expect(events[4]).toMatchObject({
      type: 'tool.completed',
      toolName: 'grep',
      outputSummary: 'src/app.ts:1: export const needle = true',
    })
    expect(events[7]).toMatchObject({
      type: 'assistant.message',
      role: 'assistant',
      content: 'Found 1 match for "needle".\nsrc/app.ts:1: export const needle = true',
    })
    expect(result.stdout).not.toContain('Mocked')
  })

  it('renders an interactive demo TUI transcript with prompt and approval controls', async () => {
    const cli = buildSpecterCodeCli({
      cwd: '/tmp/project',
      env: createConfiguredCliEnv(),
    })

    const result = await cli.run(['run', '--interactive', '--demo', 'say', 'hi'])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).not.toContain('super-secret-token')
    expect(result.stdout).toContain('Specter Code TUI')
    expect(result.stdout).toContain('Session transcript')
    expect(result.stdout).toContain('You: say hi')
    expect(result.stdout).toContain('Assistant: I found the issue.')
    expect(result.stdout).toContain('Approval required')
    expect(result.stdout).toContain('Approve [a]  Reject [r]')
    expect(result.stdout).toContain('Prompt: say hi')
  })
})

function createConfiguredCliEnv() {
  return {
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      model: 'localai/qwen-code',
      provider: {
        localai: {
          name: 'Local AI',
          env: 'LOCALAI_TOKEN',
          models: {
            'qwen-code': { name: 'Qwen Code' },
          },
        },
      },
    }),
    LOCALAI_TOKEN: 'super-secret-token',
    SPECTER_CODE_SIMULATED_AGENT_MODE: 'test',
  }
}
