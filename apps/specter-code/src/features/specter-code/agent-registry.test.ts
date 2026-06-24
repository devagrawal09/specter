import { describe, expect, it } from 'vitest'

import { createAgentRegistry } from './adapters/agent-registry'

describe('createAgentRegistry', () => {
  it('merges built-in agents with OpenCode agent config and resolves the configured default primary agent', () => {
    const registry = createAgentRegistry({
      config: {
        defaultAgent: 'reviewer',
        agent: {
          reviewer: {
            description: 'Reviews pending code changes',
            mode: 'primary',
            model: 'openai/gpt-5.1',
            prompt: 'Review the diff before coding.',
            tools: {
              read: true,
              grep: true,
              write: false,
            },
            temperature: 0.2,
            maxSteps: 12,
            color: '#8b5cf6',
          },
          researcher: {
            description: 'Searches docs and reports findings',
            mode: 'subagent',
            tools: {
              read: true,
              websearch: true,
            },
          },
          disabled: {
            description: 'Should not be available',
            disable: true,
          },
        },
      },
    })

    expect(registry.listAgents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'build',
          name: 'Build',
          mode: 'primary',
          native: true,
          default: false,
        }),
        expect.objectContaining({
          id: 'reviewer',
          name: 'Reviewer',
          description: 'Reviews pending code changes',
          mode: 'primary',
          default: true,
          model: { providerId: 'openai', modelId: 'gpt-5.1' },
          prompt: 'Review the diff before coding.',
          tools: ['grep', 'read'],
          temperature: 0.2,
          steps: 12,
          color: '#8b5cf6',
        }),
        expect.objectContaining({
          id: 'researcher',
          name: 'Researcher',
          mode: 'subagent',
          tools: ['read', 'websearch'],
          default: false,
        }),
      ]),
    )
    expect(registry.listAgents().map((agent) => agent.id)).not.toContain('disabled')
    expect(registry.resolveDefaultAgent()).toEqual(
      expect.objectContaining({ id: 'reviewer', mode: 'primary', default: true }),
    )
  })

  it('falls back to a primary agent when the configured default is a subagent or missing', () => {
    const registry = createAgentRegistry({
      config: {
        defaultAgent: 'researcher',
        agent: {
          researcher: {
            mode: 'subagent',
            description: 'Not valid as the active primary agent',
          },
        },
      },
    })

    expect(registry.resolveDefaultAgent()).toEqual(
      expect.objectContaining({ id: 'build', mode: 'primary', default: true }),
    )
    expect(registry.listPrimaryAgents().map((agent) => agent.id)).toContain('build')
    expect(registry.listPrimaryAgents().map((agent) => agent.id)).not.toContain('researcher')
  })
})
