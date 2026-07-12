import { type JSX, createSignal, For } from 'solid-js'

const installCommand = 'npm create specter@latest my-app'

const sliceSource = `// add-todo/spec.ts — immutable "what"
import { createCommandSlice, event } from '@specter-ts/core/spec'

const addTodoSpec = createCommandSlice('addTodo')
  .description('Adds a todo to the list.')
  .scenarios(
    {
      description: 'Creates a todo with the given title.',
      given: [],
      when: { todoId: 'todo-1', title: 'Ship it' },
      expect: [event('todo-added', { todoId: 'todo-1', title: 'Ship it' })],
    },
    {
      description: 'Rejects a blank title.',
      given: [],
      when: { todoId: 'todo-1', title: '   ' },
      expect: [],
      reject: { reason: 'Todo title is required' },
    },
  )

export default addTodoSpec

// add-todo/impl.ts — executable "how"
import spec from './spec'
import { todoAddedEvent } from '../events'

export const addTodo = spec
  .inputSchema(addTodoInputSchema)
  .store(todoStore)
  .handle(async (command) => {
    const title = command.title.trim()
    if (!title) throw new Error('Todo title is required')
    return [todoAddedEvent.create({ ...command, title })]
  })`

const scenarioChecks = [
  'Creates a todo with the given title.',
  'Rejects a blank title.',
]

const railStack = [
  { name: 'requestBooking', state: 'out' },
  { name: 'approveBooking', state: 'out' },
  { name: 'addTodo', state: 'focus' },
  { name: 'changeTodoCompletion', state: 'out' },
  { name: 'todosQuery', state: 'out' },
]

const capabilities = [
  {
    tag: '01',
    title: 'Specs are structured, not prose',
    body: 'The immutable spec.ts declares a Slice name, description, and exact Scenarios. The selected impl.ts adds schemas, a private Store, apply handlers, and the handler.',
  },
  {
    tag: '02',
    title: 'Scenarios are the behavior tests',
    body: 'An explicit test file calls testSliceImplementations with the app Event Definitions and a runScenario environment, turning each given/when/expect example into a check.',
  },
  {
    tag: '03',
    title: 'Vertical slices, built in isolation',
    body: 'Each slice owns its own event-derived state and catch-up cursor. You can build and test one slice against a handful of events without booting the rest of the app.',
  },
]

const anywhere = [
  {
    title: 'No database opinion',
    body: 'The Event Log is reached through one adapter. Point it at durable storage with atomic commits and backups; the Slice specifications do not change.',
  },
  {
    title: 'No protocol opinion',
    body: 'The typed Specter Client exposes flat command and query methods. Wrap it in RPC, HTTP, a queue, or a CLI. Transport is your call.',
  },
  {
    title: 'No frontend opinion',
    body: 'The client contract has no UI framework baked in. Drive it from Solid, React, a script, or an agent — the same inferred types hold.',
  },
  {
    title: 'Runs where you run',
    body: 'It is a TypeScript runtime, not a platform. Local, serverless, a long-lived node — Specter goes where your code already goes.',
  },
]

function CopyCommand(props: { command: string; big?: boolean }): JSX.Element {
  const [status, setStatus] = createSignal('copy')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.command)
      setStatus('copied')
      window.setTimeout(() => setStatus('copy'), 1600)
    } catch {
      setStatus('select and copy')
    }
  }

  return (
    <div class={props.big ? 'cmd cmd--big' : 'cmd'}>
      <span class="cmd__prompt" aria-hidden="true">
        $
      </span>
      <code class="cmd__text">{props.command}</code>
      <button class="cmd__copy" type="button" onClick={copy} aria-live="polite">
        {status()}
      </button>
    </div>
  )
}

function Section(props: {
  id: string
  eyebrow: string
  title: string
  lead?: string
  children?: JSX.Element
}): JSX.Element {
  return (
    <section class="section" id={props.id}>
      <div class="section__head">
        <p class="eyebrow">{props.eyebrow}</p>
        <h2 class="section__title">{props.title}</h2>
        {props.lead ? <p class="section__lead">{props.lead}</p> : null}
      </div>
      {props.children}
    </section>
  )
}

export default function App(): JSX.Element {
  return (
    <div class="page" id="top">
      <a class="skip-link" href="#main-content">
        Skip to content
      </a>
      <header class="nav">
        <a class="brand" href="#top">
          <span class="brand__mark" aria-hidden="true" />
          <span class="brand__name">Specter</span>
        </a>
        <nav class="nav__links" aria-label="Primary">
          <a href="#guardrails">Guardrails</a>
          <a href="#spec">Specs</a>
          <a href="#events">Events</a>
          <a href="#map">Architecture</a>
        </nav>
        <a class="nav__cta" href="#start">
          Get started
        </a>
      </header>

      <main id="main-content">
        <section class="hero">
          <div class="hero__glow" aria-hidden="true" />
          <div class="hero__body">
            <p class="eyebrow eyebrow--accent">
              A TypeScript runtime for event-sourced apps
            </p>
            <h1 class="hero__title">
              specifications that compile execute and scaffold your app
            </h1>
            <p class="hero__lead">
              Specter separates immutable Slice Specifications from selected,
              executable implementations. Scenarios describe the contract and
              run through an explicit test helper, giving AI agents a small,
              verifiable behavior boundary to work within.
            </p>
            <div class="hero__actions">
              <CopyCommand command={installCommand} big />
              <a class="btn btn--ghost" href="#guardrails">
                See the guardrails
              </a>
            </div>
            <ul class="hero__facts">
              <li>Vertical slices</li>
              <li>Durable event log</li>
              <li>Scenario-tested</li>
              <li>Storage agnostic</li>
            </ul>
          </div>

          <aside class="context" aria-label="Agent review focus illustration">
            <div class="context__chrome">
              <span class="context__label">review focus</span>
              <span class="context__budget">1 slice in focus</span>
            </div>
            <div class="rails">
              <span class="rails__line rails__line--left" aria-hidden="true" />
              <span class="rails__line rails__line--right" aria-hidden="true" />
              <ul class="rails__stack">
                <For each={railStack}>
                  {(slice) => (
                    <li
                      class={
                        slice.state === 'focus'
                          ? 'rail rail--focus'
                          : 'rail rail--out'
                      }
                    >
                      <span class="rail__dot" aria-hidden="true" />
                      <span class="rail__name">{slice.name}</span>
                      {slice.state === 'focus' ? (
                        <span class="rail__badge">in focus</span>
                      ) : (
                        <span class="rail__muted">out of focus</span>
                      )}
                    </li>
                  )}
                </For>
              </ul>
            </div>
            <p class="context__note">
              Project boundaries help an agent focus on the Slice it is changing
              while shared Event contracts keep cross-Slice effects visible.
            </p>
          </aside>
        </section>

        <section class="strip" aria-label="How it works">
          <ol class="steps">
            <li>
              <span class="steps__num">1</span>
              <h3>Specify behavior</h3>
              <p>
                Keep the Slice name, description, and exact Scenarios in an
                immutable <code>spec.ts</code>.
              </p>
            </li>
            <li>
              <span class="steps__num">2</span>
              <h3>Implement the contract</h3>
              <p>
                Add schemas, a private Store, apply handlers, and a handler in
                <code>impl.ts</code>.
              </p>
            </li>
            <li>
              <span class="steps__num">3</span>
              <h3>Run the scenarios</h3>
              <p>
                Call <code>testSliceImplementations</code>, then register one
                completed implementation per Slice in the Specter App.
              </p>
            </li>
          </ol>
        </section>

        <Section
          id="guardrails"
          eyebrow="Design direction — agent guardrails"
          title="Give agents rails, not the whole repo"
          lead="Large context windows invite broad, accidental rewrites. Specter's feature layout lets you give an agent one specification, one implementation, and their Event contracts — a bounded problem with a green/red answer."
        >
          <div class="guard">
            <div class="guard__card">
              <h3>Minimized context</h3>
              <p>
                A Slice keeps its specification and implementation together in
                one vertical feature. An agent can focus there, loading shared
                Event Definitions only when the implementation applies them.
              </p>
            </div>
            <div class="guard__card">
              <h3>Executable guardrails</h3>
              <p>
                Intent becomes scenarios, and scenarios run. A change is only
                done when the behavior checks pass, so the agent has a concrete
                target instead of a vibe.
              </p>
            </div>
            <div class="guard__card">
              <h3>Bounded blast radius</h3>
              <p>
                Slices own private state and coordinate through registered
                Events. Cross-Slice effects are therefore visible in Event
                contracts and Scenarios instead of hidden state sharing.
              </p>
            </div>
            <div class="guard__checks">
              <p class="guard__checks-title">behavior checks</p>
              <ul>
                <li class="pass">
                  <span class="tick" aria-hidden="true">
                    ✓
                  </span>
                  Creates a todo with the given title
                </li>
                <li class="pass">
                  <span class="tick" aria-hidden="true">
                    ✓
                  </span>
                  Rejects a blank title
                </li>
                <li class="pass">
                  <span class="tick" aria-hidden="true">
                    ✓
                  </span>
                  Appends exactly one todo-added event
                </li>
              </ul>
              <p class="guard__checks-foot">2 slices · 3 scenarios · 0 red</p>
            </div>
          </div>
        </Section>

        <Section
          id="spec"
          eyebrow="Structured specs"
          title="One contract, with a separate executable implementation"
          lead="The immutable specification contains production examples, while the implementation supplies schemas, Store, apply handlers, and behavior. A test helper checks their conformance."
        >
          <div class="spec">
            <figure class="code">
              <figcaption class="code__bar">
                <span class="code__dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span class="code__file">
                  features/todos/add-todo/spec.ts + impl.ts
                </span>
              </figcaption>
              <pre class="code__body">
                <code>{sliceSource}</code>
              </pre>
            </figure>
            <div class="spec__tests">
              <p class="spec__tests-title">
                scenario checks — testSliceImplementations
              </p>
              <ul>
                <For each={scenarioChecks}>
                  {(name) => (
                    <li>
                      <span class="tick" aria-hidden="true">
                        ✓
                      </span>
                      <code>{name}</code>
                    </li>
                  )}
                </For>
              </ul>
              <p class="spec__tests-foot">
                One explicit test file supplies Event Definitions and a{' '}
                <code>runScenario</code> environment; the examples remain in the
                spec.
              </p>
            </div>
          </div>
        </Section>

        <Section
          id="events"
          eyebrow="Durable by design"
          title="Recorded facts can rebuild state when storage is durable"
          lead="Specter is event-sourced: state is derived from the ordered Event Log. The app-provided Event Log adapter must still guarantee atomic commits and use durable, backed-up storage."
        >
          <div class="events">
            <div class="events__log">
              <div class="events__log-head">
                event log excerpt · append-only
              </div>
              <ol>
                <li>
                  <span class="events__id">#13</span>
                  <code>todo-added</code>
                  <span class="events__meta">title: "Ship it"</span>
                </li>
                <li>
                  <span class="events__id">#14</span>
                  <code>todo-completion-changed</code>
                  <span class="events__meta">completed: true · fifth</span>
                </li>
                <li>
                  <span class="events__id">#15</span>
                  <code>todo-cheer-created</code>
                  <span class="events__meta">milestone: 5</span>
                </li>
              </ol>
            </div>
            <div class="events__copy">
              <p>
                Each accepted command appends events in order and in one
                transaction. Nothing is edited in place, so history is auditable
                and every read model can be rebuilt by replaying the log.
              </p>
              <p>
                Because state is a projection of events, recovery is not a
                special case — it is just catch-up from the last cursor.
              </p>
            </div>
          </div>
        </Section>

        <Section
          id="orchestrate"
          eyebrow="Orchestration"
          title="Slices coordinate through events, not calls"
          lead="After a command succeeds, a Reaction Slice catches up and may produce zero or one ephemeral Reaction Effect. Its explicit Reaction Plugin interprets that effect after the transaction."
        >
          <div class="flow">
            <div class="flow__node flow__node--cmd">
              <span class="flow__kind">command</span>
              changeTodoCompletion
            </div>
            <span class="flow__arrow" aria-hidden="true">
              →
            </span>
            <div class="flow__node flow__node--evt">
              <span class="flow__kind">event</span>
              todo-completion-changed
            </div>
            <span class="flow__arrow" aria-hidden="true">
              →
            </span>
            <div class="flow__node flow__node--rxn">
              <span class="flow__kind">reaction</span>
              todoCompletionCheer
            </div>
            <span class="flow__arrow" aria-hidden="true">
              →
            </span>
            <div class="flow__node flow__node--evt">
              <span class="flow__kind">reaction effect</span>
              createTodoCheer
            </div>
          </div>
          <p class="flow__note">
            The explicit Plugin may call an API or dispatch another command. One
            failed Reaction does not prevent unrelated Reactions from being
            attempted in the same run.
          </p>
        </Section>

        <Section
          id="anywhere"
          eyebrow="No lock-in"
          title="Runs anywhere, opinionated about nothing"
          lead="Specter owns your domain behavior and leaves the edges to you. Immutable specifications and the typed client contract stay stable while implementations and runtime wiring choose storage, transport, and UI."
        >
          <div class="grid">
            <For each={anywhere}>
              {(item) => (
                <article class="grid__card">
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              )}
            </For>
          </div>
        </Section>

        <Section
          id="external"
          eyebrow="Integrations"
          title="Reach any external API through a reaction"
          lead="External calls are not sprinkled through your handlers. A Reaction Slice emits a Reaction Effect, and an explicit Reaction Plugin interprets it — email, payments, another service, or another Specter App."
        >
          <div class="integr">
            <div class="integr__node">
              <span class="flow__kind">reaction effect</span>
              sendReceiptEmail
            </div>
            <span class="integr__arrow" aria-hidden="true">
              →
            </span>
            <div class="integr__plugin">
              <span class="flow__kind">reaction plugin</span>
              emailPlugin
            </div>
            <span class="integr__arrow" aria-hidden="true">
              →
            </span>
            <div class="integr__ext">Email API</div>
          </div>
          <p class="flow__note">
            The side effect lives at an explicit, testable boundary, keeping
            integration code out of Slice handlers and Plugins replaceable.
          </p>
        </Section>

        <Section
          id="capabilities"
          eyebrow="Why it holds together"
          title="The spec is the single source of truth"
        >
          <div class="grid grid--three">
            <For each={capabilities}>
              {(item) => (
                <article class="grid__card">
                  <span class="grid__tag">{item.tag}</span>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              )}
            </For>
          </div>
        </Section>

        <Section
          id="map"
          eyebrow="Architecture vocabulary"
          title="Make Slice and Event relationships visible"
          lead="Registered Slices and Event Definitions provide a precise vocabulary for architecture reviews. This page illustrates that model; the current framework does not generate maps from application code."
        >
          <figure class="map">
            <svg
              class="map__svg"
              viewBox="0 0 720 260"
              role="img"
              aria-label="Illustrative architecture: changeTodoCompletion emits todo-completion-changed; todosQuery applies it, while todoCompletionCheer may produce the createTodoCheer Reaction Effect."
            >
              <defs>
                <marker
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                </marker>
              </defs>

              <line class="map__edge" x1="210" y1="94" x2="240" y2="106" />
              <line class="map__edge" x1="360" y1="106" x2="390" y2="94" />
              <line class="map__edge" x1="510" y1="94" x2="540" y2="106" />
              <line class="map__edge" x1="360" y1="154" x2="390" y2="166" />

              <g class="map__cmd">
                <rect x="70" y="46" width="160" height="48" rx="10" />
                <text x="150" y="66">
                  command
                </text>
                <text x="150" y="84" class="map__strong">
                  changeTodoCompletion
                </text>
              </g>

              <g class="map__evt">
                <rect x="202" y="106" width="196" height="48" rx="10" />
                <text x="300" y="126">
                  event
                </text>
                <text x="300" y="144" class="map__strong">
                  todo-completion-changed
                </text>
              </g>

              <g class="map__rxn">
                <rect x="372" y="46" width="156" height="48" rx="10" />
                <text x="450" y="66">
                  reaction
                </text>
                <text x="450" y="84" class="map__strong">
                  todoCompletionCheer
                </text>
              </g>

              <g class="map__qry">
                <rect x="372" y="166" width="156" height="48" rx="10" />
                <text x="450" y="186">
                  query
                </text>
                <text x="450" y="204" class="map__strong">
                  todosQuery
                </text>
              </g>

              <g class="map__rxn">
                <rect x="522" y="106" width="156" height="48" rx="10" />
                <text x="600" y="126">
                  reaction effect
                </text>
                <text x="600" y="144" class="map__strong">
                  createTodoCheer
                </text>
              </g>
            </svg>
            <figcaption>
              An illustrative review aid using registered Slice and Event names.
            </figcaption>
          </figure>
        </Section>

        <section class="cta" id="start">
          <div class="cta__inner">
            <p class="eyebrow eyebrow--accent">Getting started</p>
            <h2>Scaffold a Specter project in one command</h2>
            <p class="cta__lead">
              The initializer copies a scenario-tested reference app so you —
              and your agents — start inside the guardrails on day one.
            </p>
            <CopyCommand command={installCommand} big />
            <p class="cta__hint">
              Requires a current Node.js release. Add <code>-- --install</code>{' '}
              to install dependencies automatically.
            </p>
          </div>
        </section>
      </main>

      <footer class="footer">
        <div class="footer__brand">
          <span class="brand__mark" aria-hidden="true" />
          <span>Specter</span>
        </div>
        <p>
          A TypeScript runtime for vertically sliced, event-sourced
          applications.
        </p>
        <p class="footer__fine">MIT licensed · specs that compile</p>
      </footer>
    </div>
  )
}
