import { createCommandSlice, event } from '@specter-ts/spec'

type JsonObject = { readonly [key: string]: JsonValue }
type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | JsonObject

import { sessionFacts } from './facts.ts'

// The embedding host (OC++) decides Session facts and records them here: the
// runtime is its Event Log. Facts are stored as the host published them, in
// order, one commit per publication. The host's projections run in the same
// transaction as the append and still hold the invariants; dedicated Slices
// take them over family by family.
type Fact = keyof typeof sessionFacts
// What the runtime records for a host's fact, where it is not the fact itself:
// the host's own executions get the external facts, and its steps' facts the
// runtime's consolidated ones.
const recordedAs: Partial<
  Record<Fact, (payload: JsonObject) => readonly [string, JsonObject]>
> = {
  'session-execution-started': (payload) => [
    'session-external-execution-started',
    payload,
  ],
  'session-execution-succeeded': (payload) => [
    'session-external-execution-settled',
    { ...payload, outcome: 'succeeded' },
  ],
  'session-execution-failed': (payload) => [
    'session-external-execution-settled',
    { ...payload, outcome: 'failed' },
  ],
  'session-execution-interrupted': (payload) => [
    'session-external-execution-settled',
    { ...payload, outcome: 'interrupted' },
  ],
  'session-step-ended': (payload) => [
    'session-step-settled',
    { ...payload, outcome: 'succeeded' },
  ],
  'session-step-failed': (payload) => [
    'session-step-settled',
    { ...payload, outcome: 'failed' },
  ],
  'session-text-ended': (payload) => [
    'session-block-recorded',
    { ...payload, kind: 'text' },
  ],
  'session-reasoning-ended': (payload) => [
    'session-block-recorded',
    { ...payload, kind: 'reasoning' },
  ],
  // No input start named this call.
  'session-tool-called': (payload) => [
    'session-tool-requested',
    { ...payload, name: 'unknown' },
  ],
  'session-tool-success': (payload) => [
    'session-tool-settled',
    { ...payload, outcome: 'succeeded' },
  ],
  'session-tool-failed': (payload) => [
    'session-tool-settled',
    { ...payload, outcome: 'failed' },
  ],
}
const recordOne = (type: Fact) => {
  const as = recordedAs[type]?.(sessionFacts[type])
  return {
    description:
      as === undefined
        ? `Records ${type} as the host published it.`
        : `Records ${type} as ${as[0]}, the runtime's form of that fact.`,
    given: [],
    when: { facts: [{ type, payload: sessionFacts[type] }] },
    expect: [
      as === undefined ? event(type, sessionFacts[type]) : event(as[0], as[1]),
    ] as const,
  }
}
const [first, ...rest] = (Object.keys(sessionFacts) as Fact[]).map(recordOne)
// A tuple, so the builder can take one scenario per fact as rest arguments.
const recorded = [first, ...rest] as [
  ReturnType<typeof recordOne>,
  ...ReturnType<typeof recordOne>[],
]

export const recordSessionFactsSpec = createCommandSlice('recordSessionFacts')
  .description(
    "Records the Session facts an embedding host published, in order: its own executions as external ones, and its steps' facts in the runtime's consolidated form.",
  )
  .scenarios(
    ...recorded,
    {
      description:
        "A requested call takes its name from the start of the call's input.",
      given: [
        event('session-tool-input-started', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_assistant_1',
          id: 'call_1',
          name: 'echo',
        }),
      ],
      when: {
        facts: [
          {
            type: 'session-tool-called',
            payload: {
              sessionID: 'ses_1',
              assistantMessageID: 'msg_assistant_1',
              id: 'call_1',
              input: { text: 'hi' },
              executed: false,
            },
          },
        ],
      },
      expect: [
        event('session-tool-requested', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_assistant_1',
          id: 'call_1',
          input: { text: 'hi' },
          executed: false,
          name: 'echo',
        }),
      ],
    },
    {
      description:
        'A publication of several facts is one commit, in the order the host published them.',
      given: [],
      when: {
        facts: [
          {
            type: 'session-inbox-delivered',
            payload: sessionFacts['session-inbox-delivered'],
          },
          { type: 'session-moved', payload: sessionFacts['session-moved'] },
        ],
      },
      expect: [
        event(
          'session-inbox-delivered',
          sessionFacts['session-inbox-delivered'],
        ),
        event('session-moved', sessionFacts['session-moved']),
      ],
    },
  )

export default recordSessionFactsSpec
