import { type JSX, createSignal, For } from 'solid-js'

const installCommand = 'npm create specter@latest my-app'

const sliceSource = `import { z } from 'zod'
import { createCommandSlice } from '@specter-ts/core'
import { todoAddedEvent } from '../events'

export default createCommandSlice('addTodo', 'Adds a todo to the list.')
  .schema(z.object({ title: z.string().min(1).max(120) }))
  .scenarios(
    {
      description: 'Creates a todo with the given title.',
      given: [],
      when: { title: 'Ship it' },
      expect: [todoAddedEvent.create({ todoId: 'generated', title: 'Ship it' })],
    },
    {
      description: 'Rejects a blank title.',
      given: [],
      when: { title: '   ' },
      reject: { reason: 'Todo title is required' },
    },
  )
  .handle(async ({ title }) => [
    todoAddedEvent.create({ todoId: crypto.randomUUID(), title: title.trim() }),
  ])`

const generatedTests = [
  'addTodo › Creates a todo with the given title.',
  'addTodo › Rejects a blank title.',
]

const railStack = [
  { name: 'requestBooking', state: 'out' },
  { name: 'confirmBooking', state: 'out' },
  { name: 'addTodo', state: 'focus' },
  { name: 'completeTodo', state: 'out' },
  { name: 'todoCheers', state: 'out' },
]

const capabilities = [
  {
    tag: '01',
    title: 'Specs are structured, not prose',
    body: 'A slice declares its command, its input schema, and its scenarios in one place. The spec is real TypeScript that compiles — not a wiki page that drifts from the code.',
  },
  {
    tag: '02',
    title: 'Scenarios are the behavior tests',
    body: 'Every scenario — given events, when input, expect events — runs as an executable check. There is no second copy of the truth to keep in sync. The spec is the test suite.',
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
    body: 'The Event Log is reached through one adapter. Point it at SQLite, Postgres, libSQL, or your own store — the slices never change.',
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
  const [copied, setCopied] = createSignal(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div class={props.big ? 'cmd cmd--big' : 'cmd'}>
      <span class="cmd__prompt" aria-hidden="true">
        $
      </span>
      <code class="cmd__text">{props.command}</code>
      <button class="cmd__copy" type="button" onClick={copy}>
        {copied() ? 'copied' : 'copy'}
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
    <div class="page">
      <header class="nav">
        <a class="brand" href="#top">
          <span class="brand__mark" aria-hidden="true" />
          <span class="brand__name">Specter</span>
        </a>
        <nav class="nav__links">
          <a href="#guardrails">Guardrails</a>
          <a href="#spec">Specs</a>
          <a href="#events">Events</a>
          <a href="#map">Architecture</a>
        </nav>
        <a class="nav__cta" href="#start">
          npm create specter
        </a>
      </header>

      <main id="top">
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
              Specter turns structured specs into a running, event-sourced
              application. Slices define behavior, scenarios prove it, and the
              same specs scaffold your app — so AI agents work one verifiable
              slice at a time instead of rewriting your codebase.
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

          <aside class="context" aria-label="Agent context window">
            <div class="context__chrome">
              <span class="context__label">agent context</span>
              <span class="context__budget">1 slice loaded</span>
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
                        <span class="rail__badge">in context</span>
                      ) : (
                        <span class="rail__muted">out of context</span>
                      )}
                    </li>
                  )}
                </For>
              </ul>
            </div>
            <p class="context__note">
              The agent only sees the slice it is changing. Everything else
              stays behind the rails.
            </p>
          </aside>
        </section>

        <section class="strip" aria-label="How it works">
          <ol class="steps">
            <li>
              <span class="steps__num">1</span>
              <h3>Write a slice</h3>
              <p>
                Declare a command or query, its schema, and its scenarios as
                typed TypeScript.
              </p>
            </li>
            <li>
              <span class="steps__num">2</span>
              <h3>Execute the spec</h3>
              <p>
                Scenarios run as behavior tests over the event log — the spec
                and the tests are one artifact.
              </p>
            </li>
            <li>
              <span class="steps__num">3</span>
              <h3>Scaffold the app</h3>
              <p>
                Registered slices compose into a running Specter App with a
                typed client and durable events.
              </p>
            </li>
          </ol>
        </section>

        <Section
          id="guardrails"
          eyebrow="Design direction — agent guardrails"
          title="Give agents rails, not the whole repo"
          lead="Large context windows invite broad, accidental rewrites. Specter hands an agent one slice, one schema, and one set of scenarios — a bounded problem with a green/red answer."
        >
          <div class="guard">
            <div class="guard__card">
              <h3>Minimized context</h3>
              <p>
                A slice is self-contained: its events, its state, its scenarios.
                The agent loads that slice and the events it declares interest
                in — not the rest of the application.
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
                Slices own private state and communicate only through events. A
                change inside one slice cannot silently reach across the app, so
                edits stay local and reviewable.
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
                  Appends exactly one todoAdded event
                </li>
              </ul>
              <p class="guard__checks-foot">2 slices · 3 scenarios · 0 red</p>
            </div>
          </div>
        </Section>

        <Section
          id="spec"
          eyebrow="Structured specs"
          title="One slice, and it already tests itself"
          lead="This is a real Command Slice. The scenarios beside it are not documentation — they are the test suite that runs against the event log."
        >
          <div class="spec">
            <figure class="code">
              <figcaption class="code__bar">
                <span class="code__dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span class="code__file">features/todos/add-todo/slice.ts</span>
              </figcaption>
              <pre class="code__body">
                <code>{sliceSource}</code>
              </pre>
            </figure>
            <div class="spec__tests">
              <p class="spec__tests-title">
                behavior tests — generated from the spec
              </p>
              <ul>
                <For each={generatedTests}>
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
                No extra test files. Change the scenario, change the contract.
              </p>
            </div>
          </div>
        </Section>

        <Section
          id="events"
          eyebrow="Durable by design"
          title="The app never loses what happened"
          lead="Specter is event-sourced. State is derived from an ordered, durable Event Log — the recorded facts are the source of truth, not a mutable table you can overwrite."
        >
          <div class="events">
            <div class="events__log">
              <div class="events__log-head">event log · append-only</div>
              <ol>
                <li>
                  <span class="events__id">#1</span>
                  <code>todoAdded</code>
                  <span class="events__meta">title: "Ship it"</span>
                </li>
                <li>
                  <span class="events__id">#2</span>
                  <code>todoCompletionChanged</code>
                  <span class="events__meta">completed: true</span>
                </li>
                <li>
                  <span class="events__id">#3</span>
                  <code>todoCheerCreated</code>
                  <span class="events__meta">milestone: 1</span>
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
          lead="A command appends an event. Reaction Slices observe new events after that command succeeds and may emit their own commands — so features compose without importing each other."
        >
          <div class="flow">
            <div class="flow__node flow__node--cmd">
              <span class="flow__kind">command</span>
              addTodo
            </div>
            <span class="flow__arrow" aria-hidden="true">
              →
            </span>
            <div class="flow__node flow__node--evt">
              <span class="flow__kind">event</span>
              todoAdded
            </div>
            <span class="flow__arrow" aria-hidden="true">
              →
            </span>
            <div class="flow__node flow__node--rxn">
              <span class="flow__kind">reaction</span>
              todoCheers
            </div>
            <span class="flow__arrow" aria-hidden="true">
              →
            </span>
            <div class="flow__node flow__node--evt">
              <span class="flow__kind">event</span>
              todoCheerCreated
            </div>
          </div>
          <p class="flow__note">
            Reactions run in their own effect boundary. One reaction failing
            does not take down unrelated reactions in the same run.
          </p>
        </Section>

        <Section
          id="anywhere"
          eyebrow="No lock-in"
          title="Runs anywhere, opinionated about nothing"
          lead="Specter owns your domain behavior and leaves the edges to you. Storage, transport, and UI are adapters — swap them without touching a slice."
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
            <div class="integr__node">todoCheerCreated</div>
            <span class="integr__arrow" aria-hidden="true">
              →
            </span>
            <div class="integr__plugin">
              <span class="flow__kind">reaction plugin</span>
              sendEmail / callApi / dispatchCommand
            </div>
            <span class="integr__arrow" aria-hidden="true">
              →
            </span>
            <div class="integr__ext">External API</div>
          </div>
          <p class="flow__note">
            The side effect lives at an explicit, testable boundary — so your
            command logic stays pure and your integrations stay swappable.
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
          eyebrow="Generated visuals"
          title="Turn slices and events into an architecture map"
          lead="Because specs are structured, Specter can read your slices, events, and reactions and render the dataflow — a diagram that stays honest because it is derived from the code, not drawn by hand."
        >
          <figure class="map">
            <svg
              class="map__svg"
              viewBox="0 0 720 260"
              role="img"
              aria-label="Architecture diagram derived from slices and events"
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

              <line class="map__edge" x1="150" y1="70" x2="300" y2="130" />
              <line class="map__edge" x1="300" y1="130" x2="450" y2="70" />
              <line class="map__edge" x1="450" y1="70" x2="600" y2="130" />
              <line class="map__edge" x1="300" y1="130" x2="450" y2="190" />

              <g class="map__cmd">
                <rect x="70" y="46" width="160" height="48" rx="10" />
                <text x="150" y="66">
                  command
                </text>
                <text x="150" y="84" class="map__strong">
                  addTodo
                </text>
              </g>

              <g class="map__evt">
                <rect x="222" y="106" width="156" height="48" rx="10" />
                <text x="300" y="126">
                  event
                </text>
                <text x="300" y="144" class="map__strong">
                  todoAdded
                </text>
              </g>

              <g class="map__rxn">
                <rect x="372" y="46" width="156" height="48" rx="10" />
                <text x="450" y="66">
                  reaction
                </text>
                <text x="450" y="84" class="map__strong">
                  todoCheers
                </text>
              </g>

              <g class="map__qry">
                <rect x="372" y="166" width="156" height="48" rx="10" />
                <text x="450" y="186">
                  query
                </text>
                <text x="450" y="204" class="map__strong">
                  listTodos
                </text>
              </g>

              <g class="map__evt">
                <rect x="522" y="106" width="156" height="48" rx="10" />
                <text x="600" y="126">
                  event
                </text>
                <text x="600" y="144" class="map__strong">
                  todoCheerCreated
                </text>
              </g>
            </svg>
            <figcaption>
              Nodes and edges are inferred from registered slices and their
              event interests.
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
              Requires Node.js 24+. Add <code>-- --install</code> to install
              dependencies automatically.
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
