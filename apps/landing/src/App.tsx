import { createSignal, For, type JSX } from 'solid-js'
import {
  commandImplementationCode,
  commandSpecCode,
  eventLogCode,
  installCommand,
  scenarioTestCode,
  scenarioTestOutput,
  sliceCards,
  supportCards,
  workbenchCards,
} from './content'

function InstallCommand(props: { block?: boolean }): JSX.Element {
  const [copyStatus, setCopyStatus] = createSignal<
    'idle' | 'copied' | 'failed'
  >('idle')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(installCommand)
      setCopyStatus('copied')
      setTimeout(() => setCopyStatus('idle'), 1600)
    } catch {
      setCopyStatus('failed')
    }
  }

  const visibleStatus = () => {
    if (copyStatus() === 'copied') return 'copied'
    if (copyStatus() === 'failed') return 'retry'
    return 'copy'
  }

  return (
    <div
      class={`install ${props.block ? 'install--block' : 'install--inline'}`}
    >
      <code class="install__command">
        <span class="install__prompt" aria-hidden="true">
          $
        </span>{' '}
        {installCommand}
      </code>
      <button
        type="button"
        class="install__copy"
        aria-label="Copy the Specter project creation command"
        onClick={copy}
      >
        {visibleStatus()}
      </button>
      <span class="sr-only" aria-live="polite">
        {copyStatus() === 'copied'
          ? 'Install command copied to clipboard.'
          : copyStatus() === 'failed'
            ? 'Could not copy the install command. Select and copy it manually.'
            : ''}
      </span>
    </div>
  )
}

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
    <section class="hero">
      <div class="hero__copy">
        <p class="eyebrow">Slice Lab · specify · implement · validate</p>
        <h1 class="hero__title">
          specifications that compile execute and scaffold your app
        </h1>
        <p class="hero__lede">
          Specter is a TypeScript framework for vertically sliced, event-sourced
          applications. Each Command, Query, or Reaction Slice separates its
          immutable behavior specification from the schemas, private state, and
          handlers that implement it.
        </p>
        <div class="hero__actions">
          <a class="btn btn--primary" href="#start">
            Start building
          </a>
          <InstallCommand />
        </div>
        <ul class="hero__facts">
          <li>Exact scenarios per Slice</li>
          <li>Private event-derived state</li>
          <li>Construction-time conformance</li>
        </ul>
      </div>
      <div class="hero__bench" aria-hidden="true">
        <div class="bench">
          <span class="bench__label">workbench</span>
          <div class="bench__slices">
            <For each={workbenchCards}>
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
    title: 'Specify the behavior',
    body: 'Name one Command, Query, or Reaction Slice and record its description and exact scenarios in spec.ts.',
  },
  {
    n: '02',
    title: 'Implement the how',
    body: 'Complete that specification in impl.ts with schemas, a private store, apply handlers, and its terminal handler.',
  },
  {
    n: '03',
    title: 'Validate and compose',
    body: 'Run the implementation against its scenarios, then register one completed implementation for that Slice name.',
  },
]

function HowItWorks(): JSX.Element {
  return (
    <section class="section" id="how">
      <div class="section__head">
        <h2>A lab bench for every slice of behavior</h2>
        <p>
          Instead of one tangled model, Specter apps are assembled from small,
          explicit Slices. Each keeps its behavior contract separate from its
          runtime details and owns only the state it needs.
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
        <h2>The what and the how stay separate</h2>
        <p>
          A Slice Specification contains only a name, description, and exact
          scenarios. Its implementation adds schemas, private Slice State, typed
          Event apply handlers, and the Command handler.
        </p>
        <ul class="ticks">
          <li>
            Specs import from <code>@specter-ts/core/spec</code>
          </li>
          <li>Scenario Events use exact payload examples</li>
          <li>Implementations emit validated Event Drafts</li>
        </ul>
      </div>
      <div class="stack">
        <CodePanel
          file="features/bookings/request-booking/spec.ts"
          code={commandSpecCode}
        />
        <CodePanel
          file="features/bookings/request-booking/impl.ts"
          code={commandImplementationCode}
        />
      </div>
    </section>
  )
}

function Tests(): JSX.Element {
  return (
    <section class="section section--split section--reverse" id="tests">
      <div class="section__head section__head--left">
        <p class="kicker">Executable scenarios</p>
        <h2>Implementations run against their specs</h2>
        <p>
          A test entry point calls <code>testSliceImplementations</code> with
          the selected registrations, Event Definition catalog, and scenario
          runner. Given Events rebuild private test state before the expected
          result is checked.
        </p>
      </div>
      <div class="stack">
        <CodePanel
          file="features/bookings/scenarios.test.ts"
          code={scenarioTestCode}
        />
        <CodePanel
          file="pnpm --filter @specter/booking-reference test"
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
        <p class="kicker">The three Slice kinds</p>
        <h2>Command, Query, and Reaction boundaries</h2>
        <p>
          Every Slice has one kind and one private behavior boundary. The
          specification owns its scenarios; the selected implementation owns
          runtime schemas, state, and handlers.
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
      <div class="supporting">
        <div class="section__head">
          <p class="kicker">Supporting boundaries</p>
          <h2>Specifications and plugins stay explicit</h2>
          <p>
            These are not additional Slice kinds. They describe behavior and
            interpret Reaction outputs around the three runtime Slice kinds.
          </p>
        </div>
        <div class="grid grid--support">
          <For each={supportCards}>
            {(card) => (
              <article class="card" data-tag={card.tag}>
                <div class="card__top">
                  <span class="card__tag">{card.tag}</span>
                  <span class="card__kind">{card.kind}</span>
                </div>
                <h3 class="card__name">{card.name}</h3>
                <p class="card__summary">{card.summary}</p>
                <p class="card__context">{card.context}</p>
              </article>
            )}
          </For>
        </div>
      </div>
    </section>
  )
}

function Events(): JSX.Element {
  return (
    <section class="section section--split" id="events">
      <div class="section__head section__head--left">
        <p class="kicker">Durable events</p>
        <h2>Accepted facts stay in one ordered history</h2>
        <p>
          The Event Log is the durable source of truth for one Specter App.
          Accepted Commands append domain facts, while log IDs, order, and
          recorded timestamps remain metadata outside Event payloads.
        </p>
        <p>
          Command, Query, and Reaction Slices catch up by applying the relevant
          Events in global order. The starter supplies a SQLite adapter; core
          depends on the Event Log and Slice Store adapter contracts.
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
    title: 'Event Log adapter',
    body: 'The starter supplies SQLite persistence. A Specter App depends on the ordered Event Log adapter contract.',
  },
  {
    title: 'Slice Store adapter',
    body: 'Each implementation selects a store for private Slice State and applies relevant Events as it catches up.',
  },
  {
    title: 'Typed client boundary',
    body: 'Command and Query names become flat client methods. UI code stays independent of server and database modules.',
  },
  {
    title: 'Reaction Plugin',
    body: 'A plugin interprets validated Reaction output by dispatching a Command or calling an external service.',
  },
]

function Anywhere(): JSX.Element {
  return (
    <section class="section" id="anywhere">
      <div class="section__head">
        <p class="kicker">Explicit seams</p>
        <h2>Choose adapters without changing the spec</h2>
        <p>
          Specifications are independent of persistence, transport, and UI
          choices. Implementations and app wiring make those concrete decisions
          visible.
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
          <h2>Small boundaries, strong guardrails</h2>
          <p>
            A Slice keeps its <code>spec.ts</code> and <code>impl.ts</code> in
            one feature folder. An agent can focus on that behavior boundary and
            the Events it applies instead of loading the whole app.
          </p>
          <p>
            Scenario tests check exact outcomes, while app construction reports
            conformance problems with the Slice, Scenario, Event position, and
            schema path.
          </p>
        </div>
        <div class="section__head section__head--left">
          <p class="kicker">Follow the flow</p>
          <h2>Composition stays explicit in code</h2>
          <p>
            Feature registries list selected implementations and Event
            Definitions. Exact Scenario Events and typed apply handlers make it
            possible to trace how a fact moves through the app.
          </p>
          <div class="flowmap" aria-hidden="true">
            <span class="flowmap__node" data-tag="command">
              requestBooking
            </span>
            <span class="flowmap__arrow">→</span>
            <span class="flowmap__node" data-tag="event">
              booking-requested
            </span>
            <span class="flowmap__arrow">→</span>
            <span class="flowmap__node" data-tag="reaction">
              approvalNotificationReaction
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
        <h2>Create the Specter starter</h2>
        <p>
          Start with the Todo reference app, current agent guidance, SQLite
          adapters, scenario tests, and working Slice registrations.
        </p>
        <InstallCommand block />
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
        A TypeScript framework for vertically sliced, event-sourced
        applications.
      </p>
    </footer>
  )
}

export function App(): JSX.Element {
  return (
    <div class="page" id="top">
      <a class="skip-link" href="#main-content">
        Skip to content
      </a>
      <Header />
      <main id="main-content" tabIndex={-1}>
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
