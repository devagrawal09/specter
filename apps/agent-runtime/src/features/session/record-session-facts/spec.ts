import { createCommandSlice, event } from '@specter-ts/spec'

import { sessionFacts } from './facts.ts'

// The embedding host (OC++) decides Session facts and records them here: the
// runtime is its Event Log. Facts are stored as the host published them, in
// order, one commit per publication. The host's projections run in the same
// transaction as the append and still hold the invariants; dedicated Slices
// take them over family by family.
const recordOne = (type: keyof typeof sessionFacts) => ({
  description: `Records ${type} as the host published it.`,
  given: [],
  when: { facts: [{ type, payload: sessionFacts[type] }] },
  expect: [event(type, sessionFacts[type])] as const,
})
const [first, ...rest] = (
  Object.keys(sessionFacts) as (keyof typeof sessionFacts)[]
).map(recordOne)
// A tuple, so the builder can take one scenario per fact as rest arguments.
const recorded = [first, ...rest] as [
  ReturnType<typeof recordOne>,
  ...ReturnType<typeof recordOne>[],
]

export const recordSessionFactsSpec = createCommandSlice('recordSessionFacts')
  .description(
    'Records the Session facts an embedding host published, in order and unchanged.',
  )
  .scenarios(...recorded, {
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
      event('session-inbox-delivered', sessionFacts['session-inbox-delivered']),
      event('session-moved', sessionFacts['session-moved']),
    ],
  })

export default recordSessionFactsSpec
