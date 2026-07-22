import { createSignal, For, type JSX } from 'solid-js'
import { CodeBlock } from './CodeBlock'
import {
  adapters,
  agentBenefits,
  eventLog,
  externalApiSource,
  implementationSource,
  pipeline,
  reactionSource,
  scenarioTestSource,
  specSource,
} from './content'

const REPOSITORY_URL = 'https://github.com/devagrawal09/specter'
const CLONE_COMMAND = `git clone ${REPOSITORY_URL}.git`
const AGENT_PROMPT = `Summarize \`${CLONE_COMMAND}\``
const GETTING_STARTED_URL = `${REPOSITORY_URL}/blob/main/docs/getting-started.md`

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
          <span class="brand__tag">main preview</span>
        </a>
        <nav class="topnav" aria-label="Pipeline">
          <For each={pipeline}>
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
        <a class="topbar__cta" href="#start">
          Give it to your agent
        </a>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section class="hero">
          <p class="preview-badge">Public preview · tracks main</p>
          <p class="eyebrow">
            Executable specifications · bounded agent context · TypeScript
          </p>
          <h1 class="hero__title">
            Give your coding agent a better architecture
          </h1>
          <p class="hero__lede">
            Specter turns each vertical Slice into an immutable specification,
            an executable implementation, and exact scenarios. Agents get a
            small behavior boundary to work inside; the runtime checks that the
            composed application still conforms.
          </p>
          <div class="hero__actions">
            <AgentPrompt />
            <a class="btn btn--ghost" href="#pipeline">
              See the pipeline
            </a>
            <a class="btn btn--text" href={REPOSITORY_URL}>
              View on GitHub ↗
            </a>
          </div>

          <div class="hero__pipeline" aria-hidden="true">
            <For each={pipeline}>
              {(stage, i) => (
                <>
                  <span class="chip">
                    <b>{stage.step}</b>
                    {stage.title}
                  </span>
                  {i() < pipeline.length - 1 ? (
                    <span class="chip__arrow">→</span>
                  ) : null}
                </>
              )}
            </For>
          </div>
        </section>

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
              <h3>Implement the how</h3>
              <p>
                Complete that specification in <code>impl.ts</code> with
                schemas, a private store, apply handlers, and its terminal
                handler.
              </p>
            </article>
            <article class="card">
              <h3>Validate and compose</h3>
              <p>
                Run every scenario against the implementation, then register one
                complete implementation per Slice in the Specter App.
              </p>
            </article>
          </div>
        </section>

        <section class="stage" id="pipeline">
          <div class="band__head">
            <h2>The pipeline</h2>
            <p>
              specification → implementation → scenario tests → event log →
              typed envelope. Each boundary has one explicit job.
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

        <section class="stage" id="implementation">
          <div class="stage__grid stage__grid--flip">
            <CodeBlock
              label="features/todos/add-todo/impl.ts"
              tag="implementation"
              code={implementationSource}
            />
            <div class="stage__copy">
              <span class="stage__step">02 · implementation</span>
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
              <span class="stage__step">03 · scenario tests</span>
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
              <span class="stage__step">04 · event log</span>
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
                  Swap an interpreter without rewriting the specification.
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

        <section class="cta" id="start">
          <p class="preview-badge preview-badge--center">Main branch preview</p>
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
            Preview source tracks <code>main</code>. npm remains on the stable
            0.2.1 release; this page does not announce npm 0.3.0.
          </p>
        </section>
      </main>

      <footer class="foot">
        <span>
          Specter · a TypeScript framework for vertically sliced, event-sourced
          apps.
        </span>
        <span class="foot__mark">
          specification → implementation → validation → event log → envelope
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
