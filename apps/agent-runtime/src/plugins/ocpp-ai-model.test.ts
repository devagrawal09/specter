import { LLMClient } from '@ocpp/ai/route/client'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  codexBaseURL,
  codexEligible,
  ocppAiModelLayer,
  openAISettings,
} from './ocpp-ai-model.ts'
import { Model } from './model.ts'
import { type OcppCredential, OcppCredentials } from './ocpp-credentials.ts'

const chatgpt: OcppCredential = {
  integrationID: 'openai',
  label: 'chatgpt',
  type: 'oauth',
  access: 'tok',
  expires: Number.MAX_SAFE_INTEGER,
  methodID: 'chatgpt-browser',
  accountID: 'acct_1',
}

describe('codex eligibility (OC++ plugin/provider/openai.ts)', () => {
  it.each([
    ['gpt-5.5', true],
    ['gpt-5.3-codex-spark', true],
    ['gpt-5.4', true],
    ['gpt-5.4-mini', true],
    ['gpt-5.5-pro', false],
    ['gpt-5.6', false],
    ['gpt-5.4-nano', false],
    ['gpt-5.2', false],
    ['gpt-5-mini', false],
    ['gpt-5.7', true],
    ['gpt-4o', false],
    ['o3', false],
  ])('%s -> %s', (id, expected) => {
    expect(codexEligible(id)).toBe(expected)
  })
})

describe('openAISettings', () => {
  it('keeps key credentials on the default endpoint', () => {
    expect(
      openAISettings(
        { integrationID: 'openai', label: 'k', type: 'key', key: 'sk' },
        'ses_1',
      ),
    ).toEqual({ apiKey: 'sk' })
  })
  it('routes chatgpt-browser logins to the codex endpoint with codex headers', () => {
    expect(openAISettings(chatgpt, 'ses_1')).toEqual({
      apiKey: 'tok',
      baseURL: codexBaseURL,
      headers: {
        originator: 'opencode',
        'session-id': 'ses_1',
        'chatgpt-account-id': 'acct_1',
      },
    })
  })
  it('leaves other oauth methods on the default endpoint', () => {
    expect(openAISettings({ ...chatgpt, methodID: 'other' }, 'ses_1')).toEqual({
      apiKey: 'tok',
    })
  })
})

describe('ineligible model with a chatgpt login', () => {
  it('fails non-retryably before any provider call', async () => {
    const layer = ocppAiModelLayer({
      providerID: 'openai',
      modelID: 'gpt-5.6',
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          // Any use of the client would throw: the check precedes the call.
          Layer.succeed(LLMClient.Service, {} as never),
          Layer.succeed(OcppCredentials, {
            load: Effect.die('unused'),
            find: () => Effect.succeed(chatgpt),
          }),
        ),
      ),
    )
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const model = yield* Model
        return yield* model.nextOutcome({
          sessionID: 'ses_1',
          system: '',
          messages: [],
          tools: [],
          onText: () => Effect.void,
        })
      }).pipe(Effect.provide(layer)),
    )
    expect(outcome).toMatchObject({
      finish: 'error',
      retryable: false,
      error: { type: 'provider.ModelNotEligible' },
    })
  })
})
