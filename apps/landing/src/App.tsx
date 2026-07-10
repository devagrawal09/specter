import { For, type JSX } from 'solid-js'
import {
  commandSliceCode,
  eventLogCode,
  installCommand,
  scenarioTestCode,
  scenarioTestOutput,
  sliceCards,
} from './content'

function CodePanel(props: {
  file: string
  code: string
  variant?: 'default' | 'output'
}): JSX.Element {
  return (
    <figure class="panel" data-variant={props.variant ?? 'default'}>
      <figcaption class="panel__bar">
        <span class="panel__dot" aria-hidden="true" />
        <span class="panel__file">{props.file}</span>
      </figcaption>
      <pre class="panel__code">
        <code>{props.code}</code>
      </pre>
    </figure>
  )
}

function Header(): JSX.Element {
  return (
    <header class="site-header">
      <a class="brand" href="#top">
        <span class="brand__mark" aria-hidden="true">
          <i /> <i /> <i /> <i />
        </span>
        <span class="brand__name">Specter</span>
        <span class="brand__lab">Slice Lab</span>
      </a>
      <nav class="site-nav" aria-label="Primary">
        <a href="#how">How it works</a>
        <a href="#slices">Slices</a>
        <a href="#events">Events</a>
        <a href="#anywhere">Runs anywhere</a>
        <a class="site-nav__cta" href="#start">
          Get started
        </a>
      </nav>
    </header>
  )
}

function Hero(): JSX.Element {
  return (
    <section class="hero" id="top">
      <div class="hero__copy">
        <p class="eyebrow">Slice Lab · vertically sliced, event-sourced</p>
        <h1 class="hero__title">
          specifications that compile execute and scaffold your app
        </h1>
        <p class="hero__lede">
          Specter is a TypeScript runtime for vertically sliced, event-sourced
          applications. You write a structured specification for each slice of
          behavior — Specter compiles it into a running app, executes it as a
          test suite, and scaffolds the files around it.
        </p>
        <div class="hero__actions">
          <a class="btn btn--primary" href="#start">
            Start building
          </a>
          <code class="install install--inline">{installCommand}</code>
        </div>
        <ul class="hero__facts">
          <li>Small context per slice</li>
          <li>Local tests from specs</li>
          <li>Ship slices independently</li>
        </ul>
      </div>
      <div class="hero__bench" aria-hidden="true">
        <div class="bench">
          <span class="bench__label">workbench</span>
          <div class="bench__slices">
            <For each={sliceCards}>
              {(slice) => (
                <div class="chip" data-tag={slice.tag}>
                  <span class="chip__tag">{slice.tag}</span>
                  <span class="chip__name">{slice.name}</span>
                </div>
              )}
            </For>
          </div>
          <div class="bench__rail">
            <span>event log</span>
            <div class="bench__events">
              <i /> <i /> <i /> <i /> <i /> <i />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

const steps = [
  {
    n: '01',
    title: 'Specify a slice',
    body: 'Declare a command, query, or reaction with a schema and the events it cares about. One slice, one small comprehension boundary.',
  },
  {
    n: '02',
    title: 'Compile & execute',
    body: 'Scenarios attached to the slice run as behavior tests. The runtime wires slices into a Specter App with a single event log.',
  },
  {
    n: '03',
    title: 'Ship independently',
    body: 'Because each slice owns its own state and tests, you build, verify, and release it without touching the rest of the app.',
  },
]

function HowItWorks(): JSX.Element {
  return (
    <section class="section" id="how">
      <div class="section__head">
        <h2>A lab bench for every slice of behavior</h2>
        <p>
          Instead of one tangled model, Specter apps are assembled from small,
          independent slices. Each is specified, tested, and scaffolded on its
          own bench before it joins the app.
        </p>
      </div>
      <ol class="steps">
        <For each={steps}>
          {(step) => (
            <li class="step">
              <span class="step__n">{step.n}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          )}
        </For>
      </ol>
    </section>
  )
}

function Specs(): JSX.Element {
  return (
    <section class="section section--split" id="specs">
      <div class="section__head section__head--left">
        <p class="kicker">Structured specs</p>
        <h2>The specification is the code</h2>
        <p>
          A slice is a typed specification. This Command Slice declares its
          input schema, the scenarios it must satisfy, and a handler that
          decides which events to emit — or rejects the command when no event
          would be valid.
        </p>
        <ul class="ticks">
          <li>Schema-checked command input</li>
          <li>Events are the only output</li>
          <li>Decision state derived from the log</li>
        </ul>
      </div>
      <CodePanel
        file="features/bookings/request-booking/slice.ts"
        code={commandSliceCode}
      />
    </section>
  )
}

function Tests(): JSX.Element {
  return (
    <section class="section section--split section--reverse" id="tests">
      <div class="section__head section__head--left">
        <p class="kicker">Specs become tests</p>
        <h2>Scenarios run as behavior tests</h2>
        <p>
          The <code>given / when / expect</code> scenarios you attach to a slice
          are executable. Specter replays the given events, applies the input,
          and asserts the emitted events or the rejection — so the specification
          and the test never drift apart.
        </p>
      </div>
      <div class="stack">
        <CodePanel
          file="features/bookings/scenarios.test.ts"
          code={scenarioTestCode}
        />
        <CodePanel
          file="pnpm --filter app test"
          code={scenarioTestOutput}
          variant="output"
        />
      </div>
    </section>
  )
}

function Slices(): JSX.Element {
  return (
    <section class="section" id="slices">
      <div class="section__head">
        <p class="kicker">The Slice Lab</p>
        <h2>Independent slices, small context, local tests</h2>
        <p>
          Every vertical feature is built from a few kinds of slice. Each one
          keeps its own state and scenarios, so an agent or a human can reason
          about it in isolation and ship it alone.
        </p>
      </div>
      <div class="grid">
        <For each={sliceCards}>
          {(slice) => (
            <article class="card" data-tag={slice.tag}>
              <div class="card__top">
                <span class="card__tag">{slice.tag}</span>
                <span class="card__kind">{slice.kind}</span>
              </div>
              <h3 class="card__name">{slice.name}</h3>
              <p class="card__summary">{slice.summary}</p>
              <p class="card__context">{slice.context}</p>
            </article>
          )}
        </For>
      </div>
    </section>
  )
}

function Events(): JSX.Element {
  return (
    <section class="section section--split" id="events">
      <div class="section__head section__head--left">
        <p class="kicker">Durable events</p>
        <h2>The app never loses what happened</h2>
        <p>
          State is derived, not stored in place. Every accepted command appends
          facts to one ordered, append-only event log. Nothing is overwritten,
          so any slice's state can be rebuilt by replaying events — and the
          history is always there to audit.
        </p>
        <p>
          Specter orchestrates slices through those events: a command appends,
          query slices catch up to serve reads, and reaction slices observe new
          events and dispatch follow-up commands through explicit plugins.
        </p>
      </div>
      <CodePanel
        file="event-log (append-only)"
        code={eventLogCode}
        variant="output"
      />
    </section>
  )
}

const adapters = [
  {
    title: 'Any database',
    body: 'The event log and slice state live behind adapters. Start on SQLite, move to Postgres or libSQL without rewriting a slice.',
  },
  {
    title: 'Any protocol',
    body: 'The Specter Client exposes flat, typed methods. Serve them over HTTP, RPC, or a queue — the runtime has no opinion.',
  },
  {
    title: 'Any frontend',
    body: 'Slice methods are framework-agnostic. Wire them to Solid, React, or no UI at all; the contract stays the same.',
  },
  {
    title: 'Any external API',
    body: 'A reaction slice emits an effect; its plugin interprets it against an outside service. Swap the plugin to change the integration.',
  },
]

function Anywhere(): JSX.Element {
  return (
    <section class="section" id="anywhere">
      <div class="section__head">
        <p class="kicker">Runs anywhere</p>
        <h2>No opinions about your stack</h2>
        <p>
          Specter is storage-agnostic by design. Databases, protocols, and
          frontends are all adapters, and connecting to an external API is just
          another reaction plugin.
        </p>
      </div>
      <div class="grid grid--adapters">
        <For each={adapters}>
          {(adapter) => (
            <article class="tile">
              <h3>{adapter.title}</h3>
              <p>{adapter.body}</p>
            </article>
          )}
        </For>
      </div>
    </section>
  )
}

function Agents(): JSX.Element {
  return (
    <section class="section section--panelled" id="agents">
      <div class="dual">
        <div class="section__head section__head--left">
          <p class="kicker">Built for coding agents</p>
          <h2>Small context, strong guardrails</h2>
          <p>
            A slice is a tight unit of work: one schema, one handler, its own
            scenarios. An agent only needs the files for that slice, so context
            stays small and focused.
          </p>
          <p>
            The scenarios are the guardrails. If a change breaks the specified
            behavior, the slice's own tests fail immediately — before the change
            ever reaches the rest of the app.
          </p>
        </div>
        <div class="section__head section__head--left">
          <p class="kicker">Visualize the system</p>
          <h2>Specs render as architecture</h2>
          <p>
            Because slices and events are structured data, Specter can translate
            them into diagrams: which commands emit which events, which slices
            react, and how data flows across a feature.
          </p>
          <div class="flowmap" aria-hidden="true">
            <span class="flowmap__node" data-tag="command">
              requestBooking
            </span>
            <span class="flowmap__arrow">→</span>
            <span class="flowmap__node" data-tag="event">
              bookingRequested
            </span>
            <span class="flowmap__arrow">→</span>
            <span class="flowmap__node" data-tag="reaction">
              approvalNotification
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

function GetStarted(): JSX.Element {
  return (
    <section class="section start" id="start">
      <div class="start__inner">
        <p class="kicker">Get started</p>
        <h2>Scaffold a Specter project</h2>
        <p>
          Create a new project with a reference app, agent skill, and your first
          slices already wired up.
        </p>
        <code class="install install--block">{installCommand}</code>
        <p class="start__note">
          Runs on Node with your package manager of choice. No account, no keys.
        </p>
      </div>
    </section>
  )
}

function Footer(): JSX.Element {
  return (
    <footer class="site-footer">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true">
          <i /> <i /> <i /> <i />
        </span>
        <span class="brand__name">Specter</span>
      </div>
      <p>
        A TypeScript runtime for vertically sliced, event-sourced applications.
      </p>
    </footer>
  )
}

export function App(): JSX.Element {
  return (
    <div class="page">
      <Header />
      <main>
        <Hero />
        <HowItWorks />
        <Specs />
        <Tests />
        <Slices />
        <Events />
        <Anywhere />
        <Agents />
        <GetStarted />
      </main>
      <Footer />
    </div>
  )
}
