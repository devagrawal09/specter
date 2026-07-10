import { For, type JSX } from 'solid-js'

type FlowNode = {
  kind: 'intent' | 'command' | 'log' | 'query' | 'reaction' | 'adapter'
  label: string
  detail: string
}

const ledgerEntries = [
  {
    order: '#0142',
    type: 'IntentCaptured',
    note: 'user asked to reserve seat A1',
  },
  {
    order: '#0143',
    type: 'SeatReserved',
    note: 'command accepted, fact appended',
  },
  {
    order: '#0144',
    type: 'HoldPlaced',
    note: 'reaction dispatched a follow-up command',
  },
  {
    order: '#0145',
    type: 'PaymentRequested',
    note: 'adapter call queued, not yet settled',
  },
]

const flowStages: FlowNode[][] = [
  [
    {
      kind: 'intent',
      label: 'User intent',
      detail: 'A request enters the system',
    },
  ],
  [
    {
      kind: 'command',
      label: 'Command Slice',
      detail: 'Decides which events to emit',
    },
  ],
  [
    {
      kind: 'log',
      label: 'Event Log',
      detail: 'Appends durable, ordered facts',
    },
  ],
  [
    { kind: 'query', label: 'Query Slice', detail: 'Rebuilds a read model' },
    {
      kind: 'reaction',
      label: 'Reaction Slice',
      detail: 'Triggers the next command',
    },
  ],
  [
    {
      kind: 'adapter',
      label: 'Adapters',
      detail: 'Database · protocol · frontend · API',
    },
  ],
]

const specCode = `import { z } from 'zod'
import { command, event } from '@specter-ts/core'

// A domain fact. Once appended it is never mutated.
export const SeatReserved = event('SeatReserved', {
  seatId: z.string(),
  holdId: z.string(),
})

// One command, one decision, explicit event interests.
export const reserveSeat = command('reserveSeat')
  .interests([SeatReserved])
  .decide((state, input: { seatId: string; holdId: string }) => {
    if (state.taken.has(input.seatId)) {
      // No event emitted -> the command is rejected, not a silent no-op.
      return reject('seat already reserved')
    }
    return [SeatReserved(input)]
  })

// The scenario is the behavior test. given / when / then.
reserveSeat.scenario('rejects a seat that is already held', {
  given: [SeatReserved({ seatId: 'A1', holdId: 'h-1' })],
  when: { seatId: 'A1', holdId: 'h-2' },
  then: 'rejected',
})`

function FlowDiagram() {
  return (
    <div
      class="flow"
      role="img"
      aria-label="Event flow: intent becomes a command, the command emits durable events, events update read models and trigger reactions, and adapters connect any database, protocol, frontend, or API."
    >
      <For each={flowStages}>
        {(stage, index) => (
          <>
            <div class="flow__stage">
              <For each={stage}>
                {(node) => (
                  <div class={`node node--${node.kind}`}>
                    <span class="node__label">{node.label}</span>
                    <span class="node__detail">{node.detail}</span>
                  </div>
                )}
              </For>
            </div>
            {index() < flowStages.length - 1 && (
              <div class="flow__arrow" aria-hidden="true">
                →
              </div>
            )}
          </>
        )}
      </For>
    </div>
  )
}

function EventLedger() {
  return (
    <figure class="ledger">
      <figcaption class="ledger__head">
        <span class="ledger__dot" aria-hidden="true" />
        Event Log — append only, globally ordered
      </figcaption>
      <ol class="ledger__list">
        <For each={ledgerEntries}>
          {(entry) => (
            <li class="ledger__row">
              <span class="ledger__order">{entry.order}</span>
              <span class="ledger__type">{entry.type}</span>
              <span class="ledger__note">{entry.note}</span>
            </li>
          )}
        </For>
      </ol>
      <p class="ledger__foot">
        Nothing is overwritten. State is a replay of these facts, so history is
        the source of truth.
      </p>
    </figure>
  )
}

function Section(props: {
  id: string
  eyebrow: string
  title: string
  children: JSX.Element
}) {
  return (
    <section class="section" id={props.id}>
      <div class="section__head">
        <span class="eyebrow">{props.eyebrow}</span>
        <h2>{props.title}</h2>
      </div>
      {props.children}
    </section>
  )
}

export function App() {
  return (
    <div class="page">
      <div class="grid-bg" aria-hidden="true" />

      <header class="topbar">
        <a class="brand" href="#top">
          <span class="brand__mark" aria-hidden="true">
            ◇
          </span>
          Specter
        </a>
        <nav class="topnav" aria-label="Primary">
          <a href="#flow">How it works</a>
          <a href="#specs">Specs</a>
          <a href="#durability">Durability</a>
          <a href="#agents">AI agents</a>
        </nav>
        <a class="btn btn--ghost" href="#start">
          Get started
        </a>
      </header>

      <main id="top">
        <section class="hero">
          <p class="eyebrow">Event-sourced runtime for TypeScript</p>
          <h1 class="hero__title">
            specifications that compile execute and scaffold your app
          </h1>
          <p class="hero__lede">
            Specter is a TypeScript runtime for vertically sliced, event-sourced
            applications. You describe behavior as structured specs; Specter
            turns them into running slices, behavior tests, and a durable event
            log — with an Effect-based typed client wired in.
          </p>
          <div class="hero__actions">
            <a class="btn btn--solid" href="#start">
              npm create specter
            </a>
            <a class="btn btn--ghost" href="#flow">
              See the event flow
            </a>
          </div>
          <FlowDiagram />
        </section>

        <Section
          id="flow"
          eyebrow="How it works"
          title="Intent becomes commands, commands emit events, events drive everything else"
        >
          <div class="split">
            <div class="prose">
              <p>
                Every change follows one path. A request becomes a{' '}
                <strong>command</strong>. A Command Slice reads its own
                event-derived state, decides, and emits one or more{' '}
                <strong>events</strong>. Those events are appended to a single,
                ordered <strong>event log</strong>.
              </p>
              <p>
                From there, Query Slices rebuild read models and Reaction Slices
                observe new events and trigger the next command. Specter
                orchestrates the slices; the log is the only thing they share.
              </p>
            </div>
            <EventLedger />
          </div>
        </Section>

        <Section
          id="specs"
          eyebrow="Structured specs"
          title="A slice is a small, explicit specification you can read in one screen"
        >
          <div class="split split--wide-right">
            <div class="prose">
              <p>
                A slice names one behavior, declares the events it cares about,
                and makes exactly one decision. No hidden wiring, no god objects
                — just the command, its event interests, and the facts it emits.
              </p>
              <p>
                Because the shape is fixed, the same spec is what compiles, what
                runs, and what the typed client exposes as a method.
              </p>
            </div>
            <figure class="code">
              <figcaption class="code__head">
                <span class="code__badge">command slice</span>
                <span class="code__file">
                  features/booking/reserve-seat/slice.ts
                </span>
              </figcaption>
              <pre class="code__body">
                <code>{specCode}</code>
              </pre>
            </figure>
          </div>
        </Section>

        <Section
          id="tests"
          eyebrow="Specs are tests"
          title="Scenarios attached to a slice run as behavior tests automatically"
        >
          <div class="cards">
            <article class="card">
              <h3>given · when · then</h3>
              <p>
                A scenario states the events that already happened, the input
                under test, and the expected outcome. It lives next to the slice
                it describes.
              </p>
            </article>
            <article class="card">
              <h3>No separate harness</h3>
              <p>
                Specter replays the <em>given</em> events, applies the command,
                and checks the result. The spec and the test are the same
                artifact, so they never drift.
              </p>
            </article>
            <article class="card">
              <h3>Rejection is a real outcome</h3>
              <p>
                Expecting no events means the command must be rejected.
                Accidental no-ops fail the scenario instead of passing quietly.
              </p>
            </article>
          </div>
        </Section>

        <Section
          id="slices"
          eyebrow="Vertical slices"
          title="Build and test one behavior at a time, in isolation"
        >
          <div class="split">
            <div class="prose">
              <p>
                Each slice owns its own event-derived state and catches up on
                the event log independently. Two slices never share state, so
                you can add, change, or test a behavior without loading the rest
                of the app into your head.
              </p>
              <p>
                A vertical feature is just a handful of nearby slices and event
                definitions — a comprehension boundary, not a framework module
                you have to fight.
              </p>
            </div>
            <ul class="slice-stack" aria-label="Independent vertical slices">
              <li>
                <span class="slice-stack__kind">command</span>reserveSeat
              </li>
              <li>
                <span class="slice-stack__kind">query</span>seatMap
              </li>
              <li>
                <span class="slice-stack__kind">reaction</span>
                confirmHoldOnReserve
              </li>
            </ul>
          </div>
        </Section>

        <Section
          id="durability"
          eyebrow="Durability"
          title="The app never loses data because state is derived from a durable event log"
        >
          <div class="split split--wide-left">
            <div class="prose">
              <p>
                Specter is event-sourced. Accepted commands append immutable
                facts to one ordered event log; nothing is updated in place.
                Read models are projections you can
                <strong> rebuild from the log at any time</strong>.
              </p>
              <p>
                If a projection is wrong, a cache is corrupted, or you add a new
                view later, you replay the same events and recompute. The
                durable log — not any single table — is the system of record.
              </p>
              <p class="note">
                This is a design property of event-sourced systems, not a magic
                guarantee: your event log still needs durable, backed-up
                storage.
              </p>
            </div>
            <div class="stat-grid">
              <div class="stat">
                <span class="stat__value">append-only</span>
                <span class="stat__label">events are never mutated</span>
              </div>
              <div class="stat">
                <span class="stat__value">ordered</span>
                <span class="stat__label">one global sequence per app</span>
              </div>
              <div class="stat">
                <span class="stat__value">replayable</span>
                <span class="stat__label">
                  rebuild any read model on demand
                </span>
              </div>
              <div class="stat">
                <span class="stat__value">auditable</span>
                <span class="stat__label">history explains current state</span>
              </div>
            </div>
          </div>
        </Section>

        <Section
          id="orchestration"
          eyebrow="Orchestration"
          title="Reactions let events drive the next step without tangled call graphs"
        >
          <div class="split">
            <div class="prose">
              <p>
                A Reaction Slice observes new events after a command succeeds
                and may dispatch one follow-up command. That command appends
                more events, which can trigger more reactions — a clear,
                event-driven chain instead of services calling services.
              </p>
              <p>
                Reactions run in their own effect boundary, so one failing
                reaction does not take down the others in the same run.
              </p>
            </div>
            <ol class="chain" aria-label="Event-driven orchestration chain">
              <li>
                <code>SeatReserved</code> is appended
              </li>
              <li>
                <code>confirmHoldOnReserve</code> reacts
              </li>
              <li>
                it dispatches <code>placeHold</code>
              </li>
              <li>
                <code>HoldPlaced</code> is appended
              </li>
            </ol>
          </div>
        </Section>

        <Section
          id="portability"
          eyebrow="Portability"
          title="Runs anywhere, with no opinion about your database, protocol, or frontend"
        >
          <div class="cards">
            <article class="card">
              <h3>Storage-agnostic</h3>
              <p>
                The event log is reached through one adapter. Point it at
                SQLite, Postgres, or anything that can atomically query and
                commit events.
              </p>
            </article>
            <article class="card">
              <h3>Protocol-agnostic</h3>
              <p>
                The typed client exposes flat command and query methods. Expose
                them over HTTP, RPC, a queue, or an in-process call — Specter
                does not care.
              </p>
            </article>
            <article class="card">
              <h3>Frontend-agnostic</h3>
              <p>
                The client contract has no UI dependency, so the same app runs
                behind Solid, another framework, or no frontend at all.
              </p>
            </article>
          </div>
        </Section>

        <Section
          id="integrations"
          eyebrow="Integrations"
          title="Connect to any external API through an explicit reaction plugin"
        >
          <div class="split">
            <div class="prose">
              <p>
                External calls are modeled as Reaction Effects interpreted by a
                Reaction Plugin you choose when you define the slice. Charging a
                card, sending mail, or calling a partner API is just a reaction
                to an event.
              </p>
              <p>
                The integration point is explicit and visible in the slice — no
                hidden global side effects, no surprise network calls buried in
                a handler.
              </p>
            </div>
            <ul class="adapter-row" aria-label="External adapters">
              <li class="chip">Payments API</li>
              <li class="chip">Email</li>
              <li class="chip">Webhooks</li>
              <li class="chip">Another Specter app</li>
            </ul>
          </div>
        </Section>

        <Section
          id="agents"
          eyebrow="AI agents"
          title="A shape that keeps coding agents fast, focused, and inside the guardrails"
        >
          <div class="cards">
            <article class="card">
              <h3>Minimal context</h3>
              <p>
                To change a behavior, an agent reads one slice — its command,
                its event interests, its scenarios — not the whole codebase.
                Less context in, fewer ways to go wrong.
              </p>
            </article>
            <article class="card">
              <h3>Strong guardrails</h3>
              <p>
                The fixed slice shape, typed client, and event-interest
                declarations constrain what an agent can write, so generated
                code lands inside the framework's rules.
              </p>
            </article>
            <article class="card">
              <h3>Instant feedback</h3>
              <p>
                Every slice ships with scenarios, so an agent gets a pass/fail
                signal on the exact behavior it touched — a tight loop instead
                of guesswork.
              </p>
            </article>
          </div>
        </Section>

        <Section
          id="visuals"
          eyebrow="Visuals"
          title="Turn specs, slices, and events into diagrams of your architecture and dataflow"
        >
          <div class="split split--wide-left">
            <div class="prose">
              <p>
                Because slices declare their commands, event interests, and
                reactions, the wiring is already structured data. Specter can
                read those declarations and render the architecture and dataflow
                of your app for you.
              </p>
              <p>
                The event flow you see on this page is exactly that kind of
                picture: commands, events, read models, reactions, and adapters,
                derived from the specs themselves.
              </p>
            </div>
            <FlowDiagram />
          </div>
        </Section>

        <section class="cta" id="start">
          <p class="eyebrow">Getting started</p>
          <h2>Scaffold a Specter project in one command</h2>
          <p class="cta__lede">
            The initializer copies a starter template with a working reference
            app, scenarios, and an agent skill — so you start from something
            that already runs.
          </p>
          <div class="cta__command">
            <code>npm create specter@latest</code>
          </div>
          <p class="cta__hint">
            Then open the reference slices, run the scenarios, and change one
            behavior at a time.
          </p>
        </section>
      </main>

      <footer class="footer">
        <span>
          <span class="brand__mark" aria-hidden="true">
            ◇
          </span>{' '}
          Specter
        </span>
        <span class="footer__muted">
          TypeScript runtime for vertically sliced, event-sourced applications.
        </span>
      </footer>
    </div>
  )
}
