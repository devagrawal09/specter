import type { CommandEnvelope } from './slices'

export type CommandScenario<TPayload = unknown> = {
  description: string
  given: unknown[]
  when: TPayload
  expect: unknown[]
  reject?: {
    reason: string
  }
}

export type QueryScenario<TWhen = unknown, TExpect = unknown> = {
  description: string
  given: unknown[]
  when: TWhen
  expect: TExpect
}

export type ReactionScenario<TPayload = CommandEnvelope> = {
  description: string
  given: unknown[]
  expect: TPayload[]
}
