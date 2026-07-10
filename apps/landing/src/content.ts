export type PipelineStage = {
  id: string
  step: string
  title: string
  summary: string
}

export const pipeline: PipelineStage[] = [
  {
    id: 'spec',
    step: '01',
    title: 'spec',
    summary:
      'A structured, typed description of one command, its events, and its scenarios.',
  },
  {
    id: 'behavior-test',
    step: '02',
    title: 'behavior test',
    summary:
      'Every scenario compiles into an executable test that runs on each change.',
  },
  {
    id: 'slice',
    step: '03',
    title: 'slice',
    summary:
      'A vertical slice is scaffolded: events, command, read model, and registry.',
  },
  {
    id: 'event-log',
    step: '04',
    title: 'event log',
    summary:
      'Accepted commands append durable facts to one ordered, append-only log.',
  },
  {
    id: 'visual-map',
    step: '05',
    title: 'visual map',
    summary:
      'Specs, slices, and events render into an architecture and dataflow map.',
  },
]

export const specSource = `import { command, event, reject } from '@specter-ts/core'
import { z } from 'zod'

// A domain fact. Named, versioned by its schema.
export const WaitlistSignedUp = event('WaitlistSignedUp', {
  email: z.string().email(),
  variation: z.string(),
})

// A command slice: one command, its event interests, its scenarios.
export const signUp = command('signUp', {
  input: z.object({ email: z.string().email(), variation: z.string() }),
  interests: [WaitlistSignedUp],
  scenarios: [
    {
      name: 'accepts a first-time email',
      given: [],
      when: { email: 'ada@dev.io', variation: 'compiler-console' },
      then: [WaitlistSignedUp.draft({ email: 'ada@dev.io', variation: 'compiler-console' })],
    },
    {
      name: 'rejects a duplicate email',
      given: [WaitlistSignedUp.draft({ email: 'ada@dev.io', variation: 'compiler-console' })],
      when: { email: 'ada@dev.io', variation: 'compiler-console' },
      then: [], // no events emitted => rejected command
    },
  ],
  decide: (input, state) =>
    state.emails.has(input.email)
      ? reject('email already registered')
      : [WaitlistSignedUp.draft(input)],
})`

export const behaviorTestOutput = `$ specter test waitlist/sign-up

 signUp
  ✓ accepts a first-time email        1 event  (WaitlistSignedUp)
  ✓ rejects a duplicate email          0 events (rejected command)

 2 scenarios compiled to 2 behavior tests
 2 passed  ·  0 failed  ·  12ms`

export const sliceTree = `features/waitlist/
├─ events.ts              # WaitlistSignedUp definition
├─ sign-up/
│  └─ slice.ts            # signUp command slice + scenarios
├─ signups-query/
│  └─ slice.ts            # event-derived read model
└─ registry.ts            # registers the slice with the Specter App`

export const eventLog = `order  recorded              type              payload
─────  ────────────────────  ────────────────  ───────────────────────────────
    1  2026-07-09T18:04:11Z  WaitlistSignedUp  { email: "ada@dev.io", … }
    2  2026-07-09T18:07:52Z  WaitlistSignedUp  { email: "grace@dev.io", … }
    3  2026-07-09T18:09:30Z  WaitlistSignedUp  { email: "linus@dev.io", … }

append-only · ordered · replayable — state is a projection, never the source of truth`

export const reactionSource = `import { reaction, dispatch } from '@specter-ts/core'
import { WaitlistSignedUp } from '../waitlist/events'

// A reaction slice observes committed events and produces one effect.
export const sendWelcome = reaction('sendWelcome', {
  interests: [WaitlistSignedUp],
  // The plugin is the explicit interpreter for the effect.
  plugin: dispatch('email', (e) => ({
    to: e.payload.email,
    template: 'welcome',
  })),
})`

export const externalApiSource = `import { httpPlugin } from '@specter-ts/core'

// Any external API is reached through an explicit reaction plugin.
// Swap the plugin without touching a single slice or scenario.
export const email = httpPlugin({
  baseUrl: process.env.EMAIL_API_URL,
  send: (effect) => ({
    method: 'POST',
    path: '/v1/messages',
    body: { to: effect.to, template: effect.template },
  }),
})`

export type Adapter = {
  slot: string
  detail: string
  swap: string
}

export const adapters: Adapter[] = [
  {
    slot: 'Event log',
    detail: 'The one durable boundary an app depends on.',
    swap: 'SQLite · Postgres · in-memory',
  },
  {
    slot: 'Protocol',
    detail: 'How the typed client reaches the runtime.',
    swap: 'RPC · HTTP · server functions',
  },
  {
    slot: 'Frontend',
    detail: 'The client contract is UI-framework agnostic.',
    swap: 'Solid · React · headless',
  },
  {
    slot: 'Runtime',
    detail: 'Where slices execute and catch up.',
    swap: 'Node · edge · local dev',
  },
]

export type AgentBenefit = {
  title: string
  body: string
}

export const agentBenefits: AgentBenefit[] = [
  {
    title: 'Minimal context per task',
    body: 'A slice is a single file boundary: one command, its events, its scenarios. An agent reads and edits one vertical unit instead of scanning the whole app.',
  },
  {
    title: 'Guardrails from scenarios',
    body: 'Scenarios are executable spec. When an agent changes behavior, the compiled behavior tests fail loudly — the intended contract is checked, not assumed.',
  },
  {
    title: 'Typed client contract',
    body: 'Command and query methods are inferred from the app. Agents get real types at the call site instead of stringly-typed dispatch.',
  },
  {
    title: 'A map to navigate',
    body: 'The generated architecture view gives an agent a stable, high-signal picture of slices and events before it writes a line.',
  },
]
