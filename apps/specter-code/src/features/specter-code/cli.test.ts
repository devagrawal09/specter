import { describe, expect, it } from 'vitest'

import { buildSpecterCodeCli } from './cli/index'

describe('Specter Code CLI', () => {
  it('prints OpenCode-compatible top-level help', async () => {
    const cli = buildSpecterCodeCli({ cwd: '/tmp/project', env: {} })

    const result = await cli.run(['--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage: specter-code [command]')
    expect(result.stdout).toContain('run [message]')
    expect(result.stdout).toContain('serve')
    expect(result.stdout).toContain('session list')
    expect(result.stdout).toContain('providers')
    expect(result.stdout).toContain('models')
    expect(result.stderr).toBe('')
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
})
