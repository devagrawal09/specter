import { type AIError, LLM, LLMEvent, LLMResponse, Message } from '@ocpp/ai'
import * as Anthropic from '@ocpp/ai/providers/anthropic'
import * as OpenAI from '@ocpp/ai/providers/openai'
import { LLMClient } from '@ocpp/ai/route/client'
import { RequestExecutor } from '@ocpp/ai/route/executor'
import type { TokenUsage } from '@ocpp/schema/token-usage'
import { Data, Effect, Layer, Stream } from 'effect'

import {
  isExpired,
  type OcppCredential,
  OcppCredentials,
} from './ocpp-credentials.ts'
import { Model, type ModelToolCall, type Outcome } from './model.ts'

// The real-provider implementation of the Model service, on @ocpp/ai. One
// physical attempt = one LLM.stream: text deltas go to `onText` as they
// arrive, and the settled response is mapped to the same Outcome the scripted
// model produces. Credentials come from OC++'s own store (OcppCredentials).

export type ProviderSelection = {
  readonly providerID: 'openai' | 'anthropic'
  readonly modelID: string
}

// Typed so callers (and tests) can tell a credential problem from a provider
// failure. Inside the step it becomes a non-retryable failed attempt.
export class ModelCredentialError extends Data.TaggedError(
  'ModelCredentialError',
)<{
  readonly integrationID: string
  readonly reason: 'missing' | 'expired'
}> {
  override get message() {
    return this.reason === 'missing'
      ? `No ${this.integrationID} credential in OC++'s store`
      : `The ${this.integrationID} credential has expired; refresh it in OC++`
  }
}

// OC++ plugin/provider/openai.ts: ChatGPT-plan (browser login) tokens are
// routed to the Codex backend and only authorize codex-eligible models.
export const codexBaseURL = 'https://chatgpt.com/backend-api/codex'
const browserMethodID = 'chatgpt-browser'
const codexAllowed = new Set([
  'gpt-5.5',
  'gpt-5.3-codex-spark',
  'gpt-5.4',
  'gpt-5.4-mini',
])
const codexDisallowed = new Set(['gpt-5.5-pro', 'gpt-5.6'])

export const codexEligible = (modelID: string): boolean => {
  if (codexAllowed.has(modelID)) return true
  const version = modelID.match(/^gpt-(\d+\.\d+)/)?.[1]
  return (
    !codexDisallowed.has(modelID) &&
    version !== undefined &&
    Number.parseFloat(version) > 5.4
  )
}

export const isChatgptCredential = (credential: OcppCredential) =>
  credential.type === 'oauth' && credential.methodID === browserMethodID

// The OpenAI provider settings for a credential: the default endpoint for
// keys, the Codex endpoint plus OC++'s Codex headers for ChatGPT logins.
export const openAISettings = (
  credential: OcppCredential,
  sessionID: string,
) => {
  // Key and OAuth access token are both sent as the bearer token.
  if (credential.type === 'key') return { apiKey: credential.key }
  if (!isChatgptCredential(credential)) return { apiKey: credential.access }
  return {
    apiKey: credential.access,
    baseURL: codexBaseURL,
    headers: {
      originator: 'opencode',
      'session-id': sessionID,
      ...(credential.accountID === undefined
        ? {}
        : { 'chatgpt-account-id': credential.accountID }),
    },
  }
}

const languageModel = (
  selection: ProviderSelection,
  credential: OcppCredential,
  sessionID: string,
) => {
  const secret = credential.type === 'key' ? credential.key : credential.access
  if (selection.providerID === 'openai')
    return OpenAI.model(
      selection.modelID,
      openAISettings(credential, sessionID),
    )
  return Anthropic.model(
    selection.modelID,
    credential.type === 'key' ? { apiKey: secret } : { authToken: secret },
  )
}

const resolveModel = (
  credentials: OcppCredentials['Service'],
  selection: ProviderSelection,
  sessionID: string,
) =>
  Effect.gen(function* () {
    // The integration id is the provider id for both supported providers.
    const integrationID = selection.providerID
    const credential = yield* credentials.find(integrationID)
    if (!credential)
      return yield* new ModelCredentialError({
        integrationID,
        reason: 'missing',
      })
    if (isExpired(credential, Date.now()))
      return yield* new ModelCredentialError({
        integrationID,
        reason: 'expired',
      })
    if (
      selection.providerID === 'openai' &&
      isChatgptCredential(credential) &&
      !codexEligible(selection.modelID)
    )
      return yield* new ModelNotEligibleError({ modelID: selection.modelID })
    return languageModel(selection, credential, sessionID)
  })

export class ModelNotEligibleError extends Data.TaggedError(
  'ModelNotEligibleError',
)<{ readonly modelID: string }> {
  override get message() {
    return `Model ${this.modelID} is not available with a ChatGPT-plan login`
  }
}

// OC++ SessionUsage.tokens, minus cost (no price tables here).
const finite = (value: number | undefined) =>
  Math.max(0, Number.isFinite(value ?? 0) ? (value ?? 0) : 0)
const tokens = (usage: LLMResponse['usage']): TokenUsage.Info => ({
  input: finite(usage?.nonCachedInputTokens),
  output: finite(usage?.visibleOutputTokens),
  reasoning: finite(usage?.reasoningTokens),
  cache: {
    read: finite(usage?.cacheReadInputTokens),
    write: finite(usage?.cacheWriteInputTokens),
  },
})

// OC++ runner/retry.ts isRetryable.
const retryable = (error: AIError) => {
  const override = error.reason.http?.headers['x-should-retry']
  if (override === 'true') return true
  if (override === 'false') return false
  switch (error.reason._tag) {
    case 'RateLimit':
    case 'ProviderInternal':
    case 'UnknownProvider':
      return true
    case 'Transport':
      return (
        error.reason.delivery === undefined ||
        error.reason.delivery === 'not-sent'
      )
    case 'InvalidProviderOutput':
      return error.reason.classification === 'incomplete-stream'
    default:
      return false
  }
}

const failed = (
  type: string,
  message: string,
  isRetryable: boolean,
): Outcome => ({
  finish: 'error',
  retryable: isRetryable,
  error: { type, message },
})

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value }

export const ocppAiModelLayer = (selection: ProviderSelection) =>
  Layer.effect(
    Model,
    Effect.gen(function* () {
      const client = yield* LLMClient.Service
      const credentials = yield* OcppCredentials
      return Model.of({
        ref: { id: selection.modelID, providerID: selection.providerID },
        nextOutcome: (input) =>
          Effect.gen(function* () {
            const model = yield* resolveModel(
              credentials,
              selection,
              input.sessionID,
            )
            const request = LLM.request({
              model,
              system: input.system,
              // The transcript is plain data in @ocpp/ai's Message shape; the
              // local mirror types its tool-result `result` as unknown.
              messages: input.messages.map((message) =>
                Message.make(message as Message.Input),
              ),
              tools: input.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
              })),
            })
            let state = LLMResponse.empty()
            yield* LLM.stream(request).pipe(
              Stream.runForEach((event) => {
                state = LLMResponse.reduce(state, event)
                return LLMEvent.is.textDelta(event)
                  ? input.onText(event.text)
                  : Effect.void
              }),
              Effect.provideService(LLMClient.Service, client),
            )
            const response = LLMResponse.complete(state)
            if (!response)
              return failed(
                'provider.incomplete-stream',
                'The provider stream ended without a finish',
                true,
              )
            const providerError = response.events.find(
              LLMEvent.is.providerError,
            )
            const reason = response.finishReason.normalized
            if (providerError || reason === 'error')
              return failed(
                'provider.unknown',
                providerError?.message ?? 'The provider reported an error',
                false,
              )
            if (reason === 'content-filter')
              return failed(
                'provider.content-filter',
                'Provider blocked the response',
                false,
              )
            const toolCalls: ModelToolCall[] = response.toolCalls.map(
              (call) => ({
                id: call.id,
                name: call.name,
                input: asRecord(call.input),
              }),
            )
            const text = response.text
            return {
              // A response with tool calls always needs a follow-up step.
              finish:
                toolCalls.length > 0 &&
                (reason === 'stop' || reason === 'unknown')
                  ? 'tool-calls'
                  : reason,
              ...(text === '' ? {} : { text }),
              ...(toolCalls.length === 0 ? {} : { toolCalls }),
              usage: tokens(response.usage),
            } satisfies Outcome
          }).pipe(
            Effect.catchTag('ModelCredentialError', (error) =>
              Effect.succeed(
                failed(`auth.credential-${error.reason}`, error.message, false),
              ),
            ),
            Effect.catchTag('ModelNotEligibleError', (error) =>
              Effect.succeed(
                failed('provider.ModelNotEligible', error.message, false),
              ),
            ),
            Effect.catch((error: AIError) =>
              Effect.succeed(
                failed(
                  `provider.${error.reason._tag}`,
                  error.message,
                  retryable(error),
                ),
              ),
            ),
          ),
      })
    }),
  )

// The real HTTP client stack: LLMClient over a fetch-based RequestExecutor.
export const llmClientLayer = LLMClient.layer.pipe(
  Layer.provide(RequestExecutor.fetchLayer),
)
