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
