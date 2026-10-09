import { LLMClient } from '@ocpp/ai/route/client'
import { httpFailure } from '@ocpp/ai/route/executor'
import { Effect, Layer, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  codexBaseURL,
  codexEligible,
  codexRefused,
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

const nextOutcome = (
  modelID: string,
  client: never,
  credential: OcppCredential = chatgpt,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = yield* Model
      return yield* model.nextOutcome({
        sessionID: 'ses_1',
        system: '',
        messages: [],
        tools: [],
        onText: () => Effect.void,
      })
    }).pipe(
      Effect.provide(
        ocppAiModelLayer({ providerID: 'openai', modelID }).pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(LLMClient.Service, client),
              Layer.succeed(OcppCredentials, {
                load: Effect.die('unused'),
                find: () => Effect.succeed(credential),
              }),
            ),
          ),
        ),
      ),
    ),
  )

// Any use of the client would throw.
const untouched = {} as never

describe('codex refusal is advisory', () => {
  it('refuses only the disallowed models locally', () => {
    expect(codexRefused('gpt-5.6')).toBe(true)
    expect(codexRefused('gpt-5.5-pro')).toBe(true)
    expect(codexRefused('gpt-5.4-nano')).toBe(false)
    expect(codexRefused('gpt-5-mini')).toBe(false)
  })
  it('refuses a disallowed model before any provider call', async () => {
    expect(await nextOutcome('gpt-5.6', untouched)).toMatchObject({
      finish: 'error',
      retryable: false,
      error: { type: 'provider.ModelNotEligible' },
    })
  })
  it('sends a model absent from the table and lets the backend decide', async () => {
    let called = false
    const client = {
      stream: () => {
        called = true
        return Stream.fail(
          httpFailure({
            message: 'Provider request failed with HTTP 400',
            url: `${codexBaseURL}/responses`,
            status: 400,
            responseBody:
              '{"detail":"The \'gpt-5.4\' model is not supported when using Codex with a ChatGPT account."}',
          }),
        )
      },
    } as never
    const outcome = await nextOutcome('gpt-5.4-nano', client)
    expect(called).toBe(true)
    expect(outcome).toEqual({
      finish: 'error',
      retryable: false,
      error: {
        type: 'provider.InvalidRequest',
        message:
          "Provider request failed with HTTP 400: The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account.",
      },
    })
  })
  it('keeps the message when the body has no detail', async () => {
    const client = {
      stream: () =>
        Stream.fail(
          httpFailure({
            message: 'Provider request failed with HTTP 400',
            url: `${codexBaseURL}/responses`,
            status: 400,
            responseBody: 'not json',
          }),
        ),
    } as never
    expect(await nextOutcome('gpt-5.5', client)).toMatchObject({
      error: { message: 'Provider request failed with HTTP 400' },
    })
  })
})
