import { createClient } from '@libsql/client/sqlite3'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
    expect(result.stdout).toContain('specter-code          Start the interactive TUI')
    expect(result.stdout).toContain('run [message]')
    expect(result.stdout).toContain('serve')
    expect(result.stdout).toContain('session list')
    expect(result.stdout).toContain('import <file>')
    expect(result.stdout).toContain('export --session <id> --output <file>')
    expect(result.stdout).toContain('auth login')
    expect(result.stdout).toContain('auth list')
    expect(result.stdout).toContain('providers')
    expect(result.stdout).toContain('models')
    expect(result.stdout).toContain('stats')
    expect(result.stdout).toContain('db path')
    expect(result.stdout).toContain('mcp list')
    expect(result.stdout).toContain('debug info')
    expect(result.stderr).toBe('')
  })

  it('prints OpenCode-compatible debug info and paths without leaking secrets', async () => {
    const dbPath = join(tempDir, 'debug.db')
    const cli = buildSpecterCodeCli({
      cwd: tempDir,
      env: {
        ...createConfiguredCliEnv(),
        SPECTER_CODE_DB_PATH: dbPath,
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          plugin: ['@acme/debug-plugin'],
          provider: {
            localai: {
              name: 'Local AI',
              env: 'LOCALAI_TOKEN',
              models: { 'qwen-code': { name: 'Qwen Code' } },
            },
          },
        }),
      },
    })

    await expect(cli.run(['debug', '--help'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'Usage: specter-code debug info\n       specter-code debug paths\n',
      stderr: '',
    })

    const info = await cli.run(['debug', 'info'])

    expect(info.exitCode).toBe(0)
    expect(info.stderr).toBe('')
    expect(info.stdout).toContain('Specter Code debug info')
    expect(info.stdout).toContain(`cwd: ${tempDir}`)
    expect(info.stdout).toContain(`database: ${dbPath}`)
    expect(info.stdout).toContain(`node: ${process.version}`)
    expect(info.stdout).toContain('config sources: OPENCODE_CONFIG_CONTENT')
    expect(info.stdout).toContain('plugins: @acme/debug-plugin')
    expect(info.stdout).toContain('providers: localai(configured)')
    expect(info.stdout).not.toContain('super-secret-token')

    const paths = await cli.run(['debug', 'paths'])

    expect(paths.exitCode).toBe(0)
    expect(paths.stderr).toBe('')
    expect(paths.stdout).toContain(`cwd\t${tempDir}`)
    expect(paths.stdout).toContain(`database\t${dbPath}`)
    expect(paths.stdout).toContain(`project config\t${join(tempDir, '.opencode', 'opencode.jsonc')}`)
  })

  it('prints help for OpenCode-compatible database commands without opening SQLite', async () => {
    const cli = buildSpecterCodeCli({ cwd: '/tmp/project', env: {} })

    await expect(cli.run(['db', '--help'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'Usage: specter-code db path\n       specter-code db query <sql> [--format json|tsv]\n',
      stderr: '',
    })
    await expect(cli.run(['db', 'path', '--help'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'Usage: specter-code db path\n',
      stderr: '',
    })
    await expect(cli.run(['db', 'query', '--help'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'Usage: specter-code db query <sql> [--format json|tsv]\n',
      stderr: '',
    })
  })

  it('prints the configured database path and runs readonly SQL queries', async () => {
    const dbPath = join(tempDir, 'cli-query.db')
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
              'session-query',
              'workspace-query',
              'Query me',
              '/tmp/project',
              'build',
              'localai',
              'qwen-code',
              'active',
              '2026-06-25T10:00:00.000Z',
              '2026-06-25T10:05:00.000Z',
            ],
          },
        ],
        'write',
      )
    } finally {
      db.close()
    }

    const cli = buildSpecterCodeCli({ cwd: '/tmp/project', env: { SPECTER_CODE_DB_PATH: dbPath } })

    await expect(cli.run(['db', 'path'])).resolves.toEqual({
      exitCode: 0,
      stdout: `${dbPath}\n`,
      stderr: '',
    })
    await expect(
      cli.run(['db', 'query', 'SELECT id, title FROM specter_code_sessions ORDER BY id']),
    ).resolves.toEqual({
      exitCode: 0,
      stdout: 'id\ttitle\nsession-query\tQuery me\n',
      stderr: '',
    })
    await expect(
      cli.run([
        'db',
        'query',
        'SELECT id, title FROM specter_code_sessions ORDER BY id',
        '--format',
        'json',
      ]),
    ).resolves.toEqual({
      exitCode: 0,
      stdout: '[\n  {\n    "id": "session-query",\n    "title": "Query me"\n  }\n]\n',
      stderr: '',
    })
    await expect(
      cli.run(['db', 'query', 'DELETE FROM specter_code_sessions']),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining('Only readonly SELECT queries are supported'),
    })
    await expect(
      cli.run(['db', 'query', 'WITH stale AS (SELECT 1) DELETE FROM specter_code_sessions']),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining('Only readonly SELECT queries are supported'),
    })
  })

  it('prints session help for the session command and its read-only subcommands', async () => {
    const cli = buildSpecterCodeCli({ cwd: '/tmp/project', env: {} })

    await expect(cli.run(['session', '--help'])).resolves.toEqual({
      exitCode: 0,
      stdout: expect.stringContaining('Usage: specter-code session list'),
      stderr: '',
    })
    await expect(cli.run(['session', 'list', '--help'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'Usage: specter-code session list\n',
      stderr: '',
    })
    await expect(cli.run(['session', 'show', '--help'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'Usage: specter-code session show <id>\n',
      stderr: '',
    })
  })

  it('prints help for catalog-style CLI commands without loading catalog adapters', async () => {
    const cli = buildSpecterCodeCli({ cwd: '/tmp/project', env: {} })

    await expect(cli.run(['providers', '--help'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'Usage: specter-code providers\n',
      stderr: '',
    })
    await expect(cli.run(['provider', '--help'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'Usage: specter-code provider\n',
      stderr: '',
    })
    await expect(cli.run(['models', '--help'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'Usage: specter-code models\n',
      stderr: '',
    })
    await expect(cli.run(['model', '--help'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'Usage: specter-code model\n',
      stderr: '',
    })
    await expect(cli.run(['agents', '--help'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'Usage: specter-code agents\n',
      stderr: '',
    })
    await expect(cli.run(['agent', '--help'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'Usage: specter-code agent\n',
      stderr: '',
    })
    await expect(cli.run(['mcp', 'list', '--help'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'Usage: specter-code mcp list\n',
      stderr: '',
    })
    await expect(cli.run(['plugin', '--help'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'Usage: specter-code plugin <module> [--global] [--force]\n',
      stderr: '',
    })
    await expect(cli.run(['plug', '--help'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'Usage: specter-code plugin <module> [--global] [--force]\n',
      stderr: '',
    })
  })

  it('prints help for OpenCode-compatible auth commands without touching credentials', async () => {
    const cli = buildSpecterCodeCli({ cwd: '/tmp/project', env: {} })

    await expect(cli.run(['auth', '--help'])).resolves.toEqual({
      exitCode: 0,
      stdout:
        'Usage: specter-code auth login --provider <id> --key <api-key> [--description <label>]\n       specter-code auth list\n       specter-code auth logout <provider>\n',
      stderr: '',
    })
    await expect(cli.run(['auth', 'login', '--help'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'Usage: specter-code auth login --provider <id> --key <api-key> [--description <label>]\n',
      stderr: '',
    })
    await expect(cli.run(['auth', 'list', '--help'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'Usage: specter-code auth list\n',
      stderr: '',
    })
    await expect(cli.run(['auth', 'logout', '--help'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'Usage: specter-code auth logout <provider>\n',
      stderr: '',
    })
  })

  it('stores, lists, and removes OpenCode-compatible provider API credentials', async () => {
    const authPath = join(tempDir, 'auth-v2.json')
    const cli = buildSpecterCodeCli({ cwd: tempDir, env: { SPECTER_CODE_AUTH_PATH: authPath } })

    await expect(cli.run(['auth', 'list'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'No authenticated providers\n',
      stderr: '',
    })

    const login = await cli.run([
      'auth',
      'login',
      '--provider',
      'openrouter',
      '--key',
      'sk-or-secret-value',
      '--description',
      'OpenRouter CI key',
    ])

    expect(login).toEqual({
      exitCode: 0,
      stdout: 'Authenticated openrouter as OpenRouter CI key\n',
      stderr: '',
    })
    const stored = JSON.parse(readFileSync(authPath, 'utf8'))
    expect(stored).toMatchObject({
      version: 2,
      active: { openrouter: 'openrouter-default' },
      accounts: {
        'openrouter-default': {
          id: 'openrouter-default',
          serviceID: 'openrouter',
          description: 'OpenRouter CI key',
          credential: { type: 'api', key: 'sk-or-secret-value' },
        },
      },
    })

    const listed = await cli.run(['auth', 'list'])

    expect(listed.exitCode).toBe(0)
    expect(listed.stderr).toBe('')
    expect(listed.stdout).toContain('openrouter\tOpenRouter CI key\tapi\tactive')
    expect(listed.stdout).not.toContain('sk-or-secret-value')

    await expect(cli.run(['auth', 'logout', 'openrouter'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'Logged out openrouter\n',
      stderr: '',
    })
    await expect(cli.run(['auth', 'list'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'No authenticated providers\n',
      stderr: '',
    })
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

  it('renders persisted session details and transcript from the configured CLI database', async () => {
    const dbPath = join(tempDir, 'session-show.db')
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
              INSERT INTO specter_code_messages (
                id,
                session_id,
                role,
                author_json,
                content,
                created_at,
                event_order
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
              'message-user',
              'session-main',
              'user',
              JSON.stringify({ displayName: 'Dev' }),
              'Please fix the failing tests',
              '2026-06-25T10:01:00.000Z',
              1,
            ],
          },
          {
            sql: `
              INSERT INTO specter_code_messages (
                id,
                session_id,
                role,
                author_json,
                content,
                created_at,
                event_order
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
              'message-assistant',
              'session-main',
              'assistant',
              JSON.stringify({ displayName: 'Build Agent' }),
              'Done — tests pass.',
              '2026-06-25T10:02:00.000Z',
              2,
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

    const result = await cli.run(['session', 'show', 'session-main'])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Session: session-main')
    expect(result.stdout).toContain('Title: Fix tests')
    expect(result.stdout).toContain('Directory: /tmp/project')
    expect(result.stdout).toContain('Agent: build')
    expect(result.stdout).toContain('Model: localai/qwen-code')
    expect(result.stdout).toContain('Status: active')
    expect(result.stdout).toContain('Transcript:')
    expect(result.stdout).toContain('user: Please fix the failing tests')
    expect(result.stdout).toContain('assistant: Done — tests pass.')
  })

  it('creates a persisted session through the Specter command pipeline', async () => {
    const dbPath = join(tempDir, 'session-new.db')
    const cli = buildSpecterCodeCli({
      cwd: '/tmp/project',
      env: { ...createConfiguredCliEnv(), SPECTER_CODE_DB_PATH: dbPath },
    })

    const result = await cli.run([
      'session',
      'new',
      '--id',
      'session-cli-new',
      '--workspace',
      'workspace-cli',
      '--title',
      'Fix from CLI',
      '--directory',
      '/tmp/project',
      '--agent',
      'build',
      '--model',
      'localai/qwen-code',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('Created session session-cli-new\tFix from CLI\tbuild\tlocalai/qwen-code\t/tmp/project\n')

    const db = createClient({ url: `file:${dbPath}` })
    try {
      const sessionRows = await db.execute({
        sql: `
          SELECT id, workspace_id, title, directory, agent_id, provider_id, model_id, status
          FROM specter_code_sessions
          WHERE id = ?
        `,
        args: ['session-cli-new'],
      })
      expect(sessionRows.rows).toEqual([
        expect.objectContaining({
          id: 'session-cli-new',
          workspace_id: 'workspace-cli',
          title: 'Fix from CLI',
          directory: '/tmp/project',
          agent_id: 'build',
          provider_id: 'localai',
          model_id: 'qwen-code',
          status: 'active',
        }),
      ])

      const eventRows = await db.execute({
        sql: 'SELECT type, payload FROM specter_events ORDER BY event_order ASC',
        args: [],
      })
      expect(eventRows.rows.map((row) => row.type)).toEqual(['sessionCreated'])
      expect(JSON.parse(String(eventRows.rows[0]?.payload))).toMatchObject({
        sessionId: 'session-cli-new',
        workspaceId: 'workspace-cli',
        title: 'Fix from CLI',
      })
    } finally {
      db.close()
    }
  })

  it('renames a persisted session through the CLI event log', async () => {
    const dbPath = join(tempDir, 'session-rename.db')
    const cli = buildSpecterCodeCli({
      cwd: '/tmp/project',
      env: { ...createConfiguredCliEnv(), SPECTER_CODE_DB_PATH: dbPath },
    })

    await expect(
      cli.run([
        'session',
        'new',
        '--id',
        'session-cli-rename',
        '--title',
        'Before rename',
        '--directory',
        '/tmp/project',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })

    const result = await cli.run(['session', 'rename', 'session-cli-rename', 'After rename'])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('Renamed session session-cli-rename\tAfter rename\n')

    const db = createClient({ url: `file:${dbPath}` })
    try {
      const sessionRows = await db.execute({
        sql: 'SELECT id, title FROM specter_code_sessions WHERE id = ?',
        args: ['session-cli-rename'],
      })
      expect(sessionRows.rows).toEqual([
        expect.objectContaining({ id: 'session-cli-rename', title: 'After rename' }),
      ])

      const eventRows = await db.execute({
        sql: 'SELECT type, payload FROM specter_events ORDER BY event_order ASC',
        args: [],
      })
      expect(eventRows.rows.map((row) => row.type)).toEqual(['sessionCreated', 'sessionUpdated'])
      expect(JSON.parse(String(eventRows.rows[1]?.payload))).toMatchObject({
        sessionId: 'session-cli-rename',
        title: 'After rename',
        updatedBy: { displayName: 'Specter Code CLI' },
      })
    } finally {
      db.close()
    }
  })

  it('deletes a persisted session through the CLI event log', async () => {
    const dbPath = join(tempDir, 'session-delete.db')
    const cli = buildSpecterCodeCli({
      cwd: '/tmp/project',
      env: { ...createConfiguredCliEnv(), SPECTER_CODE_DB_PATH: dbPath },
    })

    await expect(
      cli.run([
        'session',
        'new',
        '--id',
        'session-cli-delete',
        '--title',
        'Delete me',
        '--directory',
        '/tmp/project',
      ]),
    ).resolves.toMatchObject({ exitCode: 0 })

    const result = await cli.run(['session', 'delete', 'session-cli-delete'])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('Deleted session session-cli-delete\n')

    const listResult = await cli.run(['session', 'list'])
    expect(listResult.exitCode).toBe(0)
    expect(listResult.stdout).not.toContain('session-cli-delete')

    const db = createClient({ url: `file:${dbPath}` })
    try {
      const sessionRows = await db.execute({
        sql: 'SELECT id, status FROM specter_code_sessions WHERE id = ?',
        args: ['session-cli-delete'],
      })
      expect(sessionRows.rows).toEqual([
        expect.objectContaining({ id: 'session-cli-delete', status: 'deleted' }),
      ])

      const eventRows = await db.execute({
        sql: 'SELECT type, payload FROM specter_events ORDER BY event_order ASC',
        args: [],
      })
      expect(eventRows.rows.map((row) => row.type)).toEqual(['sessionCreated', 'sessionDeleted'])
      expect(JSON.parse(String(eventRows.rows[1]?.payload))).toMatchObject({
        sessionId: 'session-cli-delete',
        deletedBy: { displayName: 'Specter Code CLI' },
      })
    } finally {
      db.close()
    }
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

  it('renders persisted usage statistics from the configured CLI database', async () => {
    const dbPath = join(tempDir, 'stats.db')
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
              'session-active',
              'workspace-main',
              'Active session',
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
              '2026-06-25T09:05:00.000Z',
            ],
          },
          {
            sql: `
              INSERT INTO specter_code_messages (
                id,
                session_id,
                role,
                author_json,
                content,
                created_at,
                event_order
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
              'message-user',
              'session-active',
              'user',
              JSON.stringify({ displayName: 'Dev' }),
              'Please inspect the repo',
              '2026-06-25T10:01:00.000Z',
              1,
            ],
          },
          {
            sql: `
              INSERT INTO specter_code_messages (
                id,
                session_id,
                role,
                author_json,
                content,
                created_at,
                event_order
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
              'message-assistant',
              'session-active',
              'assistant',
              JSON.stringify({ displayName: 'Build Agent' }),
              'I found one issue.',
              '2026-06-25T10:02:00.000Z',
              2,
            ],
          },
          {
            sql: `
              INSERT INTO specter_code_tool_calls (
                id,
                session_id,
                message_id,
                tool_name,
                status,
                input_json,
                output_json,
                error,
                started_at,
                completed_at,
                event_order
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
              'tool-read-1',
              'session-active',
              'message-assistant',
              'read',
              'completed',
              JSON.stringify({ path: 'src/app.ts' }),
              JSON.stringify({ preview: 'content preview' }),
              null,
              '2026-06-25T10:02:10.000Z',
              '2026-06-25T10:02:11.000Z',
              3,
            ],
          },
          {
            sql: `
              INSERT INTO specter_code_permissions (
                request_id,
                session_id,
                message_id,
                tool_call_id,
                tool_name,
                permission,
                target,
                action,
                status,
                reason,
                requested_at,
                replied_at,
                replied_by_json
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
              'permission-1',
              'session-active',
              'message-assistant',
              'tool-read-1',
              'read',
              'file.read',
              'src/app.ts',
              'ask',
              'pending',
              'Inspect file',
              '2026-06-25T10:02:09.000Z',
              null,
              null,
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

    const result = await cli.run(['stats'])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Specter Code stats')
    expect(result.stdout).toContain('Database: ' + dbPath)
    expect(result.stdout).toContain('Sessions: 1 active / 2 total')
    expect(result.stdout).toContain('Messages: 2')
    expect(result.stdout).toContain('Tool calls: 1')
    expect(result.stdout).toContain('Pending approvals: 1')
    expect(result.stdout).toContain('Top tools: read=1')
    expect(result.stdout).toContain('Top models: localai/qwen-code=1')
  })

  it('serves the web app through the package dev command with OpenCode-style host and port flags', async () => {
    const processCalls: unknown[] = []
    const cli = buildSpecterCodeCli({
      cwd: tempDir,
      env: { SPECTER_CODE_DB_PATH: join(tempDir, 'serve.db') },
      runProcess: async (input) => {
        processCalls.push(input)
        return {
          exitCode: 0,
          stdout: 'VITE ready at http://127.0.0.1:41999\n',
          stderr: '',
        }
      },
    })

    const result = await cli.run(['serve', '--host', '127.0.0.1', '--port', '41999'])

    expect(result).toEqual({
      exitCode: 0,
      stdout: 'VITE ready at http://127.0.0.1:41999\n',
      stderr: '',
    })
    expect(processCalls).toEqual([
      {
        command: 'pnpm',
        args: [
          '--filter',
          '@specter/specter-code',
          'dev',
          '--host',
          '127.0.0.1',
          '--port',
          '41999',
        ],
        cwd: tempDir,
        env: { SPECTER_CODE_DB_PATH: join(tempDir, 'serve.db') },
      },
    ])
  })

  it('can render serve help from the Node CLI entrypoint without loading run-only adapters', () => {
    const stdout = execFileSync(
      process.execPath,
      ['--experimental-strip-types', 'src/features/specter-code/cli/index.ts', '--', 'serve', '--help'],
      { cwd: process.cwd(), encoding: 'utf8' },
    )

    expect(stdout).toBe('Usage: specter-code serve [--host <host>] [--port <port>]\n')
  })

  it('creates a session through the Node CLI entrypoint', async () => {
    const dbPath = join(tempDir, 'session-new-entrypoint.db')
    const stdout = execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        'src/features/specter-code/cli/index.ts',
        '--',
        'session',
        'new',
        '--id',
        'session-entrypoint',
        '--workspace',
        'workspace-entrypoint',
        '--title',
        'Entry point session',
        '--directory',
        '/tmp/project',
        '--agent',
        'build',
        '--model',
        'localai/qwen-code',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, ...createConfiguredCliEnv(), SPECTER_CODE_DB_PATH: dbPath },
      },
    )

    expect(stdout).toBe('Created session session-entrypoint\tEntry point session\tbuild\tlocalai/qwen-code\t/tmp/project\n')

    const db = createClient({ url: `file:${dbPath}` })
    try {
      const result = await db.execute({
        sql: 'SELECT id, title FROM specter_code_sessions WHERE id = ?',
        args: ['session-entrypoint'],
      })
      expect(result.rows).toEqual([
        expect.objectContaining({ id: 'session-entrypoint', title: 'Entry point session' }),
      ])
    } finally {
      db.close()
    }
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

  it('lists MCP servers from OpenCode config without starting them', async () => {
    const cli = buildSpecterCodeCli({
      cwd: '/tmp/project',
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          mcp: {
            docs: { type: 'local', command: ['node', 'server.js'] },
            remoteDocs: { type: 'remote', url: 'https://mcp.example.test/sse' },
            disabled: { type: 'local', command: ['python', 'server.py'], enabled: false },
          },
        }),
      },
    })

    const result = await cli.run(['mcp', 'list'])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('docs\tlocal\tenabled\tnode server.js')
    expect(result.stdout).toContain('remoteDocs\tremote\tenabled\thttps://mcp.example.test/sse')
    expect(result.stdout).toContain('disabled\tlocal\tdisabled\tpython server.py')
  })

  it('registers plugin modules in project OpenCode config through plugin and plug aliases', async () => {
    const cli = buildSpecterCodeCli({ cwd: tempDir, env: {} })

    const result = await cli.run(['plugin', '@acme/opencode-plugin'])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe(`Registered plugin @acme/opencode-plugin in ${join(tempDir, '.opencode', 'opencode.jsonc')}\n`)

    const aliasResult = await cli.run(['plug', './plugins/local-plugin.ts'])

    expect(aliasResult.exitCode).toBe(0)
    expect(aliasResult.stderr).toBe('')
    expect(aliasResult.stdout).toBe(`Registered plugin ./plugins/local-plugin.ts in ${join(tempDir, '.opencode', 'opencode.jsonc')}\n`)
    expect(JSON.parse(readFileSync(join(tempDir, '.opencode', 'opencode.jsonc'), 'utf8'))).toMatchObject({
      plugin: ['@acme/opencode-plugin', './plugins/local-plugin.ts'],
    })
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

  it('runs a non-interactive prompt through the Node CLI entrypoint', () => {
    const stdout = execFileSync(
      process.execPath,
      ['--experimental-strip-types', 'src/features/specter-code/cli/index.ts', '--', 'run', '--format', 'json', 'say', 'hi'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, ...createConfiguredCliEnv() },
      },
    )

    const events = stdout
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
    expect(events[2]).toMatchObject({ agentId: 'build', model: 'localai/qwen-code' })
    expect(stdout).not.toContain('super-secret-token')
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

  it('renders the interactive TUI for an explicit prompt without requiring demo mode', async () => {
    const cli = buildSpecterCodeCli({
      cwd: '/tmp/project',
      env: createConfiguredCliEnv(),
    })

    const result = await cli.run(['run', '--interactive', 'inspect', 'the', 'repo'])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).not.toContain('Interactive TUI smoke mode currently requires --demo')
    expect(result.stdout).toContain('Specter Code TUI')
    expect(result.stdout).toContain('Session transcript')
    expect(result.stdout).toContain('You: inspect the repo')
    expect(result.stdout).toContain('Assistant: I found the issue.')
    expect(result.stdout).toContain('Tool timeline')
    expect(result.stdout).toContain('Prompt: inspect the repo')
  })

  it('launches the OpenCode-style TUI smoke screen when no command is provided', async () => {
    const cli = buildSpecterCodeCli({
      cwd: '/tmp/project',
      env: createConfiguredCliEnv(),
    })

    const result = await cli.run([])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).not.toContain('Usage: specter-code [command]')
    expect(result.stdout).toContain('Specter Code TUI')
    expect(result.stdout).toContain('You: Review this project')
    expect(result.stdout).toContain('Prompt: Review this project')
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
