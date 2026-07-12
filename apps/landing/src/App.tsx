import { createSignal, For, type JSX } from 'solid-js'

const installCommand = 'npm create specter@latest my-app'

type FlowNode = {
  kind: 'intent' | 'client' | 'command' | 'log' | 'query' | 'reaction'
  label: string
  detail: string
}

const ledgerEntries = [
  {
    order: '#0142',
    type: 'seat-reserved',
    note: 'accepted command appended a domain fact',
  },
  {
    order: '#0143',
    type: 'hold-placed',
    note: 'plugin-dispatched command appended the next fact',
  },
  {
    order: '#0144',
    type: 'seat-confirmation-sent',
    note: 'another accepted command extended the history',
  },
]

const flowStages: FlowNode[][] = [
  [
    {
      kind: 'intent',
      label: 'Caller',
      detail: 'UI · API · worker · agent',
    },
  ],
  [
    {
      kind: 'client',
      label: 'Specter Client',
      detail: 'Typed command and query methods',
    },
  ],
  [
    {
      kind: 'command',
      label: 'Command Implementation',
      detail: 'Catches up, decides, emits drafts',
    },
  ],
  [
    {
      kind: 'log',
      label: 'Event Log',
      detail: 'Atomically appends ordered facts',
    },
  ],
  [
    {
      kind: 'query',
      label: 'Query Implementation',
      detail: 'Catches up when queried by a client',
    },
    {
      kind: 'reaction',
      label: 'Reaction Implementation',
      detail: 'Catches up after a successful command',
    },
  ],
]

const specCode = `// reserve-seat/spec.ts — immutable "what"
import { createCommandSlice, event } from '@specter-ts/core/spec'

const reserveSeatSpec = createCommandSlice('reserveSeat')
  .description('Reserves an available seat.')
  .scenarios(
    {
      description: 'Reserves an available seat.',
      given: [],
      when: { seatId: 'A1', holdId: 'h-1' },
      expect: [event('seat-reserved', { seatId: 'A1', holdId: 'h-1' })],
    },
    {
      description: 'Rejects a seat that is already reserved.',
      given: [event('seat-reserved', { seatId: 'A1', holdId: 'h-1' })],
      when: { seatId: 'A1', holdId: 'h-2' },
      expect: [],
      reject: { reason: 'Seat is already reserved' },
    },
  )

export default reserveSeatSpec

// reserve-seat/impl.ts — executable "how"
import spec from './spec'
import { seatReservedEvent } from '../events'

export const reserveSeat = spec
  .inputSchema(reserveSeatInputSchema)
  .store(reserveSeatStore)
  .apply(seatReservedEvent, applySeatReserved)
  .handle(async (command, state) => {
    if (state.taken.has(command.seatId)) {
      throw new Error('Seat is already reserved')
    }
    return [seatReservedEvent.create(command)]
  })`

function CopyCommand() {
  const [status, setStatus] = createSignal('Copy')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(installCommand)
      setStatus('Copied')
      window.setTimeout(() => setStatus('Copy'), 1600)
    } catch {
      setStatus('Select and copy')
    }
  }

  return (
    <div class="copy-command">
      <code>{installCommand}</code>
      <button type="button" onClick={copy} aria-live="polite">
        {status()}
      </button>
    </div>
  )
}

function FlowDiagram() {
  return (
    <div
      class="flow"
      role="img"
      aria-label="Event flow: a caller uses the typed Specter Client, a Command Slice implementation emits drafts that the Event Log persists, and Query and Reaction implementations catch up in global event order."
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
    <div class="page" id="top">
      <a class="skip-link" href="#main-content">
        Skip to content
      </a>
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

      <main id="main-content">
        <section class="hero">
          <p class="eyebrow">Event-sourced runtime for TypeScript</p>
          <h1 class="hero__title">
            specifications that compile execute and scaffold your app
          </h1>
          <p class="hero__lede">
            Specter is a TypeScript runtime for vertically sliced, event-sourced
            applications. Immutable Slice Specifications describe behavior;
            selected implementations run it over a durable Event Log and expose
            an Effect-based typed client.
          </p>
          <div class="hero__actions">
            <a class="btn btn--solid" href="#start">
              Create a project
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
                A Query catches up its private state when its client method is
                called. Reactions catch up after a command succeeds; each may
                produce one ephemeral Reaction Effect for its explicit Plugin to
                interpret, including by dispatching another command.
              </p>
            </div>
            <EventLedger />
          </div>
        </Section>

        <Section
          id="specs"
          eyebrow="Structured specs"
          title="A Slice separates an immutable specification from an executable implementation"
        >
          <div class="split split--wide-right">
            <div class="prose">
              <p>
                The <code>spec.ts</code> file contains only the Slice name,
                description, and exact Scenarios. It imports Scenario Events
                from <code>@specter-ts/core/spec</code>, never runtime schemas,
                stores, plugins, or Event Definitions.
              </p>
              <p>
                The selected <code>impl.ts</code> adds schemas, a private Store,
                apply handlers, and the terminal handler. Registered Command and
                Query names become methods on the typed Specter Client.
              </p>
            </div>
            <figure class="code">
              <figcaption class="code__head">
                <span class="code__badge">command slice</span>
                <span class="code__file">
                  features/booking/reserve-seat/spec.ts + impl.ts
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
          title="Scenarios become executable checks through Specter's test runner"
        >
          <div class="cards">
            <article class="card">
              <h3>given · when · then</h3>
              <p>
                A scenario states the events that already happened, the input
                under test, and the expected outcome. It ships in the immutable
                specification beside the implementation.
              </p>
            </article>
            <article class="card">
              <h3>One explicit runner</h3>
              <p>
                A small test file calls <code>testSliceImplementations</code>{' '}
                with the app Event Definitions and a <code>runScenario</code>{' '}
                environment. The runner replays <em>given</em> events and checks
                each outcome.
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
          title="Recorded facts can rebuild state when the Event Log adapter is durable"
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
                Specter supplies the contract, not the durability medium. The
                Event Log adapter still needs atomic commits, durable storage,
                backups, and an operational recovery plan.
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
                and may produce zero or one Reaction Effect per catch-up cycle.
                Its explicit Reaction Plugin executes that effect afterward;
                same-app command dispatch is one possible plugin behavior.
              </p>
              <p>
                Reactions run in their own effect boundary, so one failing
                reaction does not take down the others in the same run.
              </p>
            </div>
            <ol class="chain" aria-label="Event-driven orchestration chain">
              <li>
                <code>seat-reserved</code> is appended
              </li>
              <li>
                <code>confirmHoldOnReserve</code> reacts
              </li>
              <li>
                its plugin dispatches <code>placeHold</code>
              </li>
              <li>
                <code>hold-placed</code> is appended
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
                To change a behavior, an agent reads its <code>spec.ts</code>,
                selected <code>impl.ts</code>, and shared Event Definitions —
                not the whole codebase. Less context in, fewer ways to go wrong.
              </p>
            </article>
            <article class="card">
              <h3>Strong guardrails</h3>
              <p>
                The fixed slice shape, typed client, typed apply handlers, and
                Scenario conformance make invalid boundaries easier to detect,
                so agent changes stay reviewable against executable contracts.
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
          eyebrow="Architecture model"
          title="Use registered slices and events to reason about architecture and dataflow"
        >
          <div class="split split--wide-left">
            <div class="prose">
              <p>
                Registered specifications, selected implementations, and Event
                Definitions make relationships explicit enough to inspect and
                diagram. This page illustrates that model; the current framework
                does not generate architecture maps.
              </p>
              <p>
                The event flow you see on this page is exactly that kind of
                picture: callers, the typed client, commands, durable events,
                queries, and reactions, drawn from the framework's vocabulary.
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
          <CopyCommand />
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
