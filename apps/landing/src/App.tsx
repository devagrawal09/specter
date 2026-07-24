import { createSignal, For, onCleanup, type JSX } from 'solid-js'
import { CodeBlock } from './CodeBlock'
import {
  adapters,
  agentBenefits,
  eventLog,
  externalApiSource,
  implementationSource,
  observabilityOutput,
  portableSpecSource,
  reactionSource,
  scenarioTestSource,
  specSource,
  stages,
} from './content'

const REPOSITORY_URL = 'https://github.com/devagrawal09/specter'
const CLONE_COMMAND = `git clone ${REPOSITORY_URL}.git`
const AGENT_PROMPT = `Summarize \`${CLONE_COMMAND}\``
const GETTING_STARTED_URL = `${REPOSITORY_URL}/blob/main/docs/getting-started.md`
const THEME_STORAGE_KEY = 'specter-theme'

type Theme = 'light' | 'dark'

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#f5f7f3' : '#0a0d11')
}

function ThemeToggle(): JSX.Element {
  const initialTheme: Theme =
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  const [theme, setTheme] = createSignal<Theme>(initialTheme)
  const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: light)')
  let followsSystem = true

  try {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY)
    followsSystem = storedTheme !== 'light' && storedTheme !== 'dark'
  } catch {
    // Without storage, keep following the system until this page's toggle is used.
  }

  const followSystemTheme = (event: MediaQueryListEvent) => {
    if (!followsSystem) return

    const systemTheme: Theme = event.matches ? 'light' : 'dark'
    applyTheme(systemTheme)
    setTheme(systemTheme)
  }

  colorSchemeQuery.addEventListener('change', followSystemTheme)
  onCleanup(() =>
    colorSchemeQuery.removeEventListener('change', followSystemTheme),
  )

  const toggleTheme = () => {
    const nextTheme: Theme = theme() === 'light' ? 'dark' : 'light'
    followsSystem = false
    applyTheme(nextTheme)
    setTheme(nextTheme)

    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
    } catch {
      // The selected theme still applies when storage is unavailable.
    }
  }

  return (
    <button
      type="button"
      class="theme-toggle"
      role="switch"
      aria-checked={theme() === 'light'}
      aria-label="Light mode"
      title={`Switch to ${theme() === 'light' ? 'dark' : 'light'} mode`}
      onClick={toggleTheme}
    >
      <span class="theme-toggle__glyph" aria-hidden="true">
        {theme() === 'light' ? '☼' : '◐'}
      </span>
      <span class="theme-toggle__label" aria-hidden="true">
        light
      </span>
    </button>
  )
}

function AgentPrompt(): JSX.Element {
  const [copyStatus, setCopyStatus] = createSignal<
    'idle' | 'prompt' | 'command' | 'failed'
  >('idle')

  const copy = async (value: string, success: 'prompt' | 'command') => {
    try {
      await navigator.clipboard.writeText(value)
      setCopyStatus(success)
      setTimeout(() => setCopyStatus('idle'), 1600)
    } catch {
      setCopyStatus('failed')
    }
  }

  return (
    <fieldset class="agent-prompt" aria-label="Specter agent prompt">
      <button
        type="button"
        class="agent-prompt__all"
        aria-label="Copy the complete Specter agent prompt"
        onClick={() => copy(AGENT_PROMPT, 'prompt')}
      >
        <span class="agent-prompt__lead">Summarize</span>{' '}
        <code class="agent-prompt__code">`{CLONE_COMMAND}`</code>
        <span class="agent-prompt__copy">
          {copyStatus() === 'prompt' ? 'copied prompt' : 'copy prompt'}
        </span>
      </button>
      <button
        type="button"
        class="agent-prompt__command"
        aria-label="Copy only the Specter clone command"
        onClick={() => copy(CLONE_COMMAND, 'command')}
      >
        {copyStatus() === 'command' ? 'copied command' : 'copy command'}
      </button>
      <span class="sr-only" aria-live="polite">
        {copyStatus() === 'prompt'
          ? 'Agent prompt copied to clipboard.'
          : copyStatus() === 'command'
            ? 'Clone command copied to clipboard.'
            : copyStatus() === 'failed'
              ? 'Could not copy to the clipboard. Select and copy it manually.'
              : ''}
      </span>
    </fieldset>
  )
}

export function App(): JSX.Element {
  return (
    <div class="page" id="top">
      <a class="skip-link" href="#main-content">
        Skip to content
      </a>
      <header class="topbar">
        <a class="brand" href="#top">
          <span class="brand__mark" aria-hidden="true">
            ▮
          </span>
          <span class="brand__name">Specter</span>
          <span class="brand__tag">0.4 · main</span>
        </a>
        <nav class="topnav" aria-label="Specter concepts">
          <For each={stages}>
            {(stage) => (
              <a class="topnav__link" href={`#${stage.id}`}>
                {stage.title}
              </a>
            )}
          </For>
        </nav>
        <a class="topbar__link" href={GETTING_STARTED_URL}>
          Docs
        </a>
        <ThemeToggle />
        <a class="topbar__cta" href="#start">
          <span class="topbar__cta-full">Give it to your agent</span>
          <span class="topbar__cta-short">Give to agent</span>
        </a>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section class="hero">
          <p class="preview-badge">Specter 0.4 · source preview</p>
          <p class="eyebrow">Executable contracts for agent-written code</p>
          <h1 class="hero__title">
            <a class="hero__compile-link" href="#can-agents-compile">
              “Compile”
            </a>{' '}
            JSON specs into complete applications.
          </h1>
          <p class="hero__lede">
            Different agents can produce different implementations. Specter
            gives them the same portable behavior contract and checks each
            implementation against it exactly.
          </p>

          <div class="hero__actions">
            <AgentPrompt />
            <a class="btn btn--ghost" href="#can-agents-compile">
              Why “compile”?
            </a>
            <a class="btn btn--text" href={REPOSITORY_URL}>
              View on GitHub ↗
            </a>
          </div>
        </section>

        <article class="compiler-article" id="can-agents-compile">
          <header class="compiler-article__head">
            <p class="eyebrow">The compiler angle</p>
            <h2>Can agents really compile specs into code?</h2>
            <p>
              “Compilation” names a capability, not a command or prescribed
              process. Specter gives nondeterministic code generation the parts
              that make compilation trustworthy: a stable source contract,
              constrained implementation boundaries, and deterministic
              acceptance.
            </p>
          </header>

          <div class="compiler-article__grid">
            <section>
              <span class="compiler-article__label">source contract</span>
              <h3>Executable specs define the target behavior</h3>
              <p>
                Portable JSON records the exact scenarios an implementation must
                satisfy. The same contract can guide different agents,
                languages, and implementations.
              </p>
            </section>
            <section>
              <span class="compiler-article__label">bounded synthesis</span>
              <h3>Agents implement one small Slice</h3>
              <p>
                The model writes schemas, state transitions, handlers, and
                business rules inside an explicit feature boundary. It does not
                need the entire application in context.
              </p>
            </section>
            <section>
              <span class="compiler-article__label">
                deterministic acceptance
              </span>
              <h3>The contract judges the candidate</h3>
              <p>
                Specter reconstructs the scenario state, executes the candidate,
                and compares its Events, rejections, or outputs exactly. A
                different implementation must pass the same cases.
              </p>
            </section>
            <section>
              <span class="compiler-article__label">
                capability, not automation
              </span>
              <h3>The implementation can remain nondeterministic</h3>
              <p>
                Specter does not need to generate the whole application or
                orchestrate a particular agent. It makes agent-written code
                subject to stable, executable constraints.
              </p>
            </section>
          </div>

          <aside class="compiler-article__boundary">
            <strong>What the metaphor promises.</strong>
            <p>
              The generated code may vary; the specified examples it must
              satisfy do not. Behavior absent from the specification remains
              unspecified, just as source code cannot determine behavior it
              never defines.
            </p>
          </aside>
        </article>

        <section class="band" id="how">
          <div class="band__head">
            <h2>How it works</h2>
            <p>
              The specification records the behavior that must remain stable. An
              implementation supplies runtime details, and Specter checks the
              two together through scenario tests and construction-time
              conformance.
            </p>
          </div>
          <div class="grid grid--3">
            <article class="card">
              <h3>Specify the what</h3>
              <p>
                Give one Command, Query, or Reaction Slice a stable name,
                description, and exact scenarios in <code>spec.ts</code>.
              </p>
            </article>
            <article class="card">
              <h3>Export one portable contract</h3>
              <p>
                Deterministically export adjacent <code>spec.json</code>. Every
                runtime and tool consumes the same strict contract.
              </p>
            </article>
            <article class="card">
              <h3>Implement, validate, and compose</h3>
              <p>
                Supply language-native schemas and handlers, run every scenario,
                then register one implementation per Slice.
              </p>
            </article>
          </div>
        </section>

        <section class="stage" id="architecture">
          <div class="band__head">
            <h2>Six explicit boundaries</h2>
            <p>
              Specifications, implementations, tests, runtime state, and typed
              operations each have one explicit job.
            </p>
          </div>
        </section>

        <section class="stage" id="specification">
          <div class="stage__grid">
            <div class="stage__copy">
              <span class="stage__step">01 · specification</span>
              <h2>The behavior contract stays immutable</h2>
              <p>
                A Slice Specification contains only its name, human-readable
                description, and concrete <em>given / when / expect</em>{' '}
                scenarios. Runtime schemas, stores, plugins, and handlers stay
                out of this file.
              </p>
              <ul class="ticks">
                <li>Scenario Events use exact example payloads.</li>
                <li>
                  Specifications import only from <code>@specter-ts/spec</code>
                  and implementation-independent constants.
                </li>
                <li>
                  An accepted Command expects Events; an empty expectation
                  records a rejected outcome.
                </li>
              </ul>
            </div>
            <CodeBlock
              label="features/todos/add-todo/spec.ts"
              tag="spec"
              code={specSource}
            />
          </div>
        </section>

        <section class="stage" id="portable-contract">
          <div class="stage__grid stage__grid--flip">
            <CodeBlock
              label="features/todos/add-todo/spec.json"
              tag="portable contract"
              code={portableSpecSource}
            />
            <div class="stage__copy">
              <span class="stage__step">02 · portable JSON</span>
              <h2>One behavior contract, independent of runtime language</h2>
              <p>
                <code>specter-spec export</code> converts the TypeScript
                authoring DSL into strict, versioned JSON. Implementations,
                scenario runners, and visual tools consume only this artifact.
              </p>
              <ul class="ticks">
                <li>Unknown fields and unsafe JSON values are rejected.</li>
                <li>Canonical bytes produce a stable specification digest.</li>
                <li>TypeScript and Go validate the same fixtures.</li>
              </ul>
            </div>
          </div>
        </section>

        <section class="stage" id="implementation">
          <div class="stage__grid stage__grid--flip">
            <CodeBlock
              label="features/todos/add-todo/impl.ts"
              tag="implementation"
              code={implementationSource}
            />
            <div class="stage__copy">
              <span class="stage__step">03 · implementation</span>
              <h2>Runtime details complete the specification</h2>
              <p>
                The implementation loads generated portable JSON, supplies the
                schema stages required by that Slice kind, selects a private
                Slice Store, applies relevant Events, and finishes with a
                handler.
              </p>
              <ul class="ticks">
                <li>
                  The builder order makes every runtime dependency visible.
                </li>
                <li>Slice State stays private and catches up from Events.</li>
                <li>One specification can have divergent implementations.</li>
              </ul>
            </div>
          </div>
        </section>

        <section class="stage" id="scenario-tests">
          <div class="stage__grid">
            <div class="stage__copy">
              <span class="stage__step">04 · scenario tests</span>
              <h2>Run every implementation against its contract</h2>
              <p>
                A small test entry point registers the selected implementations,
                the app's Event Definition catalog, and a scenario runner. The
                scenario descriptions become the test names.
              </p>
              <ul class="ticks">
                <li>Given Events rebuild the Slice's private test state.</li>
                <li>Expected Events and rejections are checked exactly.</li>
                <li>
                  Registries keep app composition explicit and inspectable.
                </li>
              </ul>
            </div>
            <CodeBlock
              label="features/todos/scenarios.test.ts"
              tag="validation"
              code={scenarioTestSource}
            />
          </div>
        </section>

        <section class="stage" id="event-log">
          <div class="stage__grid stage__grid--flip">
            <CodeBlock
              label="app event log"
              tag="durable"
              tone="output"
              code={eventLog}
            />
            <div class="stage__copy">
              <span class="stage__step">05 · event log</span>
              <h2>Accepted facts stay in one ordered history</h2>
              <p>
                The Event Log is the durable source of truth for a Specter App.
                Accepted Commands append domain facts; each Slice catches up by
                applying the relevant Events in global order.
              </p>
              <ul class="ticks">
                <li>Event payloads contain domain facts, not log metadata.</li>
                <li>
                  The starter supplies SQLite; the core depends on an Event Log
                  adapter contract.
                </li>
                <li>
                  Slice State can catch up again by replaying relevant Events.
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section class="stage" id="orchestration">
          <div class="stage__grid">
            <div class="stage__copy">
              <span class="stage__step">flow · reactions</span>
              <h2>Slices are orchestrated through events</h2>
              <p>
                Slices don't call each other. A command appends events; reaction
                Slices observe committed Events and may produce one typed
                output. A Reaction Plugin interprets that output, including
                dispatching a follow-up Command when appropriate.
              </p>
              <div class="flow" aria-hidden="true">
                <span class="flow__node">command</span>
                <span class="flow__edge">emits →</span>
                <span class="flow__node flow__node--event">event</span>
                <span class="flow__edge">observed by →</span>
                <span class="flow__node">reaction</span>
                <span class="flow__edge">effect →</span>
                <span class="flow__node flow__node--muted">command</span>
              </div>
            </div>
            <CodeBlock
              label="features/todos/todo-completion-cheer-reaction/impl.ts"
              tag="reaction"
              code={reactionSource}
            />
          </div>
        </section>

        <section class="band" id="anywhere">
          <div class="band__head">
            <h2>Explicit edges around a stable core</h2>
            <p>
              Specifications do not depend on databases, transports, or UI
              frameworks. Implementations and app wiring choose those concrete
              boundaries without changing the behavior contract.
            </p>
          </div>
          <div class="grid grid--4">
            <For each={adapters}>
              {(adapter) => (
                <article class="card card--slot">
                  <h3>{adapter.slot}</h3>
                  <p>{adapter.detail}</p>
                  <p class="card__swap">{adapter.swap}</p>
                </article>
              )}
            </For>
          </div>
        </section>

        <section class="stage" id="external">
          <div class="stage__grid stage__grid--flip">
            <CodeBlock
              label="features/notify/email-plugin.server.ts"
              tag="plugin"
              code={externalApiSource}
            />
            <div class="stage__copy">
              <span class="stage__step">integration · plugins</span>
              <h2>Keep external effects behind a plugin</h2>
              <p>
                A Reaction's typed output is interpreted by an explicit plugin.
                The plugin can call an external service or dispatch another
                Command while the specification stays focused on observable
                behavior.
              </p>
              <ul class="ticks">
                <li>Output schemas validate the value before execution.</li>
                <li>Service credentials stay in server-side plugin modules.</li>
                <li>
                  Use the stable delivery ID for downstream idempotency; wrap
                  slow effects with the optional outbox.
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section class="band" id="agents">
          <div class="band__head">
            <h2>Built for coding agents</h2>
            <p>
              The same boundaries that orient humans give agents smaller context
              windows and executable examples. Conformance diagnostics point
              back to a Slice, Scenario, Event, and schema path.
            </p>
          </div>
          <div class="grid grid--2">
            <For each={agentBenefits}>
              {(benefit) => (
                <article class="card">
                  <h3>{benefit.title}</h3>
                  <p>{benefit.body}</p>
                </article>
              )}
            </For>
          </div>
        </section>

        <section class="stage" id="typed-envelope">
          <div class="band__head">
            <span class="stage__step">06 · typed envelope</span>
            <h2>One typed envelope API in process or over the wire</h2>
            <p>
              The completed app exposes command, query, and subscription
              envelopes. A project-owned transport carries that same contract to
              remote UI code without importing server, database, or Slice
              modules.
            </p>
          </div>
          <figure class="map" aria-labelledby="app-shape-caption">
            <figcaption class="map__cap" id="app-shape-caption">
              completed app · explicit composition
            </figcaption>
            <p class="sr-only">
              A typed command envelope reaches the addTodo Command Slice and a
              typed query envelope reaches the todosQuery Query Slice.
              Registered implementations share the app's ordered Event Log.
            </p>
            <pre class="map__art" aria-hidden="true">
              {MAP_ART}
            </pre>
          </figure>
        </section>

        <section class="stage" id="observability">
          <div class="stage__grid">
            <div class="stage__copy">
              <span class="stage__step">observe · specification + runtime</span>
              <h2>See intended behavior beside real execution</h2>
              <p>
                Runtimes publish each immutable specification once, then attach
                its digest to Slice telemetry. The shared collector joins both
                streams without becoming part of application execution.
              </p>
              <ul class="ticks">
                <li>
                  Browse the whole Slice and every Given / When / Then lane.
                </li>
                <li>
                  Filter activity and causal traces to the exact spec version.
                </li>
                <li>TypeScript and Go producers appear in one dashboard.</li>
              </ul>
            </div>
            <CodeBlock
              label="observability dashboard / addTodo"
              tag="spec + telemetry"
              tone="output"
              code={observabilityOutput}
            />
          </div>
        </section>

        <section class="cta" id="start">
          <p class="preview-badge preview-badge--center">
            Specter 0.4 · available on main
          </p>
          <h2>Give Specter to your agent</h2>
          <p>
            Paste this prompt into your coding agent. It points at the source
            preview so the agent can inspect the architecture before touching
            your application.
          </p>
          <AgentPrompt />
          <div class="cta__links">
            <a href={GETTING_STARTED_URL}>Read the preview guide ↗</a>
            <a href={REPOSITORY_URL}>Browse the repository ↗</a>
          </div>
          <p class="cta__note">
            Specter 0.4 source is available on <code>main</code>. npm remains on
            the stable 0.2.1 release until the 0.4 packages are published.
          </p>
        </section>
      </main>

      <footer class="foot">
        <span>
          Specter · portable Slice specifications for vertically sliced,
          event-sourced apps.
        </span>
        <span class="foot__mark">
          spec.ts → spec.json → implementation → validation → runtime
        </span>
      </footer>
    </div>
  )
}

const MAP_ART = `        ┌───────────────────────── Specter App ─────────────────────────┐
        │                                                                │
command │   { type: 'addTodo', payload } ─▶ [ addTodo ] ─▶ ( todo-added )│
        │                                                    │           │
 query  │   { type: 'todosQuery', payload } ─▶ [ todosQuery ] ◀─────────┘│
        │                                                                │
        │   specifications + selected implementations + Event Definitions│
        │                                                                │
        │   ═══════════════════  ordered Event Log  ═══════════════════ │
        └────────────────────────────────────────────────────────────────┘`
