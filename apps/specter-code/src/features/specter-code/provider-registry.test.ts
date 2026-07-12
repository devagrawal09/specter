import { describe, expect, it } from 'vitest'

import { createProviderRegistry } from './adapters/llm-provider'

describe('createProviderRegistry', () => {
  it('merges built-in providers with OpenCode provider config and env auth without leaking secrets', () => {
    const registry = createProviderRegistry({
      config: {
        model: { providerId: 'openrouter', modelId: 'deepseek/deepseek-chat' },
        provider: {
          openrouter: {
            models: {
              'deepseek/deepseek-chat': { name: 'DeepSeek Chat' },
            },
          },
          local: {
            name: 'Local OpenAI-compatible',
            type: 'openai-compatible',
            baseURL: 'http://localhost:11434/v1',
            env: 'LOCAL_LLM_API_KEY',
            models: {
              'qwen2.5-coder': { name: 'Qwen Coder' },
            },
          },
        },
      },
      env: {
        OPENROUTER_API_KEY: 'sk-or-secret',
        LOCAL_LLM_API_KEY: 'local-secret',
        ANTHROPIC_API_KEY: '',
      },
    })

    expect(registry.listProviders()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'openrouter',
          name: 'OpenRouter',
          configured: true,
          apiKeyEnv: 'OPENROUTER_API_KEY',
          models: expect.arrayContaining([
            { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat' },
          ]),
        }),
        expect.objectContaining({
          id: 'anthropic',
          name: 'Anthropic',
          configured: false,
          apiKeyEnv: 'ANTHROPIC_API_KEY',
        }),
        expect.objectContaining({
          id: 'local',
          name: 'Local OpenAI-compatible',
          configured: true,
          type: 'openai-compatible',
          baseUrl: 'http://localhost:11434/v1',
          apiKeyEnv: 'LOCAL_LLM_API_KEY',
          models: [{ id: 'qwen2.5-coder', name: 'Qwen Coder' }],
        }),
      ]),
    )
    expect(JSON.stringify(registry.listProviders())).not.toContain('secret')
  })

  it('resolves the configured default model to a provider/model pair with availability status', () => {
    const registry = createProviderRegistry({
      config: {
        model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
      },
      env: { OPENROUTER_API_KEY: 'sk-or-secret' },
    })

    expect(registry.resolveDefaultModel()).toEqual({
      providerId: 'openrouter',
      providerName: 'OpenRouter',
      modelId: 'anthropic/claude-sonnet-4',
      modelName: 'Claude Sonnet 4',
      configured: true,
    })
  })
})
